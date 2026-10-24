import { randomUUID } from 'node:crypto';
import {
  campaignInputSchema,
  campaignContentSchema,
  audienceSchema,
} from '@outreacher/shared';
import { z } from 'zod';
import { audienceContacts as repositoryAudienceContacts } from '../db/repositories/contacts.js';
import {
  campaignPreparationOwned,
  claimCampaignPreparation,
  failCampaignPreparation,
  findCampaign as findCampaignRecord,
  finishCampaignPreparation,
  renewCampaignPreparation,
} from '../db/repositories/campaigns.js';
import type { Campaign } from '../db/repositories/campaigns.js';
import { findFieldByKey } from '../db/repositories/customFields.js';
import { findTemplate } from '../db/repositories/templates.js';
import {
  createJob,
  deleteJobsForCampaign,
} from '../db/repositories/jobs.js';
import { HttpError } from '../lib/HttpError.js';
import {
  getMailAccount,
  getSendingSettings,
  renderMessage,
  unsubscribeUrl,
  validateTemplate,
} from './emailService.js';

export async function audienceContacts(projectId: string, input: unknown) {
  const audience = audienceSchema.parse(input);
  const q = audience.filters;
  if (audience.mode === 'selected' && !audience.contactIds.length)
    throw new HttpError(400, 'Select at least one contact.');
  if (
    audience.mode === 'filters' &&
    q.fieldKey &&
    !findFieldByKey(projectId, q.fieldKey)
  )
    throw new HttpError(404, 'Custom field not found.');
  if (audience.mode === 'filters' && q.fieldValue && !q.fieldKey)
    throw new HttpError(400, 'Choose a custom field.');
  return repositoryAudienceContacts(projectId, audience);
}

export async function findCampaign(
  projectId: string,
  id: string,
): Promise<Campaign> {
  const campaign = findCampaignRecord(projectId, id);
  if (!campaign) throw new HttpError(404, 'Campaign not found.');
  return campaign;
}

export async function campaignMessage(projectId: string, value: unknown) {
  const content = campaignContentSchema.parse(value);
  if (content.message)
    return validateTemplate(projectId, {
      name: 'Campaign email',
      ...content.message,
    });
  if (!content.templateId) throw new HttpError(404, 'Template not found.');
  const template = findTemplate(projectId, content.templateId);
  if (!template) throw new HttpError(404, 'Template not found.');
  return validateTemplate(projectId, {
    name: template.name,
    subject: template.subject,
    html: template.html,
  });
}

export async function validateCampaign(projectId: string, value: unknown) {
  const input = campaignInputSchema.parse(value);
  const message = await campaignMessage(projectId, {
    templateId: input.templateId,
    message: input.message,
  });
  await getMailAccount(projectId, input.emailAccountId);
  return { ...input, message: input.message ? message : null };
}

export async function launchCampaign(
  projectId: string,
  id: string,
  value: unknown,
) {
  z.object({ confirmed: z.literal(true), retry: z.boolean().default(false) })
    .strict()
    .parse(value);
  const existing = await findCampaign(projectId, id);
  const retry = z
    .object({ retry: z.boolean().default(false) })
    .parse(value).retry;
  if (
    existing.state !== 'draft' &&
    !(retry && existing.state === 'preparation_failed')
  )
    return existing;
  if (!existing.emailAccountId)
    throw new HttpError(400, 'Choose a mail account before launching.');
  const settings = await getMailAccount(projectId, existing.emailAccountId);
  const policy = await getSendingSettings(projectId);
  if (!settings.senderEmail || !settings.host)
    throw new HttpError(400, 'Configure a sender before launching.');
  unsubscribeUrl(projectId, '000000000000000000000000');
  if (existing.scheduledAt && existing.scheduledAt <= new Date())
    throw new HttpError(400, 'Choose a future scheduled time.');
  const preparationToken = randomUUID();
  const campaign = claimCampaignPreparation(
    projectId,
    id,
    existing.state,
    preparationToken,
    new Date(Date.now() + 120000),
  );
  if (!campaign) return findCampaign(projectId, id);
  try {
    deleteJobsForCampaign(projectId, id);
    const template = await campaignMessage(projectId, {
      templateId: campaign.templateId,
      message: campaign.message,
    });
    const contacts = await audienceContacts(projectId, campaign.audience);
    let total = 0;
    for (const contact of contacts) {
      if (contact.suppressed) continue;
      if (!campaignPreparationOwned(projectId, id, preparationToken))
        throw new Error('Preparation lease lost');
      const url = unsubscribeUrl(projectId, contact.id);
      const message = renderMessage(template, contact, url);
      createJob({
        projectId,
        campaignId: id,
        preparationToken,
        contactId: contact.id,
        email: contact.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
        unsubscribeUrl: url,
      });
      total++;
      renewCampaignPreparation(
        projectId,
        id,
        preparationToken,
        new Date(Date.now() + 120000),
      );
    }
    finishCampaignPreparation(projectId, id, preparationToken, {
      total,
      senderName: settings.senderName,
      senderEmail: settings.senderEmail,
      replyTo: settings.replyTo,
      emailAccountId: settings.id,
      timeZone: policy.timeZone,
      state: campaign.scheduledAt ? 'scheduled' : 'active',
    });
  } catch {
    failCampaignPreparation(
      projectId,
      id,
      preparationToken,
      'Preparation interrupted or invalid. Review the email and explicitly retry.',
    );
  }
  return findCampaign(projectId, id);
}

export function inSendingWindow(
  c: {
    timeZone: string;
    weekdays: number[];
    startHour?: number | null;
    endHour?: number | null;
  },
  now: Date,
) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: c.timeZone,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(
    parts.find((p) => p.type === 'weekday')?.value ?? '',
  );
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return (
    (!c.weekdays.length || c.weekdays.includes(day)) &&
    (c.startHour == null ||
      c.endHour == null ||
      (hour >= c.startHour && hour < c.endHour))
  );
}
