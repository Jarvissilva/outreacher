import { z } from 'zod';
import { getDatabase } from '../database.js';
import {
  newId,
  nowIso,
  parseJson,
  toDate,
  toNullableDate,
} from '../values.js';

const tlsModeSchema = z.enum(['tls', 'starttls', 'none']);

export const incomingSettingsSchema = z.object({
  enabled: z.boolean(),
  host: z.string(),
  port: z.number().int(),
  tlsMode: tlsModeSchema,
  useSmtpCredentials: z.boolean(),
  username: z.string(),
  passwordEncrypted: z.string(),
});
export type IncomingSettings = z.infer<typeof incomingSettingsSchema>;

const accountRowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  archivedAt: z.string().nullable(),
  host: z.string(),
  port: z.number().int(),
  tlsMode: tlsModeSchema,
  username: z.string(),
  passwordEncrypted: z.string(),
  senderName: z.string(),
  senderEmail: z.string(),
  replyTo: z.string(),
  incoming: z.string().nullable(),
  sendingError: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
type AccountRow = z.infer<typeof accountRowSchema>;

export interface MailAccount {
  id: string;
  projectId: string;
  name: string;
  archivedAt: Date | null;
  host: string;
  port: number;
  tlsMode: 'tls' | 'starttls' | 'none';
  username: string;
  passwordEncrypted: string;
  senderName: string;
  senderEmail: string;
  replyTo: string;
  incoming: IncomingSettings | null;
  sendingError: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountWrite {
  name: string;
  host: string;
  port: number;
  tlsMode: 'tls' | 'starttls' | 'none';
  username: string;
  senderName: string;
  senderEmail: string;
  replyTo: string;
  sendingError: string;
  passwordEncrypted?: string;
}

function parseIncoming(value: string | null): IncomingSettings | null {
  if (value === null) return null;
  return incomingSettingsSchema.parse(parseJson(value));
}

function fromRow(row: AccountRow): MailAccount {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    archivedAt: toNullableDate(row.archivedAt),
    host: row.host,
    port: row.port,
    tlsMode: row.tlsMode,
    username: row.username,
    passwordEncrypted: row.passwordEncrypted,
    senderName: row.senderName,
    senderEmail: row.senderEmail,
    replyTo: row.replyTo,
    incoming: parseIncoming(row.incoming),
    sendingError: row.sendingError,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

export function serializeAccount(account: MailAccount) {
  return {
    id: account.id,
    projectId: account.projectId,
    name: account.name,
    host: account.host,
    port: account.port,
    tlsMode: account.tlsMode,
    username: account.username,
    senderName: account.senderName,
    senderEmail: account.senderEmail,
    replyTo: account.replyTo,
    passwordConfigured: Boolean(account.passwordEncrypted),
    incoming: account.incoming
      ? {
          enabled: account.incoming.enabled,
          host: account.incoming.host,
          port: account.incoming.port,
          tlsMode: account.incoming.tlsMode,
          useSmtpCredentials: account.incoming.useSmtpCredentials,
          username: account.incoming.username,
          passwordConfigured: Boolean(account.incoming.passwordEncrypted),
        }
      : null,
    sendingError: account.sendingError,
  };
}

export function listAccounts(projectId: string): MailAccount[] {
  return getDatabase()
    .prepare(
      'SELECT * FROM mail_accounts WHERE projectId = ? AND archivedAt IS NULL ORDER BY createdAt ASC, id ASC',
    )
    .all(projectId)
    .map((row) => fromRow(accountRowSchema.parse(row)));
}

export function findAccount(
  projectId: string,
  id: string,
  includeArchived = false,
): MailAccount | undefined {
  const row = getDatabase()
    .prepare(
      `SELECT * FROM mail_accounts WHERE projectId = ? AND id = ?${
        includeArchived ? '' : ' AND archivedAt IS NULL'
      }`,
    )
    .get(projectId, id);
  return row === undefined ? undefined : fromRow(accountRowSchema.parse(row));
}

export function createAccount(
  projectId: string,
  input: AccountWrite,
): MailAccount {
  const id = newId();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO mail_accounts
        (id, projectId, name, archivedAt, host, port, tlsMode, username,
         passwordEncrypted, senderName, senderEmail, replyTo, incoming, sendingError,
         createdAt, updatedAt)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    )
    .run(
      id,
      projectId,
      input.name,
      input.host,
      input.port,
      input.tlsMode,
      input.username,
      input.passwordEncrypted ?? '',
      input.senderName,
      input.senderEmail,
      input.replyTo,
      input.sendingError,
      now,
      now,
    );
  const account = findAccount(projectId, id, true);
  if (!account) throw new Error('Mail account creation failed.');
  return account;
}

export function updateAccount(
  projectId: string,
  id: string,
  input: AccountWrite,
): MailAccount | undefined {
  const db = getDatabase();
  const password =
    input.passwordEncrypted === undefined
      ? db
          .prepare(
            'SELECT passwordEncrypted FROM mail_accounts WHERE projectId = ? AND id = ?',
          )
          .get(projectId, id)
      : undefined;
  const existingPassword =
    password === undefined
      ? undefined
      : z.object({ passwordEncrypted: z.string() }).parse(password).passwordEncrypted;
  const result = db
    .prepare(
      `UPDATE mail_accounts SET
        name = ?, host = ?, port = ?, tlsMode = ?, username = ?, passwordEncrypted = ?,
        senderName = ?, senderEmail = ?, replyTo = ?, sendingError = ?, updatedAt = ?
       WHERE projectId = ? AND id = ? AND archivedAt IS NULL`,
    )
    .run(
      input.name,
      input.host,
      input.port,
      input.tlsMode,
      input.username,
      input.passwordEncrypted ?? existingPassword ?? '',
      input.senderName,
      input.senderEmail,
      input.replyTo,
      input.sendingError,
      nowIso(),
      projectId,
      id,
    );
  return result.changes === 0 ? undefined : findAccount(projectId, id);
}

export function saveIncoming(
  projectId: string,
  id: string,
  incoming: IncomingSettings,
): MailAccount | undefined {
  const result = getDatabase()
    .prepare(
      'UPDATE mail_accounts SET incoming = ?, updatedAt = ? WHERE projectId = ? AND id = ? AND archivedAt IS NULL',
    )
    .run(JSON.stringify(incoming), nowIso(), projectId, id);
  return result.changes === 0 ? undefined : findAccount(projectId, id);
}

export function archiveAccount(projectId: string, id: string): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE mail_accounts SET archivedAt = ?, passwordEncrypted = '', incoming = NULL, updatedAt = ?
       WHERE projectId = ? AND id = ? AND archivedAt IS NULL`,
    )
    .run(nowIso(), nowIso(), projectId, id);
  return result.changes > 0;
}

export function setAccountSendingError(
  projectId: string,
  id: string,
  reason: string,
): void {
  getDatabase()
    .prepare(
      'UPDATE mail_accounts SET sendingError = ?, updatedAt = ? WHERE projectId = ? AND id = ?',
    )
    .run(reason, nowIso(), projectId, id);
}
