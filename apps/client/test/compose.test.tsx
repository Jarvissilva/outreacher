import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { messageDraftInputSchema, messageSchema } from '@outreachit/shared';
import { routes } from '@/router';
const projectId = '111111111111111111111111', otherId = '222222222222222222222222', id = '333333333333333333333333', accountId = '444444444444444444444444', templateId = '555555555555555555555555';
let saved = messageSchema.parse({ id, projectId, state: 'draft', subject: '', html: '', senderEmail: '', total: 0, excluded: 0, error: '', createdAt: new Date().toISOString() });
const calls: { path: string; method: string; body: unknown }[] = [];
beforeEach(() => {
  calls.length = 0;
  saved = messageSchema.parse({ ...saved, state: 'draft', subject: '', html: '', emailAccountId: null, contactIds: [], addresses: [] });
  vi.stubGlobal('fetch', vi.fn(async (input: string, options?: RequestInit) => {
    const url = new URL(input, 'http://localhost'), method = options?.method ?? 'GET';
    const body: unknown = options?.body ? JSON.parse(String(options.body)) : undefined;
    calls.push({ path: input, method, body });
    if (url.pathname === '/api/projects') return Response.json([{ id: projectId, name: 'Default', isDefault: true, contactCount: 0 }, { id: otherId, name: 'Other', isDefault: false, contactCount: 0 }]);
    if (url.pathname.endsWith('/email-accounts')) return Response.json([{ id: accountId, projectId, name: 'Primary', host: 'smtp.example.com', port: 587, tlsMode: 'starttls', username: '', senderName: 'Sender', senderEmail: 'sender@example.com', replyTo: '', passwordConfigured: false, sendingError: '' }]);
    if (url.pathname.endsWith('/templates')) return Response.json([{ id: templateId, projectId, name: 'Welcome', subject: 'Hi {{firstName}}', html: '<p>Hello {{firstName}}</p>', text: 'Hello' }]);
    if (url.pathname.endsWith('/contacts')) return Response.json({ projectId, items: [], total: 0, page: 1, limit: 100 });
    if (url.pathname.endsWith('/messages/preview')) return Response.json({ projectId, eligible: 1, excluded: 2, recipients: [{ email: 'person@example.com', subject: 'Hi Alex', html: '<p>Hello Alex</p>', text: 'Hello Alex', warnings: [] }] });
    if (url.pathname.endsWith('/submit')) { saved = { ...saved, state: 'active', total: 1, senderEmail: 'sender@example.com' }; return Response.json(saved); }
    if (url.pathname.endsWith('/report')) return Response.json({ projectId, total: 1, counts: { queued: 1 }, items: [] });
    if (url.pathname.endsWith(`/messages/${id}`)) { if (method === 'PUT') saved = { ...saved, ...messageDraftInputSchema.parse(body) }; return Response.json(saved); }
    if (url.pathname.endsWith('/messages')) { if (method === 'POST') { saved = { ...saved, ...messageDraftInputSchema.parse(body) }; return Response.json(saved, { status: 201 }); } return Response.json([saved]); }
    throw new Error(`Unexpected request: ${input}`);
  }));
});
function open(path = `/projects/${projectId}/compose`) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  return { router, user: userEvent.setup() };
}
it('saves and reopens an incomplete draft without requiring an account or template', async () => {
  const { user, router } = open();
  await user.type(await screen.findByLabelText('Subject'), 'Unfinished');
  expect(screen.queryByLabelText('Find contacts')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Contacts' }));
  const picker = await screen.findByRole('dialog', { name: 'Add contacts' });
  expect(within(picker).getByLabelText('Find contacts')).toBeTruthy();
  await user.click(within(picker).getByRole('button', { name: 'Done' }));
  expect(screen.getByLabelText('Subject')).toHaveProperty('value', 'Unfinished');
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${projectId}/compose/${id}`));
  expect(await screen.findByLabelText('Subject')).toHaveProperty('value', 'Unfinished');
  expect(saved.emailAccountId).toBeNull();
  expect(calls.some(c => c.path.endsWith('/submit'))).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Drafts' }));
  expect(await screen.findByText('Unfinished')).toBeTruthy();
});
it('copies a template, previews on the server and sends only after explicit confirmation', async () => {
  const { user } = open();
  await screen.findByRole('option', { name: 'Welcome' });
  await user.selectOptions(screen.getByLabelText('Copy from template'), templateId);
  expect(screen.getByLabelText('Subject')).toHaveProperty('value', 'Hi {{firstName}}');
  await user.selectOptions(screen.getByLabelText('Mail account'), accountId);
  await user.type(screen.getByLabelText('Email addresses'), 'person@example.com');
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  await screen.findByText('person@example.com — Hi Alex');
  expect(screen.getByTitle('Preview for person@example.com').getAttribute('sandbox')).toBe('');
  await user.click(screen.getByRole('button', { name: 'Review and send' }));
  const dialog = await screen.findByRole('dialog', { name: 'Confirm send' });
  expect(within(dialog).getByText(/1 separate emails · 2 excluded/)).toBeTruthy();
  expect(within(dialog).getByText(/sender@example.com/)).toBeTruthy();
  expect(calls.some(c => c.path.endsWith('/submit'))).toBe(false);
  await user.click(within(dialog).getByRole('button', { name: 'Confirm send' }));
  await waitFor(() => expect(calls.find(c => c.path.endsWith('/submit'))?.body).toEqual({ confirmed: true }));
  expect(calls.some(c => c.method === 'POST' && /\/(campaigns|templates)$/.test(c.path))).toBe(false);
  await screen.findByText(/delivery is unconfirmed/);
  await user.click(screen.getByRole('button', { name: 'Send history' }));
  expect(await screen.findByText('Hi {{firstName}}')).toBeTruthy();
});
it('preserves the Compose section and clears the form when switching projects', async () => {
  const { user, router } = open();
  await user.type(await screen.findByLabelText('Subject'), 'Old project content');
  await user.click(screen.getByRole('button', { name: 'Switch project: Default' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Other' }));
  await waitFor(() => expect(router.state.location.pathname).toBe(`/projects/${otherId}/compose`));
  expect(await screen.findByLabelText('Subject')).toHaveProperty('value', '');
});
it('reopens a reply with locked account and recipient and separately displays original context', async () => {
  saved = messageSchema.parse({ ...saved, kind: 'reply', emailAccountId: accountId, addresses: ['reply@example.com'], subject: 'Re: Hello',
    replyContext: { accountId, uidValidity: '1', uid: 9, recipient: 'reply@example.com', messageId: '<original@example.com>', references: [], subject: 'Hello', from: 'Sender', text: 'Original context' },
  });
  const { user } = open(`/projects/${projectId}/compose/${id}`);
  expect(await screen.findByLabelText('Mail account')).toHaveProperty('disabled', true);
  expect(screen.getByLabelText('Email addresses')).toHaveProperty('readOnly', true);
  expect(screen.getByRole('button', { name: 'Contacts' })).toHaveProperty('disabled', true);
  expect(screen.getByLabelText('Copy from template')).toHaveProperty('disabled', true);
  await user.click(screen.getByText('Original message — Hello'));
  expect(screen.getByText('Original context')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(calls.some(c => c.method === 'PUT')).toBe(true));
  expect(saved.kind).toBe('reply');
  expect(saved.replyContext?.recipient).toBe('reply@example.com');
});
