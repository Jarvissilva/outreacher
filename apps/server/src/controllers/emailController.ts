import type { RequestHandler } from 'express';
import { z } from 'zod';
import {
  emailAccountInputSchema,
  sendingSettingsInputSchema,
  templateInputSchema,
  idSchema,
  audienceSchema,
  campaignContentSchema,
  recipientStates,
} from '@outreacher/shared';
import { getProjectId } from '../lib/getProjectId.js';
import { HttpError } from '../lib/HttpError.js';
import {
  findContactById,
  suppressContact,
} from '../db/repositories/contacts.js';
import {
  archiveAccount,
  createAccount,
  listAccounts,
  updateAccount,
} from '../db/repositories/mailAccounts.js';
import {
  createTemplate,
  deleteTemplate as deleteTemplateRecord,
  findTemplate,
  listTemplates as listTemplateRecords,
  serializeTemplate,
  updateTemplate,
} from '../db/repositories/templates.js';
import {
  createCampaign,
  deleteCampaignDraft,
  hasUnfinishedCampaignForAccount,
  listCampaigns as listCampaignRecords,
  serializeCampaign,
  transitionCampaign,
  updateCampaignDraft,
} from '../db/repositories/campaigns.js';
import {
  hasUnfinishedMessageForAccount,
  listMessageIdsForAccount,
} from '../db/repositories/messages.js';
import {
  countJobs,
  countJobsByState,
  deleteJobsForCampaign,
  hasLiveJobsForMessages,
  listJobs,
  skipQueuedJobs,
} from '../db/repositories/jobs.js';
import { saveSendingSettings as saveSendingSettingsRecord } from '../db/repositories/projects.js';
import {
  encryptPassword,
  serializeAccount,
  getSendingSettings,
  serializeSendingSettings,
  getMailAccount,
  createTransport,
  validateTemplate,
  renderMessage,
  unsubscribeUrl,
  verifyUnsubscribe,
  classifySmtpError,
} from '../services/emailService.js';
import {
  audienceContacts,
  campaignMessage,
  findCampaign as findCampaignService,
  validateCampaign,
  launchCampaign,
} from '../services/campaignService.js';

export const readSendingSettings: RequestHandler = async (req, res) => {
  res.json(
    serializeSendingSettings(await getSendingSettings(getProjectId(req))),
  );
};

export const saveSendingSettings: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const input = sendingSettingsInputSchema.parse(req.body);
  const settings = saveSendingSettingsRecord(projectId, input);
  if (!settings) throw new HttpError(404, 'Project not found.');
  res.json(serializeSendingSettings(settings));
};

export const listEmailAccounts: RequestHandler = async (req, res) => {
  res.json(listAccounts(getProjectId(req)).map(serializeAccount));
};

export const saveEmailAccount: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const accountId = req.params.accountId
    ? idSchema.parse(req.params.accountId)
    : undefined;
  if (accountId) await getMailAccount(projectId, accountId);
  const { password, ...input } = emailAccountInputSchema.parse(req.body);
  const data = {
    ...input,
    sendingError: '',
    ...(password ? { passwordEncrypted: encryptPassword(password) } : {}),
  };
  const account = accountId
    ? updateAccount(projectId, accountId, data)
    : createAccount(projectId, data);
  if (!account) throw new HttpError(404, 'Mail account not found.');
  res.status(accountId ? 200 : 201).json(serializeAccount(account));
};

export const deleteEmailAccount: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const accountId = idSchema.parse(req.params.accountId);
  await getMailAccount(projectId, accountId);
  if (hasUnfinishedCampaignForAccount(projectId, accountId))
    throw new HttpError(
      409,
      'Cancel campaigns using this account or return scheduled campaigns to draft before removing it.',
    );
  if (hasUnfinishedMessageForAccount(projectId, accountId))
    throw new HttpError(
      409,
      'Delete reply drafts or cancel unfinished messages using this account before removing it.',
    );
  const messageIds = listMessageIdsForAccount(projectId, accountId);
  if (hasLiveJobsForMessages(projectId, messageIds))
    throw new HttpError(
      409,
      'Wait for in-flight standalone emails to finish before removing this account.',
    );
  archiveAccount(projectId, accountId);
  res.status(204).end();
};

export const verifySettings: RequestHandler = async (req, res) => {
  const transport = createTransport(
    await getMailAccount(
      getProjectId(req),
      idSchema.parse(req.params.accountId),
    ),
  );
  try {
    await transport.verify();
    res.json({ ok: true });
  } catch (error) {
    throw new HttpError(400, classifySmtpError(error).reason);
  } finally {
    transport.close();
  }
};

export const testEmail: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const input = z
    .object({
      recipient: z.email(),
      templateId: idSchema.optional(),
      contactId: idSchema.optional(),
    })
    .strict()
    .parse(req.body);
  const account = await getMailAccount(
    projectId,
    idSchema.parse(req.params.accountId),
  );
  let message = {
    subject: 'Outreacher SMTP test',
    html: '<p>Your email connection works.</p>',
    text: 'Your email connection works.',
  };
  if (input.templateId) {
    const template = findTemplate(projectId, input.templateId);
    const contact = input.contactId
      ? findContactById(projectId, input.contactId)
      : undefined;
    if (!template || !contact)
      throw new HttpError(
        404,
        'Choose a template and preview contact in this project.',
      );
    message = renderMessage(
      template,
      contact,
      unsubscribeUrl(projectId, contact.id),
    );
  }
  const transport = createTransport(account);
  try {
    await transport.sendMail({
      from: {
        name: account.senderName ?? '',
        address: account.senderEmail ?? '',
      },
      to: input.recipient,
      ...(account.replyTo ? { replyTo: account.replyTo } : {}),
      ...message,
    });
    res.json({ ok: true });
  } catch (error) {
    throw new HttpError(400, classifySmtpError(error).reason);
  } finally {
    transport.close();
  }
};

export const listTemplates: RequestHandler = async (req, res) => {
  res.json(
    listTemplateRecords(getProjectId(req)).map(serializeTemplate),
  );
};

export const readTemplate: RequestHandler = async (req, res) => {
  const template = findTemplate(
    getProjectId(req),
    idSchema.parse(req.params.id),
  );
  if (!template) throw new HttpError(404, 'Template not found.');
  res.json(serializeTemplate(template));
};

export const saveTemplate: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const input = await validateTemplate(
    projectId,
    templateInputSchema.parse(req.body),
  );
  const template = req.params.id
    ? updateTemplate(projectId, idSchema.parse(req.params.id), input)
    : createTemplate(projectId, input);
  if (!template) throw new HttpError(404, 'Template not found.');
  res
    .status(req.params.id ? 200 : 201)
    .json(serializeTemplate(template));
};

export const deleteTemplate: RequestHandler = async (req, res) => {
  if (
    !deleteTemplateRecord(
      getProjectId(req),
      idSchema.parse(req.params.id),
    )
  )
    throw new HttpError(404, 'Template not found.');
  res.status(204).end();
};

export const previewTemplate: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const input = z
    .object({ contactId: idSchema, ...templateInputSchema.shape })
    .strict()
    .parse(req.body);
  const contact = findContactById(projectId, input.contactId);
  if (!contact) throw new HttpError(404, 'Contact not found.');
  const template = await validateTemplate(
    projectId,
    templateInputSchema.parse({
      name: input.name,
      subject: input.subject,
      html: input.html,
    }),
  );
  res.json({
    projectId,
    ...renderMessage(
      template,
      contact,
      unsubscribeUrl(projectId, contact.id),
    ),
  });
};

export const listCampaigns: RequestHandler = async (req, res) => {
  res.json(listCampaignRecords(getProjectId(req)).map(serializeCampaign));
};

export const readCampaign: RequestHandler = async (req, res) => {
  res.json(
    serializeCampaign(
      await findCampaignService(
        getProjectId(req),
        idSchema.parse(req.params.id),
      ),
    ),
  );
};

export const saveCampaign: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  if (req.params.id)
    await findCampaignService(projectId, idSchema.parse(req.params.id));
  const input = await validateCampaign(projectId, req.body);
  const campaign = req.params.id
    ? updateCampaignDraft(projectId, idSchema.parse(req.params.id), input)
    : createCampaign(projectId, input);
  if (!campaign)
    throw new HttpError(409, 'Campaign is missing or is no longer a draft.');
  res
    .status(req.params.id ? 200 : 201)
    .json(serializeCampaign(campaign));
};

export const deleteCampaign: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const id = idSchema.parse(req.params.id);
  await findCampaignService(projectId, id);
  if (!deleteCampaignDraft(projectId, id))
    throw new HttpError(409, 'Only drafts can be deleted.');
  deleteJobsForCampaign(projectId, id);
  res.status(204).end();
};

export const previewAudience: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const input = z
    .object({ audience: audienceSchema, ...campaignContentSchema.shape })
    .strict()
    .parse(req.body);
  const template = await campaignMessage(projectId, {
    templateId: input.templateId,
    message: input.message,
  });
  const contacts = await audienceContacts(projectId, input.audience);
  const eligible = contacts.filter((contact) => !contact.suppressed);
  const warnings = new Set<string>();
  for (const contact of eligible)
    for (const warning of renderMessage(
      template,
      contact,
      'https://example.invalid/unsubscribe',
    ).warnings)
      warnings.add(`${contact.email}: ${warning}`);
  res.json({
    projectId,
    eligible: eligible.length,
    recipients: eligible.map((contact) => ({
      contactId: contact.id,
      email: contact.email,
    })),
    excluded: contacts.length - eligible.length,
    warnings: [...warnings],
  });
};

export const launch: RequestHandler = async (req, res) => {
  res.json(
    serializeCampaign(
      await launchCampaign(
        getProjectId(req),
        idSchema.parse(req.params.id),
        req.body,
      ),
    ),
  );
};

export const campaignAction: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const id = idSchema.parse(req.params.id);
  const action = z
    .enum(['pause', 'resume', 'cancel', 'draft'])
    .parse(req.params.action);
  const current = await findCampaignService(projectId, id);
  const transitions = {
    pause: { from: ['active'] as const, to: 'paused' as const },
    resume: { from: ['paused'] as const, to: 'active' as const },
    cancel: {
      from: ['active', 'paused', 'scheduled'] as const,
      to: 'cancelled' as const,
    },
    draft: {
      from: ['scheduled', 'preparation_failed'] as const,
      to: 'draft' as const,
    },
  };
  const transition = transitions[action];
  if (action === 'resume') {
    if (
      !current.emailAccountId ||
      (await getMailAccount(projectId, current.emailAccountId)).sendingError
    )
      throw new HttpError(409, 'Save corrected SMTP settings before resuming.');
  }
  const campaign = transitionCampaign(
    projectId,
    id,
    [...transition.from],
    transition.to,
    action === 'draft' ? { clearStartedAt: true, resetTotal: true } : {},
  );
  if (!campaign)
    throw new HttpError(409, 'Campaign state changed; reload and try again.');
  if (action === 'cancel')
    skipQueuedJobs(
      { projectId, campaignId: id },
      'Campaign cancelled.',
    );
  res.json(serializeCampaign(campaign));
};

export const report: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const id = idSchema.parse(req.params.id);
  const campaign = await findCampaignService(projectId, id);
  const query = z
    .object({
      state: z.enum(recipientStates).optional(),
      page: z.coerce.number().int().min(1).default(1),
      format: z.enum(['json', 'csv']).default('json'),
    })
    .strict()
    .parse(req.query);
  const baseFilter = {
    projectId,
    campaignId: id,
    ...(campaign.preparationToken
      ? { preparationToken: campaign.preparationToken }
      : {}),
  };
  const filter = {
    ...baseFilter,
    ...(query.state ? { state: query.state } : {}),
  };
  const rows = listJobs(
    filter,
    query.format === 'csv'
      ? {}
      : { limit: 100, offset: (query.page - 1) * 100 },
  );
  const items = rows.map((job) => ({
    id: job.id,
    projectId,
    campaignId: id,
    email: job.email,
    state: job.state,
    reason: job.reason,
    attempts: job.attempts.map((attempt) => ({
      at: attempt.at.toISOString(),
      state: attempt.state,
      reason: attempt.reason,
    })),
  }));
  if (query.format === 'csv') {
    const cell = (value: string) =>
      `"${(/^[=+@\-\t\r]/.test(value) ? "'" : '') + value.replace(/"/g, '""')}"`;
    res
      .attachment('campaign-report.csv')
      .type('text/csv')
      .send(
        [
          'email,state,reason',
          ...items
            .map((job) =>
              [job.email, job.state, job.reason].map(cell).join(','),
            ),
        ].join('\r\n'),
      );
    return;
  }
  res.json({
    projectId,
    items,
    total: countJobs(filter),
    counts: countJobsByState(baseFilter),
  });
};

export const unsubscribe: RequestHandler = async (req, res) => {
  const { projectId, contactId } = verifyUnsubscribe(
    z.string().parse(req.params.token),
  );
  if (req.method === 'POST') {
    suppressContact(projectId, contactId);
    res
      .type('html')
      .send(
        '<!doctype html><title>Unsubscribed</title><h1>You have been unsubscribed.</h1><p>This applies only to this project.</p>',
      );
  } else
    res
      .set('Cache-Control', 'no-store')
      .set('Referrer-Policy', 'no-referrer')
      .type('html')
      .send(
        '<!doctype html><title>Unsubscribe</title><h1>Unsubscribe from this project?</h1><form method="post"><button>Confirm unsubscribe</button></form>',
      );
};
