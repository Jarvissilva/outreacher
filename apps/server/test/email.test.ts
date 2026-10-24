import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { OutreachApi } from '../src/mcp/api.js';
import { createMcpServer } from '../src/mcp/server.js';
import { z } from 'zod';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, beforeEach, after, it, mock } from 'node:test';
import { ImapFlow } from 'imapflow';
import request from 'supertest';
import { SMTPServer } from 'smtp-server';
import { app } from '../src/app.js';
import {
  contactInputSchema,
  replyContextSchema,
  campaignSchema,
  emailAccountSchema,
  templateSchema,
  reportSchema,
} from '@outreacher/shared';
import {
  findContactById,
  findContactByEmail,
  createContact,
  softDeleteContact,
} from '../src/db/repositories/contacts.js';
import { createField } from '../src/db/repositories/customFields.js';
import { createProject, findDefaultProject, findProject } from '../src/db/repositories/projects.js';
import { findAccount, listAccounts } from '../src/db/repositories/mailAccounts.js';
import { findCampaign } from '../src/db/repositories/campaigns.js';
import {
  createMessage,
  findMessage,
} from '../src/db/repositories/messages.js';
import {
  countJobs,
  createJob,
  findFirstJob,
} from '../src/db/repositories/jobs.js';
import type { JobFilter } from '../src/db/repositories/jobs.js';
import { newId } from '../src/db/values.js';
import {
  encryptPassword,
  decryptPassword,
  unsubscribeUrl,
  renderMessage,
  classifySmtpError,
} from '../src/services/emailService.js';
import { workerTick } from '../src/services/sendingWorker.js';
import { inSendingWindow } from '../src/services/campaignService.js';
import {
  countRows,
  deleteRows,
  resetTestDatabase,
  setRow,
  updateRows,
  setupTestDatabase,
  teardownTestDatabase,
  testDatabase,
} from './support/database.js';
let projectId = '';
let otherId = '';
let accountId = '';
const path = (suffix: string, project = projectId) =>
  `/api/projects/${project}${suffix}`;
const settings = {
  host: '127.0.0.1',
  port: 2525,
  tlsMode: 'none',
  username: '',
  password: 'test-password',
  senderName: 'Test',
  senderEmail: 'sender@example.com',
  replyTo: '',
  name: 'Primary account',
};
before(() => {
  process.env.EMAIL_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.PUBLIC_UNSUBSCRIBE_BASE_URL = 'https://unsubscribe.example.com';
  setupTestDatabase();
});
beforeEach(async () => {
  resetTestDatabase();
  projectId = findDefaultProject()?.id ?? '';
  otherId = createProject({ name: 'Other' }).id;
  accountId = emailAccountSchema.parse((await request(app).post(path('/email-accounts')).send(settings).expect(201)).body).id;
});
after(() => {
  teardownTestDatabase();
});
async function template(html = '<p>Hello {{firstName}}</p>') {
  return templateSchema.parse(
    (
      await request(app)
        .post(path('/templates'))
        .send({ name: 'Welcome', subject: 'Hi {{firstName}}', html })
        .expect(201)
    ).body,
  );
}
async function contact(
  project = projectId,
  overrides: Record<string, unknown> & { deletedAt?: Date } = {},
) {
  const { deletedAt, ...input } = overrides;
  const created = createContact(
    project,
    contactInputSchema.parse({
      email: `${randomUUID()}@example.com`,
      firstName: '<Alex>',
      ...input,
    }),
  );
  if (deletedAt) {
    softDeleteContact(project, created.id);
    setRow('contacts', created.id, { deletedAt });
  }
  const saved = findContactById(project, created.id, true);
  if (!saved) throw new Error('Contact creation failed.');
  return saved;
}
async function draft(extra = {}) {
  const t = await template();
  return campaignSchema.parse(
    (
      await request(app)
        .post(path('/campaigns'))
        .send({
          name: 'Launch',
          templateId: t.id,
          emailAccountId: accountId,
          audience: { mode: 'all' },
          ...extra,
        })
        .expect(201)
    ).body,
  );
}
async function launch(id: string) {
  return campaignSchema.parse(
    (
      await request(app)
        .post(path(`/campaigns/${id}/launch`))
        .send({ confirmed: true })
        .expect(200)
    ).body,
  );
}
async function resetRate() {
  setRow('projects', projectId, { nextSendAt: new Date(0) });
}

const accountById = (id: string) => findAccount(projectId, id, true);
const primaryAccount = () => listAccounts(projectId)[0];
const campaignById = (id: string) => findCampaign(projectId, id);
const messageById = (id: string) => findMessage(projectId, id);
const contactById = (id: string) => findContactById(projectId, id, true);
const firstJob = (filter: JobFilter) => findFirstJob(filter);
const jobCount = (filter: JobFilter) => countJobs(filter);
it('encrypts and redacts credentials, preserves blank replacement and requires explicit test recipient', async () => {
  const encoded = encryptPassword('secret');
  assert.notEqual(encoded, encryptPassword('secret'));
  assert.equal(decryptPassword(encoded), 'secret');
  const saved = primaryAccount();
  assert.ok(saved);
  assert.equal(decryptPassword(saved.passwordEncrypted), 'test-password');
  const response = await request(app)
    .put(path(`/email-accounts/${accountId}`))
    .send({ ...settings, password: '' })
    .expect(200);
  assert.equal(
    emailAccountSchema.parse(response.body).passwordConfigured,
    true,
  );
  assert.ok(!JSON.stringify(response.body).includes('test-password'));
  assert.equal(
    primaryAccount()?.passwordEncrypted,
    saved.passwordEncrypted,
  );
  await request(app).post(path(`/email-accounts/${accountId}/test`)).send({}).expect(400);
  await request(app).get(path('/email-accounts', otherId)).expect(200, []);
});
it('verifies and tests against a local SMTP capture without sending during verification', async () => {
  let messages = 0;
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onData(stream, _session, callback) {
      stream.on('data', () => {});
      stream.on('end', () => {
        messages++;
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.server.address();
    assert.ok(address && typeof address !== 'string');
    await request(app)
      .put(path(`/email-accounts/${accountId}`))
      .send({ ...settings, port: address.port })
      .expect(200);
    await request(app)
      .post(path(`/email-accounts/${accountId}/verify`))
      .send({})
      .expect(200);
    assert.equal(messages, 0);
    await request(app)
      .post(path(`/email-accounts/${accountId}/test`))
      .send({ recipient: 'capture@example.com' })
      .expect(200);
    assert.equal(messages, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it('sanitizes rich text, rejects unknown placeholders and renders escaped values consistently', async () => {
  const c = await contact();
  const t = await template(
    '<p onclick="bad()">{{firstName}} {{company}}</p><script>alert(1)</script><img src="x"><a href="javascript:alert(1)">bad</a>',
  );
  assert.ok(!/script|onclick|<img|javascript:/.test(t.html));
  const preview = await request(app)
    .post(path('/templates/preview'))
    .send({
      name: t.name,
      subject: t.subject,
      html: t.html,
      contactId: c.id,
    })
    .expect(200);
  const rendered = renderMessage(
    t,
    c,
    unsubscribeUrl(projectId, c.id),
  );
  assert.equal(preview.body.html, rendered.html);
  assert.ok(rendered.html.includes('&lt;Alex&gt;'));
  assert.ok(rendered.text.includes('<Alex>'));
  assert.ok(rendered.warnings.includes('Missing value: company'));
  await request(app)
    .post(path('/templates'))
    .send({ name: 'bad', subject: '{{unknown}}', html: '<p>hello</p>' })
    .expect(400);
  await request(app)
    .post(path('/templates/preview', otherId))
    .send({
      name: t.name,
      subject: t.subject,
      html: t.html,
      contactId: c.id,
    })
    .expect(404);
});
it('isolates every resource lookup and campaign action across projects', async () => {
  const t = await template();
  const c = await draft();
  for (const method of ['get', 'put', 'delete'] as const) {
    const body =
      method === 'put' ? { name: 'X', subject: 'Hi', html: '<p>Hi</p>' } : {};
    const agent = request(app);
    await agent[method](path(`/templates/${t.id}`, otherId))
      .send(body)
      .expect(404);
  }
  for (const suffix of ['', '/report', '/report?format=csv'])
    await request(app)
      .get(path(`/campaigns/${c.id}${suffix}`, otherId))
      .expect(404);
  for (const action of ['launch', 'pause', 'resume', 'cancel', 'draft'])
    await request(app)
      .post(path(`/campaigns/${c.id}/${action}`, otherId))
      .send({ confirmed: true })
      .expect(404);
  await request(app)
    .delete(path(`/campaigns/${c.id}`, otherId))
    .expect(404);
  await request(app)
    .post(path('/campaigns', otherId))
    .send({ name: 'X', templateId: t.id, emailAccountId: accountId, audience: { mode: 'all' } })
    .expect(404);
  await request(app)
    .post(path('/campaigns/audience-preview', otherId))
    .send({ templateId: t.id, audience: { mode: 'all' } })
    .expect(404);
  await request(app)
    .post(path(`/email-accounts/${accountId}/test`, otherId))
    .send({ recipient: 'x@example.com', templateId: t.id })
    .expect(404);
});
it('snapshots recipients and messages, makes launch idempotent and shares project rate limits', async () => {
  const person = await contact();
  await contact(projectId, { suppressed: true });
  await contact(otherId);
  const c = await draft();
  await request(app)
    .post(path(`/campaigns/${c.id}/launch`))
    .send({})
    .expect(400);
  const launches = await Promise.all([launch(c.id), launch(c.id)]);
  assert.ok(launches.some((c) => c.state === 'active'));
  assert.equal(jobCount({ projectId, campaignId: c.id }), 1);
  setRow('contacts', person.id, { firstName: 'Changed' });
  updateRows('templates', { projectId }, { html: '<p>Changed template</p>' });
  const second = await draft();
  await launch(second.id);
  let sends = 0;
  await workerTick(async (_id, message) => {
    sends++;
    assert.ok(String(message.html).includes('&lt;Alex&gt;'));
  });
  assert.equal(sends, 1);
  assert.equal(jobCount({ projectId, state: 'smtp_accepted' }), 1);
  const report = reportSchema.parse(
    (
      await request(app)
        .get(path(`/campaigns/${c.id}/report`))
        .expect(200)
    ).body,
  );
  assert.equal(report.counts.smtp_accepted, 1);
  assert.ok(
    (
      await request(app)
        .get(path(`/campaigns/${c.id}/report?format=csv`))
        .expect(200)
    ).text.includes('smtp_accepted'),
  );
});
it('suppression, deletion and changed addresses block subsequent queued submissions', async () => {
  const suppressed = await contact();
  const deleted = await contact();
  const changed = await contact();
  const c = await draft();
  await launch(c.id);
  setRow('contacts', suppressed.id, { suppressed: 1 });
  setRow('contacts', deleted.id, { deletedAt: new Date() });
  setRow('contacts', changed.id, { email: 'changed@example.com' });
  let sent = 0;
  for (let i = 0; i < 4; i++)
    await workerTick(async () => {
      sent++;
    });
  assert.equal(sent, 0);
  assert.equal(jobCount({ projectId, state: 'skipped' }), 3);
});
it('GET unsubscribe only confirms; POST and one-click suppress idempotently in one project', async () => {
  const c = await contact();
  const other = await contact(otherId, { email: c.email });
  const url = new URL(unsubscribeUrl(projectId, c.id));
  await request(app).get(url.pathname).expect(200);
  assert.equal(contactById(c.id)?.suppressed, false);
  for (let i = 0; i < 2; i++)
    await request(app)
      .post(url.pathname)
      .type('form')
      .send('List-Unsubscribe=One-Click')
      .expect(200);
  assert.equal(contactById(c.id)?.suppressed, true);
  assert.equal(
    findContactById(otherId, other.id, true)?.suppressed,
    false,
  );
  await request(app)
    .post(`${url.pathname.slice(0, -1)}z`)
    .expect(400);
});
it('pauses, resumes, cancels and returns scheduled campaigns to drafts', async () => {
  await contact();
  const c = await draft();
  await launch(c.id);
  await request(app)
    .post(path(`/campaigns/${c.id}/pause`))
    .expect(200);
  let sent = 0;
  await workerTick(async () => {
    sent++;
  });
  assert.equal(sent, 0);
  await request(app)
    .post(path(`/campaigns/${c.id}/resume`))
    .expect(200);
  await request(app)
    .post(path(`/campaigns/${c.id}/cancel`))
    .expect(200);
  await workerTick(async () => {
    sent++;
  });
  assert.equal(sent, 0);
  assert.equal(
    jobCount({ projectId, campaignId: c.id, state: 'skipped' }),
    1,
  );
  const scheduled = await draft({
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
  });
  assert.equal((await launch(scheduled.id)).state, 'scheduled');
  await workerTick(async () => {
    sent++;
  });
  assert.equal(sent, 0);
  await request(app)
    .post(path(`/campaigns/${scheduled.id}/draft`))
    .expect(200);
  await workerTick(async () => {
    sent++;
  });
  assert.equal(sent, 0);
  assert.equal(campaignById(scheduled.id)?.state, 'draft');
});
it('honors IANA weekday/hour boundaries including DST', () => {
  const c = {
    timeZone: 'America/New_York',
    weekdays: [1],
    startHour: 9,
    endHour: 17,
  };
  assert.equal(inSendingWindow(c, new Date('2026-03-09T12:59:00Z')), false);
  assert.equal(inSendingWindow(c, new Date('2026-03-09T13:00:00Z')), true);
  assert.equal(inSendingWindow(c, new Date('2026-03-09T21:00:00Z')), false);
  assert.equal(inSendingWindow(c, new Date('2026-03-08T13:00:00Z')), false);
  assert.equal(inSendingWindow(c, new Date('2026-11-02T14:00:00Z')), true);
});
it('retries definite temporary failures with backoff and stops after three retries', async () => {
  await contact();
  const c = await draft();
  await launch(c.id);
  let count = 0;
  const reject = async () => {
    count++;
    throw Object.assign(new Error('secret server details'), {
      responseCode: 451,
    });
  };
  await workerTick(reject);
  const first = firstJob({ projectId, campaignId: c.id });
  assert.equal(first?.state, 'queued');
  await resetRate();
  await workerTick(reject);
  assert.equal(count, 1);
  for (let i = 0; i < 3; i++) {
    await resetRate();
    updateRows(
      'recipient_jobs',
      { campaignId: c.id },
      { availableAt: new Date(0) },
    );
    await workerTick(reject);
  }
  assert.equal(count, 4);
  const failed = firstJob({ projectId, campaignId: c.id });
  assert.equal(failed?.state, 'failed');
  assert.ok(!failed?.reason.includes('secret'));
});
it('recovers claimed work, never resends abandoned submissions, and pauses on authentication failures', async () => {
  await contact();
  const c = await draft();
  await launch(c.id);
  updateRows(
    'recipient_jobs',
    { campaignId: c.id },
    { state: 'claimed', leaseUntil: new Date(0) },
  );
  let sends = 0;
  await workerTick(async () => {
    sends++;
    throw new Error('socket lost');
  });
  assert.equal(sends, 1);
  assert.equal(
    firstJob({ projectId, campaignId: c.id })?.state,
    'outcome_unknown',
  );
  await resetRate();
  await workerTick(async () => {
    sends++;
  });
  assert.equal(sends, 1);
  const second = await draft();
  await launch(second.id);
  updateRows(
    'recipient_jobs',
    { campaignId: second.id },
    { state: 'sending', leaseUntil: new Date(0) },
  );
  await workerTick(async () => {
    sends++;
  });
  assert.equal(sends, 1);
  assert.equal(
    firstJob({ projectId, campaignId: second.id })?.state,
    'outcome_unknown',
  );
  const third = await draft();
  await launch(third.id);
  await workerTick(async () => {
    throw Object.assign(new Error('password leaked'), { code: 'EAUTH' });
  });
  assert.equal(campaignById(third.id)?.state, 'paused');
  assert.ok(
    !primaryAccount()?.sendingError.includes('password leaked'),
  );
  assert.equal(
    classifySmtpError(Object.assign(new Error('bad'), { responseCode: 550 }))
      .kind,
    'permanent',
  );
});
it('keeps partial preparations unsendable until an explicit retry', async () => {
  await contact();
  const c = await draft();
  setRow('campaigns', c.id, {
    state: 'preparing',
    preparationUntil: new Date(0),
  });
  let sends = 0;
  await workerTick(async () => {
    sends++;
  });
  assert.equal(sends, 0);
  assert.equal(campaignById(c.id)?.state, 'preparation_failed');
  await request(app)
    .post(path(`/campaigns/${c.id}/launch`))
    .send({ confirmed: true, retry: true })
    .expect(200);
  assert.equal(jobCount({ projectId, campaignId: c.id }), 1);
});
it('claims each job only once across competing workers and preserves in-flight outcomes on cancellation', async () => {
  await contact();
  const c = await draft();
  await launch(c.id);
  let sends = 0;
  const send = async () => {
    sends++;
    await request(app)
      .post(path(`/campaigns/${c.id}/cancel`))
      .expect(200);
  };
  await Promise.all([workerTick(send), workerTick(send)]);
  assert.equal(sends, 1);
  assert.equal(
    firstJob({ projectId, campaignId: c.id })?.state,
    'smtp_accepted',
  );
  assert.equal(campaignById(c.id)?.state, 'cancelled');
});
it('does not submit work from a superseded preparation generation', async () => {
  const person = await contact();
  const c = await draft();
  await launch(c.id);
  updateRows(
    'recipient_jobs',
    { campaignId: c.id },
    { preparationToken: 'stale-generation' },
  );
  let sends = 0;
  await workerTick(async () => {
    sends++;
  });
  assert.equal(sends, 0);
  assert.equal(
    firstJob({ projectId, contactId: person.id })?.state,
    'queued',
  );
});
it('treats socket failures without a definite pre-submission signal as outcome unknown', () => {
  assert.equal(
    classifySmtpError(
      Object.assign(new Error('Disconnected after DATA'), { code: 'ESOCKET' }),
    ).kind,
    'unknown',
  );
  assert.equal(
    classifySmtpError(
      Object.assign(new Error('Connection refused'), {
        originalCode: 'ECONNREFUSED',
        code: 'ESOCKET',
        command: 'CONN',
      }),
    ).kind,
    'configuration',
  );
  assert.equal(
    classifySmtpError(
      Object.assign(new Error('Timeout after DATA'), {
        code: 'ETIMEDOUT',
        command: 'DATA',
      }),
    ).kind,
    'unknown',
  );
});
it('does not requeue post-DATA connection errors reported under CONN', () => {
  for (const code of ['ECONNECTION', 'ESOCKET', 'ETIMEDOUT'])
    assert.equal(
      classifySmtpError(
        Object.assign(new Error('Disconnected after submission'), {
          code,
          command: 'CONN',
          timeoutType: 'SOCKET_TIMEOUT',
        }),
      ).kind,
      'unknown',
    );
});
it('filters selected audiences by project and supports existing contact filters', async () => {
  createField(projectId, { key: 'interest', label: 'Interest' });
  const chosen = await contact(projectId, {
    company: 'A+B',
    customFields: { interest: 'Design' },
  });
  const foreign = await contact(otherId);
  await contact(projectId, { suppressed: true });
  const t = await template();
  const selected = await request(app)
    .post(path('/campaigns/audience-preview'))
    .send({
      templateId: t.id,
      audience: {
        mode: 'selected',
        contactIds: [chosen.id, foreign.id],
      },
    })
    .expect(200);
  assert.equal(selected.body.eligible, 1);
  assert.equal(selected.body.recipients[0].email, chosen.email);
  const filtered = await request(app)
    .post(path('/campaigns/audience-preview'))
    .send({
      templateId: t.id,
      audience: {
        mode: 'filters',
        filters: { search: 'A+B', fieldKey: 'interest', fieldValue: 'design' },
      },
    })
    .expect(200);
  assert.equal(filtered.body.eligible, 1);
  await request(app)
    .post(path('/campaigns/audience-preview'))
    .send({
      templateId: t.id,
      audience: { mode: 'filters', filters: { fieldKey: 'unknown' } },
    })
    .expect(404);
});
it('does not start campaigns before their scheduled UTC instant and uses frozen sender and message headers', async () => {
  await contact();
  const c = await draft({
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
  });
  await launch(c.id);
  updateRows(
    'mail_accounts',
    { projectId },
    { senderEmail: 'changed@example.com', senderName: 'Changed' },
  );
  let sent = 0;
  const send = async (
    _project: string,
    message: import('nodemailer/lib/mailer/index.js').default.Options,
  ) => {
    sent++;
    assert.deepEqual(message.from, {
      name: 'Test',
      address: 'sender@example.com',
    });
    assert.ok(
      JSON.stringify(message.headers).includes('List-Unsubscribe=One-Click'),
    );
  };
  await workerTick(send);
  assert.equal(sent, 0);
  setRow('campaigns', c.id, { scheduledAt: new Date(0) });
  await workerTick(send);
  assert.equal(sent, 1);
});

it('records an actual SMTP disconnect after DATA as outcome unknown without resending', async () => {
  let submissions = 0;
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    let buffer = '';
    let data = false;
    socket.write('220 localhost capture\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let boundary: number;
      while ((boundary = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (data) {
          if (line === '.') {
            submissions++;
            socket.destroy();
            return;
          }
          continue;
        }
        if (/^EHLO/.test(line)) socket.write('250 localhost\r\n');
        else if (/^(MAIL FROM|RCPT TO)/.test(line)) socket.write('250 OK\r\n');
        else if (line === 'DATA') {
          data = true;
          socket.write('354 Send message\r\n');
        } else if (line === 'QUIT') socket.end('221 Bye\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await request(app)
      .put(path(`/email-accounts/${accountId}`))
      .send({ ...settings, port: address.port })
      .expect(200);
    await contact();
    const c = await draft();
    await launch(c.id);
    await workerTick();
    assert.equal(submissions, 1);
    assert.equal(
      firstJob({ projectId, campaignId: c.id })?.state,
      'outcome_unknown',
    );
    await resetRate();
    await workerTick();
    assert.equal(submissions, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

const extraAccountInput = {
  name: 'Second account',
  host: '127.0.0.1',
  port: 2526,
  tlsMode: 'none',
  username: '',
  password: 'second-secret',
  senderName: 'Second sender',
  senderEmail: 'second@example.org',
  replyTo: '',
};
async function addAccount(project = projectId) {
  return emailAccountSchema.parse(
    (
      await request(app)
        .post(path('/email-accounts', project))
        .send(extraAccountInput)
        .expect(201)
    ).body,
  );
}
it('adds, edits and removes independent project mail accounts without exposing passwords', async () => {
  const second = await addAccount();
  const list = z
    .array(emailAccountSchema)
    .parse((await request(app).get(path('/email-accounts')).expect(200)).body);
  assert.equal(list.length, 2);
  assert.equal(list[1]?.id, second.id);
  assert.ok(!JSON.stringify(list).includes('second-secret'));
  const encrypted = accountById(second.id)?.passwordEncrypted;
  await request(app)
    .put(path(`/email-accounts/${second.id}`))
    .send({ ...extraAccountInput, name: 'Renamed account', password: '' })
    .expect(200);
  assert.equal(
    accountById(second.id)?.passwordEncrypted,
    encrypted,
  );
  assert.equal(
    primaryAccount()?.senderEmail,
    settings.senderEmail,
  );
  await request(app)
    .delete(path(`/email-accounts/${second.id}`))
    .expect(204);
  assert.equal(accountById(second.id)?.passwordEncrypted, '');
  assert.equal(
    (await request(app).get(path('/email-accounts')).expect(200)).body.length,
    1,
  );
});
it('enforces account project ownership for editing, removal, verification, tests and campaign selection', async () => {
  const foreign = await addAccount(otherId);
  const t = await template();
  await request(app)
    .put(path(`/email-accounts/${foreign.id}`))
    .send(extraAccountInput)
    .expect(404);
  await request(app)
    .delete(path(`/email-accounts/${foreign.id}`))
    .expect(404);
  await request(app)
    .post(path(`/email-accounts/${foreign.id}/verify`))
    .send({})
    .expect(404);
  await request(app)
    .post(path(`/email-accounts/${foreign.id}/test`))
    .send({ recipient: 'capture@example.com' })
    .expect(404);
  await request(app)
    .post(path('/campaigns'))
    .send({
      name: 'Wrong account',
      templateId: t.id,
      emailAccountId: foreign.id,
      audience: { mode: 'all' },
    })
    .expect(404);
  const c = await draft();
  setRow('campaigns', c.id, { emailAccountId: foreign.id });
  await request(app)
    .post(path(`/campaigns/${c.id}/launch`))
    .send({ confirmed: true })
    .expect(404);
});
it('requires an account choice with multiple accounts and freezes that choice for sending', async () => {
  const second = await addAccount();
  const first = listAccounts(projectId).find(
    (account) => account.id !== second.id,
  );
  assert.ok(first);
  const t = await template();
  await request(app)
    .post(path('/campaigns'))
    .send({
      name: 'Missing account',
      templateId: t.id,
      audience: { mode: 'all' },
    })
    .expect(400);
  await contact();
  const c = await draft({ emailAccountId: second.id });
  await launch(c.id);
  await request(app)
    .put(path(`/email-accounts/${second.id}`))
    .send({
      ...extraAccountInput,
      password: '',
      senderEmail: 'changed@example.org',
    })
    .expect(200);
  let usedAccount = '';
  await workerTick(async (_project, message, accountId) => {
    usedAccount = accountId ?? '';
    assert.deepEqual(message.from, {
      name: 'Second sender',
      address: 'second@example.org',
    });
  });
  assert.equal(usedAccount, second.id);
  await request(app)
    .put(path(`/campaigns/${c.id}`))
    .send({
      name: 'Changed',
      templateId: t.id,
      emailAccountId: first.id,
      audience: { mode: 'all' },
    })
    .expect(409);
});
it('shares the project rate budget between accounts and pauses only the failing account campaigns', async () => {
  const second = await addAccount();
  const first = listAccounts(projectId).find(
    (account) => account.id !== second.id,
  );
  assert.ok(first);
  await contact();
  const a = await draft({ emailAccountId: first.id });
  const b = await draft({ emailAccountId: second.id });
  await launch(a.id);
  await launch(b.id);
  let count = 0;
  await workerTick(async () => {
    count++;
  });
  assert.equal(count, 1);
  assert.equal(jobCount({ projectId, state: 'smtp_accepted' }), 1);
  await resetRate();
  await workerTick(async () => {
    count++;
    throw Object.assign(new Error('auth failed'), { code: 'EAUTH' });
  });
  assert.equal(count, 2);
  assert.equal(campaignById(b.id)?.state, 'paused');
  assert.equal(accountById(first.id)?.sendingError, '');
  assert.notEqual(accountById(second.id)?.sendingError, '');
  const healthy = await draft({ emailAccountId: first.id });
  await launch(healthy.id);
  await resetRate();
  await workerTick(async (_project, _message, accountId) => {
    assert.equal(accountId, first.id);
  });
  assert.equal(
    firstJob({ projectId, campaignId: healthy.id })?.state,
    'smtp_accepted',
  );
});
it('prevents removing an account used by queued campaigns and never falls back to another account', async () => {
  const second = await addAccount();
  await contact();
  const c = await draft({ emailAccountId: second.id });
  await launch(c.id);
  await request(app)
    .delete(path(`/email-accounts/${second.id}`))
    .expect(409);
  // Simulate an account removed outside the application: the worker must stop, not pick another.
  setRow('mail_accounts', second.id, { archivedAt: new Date() });
  let sends = 0;
  await workerTick(async () => {
    sends++;
  });
  assert.equal(sends, 0);
  assert.equal(campaignById(c.id)?.state, 'paused');
});
it('uses the selected SMTP server for account tests and campaign submissions', async () => {
  const counts = [0, 0];
  const servers = counts.map(
    (_count, index) =>
      new SMTPServer({
        authOptional: true,
        disabledCommands: ['STARTTLS'],
        onData(stream, _session, callback) {
          stream.on('data', () => {});
          stream.on('end', () => {
            counts[index] = (counts[index] ?? 0) + 1;
            callback();
          });
        },
      }),
  );
  try {
    for (const server of servers)
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
    const first = servers[0]?.server.address();
    const second = servers[1]?.server.address();
    assert.ok(first && typeof first !== 'string');
    assert.ok(second && typeof second !== 'string');
    await request(app)
      .put(path(`/email-accounts/${accountId}`))
      .send({ ...settings, port: first.port })
      .expect(200);
    const account = emailAccountSchema.parse(
      (
        await request(app)
          .post(path('/email-accounts'))
          .send({ ...extraAccountInput, port: second.port })
          .expect(201)
      ).body,
    );
    await request(app)
      .post(path(`/email-accounts/${account.id}/verify`))
      .send({})
      .expect(200);
    assert.deepEqual(counts, [0, 0]);
    await request(app)
      .post(path(`/email-accounts/${account.id}/test`))
      .send({ recipient: 'capture@example.com' })
      .expect(200);
    assert.deepEqual(counts, [0, 1]);
    await contact();
    const c = await draft({ emailAccountId: account.id });
    await launch(c.id);
    await workerTick();
    assert.deepEqual(counts, [0, 2]);
    assert.equal(
      firstJob({ projectId, campaignId: c.id })?.state,
      'smtp_accepted',
    );
  } finally {
    for (const server of servers)
      await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('requires an account even with one configured and removes every legacy settings endpoint', async () => {
  const t = await template();
  await request(app).post(path('/campaigns')).send({ name: 'Missing', templateId: t.id, audience: { mode: 'all' } }).expect(400);
  for (const suffix of ['/email-settings', '/email-settings/verify', '/email-settings/test']) {
    await request(app).get(path(suffix)).expect(404);
    await request(app).put(path(suffix)).send(settings).expect(404);
    await request(app).post(path(suffix)).send({ recipient: 'capture@example.com' }).expect(404);
  }
});
it('persists project rate reservations across policy edits', async () => {
  await contact();
  const c = await draft();
  await launch(c.id);
  await workerTick(async () => {});
  const reserved = findProject(projectId)?.nextSendAt;
  assert.ok(reserved && reserved > new Date());
  await request(app).put(path('/sending-settings')).send({ hourlyLimit: 20, timeZone: 'Asia/Kolkata' }).expect(200);
  assert.deepEqual(findProject(projectId)?.nextSendAt, reserved);
  assert.equal(findProject(projectId)?.hourlyLimit, 20);
});

it('saves, previews and sends a campaign email without creating a template', async () => {
  const person = await contact();
  const input = {
    name: 'Direct email', emailAccountId: accountId,
    message: { subject: 'Hello {{firstName}}', html: '<p>Direct {{firstName}}</p><script>alert(1)</script>' },
    audience: { mode: 'selected', contactIds: [person.id] },
  };
  const c = campaignSchema.parse((await request(app).post(path('/campaigns')).send(input).expect(201)).body);
  assert.equal(c.templateId, null);
  assert.equal(c.message?.html, '<p>Direct {{firstName}}</p>');
  assert.equal(countRows('templates'), 0);
  const preview = await request(app).post(path('/campaigns/audience-preview')).send({ audience: input.audience, message: input.message }).expect(200);
  assert.equal(preview.body.eligible, 1);
  await request(app).put(path(`/campaigns/${c.id}`)).send({ ...input, message: { subject: 'Updated {{firstName}}', html: '<p>Updated {{firstName}}</p>' } }).expect(200);
  await launch(c.id);
  const job = firstJob({ projectId, campaignId: c.id });
  assert.equal(job?.subject, 'Updated <Alex>');
  assert.ok(job?.html?.includes('Updated &lt;Alex&gt;'));
  assert.ok(job?.html?.includes('Unsubscribe'));
  let submitted = 0;
  await workerTick(async (_project, message, selectedAccount) => {
    submitted++;
    assert.equal(selectedAccount, accountId);
    assert.equal(message.subject, job?.subject);
    assert.equal(message.html, job?.html);
  });
  assert.equal(submitted, 1);
  assert.equal(countRows('templates'), 0);
});
it('validates direct campaign content and clears it when switching back to a template', async () => {
  const t = await template();
  const input = { name: 'Direct', emailAccountId: accountId, audience: { mode: 'all' }, message: { subject: 'Hello', html: '<p>Body</p>' } };
  for (const message of [{ subject: '', html: '<p>Body</p>' }, { subject: 'Hello', html: '<p></p>' }, { subject: '{{unknown}}', html: '<p>Body</p>' }]) {
    await request(app).post(path('/campaigns')).send({ ...input, message }).expect(400);
  }
  await request(app).post(path('/campaigns')).send({ ...input, templateId: t.id }).expect(400);
  await request(app).post(path('/campaigns')).send({ ...input, message: null }).expect(400);
  const c = campaignSchema.parse((await request(app).post(path('/campaigns')).send(input).expect(201)).body);
  const updated = campaignSchema.parse((await request(app).put(path(`/campaigns/${c.id}`)).send({ ...input, message: null, templateId: t.id }).expect(200)).body);
  assert.equal(updated.message, null);
  assert.equal(updated.templateId, t.id);
});

// Standalone messages use the same worker without creating campaigns or templates.
async function messageDraft(extra = {}) {
  const { messageSchema } = await import('@outreacher/shared');
  return messageSchema.parse((await request(app).post(path('/messages')).send({
    subject: 'Hi {{firstName}}', html: '<p>Hello {{firstName}}</p>', emailAccountId: accountId,
    addresses: ['new@example.com'], ...extra,
  }).expect(201)).body);
}
it('saves incomplete standalone drafts and enforces project isolation and explicit confirmation', async () => {
  const m = await messageDraft({ subject: '', html: '', emailAccountId: null, addresses: ['unfinished'] });
  await request(app).get(path(`/messages/${m.id}`)).expect(200);
  await request(app).get(path(`/messages/${m.id}`, otherId)).expect(404);
  await request(app).get(path(`/messages/${m.id}/report`, otherId)).expect(404);
  await request(app).put(path(`/messages/${m.id}`, otherId)).send({}).expect(409);
  await request(app).delete(path(`/messages/${m.id}`, otherId)).expect(404);
  await request(app).post(path(`/messages/${m.id}/submit`)).send({}).expect(400);
  await request(app).post(path(`/messages/${m.id}/submit`)).send({ confirmed: true }).expect(400);
  assert.equal(jobCount({ projectId, messageId: m.id }), 0);
});
it('deduplicates typed and saved recipients, preserves reservations and freezes personalized messages', async () => {
  const c = await contact(projectId, { email: 'saved@example.com', firstName: 'Alex' });
  const suppressed = await contact(projectId, { email: 'suppressed@example.com', suppressed: true });
  const deleted = await contact(projectId, { email: 'deleted@example.com', deletedAt: new Date() });
  const m = await messageDraft({ contactIds: [c.id], addresses: ['SAVED@example.com', c.email, suppressed.email, deleted.email, 'new@example.com'] });
  const preview = await request(app).post(path('/messages/preview')).send({ subject: m.subject, html: m.html, emailAccountId: accountId, contactIds: m.contactIds, addresses: m.addresses }).expect(200);
  assert.equal(preview.body.eligible, 2);
  assert.equal(preview.body.excluded, 2);
  assert.equal(findContactByEmail(projectId, 'new@example.com'), undefined);
  await Promise.all([1, 2].map(() => request(app).post(path(`/messages/${m.id}/submit`)).send({ confirmed: true }).expect(200)));
  assert.equal(jobCount({ projectId, messageId: m.id }), 2);
  assert.equal(countRows('campaigns'), 0);
  assert.equal(countRows('templates'), 0);
  assert.equal(
    contactById(deleted.id)?.deletedAt?.getTime(),
    deleted.deletedAt?.getTime(),
  );
  setRow('contacts', c.id, { firstName: 'Changed' });
  setRow('mail_accounts', accountId, { senderEmail: 'changed@example.com' });
  const sent: string[] = [];
  await workerTick(async (_project, mail) => { sent.push(String(mail.to)); assert.equal(typeof mail.from === 'object' && 'address' in mail.from ? mail.from.address : '', settings.senderEmail); if (mail.to === c.email) assert.equal(mail.subject, 'Hi Alex'); });
  assert.equal(sent.length, 1);
  await request(app).post(path(`/messages/${m.id}/submit`)).send({ confirmed: true }).expect(200);
  assert.equal(jobCount({ projectId, messageId: m.id }), 2);
  await request(app).delete(path(`/email-accounts/${accountId}`)).expect(409);
});
it('shares the campaign rate reservation and processes older standalone work first', async () => {
  const m = await messageDraft();
  await request(app).post(path(`/messages/${m.id}/submit`)).send({ confirmed: true }).expect(200);
  updateRows('recipient_jobs', { messageId: m.id }, { availableAt: new Date(0) });
  const c = await draft();
  await request(app).post(path(`/campaigns/${c.id}/launch`)).send({ confirmed: true }).expect(200);
  let sends = 0;
  await Promise.all([workerTick(async () => { sends++; }), workerTick(async () => { sends++; })]);
  assert.equal(sends, 1);
  assert.equal(jobCount({ projectId, messageId: m.id, state: 'smtp_accepted' }), 1);
  assert.equal(jobCount({ projectId, campaignId: c.id, state: 'smtp_accepted' }), 0);
});
it('recovers interrupted preparation only on explicit retry and preserves ambiguous outcomes', async () => {
  const m = await messageDraft();
  setRow('messages', m.id, { state: 'preparing', preparationUntil: new Date(0) });
  let sends = 0;
  await workerTick(async () => { sends++; });
  assert.equal(messageById(m.id)?.state, 'preparation_failed');
  await request(app).post(path(`/messages/${m.id}/submit`)).send({ confirmed: true }).expect(200);
  assert.equal(messageById(m.id)?.state, 'preparation_failed');
  await request(app).post(path(`/messages/${m.id}/submit`)).send({ confirmed: true, retry: true }).expect(200);
  updateRows('recipient_jobs', { messageId: m.id }, { state: 'sending', leaseUntil: new Date(0) });
  await workerTick(async () => { sends++; });
  assert.equal(sends, 0);
  assert.equal(firstJob({ projectId, messageId: m.id })?.state, 'outcome_unknown');
});
it('pauses standalone submissions for account errors and cancels only unsubmitted work', async () => {
  const m = await messageDraft({ addresses: ['one@example.com', 'two@example.com'] });
  await request(app).post(path(`/messages/${m.id}/submit`)).send({ confirmed: true }).expect(200);
  await workerTick(async () => { throw Object.assign(new Error('Auth'), { code: 'EAUTH' }); });
  assert.equal(messageById(m.id)?.state, 'paused');
  await request(app).post(path(`/messages/${m.id}/resume`)).expect(409);
  await request(app).put(path(`/email-accounts/${accountId}`)).send(settings).expect(200);
  await request(app).post(path(`/messages/${m.id}/resume`)).expect(200);
  setRow('projects', projectId, { nextSendAt: new Date(0) });
  await workerTick(async () => {
    await request(app).post(path(`/messages/${m.id}/cancel`)).expect(200);
    await request(app).delete(path(`/email-accounts/${accountId}`)).expect(409);
  });
  assert.equal(jobCount({ projectId, messageId: m.id, state: 'smtp_accepted' }), 1);
  assert.equal(jobCount({ projectId, messageId: m.id, state: 'skipped' }), 1);
});
it('keeps partial unique recipient indexes restart-safe without changing jobs', async () => {
  const c = await draft();
  const person = await contact();
  await request(app).post(path(`/campaigns/${c.id}/launch`)).send({ confirmed: true }).expect(200);
  const job = firstJob({ projectId, campaignId: c.id });
  assert.ok(job?.contactId);
  assert.throws(
    () =>
      createJob({
        projectId,
        campaignId: c.id,
        contactId: job.contactId ?? undefined,
        preparationToken: job.preparationToken,
        email: job.email,
        subject: job.subject,
        html: job.html,
        text: job.text,
      }),
    /UNIQUE/,
  );
  const indexes = z
    .array(z.object({ name: z.string(), sql: z.string().nullable() }))
    .parse(
      testDatabase()
        .prepare(
          "SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'recipient_jobs'",
        )
        .all(),
    );
  assert.ok(
    indexes.some(
      (index) =>
        index.name === 'campaign_recipient' &&
        index.sql?.includes('WHERE campaignId IS NOT NULL'),
    ),
  );
  assert.ok(
    indexes.some(
      (index) =>
        index.name === 'message_recipient' &&
        index.sql?.includes('WHERE messageId IS NOT NULL'),
    ),
  );
  assert.equal(jobCount({ projectId, campaignId: c.id }), 1);
  assert.equal(person.email.length > 0, true);
});
it('saves incoming settings separately, redacts and replaces credentials, and isolates projects', async () => {
  const incoming = { enabled: true, host: 'imap.example.com', port: 993, tlsMode: 'tls', useSmtpCredentials: false, username: 'incoming-user', password: 'incoming-secret' };
  const endpoint = `/email-accounts/${accountId}/incoming`;
  await request(app).put(path(endpoint, otherId)).send(incoming).expect(404);
  await request(app).put(path(endpoint)).send({ ...incoming, host: '' }).expect(400);
  const saved = await request(app).put(path(endpoint)).send(incoming).expect(200);
  assert.ok(!JSON.stringify(saved.body).includes('incoming-secret'));
  let account = accountById(accountId);
  assert.equal(decryptPassword(account?.incoming?.passwordEncrypted ?? ''), 'incoming-secret');
  assert.equal(decryptPassword(account?.passwordEncrypted ?? ''), settings.password);
  await request(app).put(path(endpoint)).send({ ...incoming, password: '' }).expect(200);
  account = accountById(accountId);
  assert.equal(decryptPassword(account?.incoming?.passwordEncrypted ?? ''), 'incoming-secret');
  await request(app).put(path(endpoint)).send({ ...incoming, password: 'replacement' }).expect(200);
  account = accountById(accountId);
  assert.equal(decryptPassword(account?.incoming?.passwordEncrypted ?? ''), 'replacement');
  await request(app).put(path(endpoint)).send({ ...incoming, useSmtpCredentials: true, password: '' }).expect(200);
  account = accountById(accountId);
  assert.equal(account?.incoming?.passwordEncrypted, '');
  await request(app).get(path(`/email-accounts/${accountId}/inbox`, otherId)).expect(404);
  await request(app).post(path(`/email-accounts/${accountId}/inbox/reply`, otherId)).send({ uidValidity: '1', uid: 1 }).expect(404);
  await request(app).put(path(endpoint)).send({ ...incoming, enabled: false, password: '' }).expect(200);
  await request(app).post(path(`${endpoint}/verify`)).send({}).expect(400);
  assert.equal(accountById(accountId)?.sendingError, '');
});
async function replyDraft() {
  return createMessage(
    projectId,
    {
      emailAccountId: accountId,
      subject: 'Re: Hello {{literal}}',
      html: '<p>Hello {{unknown}}</p>',
      addresses: ['reply@example.com'],
      contactIds: [],
    },
    {
      kind: 'reply',
      replyContext: replyContextSchema.parse({
        accountId,
        uidValidity: '1',
        uid: 5,
        recipient: 'reply@example.com',
        messageId: '<original@example.com>',
        references: ['<older@example.com>'],
        from: 'Original sender',
        subject: 'Hello',
        text: 'Original text',
      }),
    },
  );
}
it('reopens and previews locked replies and submits them idempotently without contact or outreach behavior', async () => {
  await contact(projectId, { email: 'reply@example.com', suppressed: true, deletedAt: new Date() });
  const before = countRows('contacts');
  const m = await replyDraft(), endpoint = `/messages/${m.id}`;
  const reopened = await request(app).get(path(endpoint)).expect(200);
  assert.equal(reopened.body.kind, 'reply');
  assert.equal(reopened.body.replyContext.text, 'Original text');
  const input = { subject: m.subject, html: m.html, emailAccountId: accountId, addresses: ['reply@example.com'] };
  for (const update of [{ emailAccountId: otherId }, { addresses: ['other@example.com'] }, { contactIds: [otherId] }, { kind: 'reply' }, { replyContext: {} }])
    await request(app).put(path(endpoint)).send({ ...input, ...update }).expect(400);
  await request(app).put(path(endpoint)).send(input).expect(200);
  const preview = await request(app).post(path(`${endpoint}/preview`)).send(input).expect(200);
  assert.equal(preview.body.recipients[0].html, m.html);
  await request(app).post(path(`${endpoint}/submit`)).send({}).expect(400);
  await Promise.all([1, 2].map(() => request(app).post(path(`${endpoint}/submit`)).send({ confirmed: true }).expect(200)));
  assert.equal(jobCount({ projectId, messageId: m.id }), 1);
  assert.equal(countRows('contacts'), before);
  const job = firstJob({ projectId, messageId: m.id });
  assert.equal(job?.contactId, null);
  await request(app).delete(path(`/email-accounts/${accountId}`)).expect(409);
  let sent = 0;
  await workerTick(async (_project, mail, selectedAccount) => {
    sent++; assert.equal(selectedAccount, accountId); assert.equal(mail.to, 'reply@example.com');
    assert.equal(mail.subject, m.subject); assert.equal(mail.html, m.html);
    assert.equal(mail.inReplyTo, '<original@example.com>');
    assert.deepEqual(mail.references, ['<older@example.com>', '<original@example.com>']);
    assert.deepEqual(mail.headers, {});
    await request(app).post(path(`${endpoint}/cancel`)).expect(200);
    await request(app).delete(path(`/email-accounts/${accountId}`)).expect(409);
  });
  assert.equal(sent, 1);
  assert.equal(firstJob({ projectId, messageId: m.id })?.state, 'smtp_accepted');
});
it('shares reply rate limits, cancels queued replies, and preserves unknown reply outcomes', async () => {
  const m = await replyDraft();
  await request(app).post(path(`/messages/${m.id}/submit`)).send({ confirmed: true }).expect(200);
  setRow('projects', projectId, {
    nextSendAt: new Date(Date.now() + 3600000),
  });
  let sends = 0;
  await workerTick(async () => { sends++; });
  assert.equal(sends, 0);
  await resetRate();
  await workerTick(async () => { sends++; throw new Error('Ambiguous SMTP outcome'); });
  assert.equal(sends, 1);
  assert.equal(firstJob({ projectId, messageId: m.id })?.state, 'outcome_unknown');
  await resetRate();
  await workerTick(async () => { sends++; });
  assert.equal(sends, 1);
  const cancelled = await replyDraft();
  await request(app).post(path(`/messages/${cancelled.id}/submit`)).send({ confirmed: true }).expect(200);
  await request(app).post(path(`/messages/${cancelled.id}/cancel`)).expect(200);
  await workerTick(async () => { sends++; });
  assert.equal(sends, 1);
  assert.equal(
    firstJob({ projectId, messageId: cancelled.id })?.state,
    'skipped',
  );
});

it('closes IMAP connections on failure, hides credentials and leaves outgoing mail unpaused', async () => {
  await request(app).put(path(`/email-accounts/${accountId}/incoming`)).send({ enabled: true, host: 'imap.example.com', port: 993, tlsMode: 'tls' }).expect(200);
  const connect = mock.method(ImapFlow.prototype, 'connect', async () => { throw new Error('sensitive provider details'); });
  const close = mock.method(ImapFlow.prototype, 'close', () => {});
  try {
    const response = await request(app).post(path(`/email-accounts/${accountId}/incoming/verify`)).send({}).expect(502);
    assert.ok(!JSON.stringify(response.body).includes('sensitive'));
    assert.equal(connect.mock.callCount(), 1);
    assert.equal(close.mock.callCount(), 1);
    assert.equal(accountById(accountId)?.sendingError, '');
  } finally { connect.mock.restore(); close.mock.restore(); }
});
it('reads live mail read-only and creates an empty locked reply draft from the validated source', async () => {
  const { inboxMessageSchema, messageSchema } = await import('@outreacher/shared');
  await request(app).put(path(`/email-accounts/${accountId}/incoming`)).send({ enabled: true, host: 'imap.example.com', port: 993, tlsMode: 'tls' }).expect(200);
  const source = Buffer.from([
    'From: from@example.com', 'Reply-To: reply@example.com', 'Subject: Re: Existing thread',
    'Message-ID: <original@example.com>', 'References: <older@example.com>', '', 'Original body',
  ].join('\r\n'));
  const connect = mock.method(ImapFlow.prototype, 'connect', async () => {});
  const open = mock.method(ImapFlow.prototype, 'mailboxOpen', async function (this: ImapFlow, ...[mailboxPath, options]: Parameters<ImapFlow['mailboxOpen']>) {
    assert.equal(mailboxPath, 'INBOX');
    assert.deepEqual(options, { readOnly: true });
    const mailbox = { path: 'INBOX', delimiter: '/', flags: new Set<string>(), uidValidity: 7n, uidNext: 6, exists: 1, readOnly: true };
    this.mailbox = mailbox;
    return mailbox;
  });
  const fetch = mock.method(ImapFlow.prototype, 'fetchOne', async (...[uid, query, options]: Parameters<ImapFlow['fetchOne']>) => {
    assert.equal(uid, 5);
    assert.deepEqual(options, { uid: true });
    return { seq: 1, uid: 5, flags: new Set<string>(), size: source.length, ...(query.source ? { source } : {}) };
  });
  const close = mock.method(ImapFlow.prototype, 'close', () => {});
  try {
    const response = await request(app).get(path(`/email-accounts/${accountId}/inbox/7/5`)).expect(200);
    const mail = inboxMessageSchema.parse(response.body);
    assert.equal(mail.recipient, 'reply@example.com');
    assert.equal(mail.unread, true);
    assert.equal(countRows('messages'), 0);
    const created = await request(app).post(path(`/email-accounts/${accountId}/inbox/reply`)).send({ uidValidity: '7', uid: 5 }).expect(201);
    const draft = messageSchema.parse(created.body);
    assert.equal(draft.kind, 'reply');
    assert.equal(draft.subject, 'Re: Existing thread');
    assert.equal(draft.html, '');
    assert.equal(draft.emailAccountId, accountId);
    assert.deepEqual(draft.addresses, ['reply@example.com']);
    assert.equal(draft.replyContext?.text.trim(), 'Original body');
    assert.equal(draft.replyContext?.messageId, '<original@example.com>');
    assert.deepEqual(draft.replyContext?.references, ['<older@example.com>']);
    assert.equal(countRows('contacts'), 0);
    await request(app).delete(path(`/email-accounts/${accountId}`)).expect(409);
    assert.equal(close.mock.callCount(), 2);
  } finally {
    connect.mock.restore(); open.mock.restore(); fetch.mock.restore(); close.mock.restore();
  }
});

// Exercise MCP tool schemas and the actual REST handlers against this suite's
// isolated database. No sending worker or SMTP/IMAP connection is started.
async function mcpFixture() {
  const api = new OutreachApi('http://127.0.0.1:3001/api', async (input, options) => {
    const url = new URL(String(input));
    const route = url.pathname + url.search;
    const agent = request(app);
    const pending = options?.method === 'POST' ? agent.post(route)
      : options?.method === 'PUT' ? agent.put(route)
      : options?.method === 'DELETE' ? agent.delete(route) : agent.get(route);
    if (typeof options?.body === 'string') pending.set('Content-Type', 'application/json').send(options.body);
    const response = await pending;
    return new Response(response.status === 204 ? null : response.text, {
      status: response.status,
      headers: {
        'Content-Type': String(response.headers['content-type'] ?? ''),
        'Content-Disposition': String(response.headers['content-disposition'] ?? ''),
      },
    });
  });
  const server = createMcpServer(api);
  const client = new Client({ name: 'mcp-api-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  return {
    async call(name: string, args: Record<string, unknown>) {
      const result = await client.callTool({ name, arguments: { projectId, ...args } });
      const content = z.array(z.object({ type: z.literal('text'), text: z.string() })).parse(result.content);
      return { isError: result.isError, text: content[0]?.text ?? '' };
    },
    async close() { await client.close(); await server.close(); },
  };
}

it('MCP account tools preserve and replace encrypted credentials, redact results and enforce ownership/removal restrictions', async () => {
  const f = await mcpFixture();
  try {
    const created = await f.call('create_email_account', { data: settings });
    assert.equal(created.isError, undefined);
    assert.ok(!created.text.includes(settings.password));
    const account = emailAccountSchema.parse(JSON.parse(created.text));
    assert.equal(account.passwordConfigured, true);
    let saved = accountById(account.id);
    assert.equal(decryptPassword(saved?.passwordEncrypted ?? ''), settings.password);
    const cipher = saved?.passwordEncrypted;
    const updated = await f.call('update_email_account', { accountId: account.id, data: { ...settings, name: 'Renamed', password: '' } });
    assert.equal(updated.isError, undefined);
    assert.equal(accountById(account.id)?.passwordEncrypted, cipher);
    const replaced = await f.call('update_email_account', { accountId: account.id, data: { ...settings, password: 'replacement-secret' } });
    assert.equal(replaced.isError, undefined);
    assert.ok(!replaced.text.includes('replacement-secret'));
    saved = accountById(account.id);
    assert.equal(decryptPassword(saved?.passwordEncrypted ?? ''), 'replacement-secret');
    const incoming = { enabled: true, host: 'imap.example.com', useSmtpCredentials: false, username: 'inbox-user', password: 'incoming-secret' };
    const configured = await f.call('update_incoming_settings', { accountId: account.id, data: incoming });
    assert.equal(configured.isError, undefined);
    assert.ok(!configured.text.includes('incoming-secret'));
    assert.equal(emailAccountSchema.parse(JSON.parse(configured.text)).incoming?.passwordConfigured, true);
    saved = accountById(account.id);
    assert.equal(decryptPassword(saved?.incoming?.passwordEncrypted ?? ''), 'incoming-secret');
    const incomingCipher = saved?.incoming?.passwordEncrypted;
    assert.equal((await f.call('update_incoming_settings', { accountId: account.id, data: { ...incoming, enabled: false, password: '' } })).isError, undefined);
    saved = accountById(account.id);
    assert.equal(saved?.incoming?.enabled, false);
    assert.equal(saved?.incoming?.passwordEncrypted, incomingCipher);
    assert.equal((await f.call('update_incoming_settings', { accountId: account.id, data: { ...incoming, password: 'new-incoming' } })).isError, undefined);
    saved = accountById(account.id);
    assert.equal(saved?.incoming?.enabled, true);
    assert.equal(decryptPassword(saved?.incoming?.passwordEncrypted ?? ''), 'new-incoming');
    assert.equal((await f.call('update_incoming_settings', { accountId: account.id, data: { ...incoming, useSmtpCredentials: true, password: '' } })).isError, undefined);
    assert.equal(accountById(account.id)?.incoming?.passwordEncrypted, '');
    for (const name of ['update_email_account', 'update_incoming_settings', 'delete_email_account']) {
      const result = await f.call(name, { projectId: otherId, accountId: account.id, ...(name === 'delete_email_account' ? {} : { data: name === 'update_email_account' ? settings : incoming }) });
      assert.equal(result.isError, true);
      assert.match(result.text, /HTTP 404/);
    }
    const c = await draft({ emailAccountId: account.id });
    setRow('campaigns', c.id, { state: 'paused' });
    const blocked = await f.call('delete_email_account', { accountId: account.id });
    assert.equal(blocked.isError, true);
    assert.match(blocked.text, /HTTP 409/);
    setRow('campaigns', c.id, { state: 'draft' });
    createMessage(
      projectId,
      {
        emailAccountId: account.id,
        subject: '',
        html: '',
        contactIds: [],
        addresses: [],
      },
      { kind: 'reply', replyContext: null },
    );
    assert.equal((await f.call('delete_email_account', { accountId: account.id })).isError, true);
    deleteRows('messages', { projectId });
    assert.equal((await f.call('delete_email_account', { accountId: account.id })).isError, undefined);
    saved = accountById(account.id);
    assert.ok(saved?.archivedAt);
    assert.equal(saved?.passwordEncrypted, '');
    assert.equal(saved?.incoming, null);
    const listed = await f.call('list_email_accounts', {});
    assert.ok(!listed.text.includes(account.id));
  } finally { await f.close(); }
});

it('MCP exports complete filtered campaign CSV using existing escaping and project isolation', async () => {
  const c = await draft();
  const preparationToken = 'csv-test';
  setRow('campaigns', c.id, { preparationToken });
  for (let i = 0; i < 103; i++) {
    const job = createJob({
      projectId,
      campaignId: c.id,
      contactId: newId(),
      preparationToken,
      email: `person${i}@example.com`,
      state: i === 102 ? 'queued' : 'failed',
      subject: '',
      html: '',
      text: '',
    });
    setRow('recipient_jobs', job.id, {
      reason: i === 0 ? '=formula,"quoted"\r\nnext' : 'failed reason',
    });
  }
  const f = await mcpFixture();
  try {
    const result = await f.call('export_campaign_report', { id: c.id, state: 'failed' });
    assert.equal(result.isError, undefined);
    const exported = z.object({ filename: z.string(), mimeType: z.string(), csv: z.string() }).parse(JSON.parse(result.text));
    assert.equal(exported.filename, 'campaign-report.csv');
    assert.equal(exported.mimeType, 'text/csv');
    assert.ok(exported.csv.includes('person101@example.com'));
    assert.ok(!exported.csv.includes('person102@example.com'));
    assert.ok(exported.csv.includes(`"'=formula,""quoted""\r\nnext"`));
    const rest = await request(app).get(path(`/campaigns/${c.id}/report?format=csv&state=failed`)).expect(200);
    assert.equal(exported.csv, rest.text);
    const full = await f.call('export_campaign_report', { id: c.id });
    assert.equal(full.isError, undefined);
    assert.ok(full.text.includes('person102@example.com'));
    const foreign = await f.call('export_campaign_report', { projectId: otherId, id: c.id });
    assert.equal(foreign.isError, true);
    assert.match(foreign.text, /HTTP 404/);
  } finally { await f.close(); }
});
