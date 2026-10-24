import { z } from 'zod';
import {
  audienceSchema,
  campaignStates,
  messageDraftInputSchema,
  replyContextSchema,
} from '@outreacher/shared';
import type { MessageDraftInput } from '@outreacher/shared';
import { getDatabase } from '../database.js';
import { newId, nowIso, parseJson, toDate, toNullableDate } from '../values.js';
import type { CampaignMessage, CampaignState } from './campaigns.js';

const messageRowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: z.enum(['compose', 'reply']),
  replyContext: z.string().nullable(),
  name: z.string(),
  templateId: z.string().nullable(),
  message: z.string().nullable(),
  emailAccountId: z.string().nullable(),
  audience: z.string(),
  scheduledAt: z.string().nullable(),
  weekdays: z.string(),
  startHour: z.number().int().nullable(),
  endHour: z.number().int().nullable(),
  state: z.enum(campaignStates),
  error: z.string(),
  timeZone: z.string(),
  senderName: z.string(),
  senderEmail: z.string(),
  replyTo: z.string(),
  total: z.number().int(),
  preparationToken: z.string().nullable(),
  preparationUntil: z.string().nullable(),
  startedAt: z.string().nullable(),
  subject: z.string(),
  html: z.string(),
  contactIds: z.string(),
  addresses: z.string(),
  excluded: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
type MessageRow = z.infer<typeof messageRowSchema>;

export interface Message {
  id: string;
  projectId: string;
  kind: 'compose' | 'reply';
  replyContext: z.infer<typeof replyContextSchema> | null;
  name: string;
  templateId: string | null;
  message: CampaignMessage | null;
  emailAccountId: string | null;
  audience: z.infer<typeof audienceSchema>;
  scheduledAt: Date | null;
  weekdays: number[];
  startHour: number | null;
  endHour: number | null;
  state: CampaignState;
  error: string;
  timeZone: string;
  senderName: string;
  senderEmail: string;
  replyTo: string;
  total: number;
  preparationToken: string | null;
  preparationUntil: Date | null;
  startedAt: Date | null;
  subject: string;
  html: string;
  contactIds: string[];
  addresses: string[];
  excluded: number;
  createdAt: Date;
  updatedAt: Date;
}

function fromRow(row: MessageRow): Message {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    replyContext:
      row.replyContext === null
        ? null
        : replyContextSchema.parse(parseJson(row.replyContext)),
    name: row.name,
    templateId: row.templateId,
    message:
      row.message === null
        ? null
        : z.object({ subject: z.string(), html: z.string() }).parse(parseJson(row.message)),
    emailAccountId: row.emailAccountId,
    audience: audienceSchema.parse(parseJson(row.audience)),
    scheduledAt: toNullableDate(row.scheduledAt),
    weekdays: z.array(z.number().int()).parse(parseJson(row.weekdays)),
    startHour: row.startHour,
    endHour: row.endHour,
    state: row.state,
    error: row.error,
    timeZone: row.timeZone,
    senderName: row.senderName,
    senderEmail: row.senderEmail,
    replyTo: row.replyTo,
    total: row.total,
    preparationToken: row.preparationToken,
    preparationUntil: toNullableDate(row.preparationUntil),
    startedAt: toNullableDate(row.startedAt),
    subject: row.subject,
    html: row.html,
    contactIds: z.array(z.string()).parse(parseJson(row.contactIds)),
    addresses: z.array(z.string()).parse(parseJson(row.addresses)),
    excluded: row.excluded,
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

export function serializeMessage(message: Message) {
  return {
    kind: message.kind,
    replyContext: message.replyContext
      ? {
          accountId: message.replyContext.accountId,
          uidValidity: message.replyContext.uidValidity,
          uid: message.replyContext.uid,
          recipient: message.replyContext.recipient,
          messageId: message.replyContext.messageId,
          references: message.replyContext.references,
          subject: message.replyContext.subject,
          from: message.replyContext.from,
          text: message.replyContext.text,
        }
      : null,
    id: message.id,
    projectId: message.projectId,
    subject: message.subject,
    html: message.html,
    emailAccountId: message.emailAccountId,
    contactIds: message.contactIds,
    addresses: message.addresses,
    state: message.state,
    senderEmail: message.senderEmail,
    total: message.total,
    excluded: message.excluded,
    error: message.error,
    createdAt: message.createdAt.toISOString(),
  };
}

export function listMessages(projectId: string): Message[] {
  return getDatabase()
    .prepare(
      'SELECT * FROM messages WHERE projectId = ? ORDER BY createdAt DESC, id DESC',
    )
    .all(projectId)
    .map((row) => fromRow(messageRowSchema.parse(row)));
}

export function findMessage(
  projectId: string,
  id: string,
): Message | undefined {
  const row = getDatabase()
    .prepare('SELECT * FROM messages WHERE projectId = ? AND id = ?')
    .get(projectId, id);
  return row === undefined ? undefined : fromRow(messageRowSchema.parse(row));
}

export function createMessage(
  projectId: string,
  input: MessageDraftInput,
  extra: {
    kind: 'compose' | 'reply';
    replyContext: z.infer<typeof replyContextSchema> | null;
  } = { kind: 'compose', replyContext: null },
): Message {
  const id = newId();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO messages
        (id, projectId, kind, replyContext, name, templateId, message, emailAccountId,
         audience, scheduledAt, weekdays, startHour, endHour, state, error, timeZone,
         senderName, senderEmail, replyTo, total, preparationToken, preparationUntil,
         startedAt, subject, html, contactIds, addresses, excluded, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, '', NULL, NULL, ?, ?, NULL, '[]', NULL, NULL, 'draft', '', 'UTC',
         '', '', '', 0, NULL, NULL, NULL, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(
      id,
      projectId,
      extra.kind,
      extra.replyContext ? JSON.stringify(extra.replyContext) : null,
      input.emailAccountId,
      JSON.stringify(audienceSchema.parse({})),
      input.subject,
      input.html,
      JSON.stringify(input.contactIds),
      JSON.stringify(input.addresses),
      now,
      now,
    );
  const message = findMessage(projectId, id);
  if (!message) throw new Error('Message creation failed.');
  return message;
}

export function updateMessageDraft(
  projectId: string,
  id: string,
  input: MessageDraftInput,
): Message | undefined {
  const result = getDatabase()
    .prepare(
      `UPDATE messages SET subject = ?, html = ?, emailAccountId = ?, contactIds = ?,
        addresses = ?, updatedAt = ?
       WHERE projectId = ? AND id = ? AND state = 'draft'`,
    )
    .run(
      input.subject,
      input.html,
      input.emailAccountId,
      JSON.stringify(input.contactIds),
      JSON.stringify(input.addresses),
      nowIso(),
      projectId,
      id,
    );
  return result.changes === 0 ? undefined : findMessage(projectId, id);
}

export function deleteMessageDraft(projectId: string, id: string): boolean {
  const result = getDatabase()
    .prepare("DELETE FROM messages WHERE projectId = ? AND id = ? AND state = 'draft'")
    .run(projectId, id);
  return result.changes > 0;
}

export function claimMessagePreparation(
  projectId: string,
  id: string,
  expectedState: CampaignState,
  expectedUpdatedAt: Date,
  token: string,
  until: Date,
  sender: { senderEmail: string; senderName: string; replyTo: string },
): Message | undefined {
  const row = getDatabase()
    .prepare(
      `UPDATE messages SET state = 'preparing', preparationToken = ?,
        preparationUntil = ?, error = '', senderEmail = ?, senderName = ?, replyTo = ?,
        updatedAt = ?
       WHERE projectId = ? AND id = ? AND state = ? AND updatedAt = ?
       RETURNING *`,
    )
    .get(
      token,
      until.toISOString(),
      sender.senderEmail,
      sender.senderName,
      sender.replyTo,
      nowIso(),
      projectId,
      id,
      expectedState,
      expectedUpdatedAt.toISOString(),
    );
  return row === undefined ? undefined : fromRow(messageRowSchema.parse(row));
}

export function messagePreparationOwned(
  projectId: string,
  id: string,
  token: string,
): boolean {
  return Boolean(
    getDatabase()
      .prepare(
        "SELECT 1 FROM messages WHERE projectId = ? AND id = ? AND state = 'preparing' AND preparationToken = ?",
      )
      .get(projectId, id, token),
  );
}

export function renewMessagePreparation(
  projectId: string,
  id: string,
  token: string,
  until: Date,
): boolean {
  const result = getDatabase()
    .prepare(
      "UPDATE messages SET preparationUntil = ?, updatedAt = ? WHERE projectId = ? AND id = ? AND state = 'preparing' AND preparationToken = ?",
    )
    .run(until.toISOString(), nowIso(), projectId, id, token);
  return result.changes > 0;
}

export function finishMessagePreparation(
  projectId: string,
  id: string,
  token: string,
  fields: { total: number; excluded: number },
): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE messages SET state = 'active', total = ?, excluded = ?, updatedAt = ?
       WHERE projectId = ? AND id = ? AND state = 'preparing' AND preparationToken = ?`,
    )
    .run(fields.total, fields.excluded, nowIso(), projectId, id, token);
  return result.changes > 0;
}

export function failMessagePreparation(
  projectId: string,
  id: string,
  token: string,
  error: string,
): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE messages SET state = 'preparation_failed', error = ?, updatedAt = ?
       WHERE projectId = ? AND id = ? AND state = 'preparing' AND preparationToken = ?`,
    )
    .run(error, nowIso(), projectId, id, token);
  return result.changes > 0;
}

export function transitionMessage(
  projectId: string,
  id: string,
  from: CampaignState[],
  to: CampaignState,
): Message | undefined {
  const placeholders = from.map(() => '?').join(', ');
  const row = getDatabase()
    .prepare(
      `UPDATE messages SET state = ?, error = '', updatedAt = ?
       WHERE projectId = ? AND id = ? AND state IN (${placeholders})
       RETURNING *`,
    )
    .get(to, nowIso(), projectId, id, ...from);
  return row === undefined ? undefined : fromRow(messageRowSchema.parse(row));
}

export function listActiveMessages(): Message[] {
  return getDatabase()
    .prepare("SELECT * FROM messages WHERE state = 'active'")
    .all()
    .map((row) => fromRow(messageRowSchema.parse(row)));
}

export function recoverInterruptedMessages(now: Date): number {
  return getDatabase()
    .prepare(
      `UPDATE messages SET state = 'preparation_failed',
        error = 'Preparation interrupted. Explicit retry required.', updatedAt = ?
       WHERE state = 'preparing' AND preparationUntil < ?`,
    )
    .run(nowIso(), now.toISOString()).changes;
}

export function markMessageStarted(
  projectId: string,
  id: string,
  startedAt: Date,
): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE messages SET startedAt = COALESCE(startedAt, ?), updatedAt = ?
       WHERE projectId = ? AND id = ? AND state = 'active'`,
    )
    .run(startedAt.toISOString(), nowIso(), projectId, id);
  return result.changes > 0;
}

export function messageIsCancelled(projectId: string, id: string): boolean {
  return Boolean(
    getDatabase()
      .prepare("SELECT 1 FROM messages WHERE projectId = ? AND id = ? AND state = 'cancelled'")
      .get(projectId, id),
  );
}

export function hasUnfinishedMessageForAccount(
  projectId: string,
  accountId: string,
): boolean {
  return Boolean(
    getDatabase()
      .prepare(
        `SELECT 1 FROM messages WHERE projectId = ? AND emailAccountId = ?
         AND (state IN ('preparing', 'preparation_failed', 'active', 'paused')
              OR (kind = 'reply' AND state = 'draft')) LIMIT 1`,
      )
      .get(projectId, accountId),
  );
}

export function listMessageIdsForAccount(
  projectId: string,
  accountId: string,
): string[] {
  return getDatabase()
    .prepare(
      'SELECT id FROM messages WHERE projectId = ? AND emailAccountId = ?',
    )
    .all(projectId, accountId)
    .map((row) => z.object({ id: z.string() }).parse(row).id);
}

export function pauseMessagesForAccount(
  projectId: string,
  accountId: string,
  error: string,
): number {
  return getDatabase()
    .prepare(
      `UPDATE messages SET state = 'paused', error = ?, updatedAt = ?
       WHERE projectId = ? AND emailAccountId = ? AND state = 'active'`,
    )
    .run(error, nowIso(), projectId, accountId).changes;
}

export function completeMessage(projectId: string, id: string): void {
  getDatabase()
    .prepare(
      "UPDATE messages SET state = 'completed', updatedAt = ? WHERE projectId = ? AND id = ? AND state = 'active'",
    )
    .run(nowIso(), projectId, id);
}

export function pauseMessage(
  projectId: string,
  id: string,
  error: string,
): boolean {
  const result = getDatabase()
    .prepare(
      "UPDATE messages SET state = 'paused', error = ?, updatedAt = ? WHERE projectId = ? AND id = ? AND state = 'active'",
    )
    .run(error, nowIso(), projectId, id);
  return result.changes > 0;
}

export function messageExists(
  projectId: string,
  id: string,
  state: CampaignState,
): boolean {
  return Boolean(
    getDatabase()
      .prepare('SELECT 1 FROM messages WHERE projectId = ? AND id = ? AND state = ?')
      .get(projectId, id, state),
  );
}

export function parseMessageDraft(value: unknown): MessageDraftInput {
  return messageDraftInputSchema.parse(value);
}
