import { z } from 'zod';
import { recipientStates } from '@outreacher/shared';
import { getDatabase, transaction } from '../database.js';
import { newId, nowIso, parseJson } from '../values.js';
import { findMessage } from './messages.js';

export type RecipientState = (typeof recipientStates)[number];

const jobRowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  campaignId: z.string().nullable(),
  messageId: z.string().nullable(),
  contactId: z.string().nullable(),
  inReplyTo: z.string(),
  referencesJson: z.string(),
  preparationToken: z.string(),
  email: z.string(),
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  unsubscribeUrl: z.string(),
  state: z.enum(recipientStates),
  reason: z.string(),
  availableAt: z.string(),
  leaseUntil: z.string().nullable(),
  leaseToken: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
type JobRow = z.infer<typeof jobRowSchema>;

const attemptRowSchema = z.object({
  id: z.number().int(),
  at: z.string(),
  state: z.string(),
  reason: z.string(),
});
export interface JobAttempt {
  at: Date;
  state: string;
  reason: string;
}

export interface RecipientJob {
  id: string;
  projectId: string;
  campaignId: string | null;
  messageId: string | null;
  contactId: string | null;
  inReplyTo: string;
  references: string[];
  preparationToken: string;
  email: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl: string;
  state: RecipientState;
  reason: string;
  availableAt: Date;
  leaseUntil: Date | null;
  leaseToken: string | null;
  attempts: JobAttempt[];
  createdAt: Date;
  updatedAt: Date;
}

export interface JobFilter {
  projectId: string;
  campaignId?: string;
  messageId?: string;
  preparationToken?: string;
  state?: RecipientState;
  contactId?: string;
}

export interface JobSource {
  projectId: string;
  campaignId?: string;
  messageId?: string;
  preparationToken: string;
}

function fromRow(row: JobRow, attempts: JobAttempt[]): RecipientJob {
  return {
    id: row.id,
    projectId: row.projectId,
    campaignId: row.campaignId,
    messageId: row.messageId,
    contactId: row.contactId,
    inReplyTo: row.inReplyTo,
    references: z.array(z.string()).parse(parseJson(row.referencesJson)),
    preparationToken: row.preparationToken,
    email: row.email,
    subject: row.subject,
    html: row.html,
    text: row.text,
    unsubscribeUrl: row.unsubscribeUrl,
    state: row.state,
    reason: row.reason,
    availableAt: new Date(row.availableAt),
    leaseUntil: row.leaseUntil === null ? null : new Date(row.leaseUntil),
    leaseToken: row.leaseToken,
    attempts,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

function attemptsFor(jobIds: string[]): Map<string, JobAttempt[]> {
  const grouped = new Map<string, JobAttempt[]>();
  if (!jobIds.length) return grouped;
  const rows = getDatabase()
    .prepare(
      `SELECT id, jobId, at, state, reason FROM recipient_job_attempts
       WHERE jobId IN (SELECT value FROM json_each(?)) ORDER BY id ASC`,
    )
    .all(JSON.stringify(jobIds));
  for (const row of rows) {
    const parsed = attemptRowSchema.extend({ jobId: z.string() }).parse(row);
    const attempt = { at: new Date(parsed.at), state: parsed.state, reason: parsed.reason };
    const existing = grouped.get(parsed.jobId);
    if (existing) existing.push(attempt);
    else grouped.set(parsed.jobId, [attempt]);
  }
  return grouped;
}

function hydrate(rows: unknown[]): RecipientJob[] {
  const parsedRows = rows.map((row) => jobRowSchema.parse(row));
  const attempts = attemptsFor(parsedRows.map((row) => row.id));
  return parsedRows.map((row) => fromRow(row, attempts.get(row.id) ?? []));
}

function filterClause(filter: JobFilter): { sql: string; params: string[] } {
  const clauses = ['projectId = ?'];
  const params = [filter.projectId];
  for (const [column, value] of [
    ['campaignId', filter.campaignId],
    ['messageId', filter.messageId],
    ['preparationToken', filter.preparationToken],
    ['state', filter.state],
    ['contactId', filter.contactId],
  ] as const) {
    if (value !== undefined) {
      clauses.push(`${column} = ?`);
      params.push(value);
    }
  }
  return { sql: clauses.join(' AND '), params };
}

function sourceClause(
  source: JobSource,
  extra: { state?: RecipientState; due?: Date } = {},
): { sql: string; params: string[] } {
  const clauses = ['projectId = ?', 'preparationToken = ?'];
  const params = [source.projectId, source.preparationToken];
  if (source.campaignId !== undefined) {
    clauses.push('campaignId = ?');
    params.push(source.campaignId);
  }
  if (source.messageId !== undefined) {
    clauses.push('messageId = ?');
    params.push(source.messageId);
  }
  if (extra.state !== undefined) {
    clauses.push('state = ?');
    params.push(extra.state);
  }
  if (extra.due !== undefined) {
    clauses.push('availableAt <= ?');
    params.push(extra.due.toISOString());
  }
  return { sql: clauses.join(' AND '), params };
}

export function findJob(projectId: string, id: string): RecipientJob | undefined {
  const row = getDatabase()
    .prepare('SELECT * FROM recipient_jobs WHERE projectId = ? AND id = ?')
    .get(projectId, id);
  return row === undefined ? undefined : hydrate([row])[0];
}

export function findFirstJob(filter: JobFilter): RecipientJob | undefined {
  const clause = filterClause(filter);
  const row = getDatabase()
    .prepare(
      `SELECT * FROM recipient_jobs WHERE ${clause.sql} ORDER BY createdAt ASC, id ASC LIMIT 1`,
    )
    .get(...clause.params);
  return row === undefined ? undefined : hydrate([row])[0];
}

export function listJobs(
  filter: JobFilter,
  options: { limit?: number; offset?: number } = {},
): RecipientJob[] {
  const clause = filterClause(filter);
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM recipient_jobs WHERE ${clause.sql}
       ORDER BY createdAt ASC, id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...clause.params, options.limit ?? -1, options.offset ?? 0);
  return hydrate(rows);
}

export function countJobs(filter: JobFilter): number {
  const clause = filterClause(filter);
  const row = getDatabase()
    .prepare(`SELECT COUNT(*) AS total FROM recipient_jobs WHERE ${clause.sql}`)
    .get(...clause.params);
  return z.object({ total: z.number().int() }).parse(row).total;
}

export function countJobsByState(
  filter: JobFilter,
): Record<string, number> {
  const clause = filterClause(filter);
  const rows = getDatabase()
    .prepare(
      `SELECT state, COUNT(*) AS total FROM recipient_jobs WHERE ${clause.sql} GROUP BY state`,
    )
    .all(...clause.params);
  const counts: Record<string, number> = {};
  for (const state of recipientStates) counts[state] = 0;
  for (const row of rows) {
    const parsed = z
      .object({ state: z.string(), total: z.number().int() })
      .parse(row);
    counts[parsed.state] = parsed.total;
  }
  return counts;
}

export function createJob(input: {
  projectId: string;
  campaignId?: string;
  messageId?: string;
  contactId?: string;
  inReplyTo?: string;
  references?: string[];
  preparationToken: string;
  email: string;
  subject: string;
  html: string;
  text: string;
  unsubscribeUrl?: string;
  availableAt?: Date;
  state?: RecipientState;
}): RecipientJob {
  if (Boolean(input.campaignId) === Boolean(input.messageId))
    throw new Error('A recipient job must belong to exactly one campaign or message.');
  if (!input.contactId) {
    const message = input.messageId
      ? findMessage(input.projectId, input.messageId)
      : undefined;
    const context = message?.replyContext;
    if (
      message?.kind !== 'reply' ||
      !context ||
      context.recipient !== input.email ||
      context.accountId !== message.emailAccountId ||
      message.state !== 'preparing' ||
      message.preparationToken !== input.preparationToken
    )
      throw new Error('Only validated replies may omit a contact.');
  }
  const id = newId();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO recipient_jobs
        (id, projectId, campaignId, messageId, contactId, inReplyTo, referencesJson,
         preparationToken, email, subject, html, text, unsubscribeUrl, state, reason,
         availableAt, leaseUntil, leaseToken, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, NULL, NULL, ?, ?)`,
    )
    .run(
      id,
      input.projectId,
      input.campaignId ?? null,
      input.messageId ?? null,
      input.contactId ?? null,
      input.inReplyTo ?? '',
      JSON.stringify(input.references ?? []),
      input.preparationToken,
      input.email,
      input.subject,
      input.html,
      input.text,
      input.unsubscribeUrl ?? '',
      input.state ?? 'queued',
      (input.availableAt ?? new Date()).toISOString(),
      now,
      now,
    );
  const job = findJob(input.projectId, id);
  if (!job) throw new Error('Recipient job creation failed.');
  return job;
}

export function deleteJobsForCampaign(
  projectId: string,
  campaignId: string,
): number {
  return getDatabase()
    .prepare('DELETE FROM recipient_jobs WHERE projectId = ? AND campaignId = ?')
    .run(projectId, campaignId).changes;
}

export function deleteJobsForMessage(
  projectId: string,
  messageId: string,
): number {
  return getDatabase()
    .prepare('DELETE FROM recipient_jobs WHERE projectId = ? AND messageId = ?')
    .run(projectId, messageId).changes;
}

export function deleteJobsForMessagePreparation(
  projectId: string,
  messageId: string,
  preparationToken: string,
): number {
  return getDatabase()
    .prepare(
      'DELETE FROM recipient_jobs WHERE projectId = ? AND messageId = ? AND preparationToken = ?',
    )
    .run(projectId, messageId, preparationToken).changes;
}

export function nextQueuedJob(
  source: JobSource,
  due: Date,
): RecipientJob | undefined {
  const clause = sourceClause(source, { state: 'queued', due });
  const row = getDatabase()
    .prepare(
      `SELECT * FROM recipient_jobs WHERE ${clause.sql}
       ORDER BY availableAt ASC, id ASC LIMIT 1`,
    )
    .get(...clause.params);
  return row === undefined ? undefined : hydrate([row])[0];
}

export function claimNextJob(
  source: JobSource,
  claimTime: Date,
  leaseUntil: Date,
): RecipientJob | undefined {
  const clause = sourceClause(source, { state: 'queued', due: claimTime });
  const token = newId();
  const row = transaction(() => {
    const selected = getDatabase()
      .prepare(
        `SELECT id FROM recipient_jobs WHERE ${clause.sql}
         ORDER BY availableAt ASC, id ASC LIMIT 1`,
      )
      .get(...clause.params);
    if (selected === undefined) return undefined;
    const id = z.object({ id: z.string() }).parse(selected).id;
    return getDatabase()
      .prepare(
        `UPDATE recipient_jobs SET state = 'claimed', leaseToken = ?, leaseUntil = ?,
          updatedAt = ? WHERE id = ? AND state = 'queued' RETURNING *`,
      )
      .get(token, leaseUntil.toISOString(), nowIso(), id);
  });
  return row === undefined ? undefined : hydrate([row])[0];
}

export function hasLiveJobs(source: JobSource): boolean {
  const clause = sourceClause(source);
  return Boolean(
    getDatabase()
      .prepare(
        `SELECT 1 FROM recipient_jobs WHERE ${clause.sql}
         AND state IN ('queued', 'claimed', 'sending') LIMIT 1`,
      )
      .get(...clause.params),
  );
}

export function hasLiveJobsForMessages(
  projectId: string,
  messageIds: string[],
): boolean {
  if (!messageIds.length) return false;
  return Boolean(
    getDatabase()
      .prepare(
        `SELECT 1 FROM recipient_jobs WHERE projectId = ?
         AND messageId IN (SELECT value FROM json_each(?))
         AND state IN ('claimed', 'sending') LIMIT 1`,
      )
      .get(projectId, JSON.stringify(messageIds)),
  );
}

function updateClaimed(
  jobId: string,
  token: string,
  state: RecipientState,
  reason = '',
): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE recipient_jobs SET state = ?, reason = ?, updatedAt = ?
       WHERE id = ? AND state = 'claimed' AND leaseToken = ?`,
    )
    .run(state, reason, nowIso(), jobId, token);
  return result.changes > 0;
}

export function requeueClaimedJob(jobId: string, token: string): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE recipient_jobs SET state = 'queued', leaseUntil = NULL, leaseToken = NULL,
        updatedAt = ? WHERE id = ? AND state = 'claimed' AND leaseToken = ?`,
    )
    .run(nowIso(), jobId, token);
  return result.changes > 0;
}

export function skipClaimedJob(
  jobId: string,
  token: string,
  reason: string,
): boolean {
  return updateClaimed(jobId, token, 'skipped', reason);
}

export function beginJobSend(
  jobId: string,
  token: string,
  at: Date,
  leaseUntil: Date,
): boolean {
  return transaction(() => {
    const result = getDatabase()
      .prepare(
        `UPDATE recipient_jobs SET state = 'sending', leaseUntil = ?, updatedAt = ?
         WHERE id = ? AND state = 'claimed' AND leaseToken = ?`,
      )
      .run(leaseUntil.toISOString(), nowIso(), jobId, token);
    if (result.changes === 0) return false;
    getDatabase()
      .prepare(
        'INSERT INTO recipient_job_attempts (jobId, at, state, reason) VALUES (?, ?, ?, ?)',
      )
      .run(jobId, at.toISOString(), 'sending', '');
    return true;
  });
}

export function heartbeatJob(
  jobId: string,
  token: string,
  leaseUntil: Date,
): void {
  getDatabase()
    .prepare(
      `UPDATE recipient_jobs SET leaseUntil = ?, updatedAt = ?
       WHERE id = ? AND state = 'sending' AND leaseToken = ?`,
    )
    .run(leaseUntil.toISOString(), nowIso(), jobId, token);
}

export function finishJobSend(
  jobId: string,
  token: string,
  fields: {
    state: RecipientState;
    reason: string;
    availableAt: Date;
    attempt: JobAttempt;
  },
): boolean {
  return transaction(() => {
    const result = getDatabase()
      .prepare(
        `UPDATE recipient_jobs SET state = ?, reason = ?, availableAt = ?, updatedAt = ?
         WHERE id = ? AND state = 'sending' AND leaseToken = ?`,
      )
      .run(
        fields.state,
        fields.reason,
        fields.availableAt.toISOString(),
        nowIso(),
        jobId,
        token,
      );
    if (result.changes === 0) return false;
    getDatabase()
      .prepare(
        'INSERT INTO recipient_job_attempts (jobId, at, state, reason) VALUES (?, ?, ?, ?)',
      )
      .run(
        jobId,
        fields.attempt.at.toISOString(),
        fields.attempt.state,
        fields.attempt.reason,
      );
    return true;
  });
}

export function removeLastAttempt(jobId: string): void {
  getDatabase()
    .prepare(
      `DELETE FROM recipient_job_attempts WHERE id = (
         SELECT id FROM recipient_job_attempts WHERE jobId = ? ORDER BY id DESC LIMIT 1
       )`,
    )
    .run(jobId);
}

export function cancelSendingJob(
  jobId: string,
  token: string,
  cancelled: boolean,
): void {
  transaction(() => {
    getDatabase()
      .prepare(
        `UPDATE recipient_jobs SET state = ?, reason = ?, updatedAt = ?
         WHERE id = ? AND state = 'sending' AND leaseToken = ?`,
      )
      .run(
        cancelled ? 'skipped' : 'queued',
        cancelled ? 'Campaign cancelled.' : '',
        nowIso(),
        jobId,
        token,
      );
    removeLastAttempt(jobId);
  });
}

export function sweepStaleClaimedJobs(now: Date): number {
  return getDatabase()
    .prepare(
      `UPDATE recipient_jobs SET state = 'queued', leaseUntil = NULL, leaseToken = NULL,
        updatedAt = ? WHERE state = 'claimed' AND leaseUntil < ?`,
    )
    .run(nowIso(), now.toISOString()).changes;
}

export function sweepStaleSendingJobs(
  now: Date,
  reason: string,
): number {
  return transaction(() => {
    const rows = getDatabase()
      .prepare(
        "SELECT id FROM recipient_jobs WHERE state = 'sending' AND leaseUntil < ?",
      )
      .all(now.toISOString());
    for (const row of rows) {
      const id = z.object({ id: z.string() }).parse(row).id;
      getDatabase()
        .prepare(
          `UPDATE recipient_jobs SET state = 'outcome_unknown', reason = ?, updatedAt = ?
           WHERE id = ? AND state = 'sending'`,
        )
        .run(reason, nowIso(), id);
      getDatabase()
        .prepare(
          'INSERT INTO recipient_job_attempts (jobId, at, state, reason) VALUES (?, ?, ?, ?)',
        )
        .run(id, now.toISOString(), 'outcome_unknown', 'SMTP acceptance unknown.');
    }
    return rows.length;
  });
}

export function skipQueuedJobs(
  filter: JobFilter,
  reason: string,
): number {
  const clause = filterClause(filter);
  return getDatabase()
    .prepare(
      `UPDATE recipient_jobs SET state = 'skipped', reason = ?, updatedAt = ?
       WHERE ${clause.sql} AND state IN ('queued', 'claimed')`,
    )
    .run(reason, nowIso(), ...clause.params).changes;
}
