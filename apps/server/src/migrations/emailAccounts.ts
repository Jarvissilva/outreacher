import { isDeepStrictEqual } from 'node:util';
import mongoose from 'mongoose';
import { z } from 'zod';
import { sendingSettingsInputSchema } from '@outreachit/shared';
import { MailAccountModel, CampaignModel } from '../models/EmailModels.js';
import { ProjectModel } from '../models/ProjectModel.js';

const policySchema = sendingSettingsInputSchema.extend({ nextSendAt: z.date() });
const policyKeys = ['hourlyLimit', 'timeZone', 'nextSendAt'] as const;

// Offline migration: stop all previous servers/workers before starting this version.
// Raw collections avoid schema defaults concealing missing legacy values. Copy first,
// compare every copied value, and only then drop sources. Each step can be repeated.
export async function migrateEmailAccounts() {
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database is not connected.');
  const collections = new Set((await db.listCollections().toArray()).map((c) => c.name));
  const oldAccounts = collections.has('emailsettings')
    ? await db.collection('emailsettings').find().sort({ _id: 1 }).toArray()
    : [];
  const oldPolicies = collections.has('projectemailsettings')
    ? await db.collection('projectemailsettings').find().toArray()
    : [];
  const projects = await ProjectModel.collection.find().toArray();
  const projectIds = new Set(projects.map((p) => String(p._id)));
  for (const row of [...oldAccounts, ...oldPolicies]) {
    if (!projectIds.has(String(row.projectId)))
      throw new Error('Legacy mail settings reference a missing project.');
  }
  const accounts = oldAccounts.map((row) => {
    const account = { ...row };
    for (const key of policyKeys) delete account[key];
    return account;
  });
  for (const account of accounts) {
    const existing = await MailAccountModel.collection.findOne({ _id: account._id });
    if (existing && !isDeepStrictEqual(existing, account))
      throw new Error('Conflicting mail account migration data.');
  }
  const policies = projects.map((project) => {
    const saved = oldPolicies.filter((p) => String(p.projectId) === String(project._id));
    if (saved.length > 1) throw new Error('Conflicting project sending settings.');
    const smtp = oldAccounts.filter((a) => String(a.projectId) === String(project._id));
    const values: Record<string, unknown> = {};
    for (const key of policyKeys) {
      let value: unknown = project[key] ?? saved[0]?.[key];
      if (value == null) {
        const candidates = smtp.map((a) => a[key]).filter((v: unknown) => v != null);
        if (candidates.some((v: unknown) => !isDeepStrictEqual(v, candidates[0])))
          throw new Error('Conflicting legacy SMTP sending settings.');
        value = candidates[0];
      }
      values[key] = value ?? (key === 'hourlyLimit' ? 60 : key === 'timeZone' ? 'UTC' : new Date(0));
    }
    return { id: project._id, policy: policySchema.parse(values) };
  });
  for (const account of accounts) {
    await MailAccountModel.collection.updateOne(
      { _id: account._id }, { $setOnInsert: account }, { upsert: true },
    );
  }
  for (const { id, policy } of policies) {
    await ProjectModel.collection.updateOne({ _id: id }, { $set: policy });
    const stored = await ProjectModel.collection.findOne({ _id: id });
    for (const key of policyKeys) {
      if (!isDeepStrictEqual(stored?.[key], policy[key]))
        throw new Error('Project sending settings verification failed.');
    }
  }
  for (const account of accounts) {
    if (!isDeepStrictEqual(await MailAccountModel.collection.findOne({ _id: account._id }), account))
      throw new Error('Mail account migration verification failed.');
  }
  // Original single-account campaigns did not store an account reference.
  // Preserve all existing references and all campaign/job snapshots and history.
  for (const project of projects) {
    const candidates = await MailAccountModel.find({ projectId: project._id });
    if (candidates.length === 1 && candidates[0] && !candidates[0].archivedAt) {
      await CampaignModel.updateMany(
        { projectId: project._id, emailAccountId: null },
        { $set: { emailAccountId: candidates[0]._id } },
      );
    }
  }
  for (const campaign of await CampaignModel.find({ emailAccountId: { $ne: null } })) {
    if (!(await MailAccountModel.exists({ _id: campaign.emailAccountId, projectId: campaign.projectId })))
      throw new Error('Campaign references a missing or conflicting mail account.');
  }
  await MailAccountModel.createIndexes();
  for (const name of ['emailsettings', 'projectemailsettings']) {
    if (collections.has(name)) await db.collection(name).drop();
  }
}
