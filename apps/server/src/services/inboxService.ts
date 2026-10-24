import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { z } from 'zod';
import { inboxIdentitySchema } from '@outreacher/shared';
import { getMailAccount, decryptPassword, cleanHtml, plainText } from './emailService.js';
import { HttpError } from '../lib/HttpError.js';
import { createMessage } from '../db/repositories/messages.js';

export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
// A deliberately narrow Message-ID grammar prevents header injection and invalid threading.
export function validMessageId(value: string | undefined) {
  return value && value.length <= 998 && /^<[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+>$/.test(value) ? value : '';
}
function mailDate(value: string | Date | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
export async function parseIncoming(source: Buffer) {
  if (source.length > MAX_SOURCE_BYTES) throw new HttpError(413, 'Message exceeds the 20 MiB download limit.');
  const parsed = await simpleParser(source, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
  const recipient = parsed.replyTo?.value[0]?.address ?? parsed.from?.value[0]?.address ?? '';
  const references = (Array.isArray(parsed.references) ? parsed.references : [parsed.references ?? '']).filter((v: string) => validMessageId(v)).slice(-50);
  return {
    html: cleanHtml(parsed.html || ''), text: parsed.text || plainText(cleanHtml(parsed.html || '')), recipient: z.email().safeParse(recipient).success ? recipient : '',
    messageId: validMessageId(parsed.messageId), references,
    subject: (parsed.subject ?? '').replace(/[\r\n]/g, ' ').slice(0, 490),
    from: parsed.from?.text ?? '', date: mailDate(parsed.date),
  };
}
export function createImap(account: Awaited<ReturnType<typeof getMailAccount>>) {
  const s = account.incoming;
  if (!s?.enabled || !s.host) throw new HttpError(400, 'Enable incoming mail in account settings first.');
  return new ImapFlow({
    host: s.host, port: s.port ?? 993, secure: s.tlsMode === 'tls',
    ...(s.tlsMode === 'tls' ? {} : { doSTARTTLS: s.tlsMode === 'starttls' }),
    auth: { user: (s.useSmtpCredentials ? account.username : s.username) ?? '', pass: decryptPassword((s.useSmtpCredentials ? account.passwordEncrypted : s.passwordEncrypted) ?? '') },
    logger: false, disableAutoIdle: true, disableCompression: true,
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    maxLineLength: 65536, maxLiteralSize: MAX_SOURCE_BYTES + 1, maxResponseSize: MAX_SOURCE_BYTES + 1024 * 1024,
    tls: { rejectUnauthorized: true },
  });
}
export async function withInbox<T>(projectId: string, accountId: string, work: (client: ImapFlow) => Promise<T>, factory = createImap): Promise<T> {
  const client = factory(await getMailAccount(projectId, accountId));
  // Bound the whole operation as well as individual socket stalls.
  const timer = setTimeout(() => client.close(), 60000);
  client.on('error', () => {});
  try {
    await client.connect();
    await client.mailboxOpen('INBOX', { readOnly: true });
    return await work(client);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof Error && 'code' in error && error.code === 'LiteralTooLarge')
      throw new HttpError(413, 'Message exceeds the 20 MiB download limit.');
    throw new HttpError(502, 'Incoming connection or download failed. Check IMAP host, port, TLS and credentials, then refresh. Outgoing mail is unaffected.');
  } finally {
    clearTimeout(timer);
    client.close();
  }
}
export async function listInbox(client: ImapFlow, accountId: string, page: number) {
  if (!client.mailbox) throw new HttpError(502, 'Inbox could not be opened.');
  const { exists: total, uidValidity } = client.mailbox;
  const end = total - (page - 1) * 50;
  const items = [];
  if (end > 0) for await (const row of client.fetch(`${Math.max(1, end - 49)}:${end}`, { uid: true, envelope: true, flags: true })) {
    items.push({ accountId, uidValidity: String(uidValidity), uid: row.uid,
      from: row.envelope?.from?.map((a: { name?: string | null; address?: string | null }) => a.name ? `${a.name} <${a.address ?? ''}>` : a.address ?? '').join(', ') ?? '',
      subject: row.envelope?.subject ?? '', date: mailDate(row.envelope?.date),
      unread: !row.flags?.has('\\Seen'),
    });
  }
  return { accountId, uidValidity: String(uidValidity), total, page, items: items.sort((a, b) => b.uid - a.uid) };
}
export async function readInbox(client: ImapFlow, accountId: string, value: unknown) {
  const { uidValidity, uid } = inboxIdentitySchema.parse(value);
  if (!client.mailbox || String(client.mailbox.uidValidity) !== uidValidity) throw new HttpError(409, 'Mailbox changed. Refresh the Inbox and select the message again.');
  const header = await client.fetchOne(uid, { size: true, flags: true, uid: true }, { uid: true });
  if (!header) throw new HttpError(404, 'Message is no longer in the Inbox.');
  if (typeof header.size === 'number' && header.size > MAX_SOURCE_BYTES) throw new HttpError(413, 'Message exceeds the 20 MiB download limit.');
  // Partial source request caps bytes even if the server reported an incorrect size.
  const row = await client.fetchOne(uid, { source: { start: 0, maxLength: MAX_SOURCE_BYTES + 1 } }, { uid: true });
  if (!row || !row.source) throw new HttpError(404, 'Message is no longer in the Inbox.');
  return { accountId, uidValidity, uid, unread: !header.flags?.has('\\Seen'), ...await parseIncoming(row.source) };
}
export async function createReply(projectId: string, accountId: string, value: unknown) {
  const mail = await withInbox(projectId, accountId, client => readInbox(client, accountId, value));
  if (!mail.recipient) throw new HttpError(400, 'This message has no valid reply address.');
  return createMessage(
    projectId,
    {
      subject: /^re\s*:/i.test(mail.subject) ? mail.subject : `Re: ${mail.subject}`,
      html: '',
      emailAccountId: accountId,
      contactIds: [],
      addresses: [mail.recipient],
    },
    {
      kind: 'reply',
      replyContext: {
        accountId,
        uidValidity: mail.uidValidity,
        uid: mail.uid,
        recipient: mail.recipient,
        messageId: mail.messageId,
        references: mail.references,
        subject: mail.subject,
        from: mail.from,
        text: mail.text.slice(0, 100000),
      },
    },
  );
}
