import { inboxIdentitySchema } from '@outreachit/shared';
import { replyContent, renderReply } from '../src/services/messageService.js';
import assert from 'node:assert/strict';
import { it } from 'node:test';
import { messageDraftInputSchema, messageSchema, messageSubmitSchema } from '@outreachit/shared';
import { MessageModel, RecipientJobModel } from '../src/models/EmailModels.js';
it('permits incomplete drafts but rejects oversized input and unconfirmed submissions', () => {
  assert.equal(messageDraftInputSchema.safeParse({ addresses: ['unfinished'] }).success, true);
  assert.equal(messageDraftInputSchema.safeParse({ addresses: Array(10001).fill('a@example.com') }).success, false);
  assert.equal(messageSubmitSchema.safeParse({}).success, false);
  assert.equal(messageSubmitSchema.safeParse({ confirmed: true }).success, true);
  assert.equal(messageSchema.safeParse({}).success, false);
});
it('validates exclusive recipient ownership and keeps messages in a separate collection', async () => {
  const base = { projectId: '111111111111111111111111', contactId: '222222222222222222222222', email: 'person@example.com' };
  await assert.rejects(new RecipientJobModel(base).validate(), /exactly one/);
  await assert.rejects(new RecipientJobModel({ ...base, campaignId: base.projectId, messageId: base.projectId }).validate(), /exactly one/);
  await new RecipientJobModel({ ...base, messageId: base.projectId }).validate();
  await new MessageModel({ projectId: base.projectId }).validate();
  assert.equal(MessageModel.collection.name, 'messages');
});

const accountId = '111111111111111111111111', projectId = '222222222222222222222222';
it('locks reply destination and account, preserves literal content and rejects forged reply context', () => {
  const message = new MessageModel({ projectId, kind: 'reply', emailAccountId: accountId,
    replyContext: { accountId, recipient: 'reply@example.com', messageId: '', references: [], uidValidity: '1', uid: 1 },
  });
  const input = { emailAccountId: accountId, addresses: ['reply@example.com'], subject: 'Re: {{literal}}', html: '<p>{{unknown}} and {{unsubscribeUrl}}</p>' };
  const rendered = renderReply(message, input);
  assert.equal(rendered.subject, input.subject);
  assert.equal(rendered.html, input.html);
  assert.ok(!rendered.html.includes('Unsubscribe'));
  assert.throws(() => replyContent(message, { ...input, emailAccountId: projectId }), /cannot be changed/);
  assert.throws(() => replyContent(message, { ...input, addresses: ['other@example.com'] }), /cannot be changed/);
  assert.throws(() => replyContent(message, { ...input, contactIds: [projectId] }), /cannot be changed/);
  assert.equal(messageDraftInputSchema.safeParse({ ...input, kind: 'reply', replyContext: {} }).success, false);
  assert.throws(() => renderReply(message, { ...input, html: '<p></p>' }), /contain text/);
  assert.equal(inboxIdentitySchema.safeParse({ uidValidity: '0', uid: 1 }).success, false);
});
