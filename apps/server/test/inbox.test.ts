import assert from 'node:assert/strict';
import { it, mock } from 'node:test';
import { ImapFlow } from 'imapflow';
import { MAX_SOURCE_BYTES, parseIncoming, validMessageId, listInbox, readInbox, createImap } from '../src/services/inboxService.js';
import { MailAccountModel } from '../src/models/EmailModels.js';
import { encryptPassword } from '../src/services/emailService.js';
const accountId = '111111111111111111111111', projectId = '222222222222222222222222';
it('parses MIME, rejects injection, strips remote and executable content and bounds downloads', async () => {
  const mail = await parseIncoming(Buffer.from([
    'From: Sender <from@example.com>', 'Reply-To: reply@example.com',
    'Subject: =?UTF-8?Q?Hello_=E2=9C=93?=', 'Message-ID: <original@example.com>',
    'References: <older@example.com>', 'Content-Type: text/html; charset=utf-8', '',
    '<p>Hello</p><script>alert(1)</script><img src="https://example.com/track"><iframe src="https://example.com"></iframe><a href="javascript:alert(1)">bad</a>',
  ].join('\r\n')));
  assert.equal(mail.recipient, 'reply@example.com');
  assert.equal(mail.subject, 'Hello ✓');
  assert.equal(mail.messageId, '<original@example.com>');
  assert.deepEqual(mail.references, ['<older@example.com>']);
  assert.ok(!/script|img|iframe|javascript|track/.test(mail.html));
  assert.ok(mail.text.includes('Hello'));
  assert.equal(validMessageId('<a@b>\r\nBcc: x@example.com'), '');
  assert.equal(validMessageId('invalid'), '');
  await assert.rejects(parseIncoming(Buffer.alloc(MAX_SOURCE_BYTES + 1)), /20 MiB/);
  const fallback = await parseIncoming(Buffer.from('From: from@example.com\r\n\r\nhello'));
  assert.equal(fallback.recipient, 'from@example.com');
  assert.equal(fallback.messageId, '');
});
it('requires explicitly enabled incoming settings and supports encrypted separate credentials', () => {
  process.env.EMAIL_ENCRYPTION_KEY = 'a'.repeat(64);
  const account = new MailAccountModel({ projectId, username: 'smtp-user', passwordEncrypted: encryptPassword('smtp-secret') });
  assert.throws(() => createImap(account), /Enable incoming/);
  account.set('incoming', { enabled: true, host: 'imap.example.com', port: 993, tlsMode: 'tls', useSmtpCredentials: false, username: 'imap-user', passwordEncrypted: encryptPassword('imap-secret') });
  const client = createImap(account);
  client.close();
});
it('paginates headers newest first without fetching bodies and detects stale or missing messages', async () => {
  const client = new ImapFlow({ host: 'localhost', port: 993, secure: true, auth: { user: 'test', pass: 'test' }, logger: false });
  Object.defineProperty(client, 'mailbox', { value: { path: 'INBOX', exists: 101, uidValidity: 7n }, configurable: true });
  const fetch = mock.method(client, 'fetch', async function* (range: unknown, query: { source?: unknown }) {
    assert.equal(range, '2:51'); assert.equal(query.source, undefined);
    yield { seq: 2, uid: 2, envelope: { subject: 'Older' }, flags: new Set(['\\Seen']) };
    yield { seq: 51, uid: 51, envelope: { subject: 'Newer' }, flags: new Set() };
  });
  try {
    const page = await listInbox(client, accountId, 2);
    assert.deepEqual(page.items.map(m => m.uid), [51, 2]);
    assert.equal(page.items[0]?.unread, true);
    assert.equal(page.items[1]?.unread, false);
    assert.equal((await listInbox(client, accountId, 4)).items.length, 0);
    assert.equal(fetch.mock.callCount(), 1);
    await assert.rejects(readInbox(client, accountId, { uidValidity: '6', uid: 2 }), /Mailbox changed/);
    mock.method(client, 'fetchOne', async (): Promise<false> => false);
    await assert.rejects(readInbox(client, accountId, { uidValidity: '7', uid: 2 }), /no longer/);
  } finally { mock.restoreAll(); client.close(); }
});
