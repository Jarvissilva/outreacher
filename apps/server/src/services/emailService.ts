import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import nodemailer from 'nodemailer';
import sanitizeHtml from 'sanitize-html';
import { convert } from 'html-to-text';
import { csvColumns } from '@outreachit/shared';
import type { TemplateInput } from '@outreachit/shared';
import { MailAccountModel } from '../models/EmailModels.js';
import { FieldModel, ProjectModel } from '../models/index.js';
import type { ContactDocument } from '../models/index.js';
import { HttpError } from '../lib/HttpError.js';
function key() {
  const value = process.env.EMAIL_ENCRYPTION_KEY ?? '';
  if (!/^[a-f\d]{64}$/i.test(value))
    throw new HttpError(
      503,
      'Configure EMAIL_ENCRYPTION_KEY with 32 random bytes in hex.',
    );
  return Buffer.from(value, 'hex');
}
export function encryptPassword(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    iv.toString('hex'),
    cipher.getAuthTag().toString('hex'),
    data.toString('hex'),
  ].join(':');
}
export function decryptPassword(value: string) {
  if (!value) return '';
  try {
    const [iv, tag, data] = value.split(':');
    if (!iv || !tag || !data) throw new Error('Malformed ciphertext');
    const cipher = createDecipheriv(
      'aes-256-gcm',
      key(),
      Buffer.from(iv, 'hex'),
    );
    cipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([
      cipher.update(Buffer.from(data, 'hex')),
      cipher.final(),
    ]).toString('utf8');
  } catch {
    throw new HttpError(
      503,
      'Cannot decrypt saved mail password. Restore the encryption key or save a replacement password.',
    );
  }
}
export function cleanHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [
      'p',
      'br',
      'strong',
      'em',
      's',
      'u',
      'h1',
      'h2',
      'h3',
      'ul',
      'ol',
      'li',
      'blockquote',
      'a',
      'code',
      'pre',
    ],
    allowedAttributes: { a: ['href', 'title'] },
    allowedSchemes: ['https', 'http', 'mailto'],
    allowProtocolRelative: false,
  });
}
export const plainText = (html: string) => convert(html, { wordwrap: false });
export async function validateTemplate(
  projectId: string,
  input: TemplateInput,
) {
  const fields = await FieldModel.find({ projectId });
  const allowed = new Set<string>([
    ...csvColumns,
    'unsubscribeUrl',
    ...fields.map((f) => `custom.${f.key}`),
  ]);
  for (const match of `${input.subject}\n${input.html}`.matchAll(
    /{{\s*([^{}]*?)\s*}}/g,
  ))
    if (!allowed.has(match[1] ?? ''))
      throw new HttpError(400, `Unknown placeholder: ${match[1]}`);
  if (
    /{{|}}/.test(
      `${input.subject}\n${input.html}`.replace(/{{\s*[^{}]*?\s*}}/g, ''),
    )
  )
    throw new HttpError(400, 'Malformed placeholder.');
  const html = cleanHtml(input.html);
  if (!plainText(html).trim())
    throw new HttpError(400, 'Template body must contain text.');
  return { ...input, html, text: plainText(html) };
}
const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] ?? c,
  );
export function renderMessage(
  template: { subject: string; html: string },
  contact: ContactDocument,
  unsubscribeUrl: string,
) {
  const warnings = new Set<string>();
  const replace = (value: string, html: boolean) =>
    value.replace(/{{\s*([^{}]*?)\s*}}/g, (_match: string, field: string) => {
      let result = '';
      if (field === 'unsubscribeUrl') result = unsubscribeUrl;
      else if (field.startsWith('custom.'))
        result = contact.customFields.get(field.slice(7)) ?? '';
      else {
        const standard = csvColumns.find((k) => k === field);
        if (standard) result = contact[standard];
      }
      if (!result) warnings.add(`Missing value: ${field}`);
      return html ? escape(result) : result.replace(/[\r\n]/g, ' ');
    });
  let html = cleanHtml(replace(template.html, true));
  if (!template.html.includes('{{unsubscribeUrl}}') && unsubscribeUrl)
    html += `<p><a href="${escape(unsubscribeUrl)}">Unsubscribe</a></p>`;
  return {
    subject: replace(template.subject, false),
    html,
    text: plainText(html),
    warnings: [...warnings],
  };
}
export function unsubscribeUrl(projectId: string, contactId: string) {
  const base = process.env.PUBLIC_UNSUBSCRIBE_BASE_URL;
  if (!base)
    throw new HttpError(
      400,
      'Configure PUBLIC_UNSUBSCRIBE_BASE_URL before launching.',
    );
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new HttpError(503, 'Invalid public unsubscribe base URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new HttpError(503, 'Invalid public unsubscribe base URL.');
  const payload = `${projectId}.${contactId}`;
  const signature = createHmac('sha256', key())
    .update(`unsubscribe:${payload}`)
    .digest('hex');
  return `${base.replace(/\/$/, '')}/unsubscribe/${payload}.${signature}`;
}
export function verifyUnsubscribe(token: string) {
  const parts = token.split('.');
  const [projectId, contactId, signature] = parts;
  if (
    parts.length !== 3 ||
    !projectId ||
    !contactId ||
    !/^[a-f\d]{24}$/.test(projectId) ||
    !/^[a-f\d]{24}$/.test(contactId) ||
    !signature ||
    !/^[a-f\d]{64}$/.test(signature)
  )
    throw new HttpError(400, 'Invalid unsubscribe link.');
  const expected = createHmac('sha256', key())
    .update(`unsubscribe:${projectId}.${contactId}`)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
    throw new HttpError(400, 'Invalid unsubscribe link.');
  return { projectId, contactId };
}
export async function getMailAccount(projectId: string, accountId: string) {
  const account = await MailAccountModel.findOne({
    _id: accountId,
    projectId,
    archivedAt: null,
  });
  if (!account)
    throw new HttpError(404, 'Mail account not found in this project.');
  return account;
}
export async function getSendingSettings(projectId: string) {
  const project = await ProjectModel.findById(projectId);
  if (!project) throw new HttpError(404, 'Project not found.');
  return project;
}
export function serializeSendingSettings(
  s: Awaited<ReturnType<typeof getSendingSettings>>,
) {
  return {
    projectId: String(s._id),
    hourlyLimit: s.hourlyLimit,
    timeZone: s.timeZone,
  };
}
export function serializeAccount(
  s: Awaited<ReturnType<typeof getMailAccount>>,
) {
  return {
    id: String(s._id),
    projectId: String(s.projectId),
    name: s.name,
    host: s.host ?? '',
    port: s.port ?? 587,
    tlsMode: s.tlsMode,
    username: s.username ?? '',
    senderName: s.senderName ?? '',
    senderEmail: s.senderEmail ?? '',
    replyTo: s.replyTo ?? '',
    passwordConfigured: Boolean(s.passwordEncrypted),
    incoming: s.incoming ? {
      enabled: s.incoming.enabled ?? false, host: s.incoming.host ?? '', port: s.incoming.port ?? 993,
      tlsMode: s.incoming.tlsMode ?? 'tls', useSmtpCredentials: s.incoming.useSmtpCredentials ?? true,
      username: s.incoming.username ?? '', passwordConfigured: Boolean(s.incoming.passwordEncrypted),
    } : null,
    sendingError: s.sendingError,
  };
}
export type SmtpSettings = Awaited<ReturnType<typeof getMailAccount>>;
export function createTransport(s: SmtpSettings) {
  return nodemailer.createTransport({
    host: s.host ?? '',
    port: s.port ?? 587,
    secure: s.tlsMode === 'tls',
    requireTLS: s.tlsMode === 'starttls',
    ignoreTLS: s.tlsMode === 'none',
    ...(s.username
      ? {
          auth: {
            user: s.username,
            pass: decryptPassword(s.passwordEncrypted),
          },
        }
      : {}),
    tls: { rejectUnauthorized: true },
    disableFileAccess: true,
    disableUrlAccess: true,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 45000,
  });
}
export function classifySmtpError(error: unknown) {
  const code =
    error instanceof Error && 'code' in error ? String(error.code) : '';
  const responseCode =
    error instanceof Error && 'responseCode' in error
      ? Number(error.responseCode)
      : 0;
  if (code === 'EAUTH' || [530, 534, 535, 538].includes(responseCode))
    return {
      kind: 'configuration',
      reason: 'SMTP authentication failed. Check project email settings.',
    };
  if (responseCode >= 400 && responseCode < 500)
    return {
      kind: 'temporary',
      reason: `SMTP temporary rejection (${responseCode}).`,
    };
  if (responseCode >= 500)
    return {
      kind: 'permanent',
      reason: `SMTP permanent rejection (${responseCode}).`,
    };
  // Nodemailer can report CONN even after DATA. The command alone is not
  // evidence that no submission occurred; only definite connection setup failures are safe.
  const originalCode =
    error instanceof Error && 'originalCode' in error
      ? String(error.originalCode)
      : '';
  const timeoutType =
    error instanceof Error && 'timeoutType' in error
      ? String(error.timeoutType)
      : '';
  if (
    error instanceof HttpError ||
    ['EDNS', 'ETLS'].includes(code) ||
    (code === 'ESOCKET' &&
      ['ECONNREFUSED', 'ENETUNREACH', 'EHOSTUNREACH'].includes(originalCode)) ||
    (code === 'ETIMEDOUT' &&
      ['CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT'].includes(
        timeoutType,
      ))
  )
    return {
      kind: 'configuration',
      reason:
        'SMTP connection or saved credentials failed. Check host, port, TLS, encryption key and credentials.',
    };
  return {
    kind: 'unknown',
    reason:
      'SMTP submission was interrupted; acceptance is unknown. Review manually before sending again.',
  };
}
