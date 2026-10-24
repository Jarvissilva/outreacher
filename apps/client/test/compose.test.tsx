import { routes } from '@/router';
import { messageDraftInputSchema, messageSchema } from '@outreacher/shared';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
const projectId = '111111111111111111111111', otherId = '222222222222222222222222', id = '333333333333333333333333', accountId = '444444444444444444444444', templateId = '555555555555555555555555';
let saved = messageSchema.parse({ id, projectId, state: 'draft', subject: '', html: '', senderEmail: '', total: 0, excluded: 0, error: '', createdAt: new Date().toISOString() });
const calls: { path: string; method: string; body: unknown }[] = [];
beforeEach(() => {
  calls.length = 0;
  saved = messageSchema.parse({ ...saved, state: 'draft', kind: 'compose', replyContext: null, subject: '', html: '', emailAccountId: null, contactIds: [], addresses: [] });
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
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
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
  await screen.findByRole('button', { name: 'Delete draft' });
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
  await waitFor(() => expect(screen.getByLabelText('Subject')).toHaveProperty('value', ''));
});
it('reopens a reply with locked account and recipient and separately displays original context', async () => {
  saved = messageSchema.parse({
    ...saved, kind: 'reply', emailAccountId: accountId, addresses: ['reply@example.com'], subject: 'Re: Hello',
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

it('preserves unsaved editor content while draft loaders poll', async () => {
  const { user, router } = open(`/projects/${projectId}/compose/${id}`);
  await user.type(await screen.findByLabelText('Subject'), 'Unsaved subject');
  const editor = screen.getByRole('textbox', { name: 'Email body' });
  await act(async () => { editor.innerHTML = '<p>Unsaved body</p>'; });
  const before = calls.filter(call => call.path.endsWith(`/messages/${id}`) && call.method === 'GET').length;
  await waitFor(() => expect(calls.filter(call => call.path.endsWith(`/messages/${id}`) && call.method === 'GET')).toHaveLength(before + 1), { timeout: 4500 });
  expect(screen.getByLabelText('Subject')).toHaveProperty('value', 'Unsaved subject');
  expect(screen.getByRole('textbox', { name: 'Email body' }).textContent).toContain('Unsaved body');
  expect(calls.some(call => call.method === 'POST' || call.method === 'PUT')).toBe(false);
  router.dispose();
});

it('waits for a draft save before submitting and reuses its ID after an explicit failed-send retry', async () => {
  const { user } = open();
  await screen.findByRole('option', { name: /Primary/ });
  await user.selectOptions(screen.getByLabelText('Mail account'), accountId);
  await user.type(screen.getByLabelText('Email addresses'), 'person@example.com');
  await user.click(screen.getByRole('button', { name: 'Review and send' }));
  const dialog = await screen.findByRole('dialog', { name: 'Confirm send' });
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error('Missing fetch implementation');
  let submissions = 0;
  vi.mocked(fetch).mockImplementation((input, options) => {
    if (String(input).endsWith('/submit')) {
      submissions++;
      if (submissions === 1) return Promise.resolve(Response.json({ error: { message: 'Submission unavailable.' } }, { status: 503 }));
    }
    return original(input, options);
  });
  await user.click(within(dialog).getByRole('button', { name: 'Confirm send' }));
  await screen.findByText('Submission unavailable.');
  expect(submissions).toBe(1);
  await user.click(within(dialog).getByRole('button', { name: 'Confirm send' }));
  await screen.findByText(/delivery is unconfirmed/);
  expect(submissions).toBe(2);
  expect(calls.filter(call => call.path.endsWith('/messages') && call.method === 'POST')).toHaveLength(1);
  expect(calls.filter(call => call.path.endsWith(`/messages/${id}`) && call.method === 'PUT')).toHaveLength(1);
});

it('uses the compose preview endpoint when reopening a regular saved draft', async () => {
  const { user } = open(`/projects/${projectId}/compose/${id}`);
  await user.click(await screen.findByRole('button', { name: 'Preview' }));
  await screen.findByText('person@example.com — Hi Alex');
  expect(calls.filter(call => call.method === 'POST').map(call => call.path)).toEqual([`/api/projects/${projectId}/messages/preview`]);
});

it('uses the source-bound reply preview endpoint for a saved reply', async () => {
  saved = messageSchema.parse({ ...saved, kind: 'reply', emailAccountId: accountId, addresses: ['reply@example.com'], subject: 'Re: Hello',
    replyContext: { accountId, uidValidity: '1', uid: 9, recipient: 'reply@example.com', messageId: '<original@example.com>', references: [], subject: 'Hello', from: 'Sender', text: 'Original context' },
  });
  const { user } = open(`/projects/${projectId}/compose/${id}`);
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error('Missing fetch implementation');
  let previewPath = '';
  vi.mocked(fetch).mockImplementation((input, options) => {
    if (String(input).endsWith(`/messages/${id}/preview`)) {
      previewPath = String(input);
      return Promise.resolve(Response.json({ projectId, eligible: 1, excluded: 0, recipients: [{ email: 'reply@example.com', subject: 'Re: Hello', html: '<p>Literal reply</p>', text: 'Literal reply', warnings: [] }] }));
    }
    return original(input, options);
  });
  await user.click(await screen.findByRole('button', { name: 'Preview' }));
  await screen.findByText('reply@example.com — Re: Hello');
  expect(previewPath).toBe(`/api/projects/${projectId}/messages/${id}/preview`);
});

it('uses email chips with bulk paste, duplicate removal and keyboard editing', async () => {
  const { user } = open();
  const input = await screen.findByLabelText('Email addresses');
  expect(input).toBeInstanceOf(HTMLInputElement);
  expect(document.querySelector('textarea')).toBeNull();
  await user.type(input, 'one@example.com{Enter}');
  await screen.findByRole('button', { name: 'Remove one@example.com' });
  await user.paste('two@example.com; ONE@example.com\nthree@example.com');
  expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(3);
  expect(input).toHaveProperty('value', '');
  await user.click(screen.getByRole('button', { name: 'Remove two@example.com' }));
  await user.click(input);
  await user.keyboard('{Backspace}');
  expect(input).toHaveProperty('value', 'three@example.com');
  expect(screen.queryByRole('button', { name: 'Remove three@example.com' })).toBeNull();
  await user.clear(input);
  await user.type(input, 'edited@example.com{Tab}');
  await screen.findByRole('button', { name: 'Remove edited@example.com' });
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(saved.addresses).toEqual(['one@example.com', 'edited@example.com']));
  expect(calls.some(call => call.path.endsWith('/submit'))).toBe(false);
});

it('includes an uncommitted address when saving an incomplete draft', async () => {
  const { user } = open();
  await user.type(await screen.findByLabelText('Email addresses'), 'unfinished@example.com');
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(saved.addresses).toEqual(['unfinished@example.com']));
  await screen.findByRole('button', { name: 'Remove unfinished@example.com' });
  expect(saved.emailAccountId).toBeNull();
});

it('highlights invalid addresses while allowing an incomplete draft to be saved', async () => {
  const { user } = open();
  await user.type(await screen.findByLabelText('Email addresses'), 'unfinished{Enter}');
  await screen.findByText('Check the highlighted email addresses before sending.');
  expect(screen.getByText('Invalid email address:')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(saved.addresses).toEqual(['unfinished']));
  expect(calls.some(call => call.path.endsWith('/submit'))).toBe(false);
});

it('combines typed recipients and selected project contacts without losing either', async () => {
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error('Missing fetch implementation');
  const contactId = '666666666666666666666666';
  vi.mocked(fetch).mockImplementation((input, options) => {
    if (new URL(String(input), 'http://localhost').pathname.endsWith('/contacts')) {
      return Promise.resolve(Response.json({ projectId, items: [{ id: contactId, projectId, email: 'contact@example.com', createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' }], total: 1, page: 1, limit: 100 }));
    }
    return original(input, options);
  });
  const { user } = open();
  await user.type(await screen.findByLabelText('Email addresses'), 'typed@example.com{Enter}');
  await user.click(screen.getByRole('button', { name: 'Contacts' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add contacts' });
  await user.click(await within(dialog).findByRole('checkbox', { name: 'contact@example.com' }));
  await user.click(within(dialog).getByRole('button', { name: 'Done (1)' }));
  expect(screen.getByRole('button', { name: /Contacts.*1/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Remove typed@example.com' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => {
    expect(saved.contactIds).toEqual([contactId]);
    expect(saved.addresses).toEqual(['typed@example.com']);
  });
});

it('clears an old personalized preview when recipients change', async () => {
  const { user } = open();
  await user.type(await screen.findByLabelText('Email addresses'), 'person@example.com{Enter}');
  await user.click(screen.getByRole('button', { name: 'Preview' }));
  await screen.findByText('person@example.com — Hi Alex');
  await user.click(screen.getByRole('button', { name: 'Remove person@example.com' }));
  expect(screen.queryByText('person@example.com — Hi Alex')).toBeNull();
  expect(screen.queryByRole('dialog', { name: 'Confirm send' })).toBeNull();
});
