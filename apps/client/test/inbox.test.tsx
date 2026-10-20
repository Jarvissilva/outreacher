import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { messageSchema } from '@outreachit/shared';
import { routes } from '@/router';
const projectId = '111111111111111111111111', otherId = '222222222222222222222222', accountId = '333333333333333333333333', messageId = '444444444444444444444444';
const calls: { path: string; method: string }[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (path: string, options?: RequestInit) => {
    const url = new URL(path, 'http://localhost');
    calls.push({ path, method: options?.method ?? 'GET' });
    if (url.pathname === '/api/projects') return Response.json([{ id: projectId, name: 'Default', isDefault: true, contactCount: 0 }, { id: otherId, name: 'Other', isDefault: false, contactCount: 0 }]);
    if (url.pathname.endsWith('/email-accounts')) return Response.json([{ id: accountId, projectId, name: 'Primary', host: 'smtp.example.com', port: 587, tlsMode: 'starttls', username: '', senderName: '', senderEmail: 'sender@example.com', replyTo: '', passwordConfigured: true, sendingError: '', incoming: { enabled: true, host: 'imap.example.com', port: 993, tlsMode: 'tls', useSmtpCredentials: true, username: '', passwordConfigured: false } }]);
    const header = { accountId, uidValidity: '7', uid: 51, from: 'Sender', subject: 'Received hello', date: null, unread: true };
    if (url.pathname.endsWith('/inbox')) return Response.json({ accountId, uidValidity: '7', total: 51, page: Number(url.searchParams.get('page')), items: [{ ...header, subject: url.searchParams.get('page') === '2' ? 'Older hello' : header.subject }] });
    if (url.pathname.endsWith('/inbox/7/51')) return Response.json({ ...header, html: '<p>Hello</p>', text: 'Hello', recipient: 'reply@example.com', messageId: '<original@example.com>', references: [] });
    if (url.pathname.endsWith('/inbox/reply')) return Response.json(messageSchema.parse({ id: messageId, projectId, state: 'draft', senderEmail: '', total: 0, excluded: 0, error: '', createdAt: new Date().toISOString() }));
    if (url.pathname.includes('/messages/') || /\/(messages|templates|contacts)$/.test(url.pathname)) return new Promise<Response>(() => {});
    throw new Error(`Unexpected request ${path}`);
  }));
});
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [`/projects/${projectId}/inbox`] });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { user: userEvent.setup(), router };
}
it('reads in a sandbox without changing read status, paginates and refreshes', async () => {
  const { user } = open();
  await screen.findByRole('option', { name: /Primary/ });
  await user.selectOptions(screen.getByLabelText('Inbox account'), accountId);
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
  await screen.findByRole('option', { name: /Primary/ });
  await user.selectOptions(screen.getByLabelText('Inbox account'), accountId);
  await user.click(await screen.findByRole('button', { name: /Received hello/ }));
  await user.click(await screen.findByRole('button', { name: 'Reply' }));
  await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${projectId}/compose/${messageId}`));
  expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
});
it('preserves Inbox and clears account and message when switching projects', async () => {
  const { user, router } = open();
  await screen.findByRole('option', { name: /Primary/ });
  await user.selectOptions(screen.getByLabelText('Inbox account'), accountId);
  await user.click(await screen.findByRole('button', { name: /Received hello/ }));
  await screen.findByTitle('Received message');
  await user.click(screen.getByRole('button', { name: 'Switch project: Default' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Other' }));
  await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${otherId}/inbox`));
  expect(await screen.findByLabelText('Inbox account')).toHaveProperty('value', '');
  expect(screen.queryByTitle('Received message')).toBeNull();
});
