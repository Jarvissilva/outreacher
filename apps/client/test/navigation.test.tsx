import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/router';

const firstId = '111111111111111111111111';
const secondId = '222222222222222222222222';
const createdId = '333333333333333333333333';
const initialProjects = [
  { id: firstId, name: 'Default project', isDefault: true, contactCount: 0 },
  { id: secondId, name: 'Research', isDefault: false, contactCount: 0 },
];
let projects = [...initialProjects];
const calls: { path: string; method: string; body?: string }[] = [];
beforeEach(() => {
  projects = [...initialProjects];
  calls.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, options?: RequestInit) => {
      const method = options?.method ?? 'GET';
      calls.push({
        path: input,
        method,
        body: typeof options?.body === 'string' ? options.body : undefined,
      });
      const url = new URL(input, 'http://localhost');
      if (url.pathname === '/api/projects') {
        if (method === 'POST') {
          const created = {
            id: createdId,
            name: 'New project',
            isDefault: false,
            contactCount: 0,
          };
          projects.push(created);
          return Response.json(created, { status: 201 });
        }
        return Response.json(projects);
      }
      const projectId = url.pathname.split('/')[3];
      if (url.pathname.endsWith('/email-accounts')) return Response.json([]);
      if (url.pathname.endsWith('/sending-settings'))
        return Response.json({ projectId, hourlyLimit: 60, timeZone: 'UTC' });
      if (url.pathname.endsWith('/custom-fields')) return Response.json([]);
      if (url.pathname.endsWith('/overview'))
        return Response.json({
          projectId,
          contacts: 0,
          active: 0,
          suppressed: 0,
        });
      if (url.pathname.endsWith('/contacts'))
        return Response.json({
          projectId,
          items: [],
          total: 0,
          page: 1,
          limit: 20,
        });
      throw new Error(`Unexpected request: ${method} ${input}`);
    }),
  );
});
function open(path = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, client, user: userEvent.setup() };
}

describe('Project navigation', () => {
  it('shows only project selection on Home, then opens the project root with a sidebar', async () => {
    const { user, router } = open();
    await screen.findByRole('heading', { name: 'Select a project' });
    expect(document.querySelector('[data-slot="sidebar"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /Switch project/ })).toBeNull();
    await user.click(screen.getByRole('link', { name: /Research/ }));
    await screen.findByRole('heading', { name: 'Contacts', level: 1 });
    expect(router.state.location.pathname).toBe(`/projects/${secondId}`);
    expect(document.querySelector('[data-slot="sidebar"]')).not.toBeNull();
    expect(
      screen.getByRole('button', { name: 'Switch project: Research' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
    expect(
      within(
        screen.getByRole('navigation', { name: 'Project navigation' }),
      ).queryByRole('link', { name: 'Custom fields' }),
    ).toBeNull();
  });

  it('opens Settings on deep links and preserves the section when switching projects', async () => {
    const { router, user } = open(`/projects/${firstId}/settings`);
    await screen.findByRole('heading', { name: 'Settings', level: 1 });
    expect(screen.getByRole('heading', { name: 'Custom fields' })).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: 'Switch project: Default project' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Research' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(
        `/projects/${secondId}/settings`,
      ),
    );
    expect(screen.getByRole('heading', { name: 'Custom fields' })).toBeTruthy();
    await user.click(screen.getByRole('link', { name: 'OutreachIt home' }));
    await screen.findByRole('heading', { name: 'Select a project' });
    expect(document.querySelector('[data-slot="sidebar"]')).toBeNull();
  });

  it('creates a project inside the sidebar switcher and opens it', async () => {
    const { router, user } = open(`/projects/${firstId}`);
    await user.click(
      await screen.findByRole('button', {
        name: 'Switch project: Default project',
      }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Create new project' }),
    );
    const dialog = await screen.findByRole('dialog', {
      name: 'Create project',
    });
    await user.type(
      within(dialog).getByLabelText('Project name'),
      'New project',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Create project' }),
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe(`/projects/${createdId}`),
    );
    await screen.findByRole('button', { name: 'Switch project: New project' });
    expect(
      calls.filter(
        (call) => call.path === '/api/projects' && call.method === 'POST',
      ),
    ).toHaveLength(1);
  });

  it('clears filters and open dialogs on project switches', async () => {
    const { router, user } = open(`/projects/${firstId}`);
    const search = await screen.findByRole('textbox', {
      name: 'Search contacts',
    });
    await user.type(search, 'old filter');
    await user.click(
      await screen.findByRole('button', { name: 'Add contact' }),
    );
    await screen.findByRole('dialog', { name: 'Add contact' });
    await act(async () => {
      await router.navigate(`/projects/${secondId}`);
    });
    await screen.findByRole('button', { name: 'Switch project: Research' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByRole('textbox', { name: 'Search contacts' }),
    ).toHaveProperty('value', '');
    expect(
      calls.some(
        (call) =>
          call.path.includes(`/projects/${secondId}/contacts?`) &&
          !call.path.includes('old'),
      ),
    ).toBe(true);
  });

  it('keeps a submitted contact save bound to its original project after navigation', async () => {
    const { router, client, user } = open(`/projects/${firstId}`);
    const add = await screen.findByRole('button', { name: 'Add contact' });
    await waitFor(() => expect(add).toHaveProperty('disabled', false));
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    if (!originalFetch) throw new Error('Missing test fetch implementation');
    let finishRequest = () => {};
    vi.mocked(fetch).mockImplementation((input, options) => {
      if (
        String(input) === `/api/projects/${firstId}/contacts` &&
        options?.method === 'POST'
      ) {
        calls.push({ path: String(input), method: 'POST' });
        return new Promise<Response>((resolve) => {
          finishRequest = () => resolve(Response.json({}));
        });
      }
      return originalFetch(input, options);
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await user.click(add);
    const dialog = await screen.findByRole('dialog', { name: 'Add contact' });
    await user.type(
      within(dialog).getByLabelText(/Email address/),
      'test@example.com',
    );
    await user.click(
      within(dialog).getByRole('button', { name: 'Save contact' }),
    );
    await waitFor(() =>
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1),
    );
    await act(async () => {
      await router.navigate(`/projects/${secondId}`);
    });
    await screen.findByRole('button', { name: 'Switch project: Research' });
    await act(async () => {
      finishRequest();
    });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['project', firstId],
      }),
    );
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ['project', secondId],
    });
    expect(
      calls.filter((call) => call.method === 'POST').map((call) => call.path),
    ).toEqual([`/api/projects/${firstId}/contacts`]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it.each([
    ['/contacts', `/projects/${firstId}`],
    ['/fields', `/projects/${firstId}/settings`],
    [`/projects/${secondId}/contacts`, `/projects/${secondId}`],
    [`/projects/${secondId}/fields`, `/projects/${secondId}/settings`],
  ])('redirects the old %s URL to %s', async (from, to) => {
    const { router } = open(from);
    await waitFor(() => expect(router.state.location.pathname).toBe(to));
  });

  it('shows missing projects without a sidebar or project data requests', async () => {
    open('/projects/444444444444444444444444');
    await screen.findByRole('heading', { name: 'Project not found' });
    expect(document.querySelector('[data-slot="sidebar"]')).toBeNull();
    expect(calls.every((call) => call.path === '/api/projects')).toBe(true);
  });
});
