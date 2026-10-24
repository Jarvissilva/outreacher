import { z } from 'zod';
import { audienceSchema, campaignInputSchema, campaignStates } from '@outreacher/shared';
import type { CampaignInput } from '@outreacher/shared';
import { getDatabase } from '../database.js';
import { newId, nowIso, parseJson, toDate, toNullableDate } from '../values.js';

export type CampaignState = (typeof campaignStates)[number];

const campaignMessageSchema = z.object({
  subject: z.string(),
  html: z.string(),
});
export type CampaignMessage = z.infer<typeof campaignMessageSchema>;

const campaignRowSchema = z.object({
  id: z.string(),
  projectId: z.string(),
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
  createdAt: z.string(),
  updatedAt: z.string(),
});
type CampaignRow = z.infer<typeof campaignRowSchema>;

export interface Campaign {
  id: string;
  projectId: string;
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
  createdAt: Date;
  updatedAt: Date;
}

function fromRow(row: CampaignRow): Campaign {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    templateId: row.templateId,
    message:
      row.message === null
        ? null
        : campaignMessageSchema.parse(parseJson(row.message)),
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
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
  };
}

export function serializeCampaign(campaign: Campaign) {
  return {
    id: campaign.id,
    projectId: campaign.projectId,
    name: campaign.name,
    templateId: campaign.templateId,
    message: campaign.message,
    emailAccountId: campaign.emailAccountId,
    senderEmail: campaign.senderEmail,
    audience: campaign.audience,
    scheduledAt: campaign.scheduledAt?.toISOString() ?? null,
    weekdays: campaign.weekdays,
    startHour: campaign.startHour,
    endHour: campaign.endHour,
    state: campaign.state,
    error: campaign.error,
    timeZone: campaign.timeZone,
    total: campaign.total,
  };
}

export function listCampaigns(projectId: string): Campaign[] {
  return getDatabase()
    .prepare(
      'SELECT * FROM campaigns WHERE projectId = ? ORDER BY createdAt DESC, id DESC',
    )
    .all(projectId)
    .map((row) => fromRow(campaignRowSchema.parse(row)));
}

export function findCampaign(
  projectId: string,
  id: string,
): Campaign | undefined {
  const row = getDatabase()
    .prepare('SELECT * FROM campaigns WHERE projectId = ? AND id = ?')
    .get(projectId, id);
  return row === undefined ? undefined : fromRow(campaignRowSchema.parse(row));
}

export function createCampaign(
  projectId: string,
  input: CampaignInput,
): Campaign {
  const id = newId();
  const now = nowIso();
  getDatabase()
    .prepare(
      `INSERT INTO campaigns
        (id, projectId, name, templateId, message, emailAccountId, audience, scheduledAt,
         weekdays, startHour, endHour, state, error, timeZone, senderName, senderEmail,
         replyTo, total, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', '', 'UTC', '', '', '', 0, ?, ?)`,
    )
    .run(
      id,
      projectId,
      input.name,
      input.templateId,
      input.message ? JSON.stringify(input.message) : null,
      input.emailAccountId,
      JSON.stringify(input.audience),
      input.scheduledAt,
      JSON.stringify(input.weekdays),
      input.startHour,
      input.endHour,
      now,
      now,
    );
  const campaign = findCampaign(projectId, id);
  if (!campaign) throw new Error('Campaign creation failed.');
  return campaign;
}

export function updateCampaignDraft(
  projectId: string,
  id: string,
  input: CampaignInput,
): Campaign | undefined {
  const result = getDatabase()
    .prepare(
      `UPDATE campaigns SET
        name = ?, templateId = ?, message = ?, emailAccountId = ?, audience = ?,
        scheduledAt = ?, weekdays = ?, startHour = ?, endHour = ?, updatedAt = ?
       WHERE projectId = ? AND id = ? AND state = 'draft'`,
    )
    .run(
      input.name,
      input.templateId,
      input.message ? JSON.stringify(input.message) : null,
      input.emailAccountId,
      JSON.stringify(input.audience),
      input.scheduledAt,
      JSON.stringify(input.weekdays),
      input.startHour,
      input.endHour,
      nowIso(),
      projectId,
      id,
    );
  return result.changes === 0 ? undefined : findCampaign(projectId, id);
}

export function deleteCampaignDraft(projectId: string, id: string): boolean {
  const result = getDatabase()
    .prepare("DELETE FROM campaigns WHERE projectId = ? AND id = ? AND state = 'draft'")
    .run(projectId, id);
  return result.changes > 0;
}

export function claimCampaignPreparation(
  projectId: string,
  id: string,
  expectedState: CampaignState,
  token: string,
  until: Date,
): Campaign | undefined {
  const row = getDatabase()
    .prepare(
      `UPDATE campaigns SET state = 'preparing', preparationToken = ?,
        preparationUntil = ?, error = '', updatedAt = ?
       WHERE projectId = ? AND id = ? AND state = ?
       RETURNING *`,
    )
    .get(token, until.toISOString(), nowIso(), projectId, id, expectedState);
  return row === undefined ? undefined : fromRow(campaignRowSchema.parse(row));
}

export function campaignPreparationOwned(
  projectId: string,
  id: string,
  token: string,
): boolean {
  return Boolean(
    getDatabase()
      .prepare(
        "SELECT 1 FROM campaigns WHERE projectId = ? AND id = ? AND state = 'preparing' AND preparationToken = ?",
      )
      .get(projectId, id, token),
  );
}

export function renewCampaignPreparation(
  projectId: string,
  id: string,
  token: string,
  until: Date,
): boolean {
  const result = getDatabase()
    .prepare(
      "UPDATE campaigns SET preparationUntil = ?, updatedAt = ? WHERE projectId = ? AND id = ? AND state = 'preparing' AND preparationToken = ?",
    )
    .run(until.toISOString(), nowIso(), projectId, id, token);
  return result.changes > 0;
}

export function finishCampaignPreparation(
  projectId: string,
  id: string,
  token: string,
  fields: {
    total: number;
    senderName: string;
    senderEmail: string;
    replyTo: string;
    emailAccountId: string;
    timeZone: string;
    state: CampaignState;
  },
): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE campaigns SET total = ?, senderName = ?, senderEmail = ?, replyTo = ?,
        emailAccountId = ?, timeZone = ?, state = ?, updatedAt = ?
       WHERE projectId = ? AND id = ? AND state = 'preparing' AND preparationToken = ?`,
    )
    .run(
      fields.total,
      fields.senderName,
      fields.senderEmail,
      fields.replyTo,
      fields.emailAccountId,
      fields.timeZone,
      fields.state,
      nowIso(),
      projectId,
      id,
      token,
    );
  return result.changes > 0;
}

export function failCampaignPreparation(
  projectId: string,
  id: string,
  token: string,
  error: string,
): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE campaigns SET state = 'preparation_failed', error = ?, updatedAt = ?
       WHERE projectId = ? AND id = ? AND state = 'preparing' AND preparationToken = ?`,
    )
    .run(error, nowIso(), projectId, id, token);
  return result.changes > 0;
}

export function transitionCampaign(
  projectId: string,
  id: string,
  from: CampaignState[],
  to: CampaignState,
  options: { clearStartedAt?: boolean; resetTotal?: boolean } = {},
): Campaign | undefined {
  const placeholders = from.map(() => '?').join(', ');
  const row = getDatabase()
    .prepare(
      `UPDATE campaigns SET state = ?, error = '', total = ${
        options.resetTotal ? 0 : 'total'
      }, startedAt = ${options.clearStartedAt ? 'NULL' : 'startedAt'}, updatedAt = ?
       WHERE projectId = ? AND id = ? AND state IN (${placeholders})
       RETURNING *`,
    )
    .get(
      to,
      nowIso(),
      projectId,
      id,
      ...from,
    );
  return row === undefined ? undefined : fromRow(campaignRowSchema.parse(row));
}

export function listActiveCampaigns(): Campaign[] {
  return getDatabase()
    .prepare("SELECT * FROM campaigns WHERE state = 'active'")
    .all()
    .map((row) => fromRow(campaignRowSchema.parse(row)));
}

export function activateScheduledCampaigns(now: Date): number {
  return getDatabase()
    .prepare(
      `UPDATE campaigns SET state = 'active', updatedAt = ?
       WHERE state = 'scheduled' AND scheduledAt <= ?`,
    )
    .run(nowIso(), now.toISOString()).changes;
}

export function recoverInterruptedCampaigns(now: Date): number {
  return getDatabase()
    .prepare(
      `UPDATE campaigns SET state = 'preparation_failed',
        error = 'Preparation interrupted. Explicit retry required.', updatedAt = ?
       WHERE state = 'preparing' AND preparationUntil < ?`,
    )
    .run(nowIso(), now.toISOString()).changes;
}

export function markCampaignStarted(
  projectId: string,
  id: string,
  startedAt: Date,
): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE campaigns SET startedAt = COALESCE(startedAt, ?), updatedAt = ?
       WHERE projectId = ? AND id = ? AND state = 'active'`,
    )
    .run(startedAt.toISOString(), nowIso(), projectId, id);
  return result.changes > 0;
}

export function campaignIsCancelled(projectId: string, id: string): boolean {
  return Boolean(
    getDatabase()
      .prepare("SELECT 1 FROM campaigns WHERE projectId = ? AND id = ? AND state = 'cancelled'")
      .get(projectId, id),
  );
}

export function completeCampaign(projectId: string, id: string): void {
  getDatabase()
    .prepare(
      "UPDATE campaigns SET state = 'completed', updatedAt = ? WHERE projectId = ? AND id = ? AND state = 'active'",
    )
    .run(nowIso(), projectId, id);
}

export function pauseCampaign(
  projectId: string,
  id: string,
  error: string,
): boolean {
  const result = getDatabase()
    .prepare(
      "UPDATE campaigns SET state = 'paused', error = ?, updatedAt = ? WHERE projectId = ? AND id = ? AND state = 'active'",
    )
    .run(error, nowIso(), projectId, id);
  return result.changes > 0;
}

export function campaignExists(
  projectId: string,
  id: string,
  state: CampaignState,
): boolean {
  return Boolean(
    getDatabase()
      .prepare('SELECT 1 FROM campaigns WHERE projectId = ? AND id = ? AND state = ?')
      .get(projectId, id, state),
  );
}

export function hasUnfinishedCampaignForAccount(
  projectId: string,
  accountId: string,
): boolean {
  return Boolean(
    getDatabase()
      .prepare(
        `SELECT 1 FROM campaigns WHERE projectId = ? AND emailAccountId = ?
         AND state IN ('preparing', 'scheduled', 'active', 'paused') LIMIT 1`,
      )
      .get(projectId, accountId),
  );
}

export function pauseCampaignsForAccount(
  projectId: string,
  accountId: string,
  error: string,
): number {
  return getDatabase()
    .prepare(
      `UPDATE campaigns SET state = 'paused', error = ?, updatedAt = ?
       WHERE projectId = ? AND emailAccountId = ? AND state = 'active'`,
    )
    .run(error, nowIso(), projectId, accountId).changes;
}

export function parseCampaignInput(value: unknown): CampaignInput {
  return campaignInputSchema.parse(value);
}
