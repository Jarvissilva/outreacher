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
} from '@outreachit/shared';
import { getProjectId } from '../lib/getProjectId.js';
import { HttpError } from '../lib/HttpError.js';
import { ContactModel } from '../models/index.js';
import {
  MailAccountModel,
  TemplateModel,
  CampaignModel,
  MessageModel,
  RecipientJobModel,
  serializeTemplate,
  serializeCampaign,
} from '../models/EmailModels.js';
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
  findCampaign,
  validateCampaign,
  launchCampaign,
} from '../services/campaignService.js';
export const readSendingSettings: RequestHandler = async (req, res) => {
  res.json(
    serializeSendingSettings(await getSendingSettings(getProjectId(req))),
  );
};
export const saveSendingSettings: RequestHandler = async (req, res) => {
  const settings = await getSendingSettings(getProjectId(req));
  const input = sendingSettingsInputSchema.parse(req.body);
  settings.hourlyLimit = input.hourlyLimit;
  settings.timeZone = input.timeZone;
  await settings.save();
  res.json(serializeSendingSettings(settings));
};
export const listEmailAccounts: RequestHandler = async (req, res) => {
  res.json(
    (
      await MailAccountModel.find({
        projectId: getProjectId(req),
        archivedAt: null,
      }).sort({ createdAt: 1, _id: 1 })
    ).map(serializeAccount),
  );
};
export const saveEmailAccount: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  if (req.params.accountId)
    await getMailAccount(projectId, idSchema.parse(req.params.accountId));
  const { password, ...input } = emailAccountInputSchema.parse(req.body);
  const data = {
    ...input,
    sendingError: '',
    ...(password ? { passwordEncrypted: encryptPassword(password) } : {}),
  };
  const account = req.params.accountId
    ? await MailAccountModel.findOneAndUpdate(
      {
        _id: idSchema.parse(req.params.accountId),
        projectId,
        archivedAt: null,
      },
      { $set: data },
      { returnDocument: 'after' },
    )
    : await MailAccountModel.create({ projectId, ...data });
  if (!account) throw new HttpError(404, 'Mail account not found.');
  res.status(req.params.accountId ? 200 : 201).json(serializeAccount(account));
};
export const deleteEmailAccount: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const accountId = idSchema.parse(req.params.accountId);
  await getMailAccount(projectId, accountId);
  if (
    await CampaignModel.exists({
      projectId,
      emailAccountId: accountId,
      state: { $in: ['preparing', 'scheduled', 'active', 'paused'] },
    })
  )
    throw new HttpError(
      409,
      'Cancel campaigns using this account or return scheduled campaigns to draft before removing it.',
    );
  if (await MessageModel.exists({ projectId, emailAccountId: accountId, $or: [{ state: { $in: ['preparing', 'preparation_failed', 'active', 'paused'] } }, { kind: 'reply', state: 'draft' }] })) throw new HttpError(409, 'Delete reply drafts or cancel unfinished messages using this account before removing it.');
  const messages = await MessageModel.find({ projectId, emailAccountId: accountId }).select('_id');
  if (await RecipientJobModel.exists({ projectId, messageId: { $in: messages.map(m => m._id) }, state: { $in: ['claimed', 'sending'] } }))
    throw new HttpError(409, 'Wait for in-flight standalone emails to finish before removing this account.');
  await MailAccountModel.updateOne(
    { _id: accountId, projectId, archivedAt: null },
    { $set: { archivedAt: new Date(), passwordEncrypted: '', incoming: null } },
  );
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
  } catch (e) {
    throw new HttpError(400, classifySmtpError(e).reason);
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
  const s = await getMailAccount(
    projectId,
    idSchema.parse(req.params.accountId),
  );
  let message = {
    subject: 'OutreachIt SMTP test',
    html: '<p>Your email connection works.</p>',
    text: 'Your email connection works.',
  };
  if (input.templateId) {
    const template = await TemplateModel.findOne({
      _id: input.templateId,
      projectId,
    });
    const contact = input.contactId
      ? await ContactModel.findOne({
        _id: input.contactId,
        projectId,
        deletedAt: null,
      })
      : null;
    if (!template || !contact)
      throw new HttpError(
        404,
        'Choose a template and preview contact in this project.',
      );
    message = renderMessage(
      template,
      contact,
      unsubscribeUrl(projectId, String(contact._id)),
    );
  }
  const transport = createTransport(s);
  try {
    await transport.sendMail({
      from: { name: s.senderName ?? '', address: s.senderEmail ?? '' },
      to: input.recipient,
      ...(s.replyTo ? { replyTo: s.replyTo } : {}),
      ...message,
    });
    res.json({ ok: true });
  } catch (e) {
    throw new HttpError(400, classifySmtpError(e).reason);
  } finally {
    transport.close();
  }
};
export const listTemplates: RequestHandler = async (req, res) => {
  res.json(
    (
      await TemplateModel.find({ projectId: getProjectId(req) }).sort({
        createdAt: -1,
      })
    ).map(serializeTemplate),
  );
};
export const readTemplate: RequestHandler = async (req, res) => {
  const t = await TemplateModel.findOne({
    _id: idSchema.parse(req.params.id),
    projectId: getProjectId(req),
  });
  if (!t) throw new HttpError(404, 'Template not found.');
  res.json(serializeTemplate(t));
};
export const saveTemplate: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const input = await validateTemplate(
    projectId,
    templateInputSchema.parse(req.body),
  );
  const t = req.params.id
    ? await TemplateModel.findOneAndUpdate(
      { _id: idSchema.parse(req.params.id), projectId },
      { $set: input },
      { returnDocument: 'after' },
    )
    : await TemplateModel.create({ projectId, ...input });
  if (!t) throw new HttpError(404, 'Template not found.');
  res.status(req.params.id ? 200 : 201).json(serializeTemplate(t));
};
export const deleteTemplate: RequestHandler = async (req, res) => {
  if (
    !(
      await TemplateModel.deleteOne({
        _id: idSchema.parse(req.params.id),
        projectId: getProjectId(req),
      })
    ).deletedCount
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
  const contact = await ContactModel.findOne({
    _id: input.contactId,
    projectId,
    deletedAt: null,
  });
  if (!contact) throw new HttpError(404, 'Contact not found.');
  const t = await validateTemplate(
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
      t,
      contact,
      unsubscribeUrl(projectId, String(contact._id)),
    ),
  });
};
export const listCampaigns: RequestHandler = async (req, res) => {
  res.json(
    (
      await CampaignModel.find({ projectId: getProjectId(req) }).sort({
        createdAt: -1,
      })
    ).map(serializeCampaign),
  );
};
export const readCampaign: RequestHandler = async (req, res) => {
  res.json(
    serializeCampaign(
      await findCampaign(getProjectId(req), idSchema.parse(req.params.id)),
    ),
  );
};
export const saveCampaign: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  if (req.params.id)
    await findCampaign(projectId, idSchema.parse(req.params.id));
  const input = await validateCampaign(projectId, req.body);
  const c = req.params.id
    ? await CampaignModel.findOneAndUpdate(
      { _id: idSchema.parse(req.params.id), projectId, state: 'draft' },
      { $set: input },
      { returnDocument: 'after' },
    )
    : await CampaignModel.create({ ...input, projectId });
  if (!c)
    throw new HttpError(409, 'Campaign is missing or is no longer a draft.');
  res.status(req.params.id ? 200 : 201).json(serializeCampaign(c));
};
export const deleteCampaign: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const id = idSchema.parse(req.params.id);
  await findCampaign(projectId, id);
  if (
    !(await CampaignModel.deleteOne({ _id: id, projectId, state: 'draft' }))
      .deletedCount
  )
    throw new HttpError(409, 'Only drafts can be deleted.');
  await RecipientJobModel.deleteMany({ projectId, campaignId: id });
  res.status(204).end();
};
export const previewAudience: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const input = z
    .object({ audience: audienceSchema, ...campaignContentSchema.shape })
    .strict()
    .parse(req.body);
  const template = await campaignMessage(projectId, {
    templateId: input.templateId, message: input.message,
  });
  const contacts = await audienceContacts(projectId, input.audience);
  const eligible = contacts.filter((c) => !c.suppressed);
  const warnings = new Set<string>();
  for (const c of eligible)
    for (const warning of renderMessage(
      template,
      c,
      'https://example.invalid/unsubscribe',
    ).warnings)
      warnings.add(`${c.email}: ${warning}`);
  res.json({
    projectId,
    eligible: eligible.length,
    recipients: eligible.map((c) => ({
      contactId: String(c._id),
      email: c.email,
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
  const current = await findCampaign(projectId, id);
  const transitions = {
    pause: { from: ['active'], to: 'paused' },
    resume: { from: ['paused'], to: 'active' },
    cancel: { from: ['active', 'paused', 'scheduled'], to: 'cancelled' },
    draft: { from: ['scheduled', 'preparation_failed'], to: 'draft' },
  };
  const t = transitions[action];
  if (
    action === 'resume' &&
    (!current.emailAccountId ||
      (await getMailAccount(projectId, String(current.emailAccountId)))
        .sendingError)
  )
    throw new HttpError(409, 'Save corrected SMTP settings before resuming.');
  const c = await CampaignModel.findOneAndUpdate(
    {
      _id: id,
      projectId,
      state: { $in: t.from },
      ...(action === 'draft' ? { startedAt: null } : {}),
    },
    {
      $set: {
        state: t.to,
        error: '',
        ...(action === 'draft' ? { total: 0 } : {}),
      },
    },
    { returnDocument: 'after' },
  );
  if (!c)
    throw new HttpError(409, 'Campaign state changed; reload and try again.');
  if (action === 'cancel')
    await RecipientJobModel.updateMany(
      { projectId, campaignId: id, state: { $in: ['queued', 'claimed'] } },
      { $set: { state: 'skipped', reason: 'Campaign cancelled.' } },
    );
  res.json(serializeCampaign(c));
};
export const report: RequestHandler = async (req, res) => {
  const projectId = getProjectId(req);
  const id = idSchema.parse(req.params.id);
  const campaign = await findCampaign(projectId, id);
  const query = z
    .object({
      state: z.enum(recipientStates).optional(),
      page: z.coerce.number().int().min(1).default(1),
      format: z.enum(['json', 'csv']).default('json'),
    })
    .strict()
    .parse(req.query);
  const filter = {
    projectId,
    campaignId: id,
    preparationToken: campaign.preparationToken,
    ...(query.state ? { state: query.state } : {}),
  };
  const rows = await RecipientJobModel.find(filter)
    .sort({ _id: 1 })
    .skip(query.format === 'csv' ? 0 : (query.page - 1) * 100)
    .limit(query.format === 'csv' ? 0 : 100);
  const items = rows.map((j) => ({
    id: String(j._id),
    projectId,
    campaignId: id,
    email: j.email,
    state: j.state,
    reason: j.reason,
    attempts: j.attempts.map((a) => ({
      at: a.at.toISOString(),
      state: a.state,
      reason: a.reason,
    })),
  }));
  if (query.format === 'csv') {
    const cell = (s: string) =>
      `"${(/^[=+@\-\t\r]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"`;
    res
      .attachment('campaign-report.csv')
      .type('text/csv')
      .send(
        [
          'email,state,reason',
          ...items.map((j) => [j.email, j.state, j.reason].map(cell).join(',')),
        ].join('\r\n'),
      );
    return;
  }
  const counts: Record<string, number> = {};
  for (const state of recipientStates)
    counts[state] = await RecipientJobModel.countDocuments({
      projectId,
      campaignId: id,
      preparationToken: campaign.preparationToken,
      state,
    });
  res.json({
    projectId,
    items,
    total: await RecipientJobModel.countDocuments(filter),
    counts,
  });
};
export const unsubscribe: RequestHandler = async (req, res) => {
  const { projectId, contactId } = verifyUnsubscribe(
    z.string().parse(req.params.token),
  );
  if (req.method === 'POST') {
    await ContactModel.updateOne(
      { _id: contactId, projectId },
      { $set: { suppressed: true } },
    );
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
