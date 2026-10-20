import type { RequestHandler } from 'express';
import { idSchema, incomingInputSchema, inboxIdentitySchema, inboxQuerySchema } from '@outreachit/shared';
import { getProjectId } from '../lib/getProjectId.js';
import { getMailAccount, encryptPassword, serializeAccount } from '../services/emailService.js';
import { createReply, listInbox, readInbox, withInbox } from '../services/inboxService.js';
import { serializeMessage } from '../models/EmailModels.js';
export const saveIncoming: RequestHandler = async (req, res) => {
  const account = await getMailAccount(getProjectId(req), idSchema.parse(req.params.accountId));
  const { password, ...input } = incomingInputSchema.parse(req.body);
  account.set('incoming', { ...input, passwordEncrypted: input.useSmtpCredentials ? '' : password ? encryptPassword(password) : account.incoming?.passwordEncrypted ?? '' });
  await account.save();
  res.json(serializeAccount(account));
};
export const verify: RequestHandler = async (req, res) => {
  await withInbox(getProjectId(req), idSchema.parse(req.params.accountId), async () => {});
  res.json({ ok: true });
};
export const list: RequestHandler = async (req, res) => {
  const accountId = idSchema.parse(req.params.accountId);
  const { page } = inboxQuerySchema.parse(req.query);
  res.set('Cache-Control', 'no-store').json(await withInbox(getProjectId(req), accountId, client => listInbox(client, accountId, page)));
};
export const read: RequestHandler = async (req, res) => {
  const accountId = idSchema.parse(req.params.accountId);
  const identity = inboxIdentitySchema.parse({ uidValidity: req.params.uidValidity, uid: req.params.uid });
  res.set('Cache-Control', 'no-store').json(await withInbox(getProjectId(req), accountId, client => readInbox(client, accountId, identity)));
};
export const reply: RequestHandler = async (req, res) => {
  res.status(201).json(serializeMessage(await createReply(getProjectId(req), idSchema.parse(req.params.accountId), inboxIdentitySchema.parse(req.body))));
};
