import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { routes } from '@/router';
import { campaignSchema } from '@outreachit/shared';
const projectId = '111111111111111111111111';
const otherId = '222222222222222222222222';
const templateId = '333333333333333333333333';
const campaignId = '444444444444444444444444';
const accountId = '555555555555555555555555';
const secondAccountId = '666666666666666666666666';
const mailAccounts = [
  {
    id: accountId,
    projectId,
    name: 'Main account',
    host: 'smtp.example.com',
    port: 587,
    tlsMode: 'starttls',
    username: '',
    senderName: 'Sender',
    senderEmail: 'sender@example.com',
    replyTo: '',
    passwordConfigured: true,
    sendingError: '',
  },
  {
    id: secondAccountId,
    projectId,
    name: 'Second account',
    host: 'smtp.example.org',
    port: 587,
    tlsMode: 'starttls',
    username: '',
    senderName: 'Second sender',
    senderEmail: 'second@example.org',
    replyTo: '',
    passwordConfigured: false,
    sendingError: '',
  },
];
const template = {
  id: templateId,
  projectId,
  name: 'Welcome',
  subject: 'Hi {{firstName}}',
  html: '<p>Hello {{firstName}}</p>',
  text: 'Hello {{firstName}}',
};
const initialCampaign = {
  id: campaignId,
  projectId,
  name: 'Launch',
  templateId,
  emailAccountId: accountId,
  audience: { mode: 'all', contactIds: [], filters: {} },
  scheduledAt: null,
  weekdays: [],
  startHour: null,
  endHour: null,
  state: 'draft',
  error: '',
  timeZone: 'UTC',
  total: 0,
};
let campaign = campaignSchema.parse(initialCampaign);
let noTemplates = false;
let failure = false;
const calls: { path: string; method: string; body: unknown }[] = [];
beforeEach(() => {
  campaign = campaignSchema.parse(initialCampaign);
  noTemplates = false;
  failure = false;
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const method = options?.method ?? 'GET';
      const body: unknown = options?.body
        ? JSON.parse(String(options.body))
        : undefined;
      calls.push({ path: input, method, body });
      if (failure)
        return Response.json(
          { error: { message: 'SMTP settings need attention.' } },
          { status: 400 },
        );
      if (url.pathname === '/api/projects')
        return Response.json([
          {
            id: projectId,
            name: 'Default project',
            isDefault: true,
            contactCount: 1,
          },
          { id: otherId, name: 'Research', isDefault: false, contactCount: 0 },
        ]);
      if (url.pathname.endsWith('/email-accounts')) {
        if (method === 'POST' && typeof body === 'object' && body)
          return Response.json({ ...mailAccounts[0], ...body });
        return Response.json(mailAccounts);
      }
      if (/\/email-accounts\/[^/]+\/(test|verify)$/.test(url.pathname))
        return Response.json({ ok: true });
      if (url.pathname.endsWith('/sending-settings'))
        return Response.json({ projectId, hourlyLimit: 60, timeZone: 'UTC' });
      if (url.pathname.endsWith('/custom-fields')) return Response.json([]);
      if (url.pathname.endsWith('/contacts'))
        return Response.json({
          projectId,
          items: [
            {
              id: '777777777777777777777777',
              projectId,
              email: 'preview@example.com',
              firstName: 'Alex',
              createdAt: '2026-10-20T10:00:00Z',
              updatedAt: '2026-10-20T10:00:00Z',
            },
          ],
          page: 1,
          limit: 100,
          total: 0,
        });
      if (url.pathname.endsWith('/templates/preview'))
        return Response.json({
          projectId,
          subject: 'Personalized email for Alex',
          html: '<p>Hello Alex</p>',
          text: 'Hello Alex',
          warnings: [],
        });
      if (url.pathname.endsWith('/templates')) return Response.json(noTemplates ? [] : [template]);
      if (url.pathname.endsWith(`/templates/${templateId}`))
        return Response.json({
          ...template,
          ...(typeof body === 'object' && body ? body : {}),
        });
      if (url.pathname.endsWith('/campaigns/audience-preview'))
        return Response.json({
          projectId,
          eligible: 12,
          excluded: 2,
          warnings: ['person@example.com: Missing value: company'],
        });
      if (url.pathname.endsWith('/launch')) {
        campaign = {
          ...campaign,
          state: campaign.scheduledAt ? 'scheduled' : 'active',
          total: 12,
        };
        return Response.json(campaign);
      }
      if (url.pathname.endsWith('/report'))
        return Response.json({
          projectId,
          items: [
            {
              id: templateId,
              projectId,
              campaignId,
              email: 'person@example.com',
              state: 'smtp_accepted',
              reason: '',
              attempts: [
                {
                  at: '2026-10-20T10:00:00Z',
                  state: 'smtp_accepted',
                  reason: '',
                },
              ],
            },
          ],
          total: 1,
          counts: { smtp_accepted: 1 },
        });
      if (url.pathname.endsWith(`/campaigns/${campaignId}`)) {
        if (method === 'PUT' && typeof body === 'object' && body)
          campaign = { ...campaign, ...body };
        return Response.json(campaign);
      }
      if (url.pathname.endsWith('/campaigns')) {
        if (method === 'POST' && typeof body === 'object' && body) {
          campaign = campaignSchema.parse({ ...campaign, ...body });
          return Response.json(campaign, { status: 201 });
        }
        return Response.json(url.pathname.includes(otherId) ? [] : [campaign]);
      }
      throw new Error(`Unexpected request ${input}`);
    }),
  );
});
function open(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}
it('edits a rich-text template and saves its HTML and subject', async () => {
  const { user } = open(`/projects/${projectId}/templates/${templateId}`);
  const subject = await screen.findByLabelText('Subject');
  await user.clear(subject);
  await user.type(subject, 'Updated subject');
  expect(
    await screen.findByRole('toolbar', { name: 'Text formatting' }),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Bold' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save template' }));
  await waitFor(() =>
    expect(
      calls.some(
        (c) =>
          c.method === 'PUT' &&
          JSON.stringify(c.body).includes('Updated subject') &&
          JSON.stringify(c.body).includes('<p>Hello'),
      ),
    ).toBe(true),
  );
});
it('requires review and explicit confirmation, preserving schedule in UTC', async () => {
  const { user } = open(`/projects/${projectId}/campaigns/${campaignId}`);
  await screen.findByRole('heading', { name: 'Edit draft' });
  await user.click(screen.getByText('Schedule and sending window'));
  await user.type(screen.getByLabelText(/Scheduled time/), '2027-10-21T10:00');
  await user.click(
    screen.getByRole('button', { name: 'Review recipients and launch' }),
  );
  await screen.findByRole('heading', { name: 'Review campaign' });
  expect(screen.getByText(/12 eligible recipients/)).toBeTruthy();
  expect(screen.getByText(/Missing value: company/)).toBeTruthy();
  expect(calls.some((c) => c.path.endsWith('/launch'))).toBe(false);
  expect(campaign.scheduledAt).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Confirm schedule' }));
  await waitFor(() =>
    expect(calls.find((c) => c.path.endsWith('/launch'))?.body).toEqual({
      confirmed: true,
    }),
  );
});
it('shows sending reports, state filtering and CSV export without claiming delivery', async () => {
  campaign.state = 'active';
  const { user } = open(`/projects/${projectId}/campaigns/${campaignId}`);
  await screen.findByRole('heading', { name: 'Sending report' });
  await screen.findByText('person@example.com');
  expect(screen.getByText(/Confirmed delivery is not measured/)).toBeTruthy();
  await user.selectOptions(
    screen.getByLabelText('Filter recipient status'),
    'smtp_accepted',
  );
  await waitFor(() =>
    expect(calls.some((c) => c.path.includes('state=smtp_accepted'))).toBe(
      true,
    ),
  );
  expect(
    screen.getByRole('link', { name: 'Export CSV' }).getAttribute('href'),
  ).toContain('format=csv&state=smtp_accepted');
});
it('switches from a campaign detail to the destination project list', async () => {
  campaign.state = 'active';
  const { user, router } = open(
    `/projects/${projectId}/campaigns/${campaignId}`,
  );
  await screen.findByRole('heading', { name: 'Sending report' });
  await user.click(
    screen.getByRole('button', { name: 'Switch project: Default project' }),
  );
  await user.click(await screen.findByRole('menuitem', { name: 'Research' }));
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(
      `/projects/${otherId}/campaigns`,
    ),
  );
  await screen.findByRole('heading', { name: 'Campaigns', level: 1 });
  expect(screen.queryByText('person@example.com')).toBeNull();
});
it('surfaces launch errors while keeping confirmation available for retry', async () => {
  const { user } = open(`/projects/${projectId}/campaigns/${campaignId}`);
  await screen.findByRole('heading', { name: 'Edit draft' });
  await user.click(
    screen.getByRole('button', { name: 'Review recipients and launch' }),
  );
  await screen.findByRole('heading', { name: 'Review campaign' });
  failure = true;
  await user.click(screen.getByRole('button', { name: 'Confirm launch' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('SMTP settings need attention.'),
  );
  expect(screen.getByRole('button', { name: 'Confirm launch' })).toBeTruthy();
});

it('saves the selected campaign account and shows it during review', async () => {
  const { user } = open(`/projects/${projectId}/campaigns/${campaignId}`);
  const select = await screen.findByLabelText('Send from mail account');
  await screen.findByRole('option', { name: /Second account/ });
  await user.selectOptions(select, secondAccountId);
  await user.click(
    screen.getByRole('button', { name: 'Review recipients and launch' }),
  );
  await screen.findByRole('heading', { name: 'Review campaign' });
  expect(
    calls.find(
      (c) => c.method === 'PUT' && c.path.endsWith(`/campaigns/${campaignId}`),
    )?.body,
  ).toMatchObject({ emailAccountId: secondAccountId });
  expect(screen.getByText(/Mail account: Second account/)).toBeTruthy();
  expect(screen.getByText(/second@example.org/)).toBeTruthy();
});
it('sends a template test through the explicitly selected mail account', async () => {
  const { user } = open(`/projects/${projectId}/templates/${templateId}`);
  await screen.findByRole('option', { name: /Second account/ });
  await user.selectOptions(
    await screen.findByLabelText('Test mail account'),
    secondAccountId,
  );
  await user.selectOptions(
    screen.getByLabelText('Preview contact'),
    '777777777777777777777777',
  );
  await user.type(
    screen.getByLabelText('Explicit test recipient'),
    'capture@example.com',
  );
  await user.click(
    screen.getByRole('button', { name: 'Send saved template test' }),
  );
  await screen.findByText('Saved template test submitted to SMTP.');
  expect(
    calls.find((c) =>
      c.path.endsWith(`/email-accounts/${secondAccountId}/test`),
    )?.body,
  ).toMatchObject({ recipient: 'capture@example.com', templateId });
});
it('adds another mail account in Settings without replacing project sending settings', async () => {
  const { user } = open(`/projects/${projectId}/settings`);
  await user.click(
    await screen.findByRole('button', { name: 'Add mail account' }),
  );
  await user.type(screen.getByLabelText('Account name'), 'Third account');
  await user.type(screen.getByLabelText('SMTP host'), 'smtp.example.net');
  await user.type(screen.getByLabelText('Sender email'), 'third@example.net');
  await user.click(screen.getByRole('button', { name: 'Save mail account' }));
  await waitFor(() =>
    expect(
      calls.some(
        (c) => c.path.endsWith('/email-accounts') && c.method === 'POST',
      ),
    ).toBe(true),
  );
  expect(
    calls.find((c) => c.path.endsWith('/email-accounts') && c.method === 'POST')
      ?.body,
  ).toMatchObject({ name: 'Third account', senderEmail: 'third@example.net' });
  expect(
    calls.some(
      (c) => c.path.endsWith('/sending-settings') && c.method === 'PUT',
    ),
  ).toBe(false);
});

it('writes and reviews a campaign without templates or creating a reusable template', async () => {
  noTemplates = true;
  const { user } = open(`/projects/${projectId}/campaigns/new`);
  await user.type(await screen.findByLabelText('Name'), 'Direct campaign');
  await screen.findByRole('option', { name: /Main account/ });
  await user.selectOptions(screen.getByLabelText('Send from mail account'), accountId);
  await user.type(screen.getByLabelText('Subject'), 'A direct email');
  expect(screen.getByRole('textbox', { name: 'Email body' })).toBeTruthy();
  expect(screen.queryByLabelText('Template')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Review recipients and launch' }));
  await screen.findByRole('heading', { name: 'Review campaign' });
  const saved = calls.find((c) => c.method === 'POST' && c.path.endsWith('/campaigns'));
  expect(saved?.body).toMatchObject({ templateId: null, message: { subject: 'A direct email', html: expect.stringContaining('Hello') } });
  expect(calls.find((c) => c.path.endsWith('/audience-preview'))?.body).toMatchObject({ templateId: null, message: { subject: 'A direct email' } });
  expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/templates'))).toBe(false);
  expect(calls.some((c) => c.path.endsWith('/launch'))).toBe(false);
  expect(screen.getByText('Subject: A direct email')).toBeTruthy();
});
it('selects a page of contacts and clears selection without losing the email draft', async () => {
  const { user } = open(`/projects/${projectId}/campaigns/${campaignId}`);
  await user.selectOptions(await screen.findByLabelText('Audience'), 'selected');
  await screen.findByText('preview@example.com');
  await user.click(screen.getByRole('button', { name: 'Select this page' }));
  expect(screen.getByRole('checkbox', { name: 'preview@example.com' })).toHaveProperty('checked', true);
  await user.click(screen.getByRole('button', { name: 'Clear selection' }));
  expect(screen.getByRole('checkbox', { name: 'preview@example.com' })).toHaveProperty('checked', false);
  await user.click(screen.getByRole('checkbox', { name: 'preview@example.com' }));
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(calls.find((c) => c.method === 'PUT' && c.path.endsWith(`/campaigns/${campaignId}`))?.body).toMatchObject({
    templateId, message: null, audience: { mode: 'selected', contactIds: ['777777777777777777777777'] },
  }));
});
it('reopens and edits a campaign email with no template', async () => {
  campaign = { ...campaign, templateId: null, message: { subject: 'Saved subject', html: '<p>Saved campaign body</p>' } };
  const { user } = open(`/projects/${projectId}/campaigns/${campaignId}`);
  const subject = await screen.findByLabelText('Subject');
  expect(subject).toHaveProperty('value', 'Saved subject');
  expect(screen.getByRole('textbox', { name: 'Email body' }).textContent).toContain('Saved campaign body');
  await user.clear(subject);
  await user.type(subject, 'Edited subject');
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ templateId: null, message: { subject: 'Edited subject', html: '<p>Saved campaign body</p>' } }));
});

it('renders the current campaign email through the server preview without sending', async () => {
  campaign = { ...campaign, templateId: null, message: { subject: 'Hello {{firstName}}', html: '<p>Current campaign body</p>' } };
  const { user } = open(`/projects/${projectId}/campaigns/${campaignId}`);
  await user.click(await screen.findByRole('tab', { name: 'Preview' }));
  await user.selectOptions(screen.getByLabelText('Preview contact'), '777777777777777777777777');
  await user.click(screen.getByRole('button', { name: 'Render preview' }));
  const frame = await screen.findByTitle('Campaign email preview');
  expect(frame.getAttribute('srcdoc')).toBe('<p>Hello Alex</p>');
  expect(frame.getAttribute('sandbox')).toBe('');
  expect(calls.find((c) => c.path.endsWith('/templates/preview'))?.body).toMatchObject({
    subject: 'Hello {{firstName}}', html: '<p>Current campaign body</p>', contactId: '777777777777777777777777',
  });
  expect(calls.some((c) => c.path.endsWith('/test') || c.path.endsWith('/launch'))).toBe(false);
  await user.click(screen.getByRole('tab', { name: 'Compose' }));
  await user.clear(screen.getByLabelText('Subject'));
  await user.type(screen.getByLabelText('Subject'), 'Updated subject');
  await user.click(screen.getByRole('tab', { name: 'Preview' }));
  expect(screen.queryByTitle('Campaign email preview')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Render preview' }));
  await screen.findByTitle('Campaign email preview');
  expect(calls.filter((c) => c.path.endsWith('/templates/preview')).at(-1)?.body).toMatchObject({ subject: 'Updated subject' });
});
it('supports keyboard navigation between compose and preview', async () => {
  const { user } = open(`/projects/${projectId}/campaigns/${campaignId}`);
  const compose = await screen.findByRole('tab', { name: 'Compose' });
  compose.focus();
  await user.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: 'Preview' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('campaign-preview-tab');
  await user.keyboard('{ArrowLeft}');
  expect(screen.getByRole('tab', { name: 'Compose' }).getAttribute('aria-selected')).toBe('true');
});
