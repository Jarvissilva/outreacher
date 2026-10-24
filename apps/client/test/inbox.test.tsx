import { routes } from '@/router';
import { messageSchema } from '@outreacher/shared';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
const projectId = '111111111111111111111111', otherId = '222222222222222222222222', accountId = '333333333333333333333333', messageId = '444444444444444444444444', secondAccountId = '555555555555555555555555', disabledAccountId = '666666666666666666666666';
const calls: { path: string; method: string }[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    const url = new URL(path, 'http://localhost');
    calls.push({ path, method: options?.method ?? 'GET' });
    if (url.pathname === '/api/projects') return Response.json([{ id: projectId, name: 'Default', isDefault: true, contactCount: 0 }, { id: otherId, name: 'Other', isDefault: false, contactCount: 0 }]);
    if (url.pathname.endsWith('/email-accounts')) {
      const primary = { id: accountId, projectId, name: 'Primary', host: 'smtp.example.com', port: 587, tlsMode: 'starttls', username: '', senderName: '', senderEmail: 'sender@example.com', replyTo: '', passwordConfigured: true, sendingError: '', incoming: { enabled: true, host: 'imap.example.com', port: 993, tlsMode: 'tls', useSmtpCredentials: true, username: '', passwordConfigured: false } };
      return Response.json([
        primary,
        { ...primary, id: secondAccountId, name: 'Secondary', senderEmail: 'second@example.com' },
        { ...primary, id: disabledAccountId, name: 'Outgoing only', senderEmail: 'outgoing@example.com', incoming: null },
      ]);
    }
    const header = { accountId: url.pathname.split('/')[5], uidValidity: '7', uid: 51, from: 'Sender', subject: 'Received hello', date: null, unread: true };
    if (url.pathname.endsWith('/inbox')) return Response.json({ accountId: header.accountId, uidValidity: '7', total: 51, page: Number(url.searchParams.get('page')), items: [{ ...header, subject: url.searchParams.get('page') === '2' ? 'Older hello' : header.subject }] });
    if (url.pathname.endsWith('/inbox/7/51')) return Response.json({ ...header, html: '<p>Hello</p>', text: 'Hello', recipient: 'reply@example.com', messageId: '<original@example.com>', references: [] });
    if (url.pathname.endsWith('/inbox/reply')) return Response.json(messageSchema.parse({ id: messageId, projectId, state: 'draft', senderEmail: '', total: 0, excluded: 0, error: '', createdAt: new Date().toISOString() }));
    if (url.pathname.includes('/messages/')) return Response.json(messageSchema.parse({ id: messageId, projectId, state: 'draft', senderEmail: '', total: 0, excluded: 0, error: '', createdAt: new Date().toISOString() }));
    if (/\/(messages|templates)$/.test(url.pathname)) return Response.json([]);
    if (url.pathname.endsWith('/contacts')) return Response.json({ projectId, items: [], total: 0, page: 1, limit: 100 });
    throw new Error(`Unexpected request ${path}`);
  }));
});
function open() {
  const router = createMemoryRouter(routes, { initialEntries: [`/projects/${projectId}/inbox`] });
  render(<RouterProvider router={router} />);
  return { user: userEvent.setup(), router };
}
it('reads in a sandbox without changing read status, paginates and refreshes', async () => {
  const { user } = open();
  await screen.findByRole('tab', { name: /Primary/ });
  await user.click(screen.getByRole('tab', { name: /Primary/ }));
  await user.click(await screen.findByRole('button', { name: /Received hello/ }));
  const frame = await screen.findByTitle('Received message');
  expect(frame.getAttribute('sandbox')).toBe('');
  expect(frame.getAttribute('srcdoc')).toContain("img-src 'none'");
  expect(screen.getByLabelText('Unread')).toBeTruthy();
  expect(calls.every(c => c.method === 'GET')).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Back to Inbox' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('button', { name: /Older hello/ });
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(calls.filter(c => c.path.endsWith('/inbox?page=2')).length).toBe(2));
});
it('creates a reply draft only on Reply and opens Compose', async () => {
  const { user, router } = open();
  await screen.findByRole('tab', { name: /Primary/ });
  await user.click(screen.getByRole('tab', { name: /Primary/ }));
  await user.click(await screen.findByRole('button', { name: /Received hello/ }));
  await user.click(await screen.findByRole('button', { name: 'Reply' }));
  await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${projectId}/compose/${messageId}`));
  expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
});
it('preserves Inbox and clears account and message when switching projects', async () => {
  const { user, router } = open();
  await screen.findByRole('tab', { name: /Primary/ });
  await user.click(screen.getByRole('tab', { name: /Primary/ }));
  await user.click(await screen.findByRole('button', { name: /Received hello/ }));
  await screen.findByTitle('Received message');
  await user.click(screen.getByRole('button', { name: 'Switch project: Default' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Other' }));
  await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${otherId}/inbox`));
  await waitFor(() => expect(screen.getByRole('tab', { name: /Primary/ }).getAttribute('aria-selected')).toBe('false'));
  expect(screen.queryByTitle('Received message')).toBeNull();
});

it('reads IMAP only after explicit selection and does not repeat reads during router revalidation', async () => {
  const { user, router } = open();
  await screen.findByRole('tab', { name: /Primary/ });
  expect(calls.some(call => call.path.includes('/inbox'))).toBe(false);
  await user.click(screen.getByRole('tab', { name: /Primary/ }));
  await user.click(await screen.findByRole('button', { name: /Received hello/ }));
  await screen.findByTitle('Received message');
  const reads = calls.filter(call => call.path.includes('/inbox'));
  await act(async () => { await router.revalidate(); });
  expect(calls.filter(call => call.path.includes('/inbox'))).toEqual(reads);
  expect(screen.getByTitle('Received message')).toBeTruthy();
});

it('ignores a late message body after the user switches account tabs', async () => {
  const { user } = open();
  await screen.findByRole('tab', { name: /Primary/ });
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error('Missing fetch implementation');
  let finish = () => { };
  vi.mocked(fetch).mockImplementation((input, options) => {
    if (String(input).endsWith('/inbox/7/51')) return new Promise<Response>(resolve => { finish = () => { void original(input, options).then(resolve); }; });
    return original(input, options);
  });
  await user.click(screen.getByRole('tab', { name: /Primary/ }));
  await user.click(await screen.findByRole('button', { name: /Received hello/ }));
  await screen.findByText('Loading message…');
  await user.click(screen.getByRole('tab', { name: /Secondary/ }));
  await act(async () => { finish(); });
  expect(screen.queryByTitle('Received message')).toBeNull();
  expect(screen.getByRole('tab', { name: /Secondary/ }).getAttribute('aria-selected')).toBe('true');
});

it('shows one tab per account and resets pagination when switching tabs', async () => {
  const { user } = open();
  await screen.findByRole('tab', { name: /Primary/ });
  expect(screen.getAllByRole('tab')).toHaveLength(3);
  expect(screen.queryByRole('combobox')).toBeNull();
  await user.click(screen.getByRole('tab', { name: /Primary/ }));
  await screen.findByRole('button', { name: /Received hello/ });
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(await screen.findByRole('button', { name: /Older hello/ }));
  await screen.findByTitle('Received message');
  await user.click(screen.getByRole('tab', { name: /Secondary/ }));
  await screen.findByRole('button', { name: /Received hello/ });
  expect(screen.queryByTitle('Received message')).toBeNull();
  expect(screen.getByText('Page 1')).toBeTruthy();
  expect(screen.getByRole('tabpanel', { name: /Secondary/ })).toBeTruthy();
  expect(calls.filter(call => call.path.includes(`/email-accounts/${secondAccountId}/inbox`))).toEqual([
    { path: `/api/projects/${projectId}/email-accounts/${secondAccountId}/inbox?page=1`, method: 'GET' },
  ]);
});

it('supports manual keyboard activation and shows setup guidance for accounts without incoming mail', async () => {
  const { user } = open();
  await user.click(await screen.findByRole('tab', { name: /Primary/ }));
  await screen.findByRole('button', { name: /Received hello/ });
  const reads = calls.filter(call => call.path.includes('/inbox')).length;
  await user.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Secondary/ }));
  expect(screen.getByRole('tab', { name: /Primary/ }).getAttribute('aria-selected')).toBe('true');
  expect(calls.filter(call => call.path.includes('/inbox'))).toHaveLength(reads);
  await user.keyboard('{Enter}');
  await screen.findByRole('tabpanel', { name: /Secondary/ });
  await screen.findByRole('button', { name: /Received hello/ });
  expect(calls.some(call => call.path.includes(`/email-accounts/${secondAccountId}/inbox`))).toBe(true);
  const beforeDisabled = calls.filter(call => call.path.includes('/inbox')).length;
  await user.click(screen.getByRole('tab', { name: /Outgoing only/ }));
  await screen.findByRole('link', { name: 'mail account settings' });
  expect(screen.getByRole('button', { name: 'Refresh' })).toHaveProperty('disabled', true);
  expect(calls.filter(call => call.path.includes('/inbox'))).toHaveLength(beforeDisabled);
  expect(calls.some(call => call.path.includes(`/email-accounts/${disabledAccountId}/inbox`))).toBe(false);
});

it('shows mail account setup guidance when there are no accounts', async () => {
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error('Missing fetch implementation');
  vi.mocked(fetch).mockImplementation((input, options) => {
    if (String(input).endsWith('/email-accounts')) return Promise.resolve(Response.json([]));
    return original(input, options);
  });
  open();
  await screen.findByRole('link', { name: 'mail account settings' });
  expect(screen.queryAllByRole('tab')).toHaveLength(0);
  expect(calls.some(call => call.path.includes('/inbox'))).toBe(false);
});
