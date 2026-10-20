import { randomUUID } from 'node:crypto';
import type Mail from 'nodemailer/lib/mailer/index.js';
import {
  CampaignModel,
  MessageModel,
  MailAccountModel,
  RecipientJobModel,
} from '../models/EmailModels.js';
import { ContactModel, ProjectModel } from '../models/index.js';
import {
  classifySmtpError,
  createTransport,
  getMailAccount,
} from './emailService.js';
import { inSendingWindow } from './campaignService.js';
export type MailSender = (
  projectId: string,
  message: Mail.Options,
  accountId: string,
) => Promise<void>;
const smtpSend: MailSender = async (projectId, message, accountId) => {
  const transport = createTransport(
    await getMailAccount(projectId, accountId),
  );
  try {
    const info = await transport.sendMail(message);
    if (!info.accepted.length)
      throw Object.assign(new Error('Rejected'), { responseCode: 550 });
  } finally {
    transport.close();
  }
};
export async function workerTick(
  send: MailSender = smtpSend,
  now = new Date(),
) {
  for (const model of [CampaignModel, MessageModel]) await model.updateMany(
    { state: 'preparing', preparationUntil: { $lt: now } },
    {
      $set: {
        state: 'preparation_failed',
        error: 'Preparation interrupted. Explicit retry required.',
      },
    },
  );
  await RecipientJobModel.updateMany(
    { state: 'claimed', leaseUntil: { $lt: now } },
    { $set: { state: 'queued' } },
  );
  await RecipientJobModel.updateMany(
    { state: 'sending', leaseUntil: { $lt: now } },
    {
      $set: {
        state: 'outcome_unknown',
        reason:
          'Worker interrupted during SMTP submission; do not automatically resend.',
      },
      $push: {
        attempts: {
          at: now,
          state: 'outcome_unknown',
          reason: 'SMTP acceptance unknown.',
        },
      },
    },
  );
  await CampaignModel.updateMany(
    { state: 'scheduled', scheduledAt: { $lte: now } },
    { $set: { state: 'active' } },
  );
  const sources = [
    ...(await CampaignModel.find({ state: 'active' })).map(c => ({ c, standalone: false })),
    ...(await MessageModel.find({ state: 'active' })).map(c => ({ c, standalone: true })),
  ];
  const due = await Promise.all(sources.map(async source => {
    const job = await RecipientJobModel.findOne({ projectId: source.c.projectId,
      ...(source.standalone ? { messageId: source.c._id } : { campaignId: source.c._id }),
      preparationToken: source.c.preparationToken, state: 'queued' }).sort({ availableAt: 1, _id: 1 });
    return { ...source, due: job?.availableAt.getTime() ?? Infinity };
  }));
  due.sort((a, b) => a.due - b.due);
  for (const { c, standalone } of due) {
    const model = standalone ? MessageModel : CampaignModel;
    const owner = standalone ? { messageId: c._id } : { campaignId: c._id };
    const claimTime = new Date(Math.max(now.getTime(), Date.now()));
    if (!inSendingWindow(c, claimTime)) continue;
    const projectId = String(c.projectId);
    const token = randomUUID();
    const job = await RecipientJobModel.findOneAndUpdate(
      {
        projectId,
        ...owner,
        preparationToken: c.preparationToken,
        state: 'queued',
        availableAt: { $lte: claimTime },
      },
      {
        $set: {
          state: 'claimed',
          leaseToken: token,
          leaseUntil: new Date(claimTime.getTime() + 90000),
        },
      },
      { returnDocument: 'after', sort: { availableAt: 1, _id: 1 } },
    );
    if (!job) {
      if (
        !(await RecipientJobModel.exists({
          projectId,
          ...owner,
          preparationToken: c.preparationToken,
          state: { $in: ['queued', 'claimed', 'sending'] },
        }))
      )
        await model.updateOne(
          { _id: c._id, projectId, state: 'active' },
          { $set: { state: 'completed' } },
        );
      continue;
    }
    const owned = {
      _id: job._id,
      projectId,
      state: 'claimed',
      leaseToken: token,
    };
    const reply = standalone ? await MessageModel.findOne({ _id: c._id, projectId, kind: 'reply' }) : null;
    const validReply = Boolean(reply?.replyContext && String(reply.replyContext.accountId) === String(c.emailAccountId) &&
      reply.replyContext.recipient === job.email && !job.contactId);
    const contact = job.contactId ? await ContactModel.findOne({
      _id: job.contactId,
      projectId,
      deletedAt: null,
      suppressed: false,
      email: job.email,
    }) : null;
    if ((!contact && !validReply) || !(await ProjectModel.exists({ _id: projectId }))) {
      await RecipientJobModel.updateOne(owned, {
        $set: {
          state: 'skipped',
          reason:
            'Contact deleted, suppressed, moved or destination email changed.',
        },
      });
      continue;
    }
    const account = c.emailAccountId
      ? await MailAccountModel.findOne({
          _id: c.emailAccountId,
          projectId,
          archivedAt: null,
        })
      : null;
    const settings = await ProjectModel.findById(projectId);
    if (!settings || !account || account.sendingError) {
      await model.updateOne(
        { _id: c._id, projectId, state: 'active' },
        {
          $set: {
            state: 'paused',
            error:
              account?.sendingError ||
              'SMTP settings are missing. Configure email settings before resuming.',
          },
        },
      );
      await RecipientJobModel.updateOne(owned, { $set: { state: 'queued' } });
      continue;
    }
    if (
      !inSendingWindow(c, new Date(Math.max(now.getTime(), Date.now()))) ||
      !(await model.exists({ _id: c._id, projectId, state: 'active' }))
    ) {
      await RecipientJobModel.updateOne(owned, { $set: { state: 'queued' } });
      continue;
    }
    const reserved = await ProjectModel.findOneAndUpdate(
      {
        _id: settings._id,
        nextSendAt: { $lte: claimTime },
      },
      {
        $set: {
          nextSendAt: new Date(
            claimTime.getTime() +
              Math.ceil(3600000 / (settings.hourlyLimit ?? 60)),
          ),
        },
      },
    );
    if (!reserved) {
      await RecipientJobModel.updateOne(owned, { $set: { state: 'queued' } });
      continue;
    }
    // This durable transition is the SMTP submission boundary. A crash after it is ambiguous.
    if (
      !inSendingWindow(c, new Date(Math.max(now.getTime(), Date.now()))) ||
      !(await model.exists({
        _id: c._id,
        projectId,
        state: 'active',
      })) ||
      (!validReply && !(await ContactModel.exists({
        _id: job.contactId,
        projectId,
        deletedAt: null,
        suppressed: false,
        email: job.email,
      })))
    ) {
      await RecipientJobModel.updateOne(owned, { $set: { state: 'queued' } });
      continue;
    }
    const begun = await RecipientJobModel.updateOne(owned, {
      $set: { state: 'sending', leaseUntil: new Date(Date.now() + 90000) },
      $push: { attempts: { at: now, state: 'sending', reason: '' } },
    });
    if (!begun.modifiedCount) continue;
    const permitted = await model.updateOne(
      { _id: c._id, projectId, state: 'active' },
      { $set: { startedAt: c.startedAt ?? now } },
      {},
    );
    if (!permitted.matchedCount) {
      const cancelled = await model.exists({
        _id: c._id,
        projectId,
        state: 'cancelled',
      });
      await RecipientJobModel.updateOne(
        { _id: job._id, state: 'sending', leaseToken: token },
        {
          $set: {
            state: cancelled ? 'skipped' : 'queued',
            reason: cancelled ? 'Campaign cancelled.' : '',
          },
          $pop: { attempts: 1 },
        },
      );
      continue;
    }
    const heartbeat = setInterval(() => {
      void RecipientJobModel.updateOne(
        { _id: job._id, state: 'sending', leaseToken: token },
        { $set: { leaseUntil: new Date(Date.now() + 90000) } },
      ).catch(() => {});
    }, 20000);
    let state = 'smtp_accepted';
    let reason = '';
    let pause = false;
    try {
      await send(
        projectId,
        {
          from: { name: c.senderName ?? '', address: c.senderEmail ?? '' },
          to: job.email,
          ...(c.replyTo ? { replyTo: c.replyTo } : {}),
          subject: job.subject ?? '',
          html: job.html ?? '',
          text: job.text ?? '',
          ...(validReply ? { inReplyTo: job.inReplyTo || undefined, references: job.references } : {}),
          headers: validReply ? {} : {
            'List-Unsubscribe': `<${job.unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
          disableFileAccess: true,
          disableUrlAccess: true,
        },
        String(account._id),
      );
    } catch (error) {
      const failure = classifySmtpError(error);
      reason = failure.reason;
      pause = failure.kind === 'configuration';
      state =
        failure.kind === 'unknown'
          ? 'outcome_unknown'
          : (failure.kind === 'temporary' &&
                job.attempts.filter((a) => a.state === 'sending').length < 3) ||
              pause
            ? 'queued'
            : 'failed';
    } finally {
      clearInterval(heartbeat);
    }
    await RecipientJobModel.updateOne(
      { _id: job._id, state: 'sending', leaseToken: token },
      {
        $set: {
          state,
          reason,
          availableAt: new Date(
            now.getTime() +
              60000 *
                2 ** job.attempts.filter((a) => a.state === 'sending').length,
          ),
        },
        $push: { attempts: { at: new Date(), state, reason } },
      },
    );
    if (pause) {
      await MailAccountModel.updateOne(
        { projectId, _id: account._id },
        { $set: { sendingError: reason } },
      );
      for (const affected of [CampaignModel, MessageModel]) await affected.updateMany(
        { projectId, emailAccountId: account._id, state: 'active' },
        { $set: { state: 'paused', error: reason } },
      );
    }
  }
}
export function startSendingWorker() {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void workerTick()
      .catch(() => console.error('Email worker tick failed.'))
      .finally(() => {
        running = false;
      });
  }, 1000);
  timer.unref();
  return () => clearInterval(timer);
}
