import type { RequestHandler } from 'express';
import { z } from 'zod';
import { idSchema, messageDraftInputSchema } from '@outreacher/shared';
import {
  createMessage,
  deleteMessageDraft,
  findMessage as findMessageRecord,
  listMessages,
  serializeMessage,
  transitionMessage,
  updateMessageDraft,
} from '../db/repositories/messages.js';
import {
  countJobs,
  countJobsByState,
  listJobs,
  skipQueuedJobs,
} from '../db/repositories/jobs.js';
import { getProjectId } from '../lib/getProjectId.js';
import { HttpError } from '../lib/HttpError.js';
import {
  findMessage,
  renderReply,
  replyContent,
  resolveMessage,
  submitMessage,
} from '../services/messageService.js';
import {
  getMailAccount,
  renderMessage,
  unsubscribeUrl,
} from '../services/emailService.js';

export const list: RequestHandler = async (req, res) => {
  res.json(listMessages(getProjectId(req)).map(serializeMessage));
};

export const read: RequestHandler = async (req, res) => {
  res.json(
    serializeMessage(
      await findMessage(getProjectId(req), idSchema.parse(req.params.id)),
    ),
  );
};

export const save: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const input = messageDraftInputSchema.parse(req.body);
  if (req.params.id) {
    const existing = findMessageRecord(
      projectId,
      idSchema.parse(req.params.id),
    );
    if (!existing) throw new HttpError(409, 'Only drafts can be edited.');
    if (existing.kind === 'reply') replyContent(existing, input);
  }
  if (input.emailAccountId)
    await getMailAccount(projectId, input.emailAccountId);
  const message = req.params.id
    ? updateMessageDraft(projectId, idSchema.parse(req.params.id), input)
    : createMessage(projectId, input);
  if (!message) throw new HttpError(409, 'Only drafts can be edited.');
  res.status(req.params.id ? 200 : 201).json(serializeMessage(message));
};

export const remove: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const id = idSchema.parse(req.params.id);
  await findMessage(projectId, id);
  if (!deleteMessageDraft(projectId, id))
    throw new HttpError(409, 'Only drafts can be deleted.');
  res.status(204).end();
};

export const preview: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const { contacts, content, excluded } = await resolveMessage(
    projectId,
    req.body,
  );
  res.json({
    projectId,
    eligible: contacts.length,
    excluded,
    recipients: contacts.map((contact) => ({
      email: contact.email,
      ...renderMessage(
        content,
        contact,
        unsubscribeUrl(projectId, contact.id),
      ),
    })),
  });
};

export const submit: RequestHandler = async (req, res) => {
  res.json(
    serializeMessage(
      await submitMessage(
        getProjectId(req),
        idSchema.parse(req.params.id),
        req.body,
      ),
    ),
  );
};

export const action: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const id = idSchema.parse(req.params.id);
  const action = z.enum(['cancel', 'resume']).parse(req.params.action);
  const message = await findMessage(projectId, id);
  if (action === 'resume') {
    if (
      !message.emailAccountId ||
      (await getMailAccount(projectId, message.emailAccountId)).sendingError
    )
      throw new HttpError(409, 'Save corrected SMTP settings before resuming.');
  }
  const validStates =
    action === 'resume'
      ? (['paused'] as const)
      : (['preparing', 'preparation_failed', 'active', 'paused'] as const);
  const result = transitionMessage(
    projectId,
    id,
    [...validStates],
    action === 'resume' ? 'active' : 'cancelled',
  );
  if (!result)
    throw new HttpError(409, 'Message state changed; reload and try again.');
  if (action === 'cancel')
    skipQueuedJobs(
      { projectId, messageId: id },
      'Message cancelled.',
    );
  res.json(serializeMessage(result));
};

export const report: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const id = idSchema.parse(req.params.id);
  const message = await findMessage(projectId, id);
  const { page } = z
    .object({ page: z.coerce.number().int().min(1).default(1) })
    .strict()
    .parse(req.query);
  const filter = {
    projectId,
    messageId: id,
    ...(message.preparationToken
      ? { preparationToken: message.preparationToken }
      : {}),
  };
  const rows = listJobs(filter, { limit: 100, offset: (page - 1) * 100 });
  res.json({
    projectId,
    total: countJobs(filter),
    counts: countJobsByState(filter),
    items: rows.map((job) => ({
      id: job.id,
      projectId,
      messageId: id,
      email: job.email,
      state: job.state,
      reason: job.reason,
      attempts: job.attempts.map((attempt) => ({
        at: attempt.at.toISOString(),
        state: attempt.state,
        reason: attempt.reason,
      })),
    })),
  });
};

export const previewReply: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const message = await findMessage(
    projectId,
    idSchema.parse(req.params.id),
  );
  const content = renderReply(message, req.body);
  res.json({
    projectId,
    eligible: 1,
    excluded: 0,
    recipients: [
      {
        email: message.replyContext?.recipient,
        ...content,
        warnings: [],
      },
    ],
  });
};
