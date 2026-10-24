import { routes } from '@/router';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(

    <RouterProvider router={router} />
    ,
  );
  return { router, user: userEvent.setup() };
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
    await screen.findByRole('button', { name: 'Switch project: Research' });
    await user.click(screen.getByRole('link', { name: 'Outreacher home' }));
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
    const { router, user } = open(`/projects/${firstId}`);
    const add = await screen.findByRole('button', { name: 'Add contact' });
    await waitFor(() => expect(add).toHaveProperty('disabled', false));
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    if (!originalFetch) throw new Error('Missing test fetch implementation');
    let finishRequest = () => { };
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

  it('shows missing projects without a sidebar', async () => {
    open('/projects/444444444444444444444444');
    await screen.findByRole('heading', { name: 'Project not found' });
    expect(document.querySelector('[data-slot="sidebar"]')).toBeNull();
    expect(calls.every((call) => call.method === 'GET')).toBe(true);
  });
});

it('restores contacts filters and pagination from the URL and resets the page when filtering', async () => {
  const { router, user } = open(`/projects/${firstId}?search=Alex&status=suppressed&page=2`);
  expect(await screen.findByLabelText('Search contacts')).toHaveProperty('value', 'Alex');
  expect(screen.getByLabelText('Filter by outreach status')).toHaveProperty('value', 'suppressed');
  await user.selectOptions(screen.getByLabelText('Filter by outreach status'), 'active');
  await waitFor(() => {
    const params = new URLSearchParams(router.state.location.search);
    expect(params.get('status')).toBe('active');
    expect(params.get('page')).toBe('1');
    expect(params.get('search')).toBe('Alex');
  });
  await user.clear(screen.getByLabelText('Search contacts'));
  await user.type(screen.getByLabelText('Search contacts'), 'new search');
  await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('search')).toBe('new search'));
});

it('keeps contact validation errors inline without revalidating or closing the editor', async () => {
  const { user } = open(`/projects/${firstId}`);
  await user.click(await screen.findByRole('button', { name: 'Add contact' }));
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error('Missing fetch implementation');
  let reads = 0;
  vi.mocked(fetch).mockImplementation((input, options) => {
    if (options?.method === 'POST') return Promise.resolve(Response.json({ error: { message: 'Email is reserved.' } }, { status: 409 }));
    reads++;
    return original(input, options);
  });
  const dialog = screen.getByRole('dialog', { name: 'Add contact' });
  await user.type(within(dialog).getByLabelText(/Email address/), 'reserved@example.com');
  await user.click(within(dialog).getByRole('button', { name: 'Save contact' }));
  expect(await within(dialog).findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Email is reserved.'));
  expect(within(dialog).getByLabelText(/Email address/)).toHaveProperty('value', 'reserved@example.com');
  expect(reads).toBe(0);
});

it('revalidates project names after an inline rename', async () => {
  const { user } = open(`/projects/${firstId}/settings`);
  await user.click(await screen.findByRole('button', { name: 'Rename project' }));
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error('Missing fetch implementation');
  vi.mocked(fetch).mockImplementation((input, options) => {
    if (String(input) === `/api/projects/${firstId}` && options?.method === 'PUT') {
      projects = projects.map(project => project.id === firstId ? { ...project, name: 'Renamed' } : project);
      return Promise.resolve(Response.json(projects[0]));
    }
    return original(input, options);
  });
  const dialog = screen.getByRole('dialog', { name: 'Rename project' });
  await user.clear(within(dialog).getByLabelText('Project name'));
  await user.type(within(dialog).getByLabelText('Project name'), 'Renamed');
  await user.click(within(dialog).getByRole('button', { name: 'Save project' }));
  await screen.findByRole('button', { name: 'Switch project: Renamed' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByText('Renamed', { selector: 'p' })).toBeTruthy();
});

it('runs CSV stages through route actions and refreshes contact counts after import', async () => {
  const { user } = open(`/projects/${firstId}`);
  await user.click(await screen.findByRole('button', { name: 'Import CSV' }));
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error('Missing fetch implementation');
  let imported = false;
  const stages: string[] = [];
  vi.mocked(fetch).mockImplementation((input, options) => {
    const path = String(input);
    if (options?.method === 'POST') {
      stages.push(path.split('/').pop() ?? '');
      if (path.endsWith('/headers')) return Promise.resolve(Response.json({ projectId: firstId, headers: ['email'] }));
      if (path.endsWith('/preview')) return Promise.resolve(Response.json({ projectId: firstId, total: 1, ready: 1, duplicates: 0, invalid: 0, rows: [{ row: 2, email: 'person@example.com', status: 'ready', issues: [] }] }));
      if (path.endsWith('/import')) {
        imported = true;
        projects = projects.map(project => project.id === firstId ? { ...project, contactCount: 1 } : project);
        return Promise.resolve(Response.json({ projectId: firstId, imported: 1, duplicates: 0, invalid: 0 }));
      }
    }
    if (imported && path.endsWith('/overview')) return Promise.resolve(Response.json({ projectId: firstId, contacts: 1, active: 1, suppressed: 0 }));
    return original(input, options);
  });
  const file = new File(['email\nperson@example.com'], 'contacts.csv', { type: 'text/csv' });
  Object.defineProperty(file, 'text', { value: async () => 'email\nperson@example.com' });
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('Missing upload input');
  await user.upload(input, file);
  await user.click(await screen.findByRole('button', { name: 'Preview import' }));
  await user.click(await screen.findByRole('button', { name: 'Import 1 contacts' }));
  await screen.findByText('Import complete');
  expect(stages).toEqual(['headers', 'preview', 'import']);
  await user.click(screen.getByRole('button', { name: 'Done' }));
  expect(document.querySelector('.stat-card strong')).toHaveProperty('textContent', '1');
  await user.click(screen.getByRole('link', { name: 'Outreacher home' }));
  await screen.findByText('1 contact');
});

it('aborts superseded contacts loaders and ignores late results', async () => {
  const { router } = open(`/projects/${firstId}`);
  await screen.findByRole('heading', { name: 'Contacts', level: 1 });
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error('Missing fetch implementation');
  let finish = () => { };
  let signal: AbortSignal | null | undefined;
  vi.mocked(fetch).mockImplementation((input, options) => {
    if (String(input).includes('/contacts?search=old')) {
      signal = options?.signal;
      return new Promise<Response>(resolve => { finish = () => resolve(Response.json({ projectId: firstId, items: [], total: 999, page: 1, limit: 20 })); });
    }
    return original(input, options);
  });
  let oldNavigation: Promise<void> | undefined;
  await act(async () => { oldNavigation = router.navigate(`/projects/${firstId}?search=old`); });
  await waitFor(() => expect(signal).toBeTruthy());
  await act(async () => { await router.navigate(`/projects/${firstId}?search=new`); });
  expect(signal?.aborted).toBe(true);
  await act(async () => { finish(); await oldNavigation; });
  expect(screen.getByLabelText('Search contacts')).toHaveProperty('value', 'new');
  expect(screen.queryByText('999')).toBeNull();
});

it('keeps typing responsive while filtered contacts are still loading', async () => {
  const { user, router } = open(`/projects/${firstId}`);
  await screen.findByLabelText('Search contacts');
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error('Missing fetch implementation');
  const pending: { resolve(response: Response): void; signal?: AbortSignal | null }[] = [];
  vi.mocked(fetch).mockImplementation((input, options) => {
    if (String(input).includes('/contacts?search=')) return new Promise<Response>(resolve => { pending.push({ resolve, signal: options?.signal }); });
    return original(input, options);
  });
  await user.type(screen.getByLabelText('Search contacts'), 'slow search');
  expect(screen.getByLabelText('Search contacts')).toHaveProperty('value', 'slow search');
  expect(router.state.navigation.location?.search).toContain('slow+search');
  expect(pending.slice(0, -1).every(request => request.signal?.aborted)).toBe(true);
  await act(async () => {
    for (const request of pending) request.resolve(Response.json({ projectId: firstId, items: [], total: 0, page: 1, limit: 20 }));
  });
  await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('search')).toBe('slow search'));
});

it('recovers an unavailable initial page through the route error boundary', async () => {
  const original = vi.mocked(fetch).getMockImplementation();
  if (!original) throw new Error('Missing fetch implementation');
  let unavailable = true;
  vi.mocked(fetch).mockImplementation((input, options) => {
    if (unavailable) return Promise.resolve(Response.json({ error: { message: 'Database unavailable.' } }, { status: 503 }));
    return original(input, options);
  });
  const { user } = open('/');
  await screen.findByRole('heading', { name: 'Could not open this page' });
  expect(screen.getByRole('alert').textContent).toContain('Database unavailable.');
  unavailable = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('heading', { name: 'Select a project' });
});
