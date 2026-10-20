import type { RequestHandler } from 'express';
import { z } from 'zod';
import { idSchema, messageDraftInputSchema, recipientStates } from '@outreachit/shared';
import { getProjectId } from '../lib/getProjectId.js';
import { HttpError } from '../lib/HttpError.js';
import { MessageModel, RecipientJobModel, serializeMessage } from '../models/EmailModels.js';
import { findMessage, resolveMessage, submitMessage, replyContent, renderReply } from '../services/messageService.js';
import { getMailAccount, renderMessage, unsubscribeUrl } from '../services/emailService.js';
export const list: RequestHandler = async (req, res) => {
  res.json((await MessageModel.find({ projectId: getProjectId(req) }).sort({ createdAt: -1 })).map(serializeMessage));
};
export const read: RequestHandler = async (req, res) => { res.json(serializeMessage(await findMessage(getProjectId(req), idSchema.parse(req.params.id)))); };
export const save: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req), input = messageDraftInputSchema.parse(req.body);
  if (req.params.id) {
    const existing = await MessageModel.findOne({ projectId, _id: idSchema.parse(req.params.id) });
    if (!existing) throw new HttpError(409, 'Only drafts can be edited.');
    if (existing.kind === 'reply') replyContent(existing, input);
  }
  if (input.emailAccountId) await getMailAccount(projectId, input.emailAccountId);
  const m = req.params.id ? await MessageModel.findOneAndUpdate({ _id: idSchema.parse(req.params.id), projectId, state: 'draft' }, { $set: input }, { returnDocument: 'after' }) : await MessageModel.create({ projectId, ...input });
  if (!m) throw new HttpError(409, 'Only drafts can be edited.');
  res.status(req.params.id ? 200 : 201).json(serializeMessage(m));
};
export const remove: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req), id = idSchema.parse(req.params.id);
  await findMessage(projectId, id);
  if (!(await MessageModel.deleteOne({ _id: id, projectId, state: 'draft' })).deletedCount) throw new HttpError(409, 'Only drafts can be deleted.');
  res.status(204).end();
};
export const preview: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const { contacts, content, excluded } = await resolveMessage(projectId, req.body);
  res.json({ projectId, eligible: contacts.length, excluded, recipients: contacts.map(c => ({ email: c.email, ...renderMessage(content, c, unsubscribeUrl(projectId, String(c._id))) })) });
};
export const submit: RequestHandler = async (req, res) => { res.json(serializeMessage(await submitMessage(getProjectId(req), idSchema.parse(req.params.id), req.body))); };
export const action: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req), id = idSchema.parse(req.params.id);
  const action = z.enum(['cancel', 'resume']).parse(req.params.action);
  const m = await findMessage(projectId, id);
  if (action === 'resume') {
    if (!m.emailAccountId || (await getMailAccount(projectId, String(m.emailAccountId))).sendingError) throw new HttpError(409, 'Save corrected SMTP settings before resuming.');
  }
  const result = await MessageModel.findOneAndUpdate({ _id: id, projectId, state: { $in: action === 'resume' ? ['paused'] : ['preparing', 'preparation_failed', 'active', 'paused'] } }, { $set: { state: action === 'resume' ? 'active' : 'cancelled', error: '' } }, { returnDocument: 'after' });
  if (!result) throw new HttpError(409, 'Message state changed; reload and try again.');
  if (action === 'cancel') await RecipientJobModel.updateMany({ projectId, messageId: id, state: { $in: ['queued', 'claimed'] } }, { $set: { state: 'skipped', reason: 'Message cancelled.' } });
  res.json(serializeMessage(result));
};
export const report: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req), id = idSchema.parse(req.params.id);
  const m = await findMessage(projectId, id);
  const { page } = z.object({ page: z.coerce.number().int().min(1).default(1) }).strict().parse(req.query);
  const filter = { projectId, messageId: id, preparationToken: m.preparationToken };
  const rows = await RecipientJobModel.find(filter).sort({ _id: 1 }).skip((page - 1) * 100).limit(100);
  const counts: Record<string, number> = {};
  for (const state of recipientStates) counts[state] = await RecipientJobModel.countDocuments({ ...filter, state });
  res.json({ projectId, total: await RecipientJobModel.countDocuments(filter), counts, items: rows.map(j => ({ id: String(j._id), projectId, messageId: id, email: j.email, state: j.state, reason: j.reason, attempts: j.attempts.map(a => ({ at: a.at.toISOString(), state: a.state, reason: a.reason })) })) });
};

export const previewReply: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const message = await findMessage(projectId, idSchema.parse(req.params.id));
  const content = renderReply(message, req.body);
  res.json({ projectId, eligible: 1, excluded: 0, recipients: [{ email: message.replyContext?.recipient, ...content, warnings: [] }] });
};
