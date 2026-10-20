import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, after, it } from 'node:test';
import mongoose, { Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { migrateEmailAccounts } from '../src/migrations/emailAccounts.js';
import { MailAccountModel, CampaignModel, RecipientJobModel } from '../src/models/EmailModels.js';
import { ProjectModel } from '../src/models/ProjectModel.js';
let memory: MongoMemoryServer | undefined;
before(async () => {
  const uri = process.env.TEST_MONGODB_URI ?? (memory = await MongoMemoryServer.create()).getUri();
  await mongoose.connect(uri, { dbName: `outreachit_test_migration_${randomUUID().replaceAll('-', '')}`, autoIndex: false });
});
beforeEach(async () => { await mongoose.connection.dropDatabase(); });
after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await memory?.stop();
});
function db() {
  const database = mongoose.connection.db;
  assert.ok(database);
  return database;
}
const reservation = new Date('2030-01-01T00:00:00Z');
async function legacy() {
  const projectId = new Types.ObjectId();
  await db().collection('projects').insertOne({ _id: projectId, name: 'Legacy', normalizedName: 'legacy' });
  const account = {
    _id: new Types.ObjectId(), projectId, host: 'smtp.example.com', port: 587,
    tlsMode: 'starttls', username: 'user', passwordEncrypted: 'unchanged:cipher:text',
    senderName: 'Sender', senderEmail: 'sender@example.com', replyTo: '',
    hourlyLimit: 23, timeZone: 'Asia/Kolkata', nextSendAt: reservation,
  };
  await db().collection('emailsettings').insertOne(account);
  return account;
}
async function assertRemoved() {
  const names = (await db().listCollections().toArray()).map((c) => c.name);
  assert.ok(!names.includes('emailsettings'));
  assert.ok(!names.includes('projectemailsettings'));
}
it('initializes fresh projects and repeats without legacy collections', async () => {
  const project = await ProjectModel.create({ name: 'Fresh', normalizedName: 'fresh' });
  await migrateEmailAccounts();
  await migrateEmailAccounts();
  const stored = await ProjectModel.findById(project._id);
  assert.equal(stored?.hourlyLimit, 60);
  assert.equal(stored?.timeZone, 'UTC');
  assert.equal(stored?.nextSendAt.getTime(), 0);
  await assertRemoved();
});
it('migrates original SMTP records, ciphertext, references and history unchanged', async () => {
  const account = await legacy();
  await db().collection('emailsettings').createIndex({ projectId: 1 }, { unique: true });
  const campaign = await CampaignModel.create({ projectId: account.projectId, name: 'Campaign', templateId: new Types.ObjectId(), state: 'paused', senderEmail: 'frozen@example.com' });
  const job = await RecipientJobModel.create({ projectId: account.projectId, campaignId: campaign._id, contactId: new Types.ObjectId(), email: 'recipient@example.com', state: 'outcome_unknown', subject: 'Snapshot', attempts: [{ at: reservation, state: 'sending', reason: '' }] });
  const before = await RecipientJobModel.collection.findOne({ _id: job._id });
  await migrateEmailAccounts();
  await migrateEmailAccounts();
  const { hourlyLimit, timeZone, nextSendAt, ...expected } = account;
  assert.deepEqual(await MailAccountModel.collection.findOne({ _id: account._id }), expected);
  const project = await ProjectModel.findById(account.projectId);
  assert.equal(project?.hourlyLimit, hourlyLimit);
  assert.equal(project?.timeZone, timeZone);
  assert.deepEqual(project?.nextSendAt, nextSendAt);
  assert.equal(String((await CampaignModel.findById(campaign._id))?.emailAccountId), String(account._id));
  assert.equal((await CampaignModel.findById(campaign._id))?.senderEmail, 'frozen@example.com');
  assert.deepEqual(await RecipientJobModel.collection.findOne({ _id: job._id }), before);
  await assertRemoved();
});
it('preserves every account and explicit campaign reference with shared settings taking precedence', async () => {
  const first = await legacy();
  const second = { ...first, _id: new Types.ObjectId(), name: 'Second', archivedAt: reservation, passwordEncrypted: 'second:cipher:text', hourlyLimit: 99 };
  await db().collection('emailsettings').insertOne(second);
  await db().collection('projectemailsettings').insertOne({ projectId: first.projectId, hourlyLimit: 42, timeZone: 'Europe/London', nextSendAt: reservation });
  const campaign = await CampaignModel.create({ projectId: first.projectId, name: 'Selected', templateId: new Types.ObjectId(), emailAccountId: second._id });
  await migrateEmailAccounts();
  assert.equal(await MailAccountModel.countDocuments(), 2);
  assert.equal((await MailAccountModel.findById(second._id))?.passwordEncrypted, second.passwordEncrypted);
  assert.equal(String((await CampaignModel.findById(campaign._id))?.emailAccountId), String(second._id));
  assert.equal((await ProjectModel.findById(first.projectId))?.hourlyLimit, 42);
  await assertRemoved();
});
it('preserves embedded project settings and resumes partially copied accounts', async () => {
  const account = await legacy();
  const policy = { hourlyLimit: 12, timeZone: 'Europe/Paris', nextSendAt: new Date('2031-01-01') };
  await ProjectModel.collection.updateOne({ _id: account.projectId }, { $set: policy });
  const copy = { ...account };
  for (const key of ['hourlyLimit', 'timeZone', 'nextSendAt'] as const) Reflect.deleteProperty(copy, key);
  await MailAccountModel.collection.insertOne(copy);
  await migrateEmailAccounts();
  await migrateEmailAccounts();
  const stored = await ProjectModel.findById(account.projectId);
  assert.equal(stored?.hourlyLimit, policy.hourlyLimit);
  assert.deepEqual(stored?.nextSendAt, policy.nextSendAt);
  assert.equal(await MailAccountModel.countDocuments(), 1);
  await assertRemoved();
});
it('keeps both source collections on account conflicts and can retry after repair', async () => {
  const account = await legacy();
  await db().collection('projectemailsettings').insertOne({ projectId: account.projectId, hourlyLimit: 60, timeZone: 'UTC' });
  await MailAccountModel.collection.insertOne({ ...account, host: 'conflict.example.com' });
  await assert.rejects(migrateEmailAccounts, /Conflicting mail account/);
  assert.equal(await db().collection('emailsettings').countDocuments(), 1);
  assert.equal(await db().collection('projectemailsettings').countDocuments(), 1);
  await MailAccountModel.deleteMany({});
  await migrateEmailAccounts();
  await assertRemoved();
});
it('fails on ambiguous legacy policy and missing campaign references without dropping sources', async () => {
  const first = await legacy();
  await db().collection('emailsettings').insertOne({ ...first, _id: new Types.ObjectId(), hourlyLimit: 5 });
  await assert.rejects(migrateEmailAccounts, /Conflicting legacy SMTP/);
  await db().collection('projectemailsettings').insertOne({ projectId: first.projectId, hourlyLimit: 60, timeZone: 'UTC' });
  const campaign = await CampaignModel.create({ projectId: first.projectId, name: 'Broken', templateId: new Types.ObjectId(), emailAccountId: new Types.ObjectId() });
  await assert.rejects(migrateEmailAccounts, /Campaign references/);
  assert.equal(await db().collection('emailsettings').countDocuments(), 2);
  await CampaignModel.deleteOne({ _id: campaign._id });
  await migrateEmailAccounts();
  await assertRemoved();
});

it('uses defaults when legacy settings have no sending fields and removes empty legacy collections', async () => {
  const account = await legacy();
  await db().collection('emailsettings').updateOne({ _id: account._id }, { $unset: { hourlyLimit: '', timeZone: '', nextSendAt: '' } });
  await db().createCollection('projectemailsettings');
  await migrateEmailAccounts();
  const project = await ProjectModel.findById(account.projectId);
  assert.equal(project?.hourlyLimit, 60);
  assert.equal(project?.timeZone, 'UTC');
  assert.equal(project?.nextSendAt.getTime(), 0);
  await assertRemoved();
});
it('resumes after account sources were dropped but the shared policy collection remains', async () => {
  const account = await legacy();
  await db().collection('projectemailsettings').insertOne({ projectId: account.projectId, hourlyLimit: 31, timeZone: 'Europe/London', nextSendAt: reservation });
  await migrateEmailAccounts();
  await db().collection('projectemailsettings').insertOne({ projectId: account.projectId, hourlyLimit: 31, timeZone: 'Europe/London', nextSendAt: reservation });
  await migrateEmailAccounts();
  assert.equal((await ProjectModel.findById(account.projectId))?.hourlyLimit, 31);
  assert.equal((await MailAccountModel.findById(account._id))?.passwordEncrypted, account.passwordEncrypted);
  await assertRemoved();
});
