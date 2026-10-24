import type { RequestHandler } from 'express';
import {
  idSchema,
  incomingInputSchema,
  inboxIdentitySchema,
  inboxQuerySchema,
} from '@outreacher/shared';
import { getProjectId } from '../lib/getProjectId.js';
import { HttpError } from '../lib/HttpError.js';
import {
  getMailAccount,
  encryptPassword,
  serializeAccount,
} from '../services/emailService.js';
import {
  createReply,
  listInbox,
  readInbox,
  withInbox,
} from '../services/inboxService.js';
import { saveIncoming as saveIncomingRecord } from '../db/repositories/mailAccounts.js';
import { serializeMessage } from '../db/repositories/messages.js';

export const saveIncoming: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const accountId = idSchema.parse(req.params.accountId);
  const account = await getMailAccount(projectId, accountId);
  const { password, ...input } = incomingInputSchema.parse(req.body);
  const updated = saveIncomingRecord(projectId, accountId, {
    ...input,
    passwordEncrypted: input.useSmtpCredentials
      ? ''
      : password
        ? encryptPassword(password)
        : (account.incoming?.passwordEncrypted ?? ''),
  });
  if (!updated) throw new HttpError(404, 'Mail account not found.');
  res.json(serializeAccount(updated));
};

export const verify: RequestHandler = async (req, res) => {
  await withInbox(
    getProjectId(req),
    idSchema.parse(req.params.accountId),
    async () => {},
  );
  res.json({ ok: true });
};

export const list: RequestHandler = async (req, res) => {
  const accountId = idSchema.parse(req.params.accountId);
  const { page } = inboxQuerySchema.parse(req.query);
  res
    .set('Cache-Control', 'no-store')
    .json(
      await withInbox(getProjectId(req), accountId, (client) =>
        listInbox(client, accountId, page),
      ),
    );
};

export const read: RequestHandler = async (req, res) => {
  const accountId = idSchema.parse(req.params.accountId);
  const identity = inboxIdentitySchema.parse({
    uidValidity: req.params.uidValidity,
    uid: req.params.uid,
  });
  res
    .set('Cache-Control', 'no-store')
    .json(
      await withInbox(getProjectId(req), accountId, (client) =>
        readInbox(client, accountId, identity),
      ),
    );
};

export const reply: RequestHandler = async (req, res) => {
  res
    .status(201)
    .json(
      serializeMessage(
        await createReply(
          getProjectId(req),
          idSchema.parse(req.params.accountId),
          inboxIdentitySchema.parse(req.body),
        ),
      ),
    );
};
