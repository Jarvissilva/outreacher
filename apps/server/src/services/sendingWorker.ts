import type Mail from 'nodemailer/lib/mailer/index.js';
import {
  activateScheduledCampaigns,
  campaignExists,
  completeCampaign,
  listActiveCampaigns,
  markCampaignStarted,
  pauseCampaign,
  pauseCampaignsForAccount,
  recoverInterruptedCampaigns,
} from '../db/repositories/campaigns.js';
import type { Campaign } from '../db/repositories/campaigns.js';
import {
  completeMessage,
  listActiveMessages,
  markMessageStarted,
  messageExists,
  pauseMessage,
  pauseMessagesForAccount,
  recoverInterruptedMessages,
  findMessage,
} from '../db/repositories/messages.js';
import type { Message } from '../db/repositories/messages.js';
import { findAccount, setAccountSendingError } from '../db/repositories/mailAccounts.js';
import { findProject, reserveSendSlot } from '../db/repositories/projects.js';
import { findActiveContactByDestination } from '../db/repositories/contacts.js';
import {
  beginJobSend,
  claimNextJob,
  finishJobSend,
  hasLiveJobs,
  heartbeatJob,
  nextQueuedJob,
  requeueClaimedJob,
  skipClaimedJob,
  sweepStaleClaimedJobs,
  sweepStaleSendingJobs,
  cancelSendingJob,
} from '../db/repositories/jobs.js';
import type { JobSource, RecipientState } from '../db/repositories/jobs.js';
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
  const transport = createTransport(await getMailAccount(projectId, accountId));
  try {
    const info = await transport.sendMail(message);
    if (!info.accepted.length)
      throw Object.assign(new Error('Rejected'), { responseCode: 550 });
  } finally {
    transport.close();
  }
};

type Source =
  | { source: Campaign; standalone: false }
  | { source: Message; standalone: true };

function jobSource(entry: Source): JobSource {
  const { source } = entry;
  return {
    projectId: source.projectId,
    ...(entry.standalone
      ? { messageId: source.id }
      : { campaignId: source.id }),
    preparationToken: source.preparationToken ?? '',
  };
}

function sourceIsActive(entry: Source, projectId: string): boolean {
  return entry.standalone
    ? messageExists(projectId, entry.source.id, 'active')
    : campaignExists(projectId, entry.source.id, 'active');
}

function sourceIsCancelled(entry: Source, projectId: string): boolean {
  return entry.standalone
    ? messageExists(projectId, entry.source.id, 'cancelled')
    : campaignExists(projectId, entry.source.id, 'cancelled');
}

function markStarted(entry: Source, now: Date): boolean {
  return entry.standalone
    ? markMessageStarted(entry.source.projectId, entry.source.id, now)
    : markCampaignStarted(entry.source.projectId, entry.source.id, now);
}

function completeSource(entry: Source): void {
  if (entry.standalone) completeMessage(entry.source.projectId, entry.source.id);
  else completeCampaign(entry.source.projectId, entry.source.id);
}

function pauseSource(entry: Source, error: string): void {
  if (entry.standalone)
    pauseMessage(entry.source.projectId, entry.source.id, error);
  else pauseCampaign(entry.source.projectId, entry.source.id, error);
}

export async function workerTick(
  send: MailSender = smtpSend,
  now = new Date(),
) {
  recoverInterruptedCampaigns(now);
  recoverInterruptedMessages(now);
  sweepStaleClaimedJobs(now);
  sweepStaleSendingJobs(
    now,
    'Worker interrupted during SMTP submission; do not automatically resend.',
  );
  activateScheduledCampaigns(now);
  const sources: Source[] = [
    ...listActiveCampaigns().map(
      (source): Source => ({ source, standalone: false }),
    ),
    ...listActiveMessages().map(
      (source): Source => ({ source, standalone: true }),
    ),
  ];
  const due = sources
    .map((entry) => {
      const job = nextQueuedJob(
        jobSource(entry),
        new Date('9999-12-31T23:59:59.999Z'),
      );
      return {
        entry,
        due: job?.availableAt.getTime() ?? Infinity,
        createdAt: job?.createdAt.getTime() ?? Infinity,
      };
    })
    .sort((a, b) => a.due - b.due || a.createdAt - b.createdAt);
  for (const { entry } of due) {
    const { source } = entry;
    const projectId = source.projectId;
    const claimTime = new Date(Math.max(now.getTime(), Date.now()));
    if (!inSendingWindow(source, claimTime)) continue;
    const target = jobSource(entry);
    const job = claimNextJob(
      target,
      claimTime,
      new Date(claimTime.getTime() + 90000),
    );
    if (!job) {
      if (!hasLiveJobs(target)) completeSource(entry);
      continue;
    }
    const token = job.leaseToken;
    if (!token) continue;
    const reply = entry.standalone
      ? findMessage(projectId, source.id)
      : undefined;
    const validReply = Boolean(
      reply?.replyContext &&
        reply.replyContext.accountId === source.emailAccountId &&
        reply.replyContext.recipient === job.email &&
        !job.contactId,
    );
    const contact = job.contactId
      ? findActiveContactByDestination(projectId, job.contactId, job.email)
      : null;
    if ((!contact && !validReply) || !findProject(projectId)) {
      skipClaimedJob(
        job.id,
        token,
        'Contact deleted, suppressed, moved or destination email changed.',
      );
      continue;
    }
    const account = source.emailAccountId
      ? findAccount(projectId, source.emailAccountId)
      : null;
    const settings = findProject(projectId);
    if (!settings || !account || account.sendingError) {
      pauseSource(
        entry,
        account?.sendingError ||
          'SMTP settings are missing. Configure email settings before resuming.',
      );
      requeueClaimedJob(job.id, token);
      continue;
    }
    if (
      !inSendingWindow(source, new Date(Math.max(now.getTime(), Date.now()))) ||
      !sourceIsActive(entry, projectId)
    ) {
      requeueClaimedJob(job.id, token);
      continue;
    }
    const reserved = reserveSendSlot(
      projectId,
      claimTime,
      new Date(
        claimTime.getTime() + Math.ceil(3600000 / (settings.hourlyLimit ?? 60)),
      ),
    );
    if (!reserved) {
      requeueClaimedJob(job.id, token);
      continue;
    }
    // This durable transition is the SMTP submission boundary. A crash after it is ambiguous.
    if (
      !inSendingWindow(source, new Date(Math.max(now.getTime(), Date.now()))) ||
      !sourceIsActive(entry, projectId) ||
      (!validReply &&
        !(job.contactId
          ? findActiveContactByDestination(projectId, job.contactId, job.email)
          : undefined))
    ) {
      requeueClaimedJob(job.id, token);
      continue;
    }
    if (
      !beginJobSend(
        job.id,
        token,
        now,
        new Date(Date.now() + 90000),
      )
    )
      continue;
    if (!markStarted(entry, now)) {
      cancelSendingJob(job.id, token, sourceIsCancelled(entry, projectId));
      continue;
    }
    const heartbeat = setInterval(() => {
      heartbeatJob(job.id, token, new Date(Date.now() + 90000));
    }, 20000);
    let state: RecipientState = 'smtp_accepted';
    let reason = '';
    let pause = false;
    try {
      await send(
        projectId,
        {
          from: {
            name: source.senderName ?? '',
            address: source.senderEmail ?? '',
          },
          to: job.email,
          ...(source.replyTo ? { replyTo: source.replyTo } : {}),
          subject: job.subject ?? '',
          html: job.html ?? '',
          text: job.text ?? '',
          ...(validReply
            ? { inReplyTo: job.inReplyTo || undefined, references: job.references }
            : {}),
          headers: validReply || !job.unsubscribeUrl
            ? {}
            : {
                'List-Unsubscribe': `<${job.unsubscribeUrl}>`,
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              },
          disableFileAccess: true,
          disableUrlAccess: true,
        },
        account.id,
      );
    } catch (error) {
      const failure = classifySmtpError(error);
      reason = failure.reason;
      pause = failure.kind === 'configuration';
      state =
        failure.kind === 'unknown'
          ? 'outcome_unknown'
          : (failure.kind === 'temporary' &&
                job.attempts.filter((attempt) => attempt.state === 'sending')
                  .length < 3) ||
              pause
            ? 'queued'
            : 'failed';
    } finally {
      clearInterval(heartbeat);
    }
    finishJobSend(job.id, token, {
      state,
      reason,
      availableAt: new Date(
        now.getTime() +
          60000 *
            2 **
              job.attempts.filter((attempt) => attempt.state === 'sending')
                .length,
      ),
      attempt: { at: new Date(), state, reason },
    });
    if (pause) {
      setAccountSendingError(projectId, account.id, reason);
      pauseCampaignsForAccount(projectId, account.id, reason);
      pauseMessagesForAccount(projectId, account.id, reason);
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
