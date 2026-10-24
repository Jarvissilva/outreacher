import assert from 'node:assert/strict';
import { before, beforeEach, it, after } from 'node:test';
import {
  inboxIdentitySchema,
  messageDraftInputSchema,
  messageSchema,
  messageSubmitSchema,
  replyContextSchema,
} from '@outreacher/shared';
import { replyContent, renderReply } from '../src/services/messageService.js';
import {
  createJob,
} from '../src/db/repositories/jobs.js';
import {
  createMessage,
  findMessage,
} from '../src/db/repositories/messages.js';
import { newId } from '../src/db/values.js';
import {
  resetTestDatabase,
  setupTestDatabase,
  teardownTestDatabase,
} from './support/database.js';

let projectId = '';
let accountId = '';

before(() => {
  setupTestDatabase();
});
beforeEach(() => {
  projectId = resetTestDatabase().id;
  accountId = newId();
});
after(() => {
  teardownTestDatabase();
});

it('permits incomplete drafts but rejects oversized input and unconfirmed submissions', () => {
  assert.equal(
    messageDraftInputSchema.safeParse({ addresses: ['unfinished'] }).success,
    true,
  );
  assert.equal(
    messageDraftInputSchema.safeParse({
      addresses: Array(10001).fill('a@example.com'),
    }).success,
    false,
  );
  assert.equal(messageSubmitSchema.safeParse({}).success, false);
  assert.equal(messageSubmitSchema.safeParse({ confirmed: true }).success, true);
  assert.equal(messageSchema.safeParse({}).success, false);
});

it('validates exclusive recipient ownership and keeps messages in their own table', () => {
  const contactId = newId();
  const base = {
    projectId,
    contactId,
    preparationToken: newId(),
    email: 'person@example.com',
    subject: '',
    html: '',
    text: '',
  };
  assert.throws(
    () => createJob({ ...base, campaignId: newId(), messageId: newId() }),
    /exactly one/,
  );
  assert.throws(() => createJob(base), /exactly one/);
  assert.throws(
    () => createJob({ ...base, messageId: newId(), contactId: undefined }),
    /Only validated replies/,
  );
  const message = createMessage(projectId, {
    subject: '',
    html: '',
    emailAccountId: accountId,
    contactIds: [],
    addresses: [],
  });
  assert.equal(message.kind, 'compose');
  assert.equal(findMessage(projectId, message.id)?.state, 'draft');
});

it('locks reply destination and account, preserves literal content and rejects forged reply context', () => {
  const replyContext = replyContextSchema.parse({
    accountId,
    recipient: 'reply@example.com',
    messageId: '',
    references: [],
    uidValidity: '1',
    uid: 1,
    subject: 'Original',
    from: 'sender@example.com',
    text: 'Original body',
  });
  const message = createMessage(
    projectId,
    {
      emailAccountId: accountId,
      addresses: ['reply@example.com'],
      subject: 'Re: {{literal}}',
      html: '<p>{{unknown}} and {{unsubscribeUrl}}</p>',
      contactIds: [],
    },
    { kind: 'reply', replyContext },
  );
  const input = {
    emailAccountId: accountId,
    addresses: ['reply@example.com'],
    subject: 'Re: {{literal}}',
    html: '<p>{{unknown}} and {{unsubscribeUrl}}</p>',
  };
  const rendered = renderReply(message, input);
  assert.equal(rendered.subject, input.subject);
  assert.equal(rendered.html, input.html);
  assert.ok(!rendered.html.includes('Unsubscribe'));
  assert.throws(
    () => replyContent(message, { ...input, emailAccountId: projectId }),
    /cannot be changed/,
  );
  assert.throws(
    () => replyContent(message, { ...input, addresses: ['other@example.com'] }),
    /cannot be changed/,
  );
  assert.throws(
    () => replyContent(message, { ...input, contactIds: [projectId] }),
    /cannot be changed/,
  );
  assert.equal(
    messageDraftInputSchema.safeParse({
      ...input,
      kind: 'reply',
      replyContext: {},
    }).success,
    false,
  );
  assert.throws(
    () => renderReply(message, { ...input, html: '<p></p>' }),
    /contain text/,
  );
  assert.equal(
    inboxIdentitySchema.safeParse({ uidValidity: '0', uid: 1 }).success,
    false,
  );
});
