import { randomUUID } from 'node:crypto';
import {
  campaignInputSchema,
  campaignContentSchema,
  audienceSchema,
} from '@outreachit/shared';
import { z } from 'zod';
import { ContactModel, FieldModel } from '../models/index.js';
import {
  CampaignModel,
  TemplateModel,
  RecipientJobModel,
} from '../models/EmailModels.js';
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
    !(await FieldModel.exists({ projectId, key: q.fieldKey }))
  )
    throw new HttpError(404, 'Custom field not found.');
  if (audience.mode === 'filters' && q.fieldValue && !q.fieldKey)
    throw new HttpError(400, 'Choose a custom field.');
  const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return ContactModel.find({
    projectId,
    deletedAt: null,
    ...(audience.mode === 'selected'
      ? { _id: { $in: audience.contactIds } }
      : {}),
    ...(audience.mode === 'filters'
      ? {
        ...(q.status === 'all'
          ? {}
          : { suppressed: q.status === 'suppressed' }),
        ...(q.fieldKey
          ? {
            [`customFields.${q.fieldKey}`]: {
              $regex: literal(q.fieldValue),
              $options: 'i',
            },
          }
          : {}),
        ...(q.search
          ? {
            $or: [
              'email',
              'firstName',
              'lastName',
              'company',
              'city',
              'source',
            ].map((k) => ({
              [k]: { $regex: literal(q.search), $options: 'i' },
            })),
          }
          : {}),
      }
      : {}),
  });
}
export async function findCampaign(projectId: string, id: string) {
  const c = await CampaignModel.findOne({ _id: id, projectId });
  if (!c) throw new HttpError(404, 'Campaign not found.');
  return c;
}
export async function campaignMessage(projectId: string, value: unknown) {
  const content = campaignContentSchema.parse(value);
  if (content.message)
    return validateTemplate(projectId, {
      name: 'Campaign email',
      ...content.message,
    });
  const template = await TemplateModel.findOne({
    _id: content.templateId,
    projectId,
  });
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
  const settings = await getMailAccount(
    projectId,
    String(existing.emailAccountId),
  );
  const policy = await getSendingSettings(projectId);
  if (!settings.senderEmail || !settings.host)
    throw new HttpError(400, 'Configure a sender before launching.');
  unsubscribeUrl(projectId, '000000000000000000000000');
  if (existing.scheduledAt && existing.scheduledAt <= new Date())
    throw new HttpError(400, 'Choose a future scheduled time.');
  const preparationToken = randomUUID();
  const campaign = await CampaignModel.findOneAndUpdate(
    { _id: id, projectId, state: existing.state },
    {
      $set: {
        state: 'preparing',
        preparationToken,
        preparationUntil: new Date(Date.now() + 120000),
        error: '',
      },
    },
    { returnDocument: 'after' },
  );
  if (!campaign) return findCampaign(projectId, id);
  try {
    await RecipientJobModel.deleteMany({ projectId, campaignId: id });
    const template = await campaignMessage(projectId, {
      templateId: campaign.templateId ? String(campaign.templateId) : null,
      message: campaign.message
        ? { subject: campaign.message.subject, html: campaign.message.html }
        : null,
    });
    const contacts = await audienceContacts(
      projectId,
      campaign.toObject().audience,
    );
    let total = 0;
    for (const contact of contacts) {
      if (contact.suppressed) continue;
      if (
        !(await CampaignModel.exists({
          _id: id,
          projectId,
          state: 'preparing',
          preparationToken,
        }))
      )
        throw new Error('Preparation lease lost');
      const url = unsubscribeUrl(projectId, String(contact._id));
      const message = renderMessage(template, contact, url);
      await RecipientJobModel.create({
        projectId,
        campaignId: id,
        preparationToken,
        contactId: contact._id,
        email: contact.email,
        subject: message.subject,
        html: message.html,
        text: message.text,
        unsubscribeUrl: url,
      });
      total++;
      await CampaignModel.updateOne(
        { _id: id, projectId, state: 'preparing', preparationToken },
        { $set: { preparationUntil: new Date(Date.now() + 120000) } },
      );
    }
    await CampaignModel.updateOne(
      { _id: id, projectId, state: 'preparing', preparationToken },
      {
        $set: {
          total,
          senderName: settings.senderName,
          senderEmail: settings.senderEmail,
          replyTo: settings.replyTo,
          emailAccountId: settings._id,
          timeZone: policy.timeZone,
          state: campaign.scheduledAt ? 'scheduled' : 'active',
        },
      },
    );
  } catch {
    await CampaignModel.updateOne(
      { _id: id, projectId, state: 'preparing', preparationToken },
      {
        $set: {
          state: 'preparation_failed',
          error:
            'Preparation interrupted or invalid. Review the email and explicitly retry.',
        },
      },
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
