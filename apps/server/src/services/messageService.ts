import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { campaignMessageInputSchema, messageDraftInputSchema, messageSubmitSchema } from '@outreacher/shared';
import {
  emptyContact,
  findContactByEmail,
  findContactsByIds,
  insertContactIfMissing,
} from '../db/repositories/contacts.js';
import type { Contact } from '../db/repositories/contacts.js';
import {
  claimMessagePreparation,
  deleteMessageDraft as deleteMessageDraftRecord,
  failMessagePreparation,
  findMessage as findMessageRecord,
  finishMessagePreparation,
  messagePreparationOwned,
  renewMessagePreparation,
  transitionMessage,
} from '../db/repositories/messages.js';
import type { Message } from '../db/repositories/messages.js';
import {
  createJob,
  deleteJobsForMessagePreparation,
  skipQueuedJobs,
} from '../db/repositories/jobs.js';
import { HttpError } from '../lib/HttpError.js';
import {
  getMailAccount,
  cleanHtml,
  plainText,
  renderMessage,
  unsubscribeUrl,
  validateTemplate,
} from './emailService.js';

export async function findMessage(
  projectId: string,
  id: string,
): Promise<Message> {
  const message = findMessageRecord(projectId, id);
  if (!message) throw new HttpError(404, 'Message not found.');
  return message;
}

export async function resolveMessage(
  projectId: string,
  value: unknown,
  create = false,
  renewPreparation?: () => Promise<void>,
) {
  const input = messageDraftInputSchema.parse(value);
  const content = await validateTemplate(projectId, {
    name: 'Compose',
    ...campaignMessageInputSchema.parse({
      subject: input.subject,
      html: input.html,
    }),
  });
  const selected = findContactsByIds(projectId, input.contactIds);
  const emails = new Set(selected.map((contact) => contact.email));
  let excluded = new Set(input.contactIds).size - selected.length;
  for (const address of input.addresses)
    emails.add(z.email().parse(address.toLowerCase()));
  const contacts: Contact[] = [];
  for (const email of emails) {
    await renewPreparation?.();
    let contact = findContactByEmail(projectId, email);
    if (!contact && create) {
      // The unique project/email index arbitrates concurrent submissions without overwrites.
      contact = insertContactIfMissing(projectId, email);
    }
    if (contact?.suppressed || contact?.deletedAt) {
      excluded++;
      continue;
    }
    contacts.push(contact ?? emptyContact(projectId, email));
  }
  return { input, content, contacts, excluded };
}

export function replyContent(message: Message, value: unknown) {
  const input = messageDraftInputSchema.parse(value);
  const context = message.replyContext;
  if (
    message.kind !== 'reply' ||
    !context ||
    context.accountId !== input.emailAccountId ||
    input.contactIds.length ||
    input.addresses.length !== 1 ||
    input.addresses[0] !== context.recipient
  )
    throw new HttpError(400, 'Reply account and destination cannot be changed.');
  return input;
}

export function renderReply(message: Message, value: unknown) {
  const input = replyContent(message, value);
  campaignMessageInputSchema.parse({ subject: input.subject, html: input.html });
  const html = cleanHtml(input.html),
    text = plainText(html);
  if (!text.trim()) throw new HttpError(400, 'Reply body must contain text.');
  return { subject: input.subject, html, text };
}

export async function submitMessage(
  projectId: string,
  id: string,
  value: unknown,
) {
  const { retry } = messageSubmitSchema.parse(value);
  const existing = await findMessage(projectId, id);
  if (
    existing.state !== 'draft' &&
    !(retry && existing.state === 'preparation_failed')
  )
    return existing;
  const input = messageDraftInputSchema.parse({
    subject: existing.subject,
    html: existing.html,
    contactIds: existing.contactIds,
    addresses: existing.addresses,
    emailAccountId: existing.emailAccountId,
  });
  if (!input.emailAccountId) throw new HttpError(400, 'Choose a mail account.');
  const account = await getMailAccount(projectId, input.emailAccountId);
  if (!account.host || !account.senderEmail || account.sendingError)
    throw new HttpError(400, 'Save corrected SMTP settings before sending.');
  const isReply = existing.kind === 'reply';
  if (isReply) renderReply(existing, input);
  const resolved = isReply ? null : await resolveMessage(projectId, input);
  if (resolved && !resolved.contacts.length)
    throw new HttpError(400, 'No eligible recipients.');
  if (!isReply) unsubscribeUrl(projectId, '000000000000000000000000');
  const preparationToken = randomUUID();
  const claimed = claimMessagePreparation(
    projectId,
    id,
    existing.state,
    existing.updatedAt,
    preparationToken,
    new Date(Date.now() + 120000),
    {
      senderEmail: account.senderEmail,
      senderName: account.senderName,
      replyTo: account.replyTo,
    },
  );
  if (!claimed) return findMessage(projectId, id);
  const renew = () => {
    renewMessagePreparation(
      projectId,
      id,
      preparationToken,
      new Date(Date.now() + 120000),
    );
  };
  try {
    if (existing.preparationToken)
      deleteJobsForMessagePreparation(
        projectId,
        id,
        existing.preparationToken,
      );
    if (isReply) {
      const context = existing.replyContext;
      if (!context) throw new Error('Missing reply context');
      if (!messagePreparationOwned(projectId, id, preparationToken))
        throw new Error('Preparation lease lost');
      createJob({
        projectId,
        messageId: id,
        preparationToken,
        email: z.email().parse(context.recipient),
        ...renderReply(existing, input),
        inReplyTo: context.messageId || undefined,
        references: context.messageId
          ? [...context.references, context.messageId]
          : [],
      });
      finishMessagePreparation(projectId, id, preparationToken, {
        total: 1,
        excluded: 0,
      });
    } else {
      const { content, contacts, excluded } = await resolveMessage(
        projectId,
        input,
        true,
        async () => {
          if (!messagePreparationOwned(projectId, id, preparationToken))
            throw new Error('Preparation lease lost');
          renew();
        },
      );
      for (const contact of contacts) {
        if (!messagePreparationOwned(projectId, id, preparationToken))
          throw new Error('Preparation lease lost');
        const url = unsubscribeUrl(projectId, contact.id);
        createJob({
          projectId,
          messageId: id,
          contactId: contact.id,
          preparationToken,
          email: contact.email,
          ...renderMessage(content, contact, url),
          unsubscribeUrl: url,
        });
        renew();
      }
      finishMessagePreparation(projectId, id, preparationToken, {
        total: contacts.length,
        excluded,
      });
    }
  } catch {
    failMessagePreparation(
      projectId,
      id,
      preparationToken,
      'Preparation interrupted. Explicit retry required.',
    );
  }
  const message = await findMessage(projectId, id);
  if (message.state === 'cancelled')
    skipQueuedJobs(
      { projectId, messageId: id, preparationToken },
      'Message cancelled.',
    );
  return message;
}

export { deleteMessageDraftRecord, transitionMessage };
