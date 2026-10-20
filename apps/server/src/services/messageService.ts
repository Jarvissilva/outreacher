import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { campaignMessageInputSchema, messageDraftInputSchema, messageSubmitSchema } from '@outreachit/shared';
import { ContactModel } from '../models/ContactModel.js';
import { MessageModel, RecipientJobModel } from '../models/EmailModels.js';
import { HttpError } from '../lib/HttpError.js';
import { getMailAccount, cleanHtml, plainText, renderMessage, unsubscribeUrl, validateTemplate } from './emailService.js';
export async function findMessage(projectId: string, id: string) {
  const m = await MessageModel.findOne({ _id: id, projectId });
  if (!m) throw new HttpError(404, 'Message not found.');
  return m;
}
export async function resolveMessage(
  projectId: string, value: unknown, create = false,
  renewPreparation?: () => Promise<void>,
) {
  const input = messageDraftInputSchema.parse(value);
  const content = await validateTemplate(projectId, { name: 'Compose', ...campaignMessageInputSchema.parse({ subject: input.subject, html: input.html }) });
  const selected = await ContactModel.find({ projectId, _id: { $in: input.contactIds } });
  const emails = new Set(selected.map(c => c.email));
  let excluded = new Set(input.contactIds).size - selected.length;
  for (const address of input.addresses) emails.add(z.email().parse(address.toLowerCase()));
  const contacts = [];
  for (const email of emails) {
    await renewPreparation?.();
    let contact = await ContactModel.findOne({ projectId, email });
    if (!contact && create) {
      // The unique project/email index arbitrates concurrent submissions without overwrites.
      try { contact = await ContactModel.findOneAndUpdate({ projectId, email }, { $setOnInsert: { projectId, email } }, { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }); }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 11000)) throw error;
        contact = await ContactModel.findOne({ projectId, email });
      }
    }
    if (contact?.suppressed || contact?.deletedAt) { excluded++; continue; }
    contacts.push(contact ?? new ContactModel({ projectId, email }));
  }
  return { input, content, contacts, excluded };
}
export function replyContent(message: InstanceType<typeof MessageModel>, value: unknown) {
  const input = messageDraftInputSchema.parse(value);
  const context = message.replyContext;
  if (message.kind !== 'reply' || !context || String(context.accountId) !== input.emailAccountId ||
    input.contactIds.length || input.addresses.length !== 1 || input.addresses[0] !== context.recipient)
    throw new HttpError(400, 'Reply account and destination cannot be changed.');
  return input;
}
export function renderReply(message: InstanceType<typeof MessageModel>, value: unknown) {
  const input = replyContent(message, value);
  campaignMessageInputSchema.parse({ subject: input.subject, html: input.html });
  const html = cleanHtml(input.html), text = plainText(html);
  if (!text.trim()) throw new HttpError(400, 'Reply body must contain text.');
  return { subject: input.subject, html, text };
}
export async function submitMessage(projectId: string, id: string, value: unknown) {
  const { retry } = messageSubmitSchema.parse(value);
  const existing = await findMessage(projectId, id);
  if (existing.state !== 'draft' && !(retry && existing.state === 'preparation_failed')) return existing;
  const input = messageDraftInputSchema.parse({ subject: existing.subject, html: existing.html, contactIds: existing.contactIds, addresses: existing.addresses, emailAccountId: existing.emailAccountId ? String(existing.emailAccountId) : null });
  if (!input.emailAccountId) throw new HttpError(400, 'Choose a mail account.');
  const account = await getMailAccount(projectId, input.emailAccountId);
  if (!account.host || !account.senderEmail || account.sendingError) throw new HttpError(400, 'Save corrected SMTP settings before sending.');
  const isReply = existing.kind === 'reply';
  if (isReply) renderReply(existing, input);
  const resolved = isReply ? null : await resolveMessage(projectId, input);
  if (resolved && !resolved.contacts.length) throw new HttpError(400, 'No eligible recipients.');
  if (!isReply) unsubscribeUrl(projectId, '000000000000000000000000');
  const preparationToken = randomUUID();
  const owned = { _id: id, projectId, state: 'preparing', preparationToken };
  const claimed = await MessageModel.findOneAndUpdate({ _id: id, projectId, state: existing.state, updatedAt: existing.updatedAt }, {
    $set: {
      state: 'preparing', preparationToken, preparationUntil: new Date(Date.now() + 120000), error: '',
      senderEmail: account.senderEmail, senderName: account.senderName, replyTo: account.replyTo,
    }
  });
  if (!claimed) return findMessage(projectId, id);
  try {
    if (existing.preparationToken)
      await RecipientJobModel.deleteMany({ projectId, messageId: id, preparationToken: existing.preparationToken });
    if (isReply) {
      const context = existing.replyContext;
      if (!context) throw new Error('Missing reply context');
      if (!(await MessageModel.exists(owned))) throw new Error('Preparation lease lost');
      await RecipientJobModel.create({ projectId, messageId: id, preparationToken,
        email: z.email().parse(context.recipient), ...renderReply(existing, input),
        inReplyTo: context.messageId || undefined,
        references: context.messageId ? [...context.references, context.messageId] : [],
      });
      await MessageModel.updateOne(owned, { $set: { state: 'active', total: 1, excluded: 0 } });
    } else {
      const { content, contacts, excluded } = await resolveMessage(projectId, input, true, async () => {
        const renewed = await MessageModel.updateOne(owned, {
          $set: { preparationUntil: new Date(Date.now() + 120000) },
        });
        if (!renewed.matchedCount) throw new Error('Preparation lease lost');
      });
      for (const contact of contacts) {
        if (!(await MessageModel.exists(owned))) throw new Error('Preparation lease lost');
        const url = unsubscribeUrl(projectId, String(contact._id));
        await RecipientJobModel.create({
          projectId, messageId: id, contactId: contact._id, preparationToken,
          email: contact.email, ...renderMessage(content, contact, url), unsubscribeUrl: url
        });
        await MessageModel.updateOne(owned, { $set: { preparationUntil: new Date(Date.now() + 120000) } });
      }
      await MessageModel.updateOne(owned, { $set: { state: 'active', total: contacts.length, excluded } });
    }
  } catch {
    await MessageModel.updateOne(owned, { $set: { state: 'preparation_failed', error: 'Preparation interrupted. Explicit retry required.' } });
  }
  if (await MessageModel.exists({ _id: id, projectId, state: 'cancelled' }))
    await RecipientJobModel.updateMany({ projectId, messageId: id, preparationToken, state: { $in: ['queued', 'claimed'] } }, { $set: { state: 'skipped', reason: 'Message cancelled.' } });
  return findMessage(projectId, id);
}

