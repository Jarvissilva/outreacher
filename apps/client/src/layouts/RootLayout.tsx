import { api } from '@/lib/api';
import { routeOperation } from '@/lib/route-data';
import { projectInputSchema, projectSchema, projectsSchema, idSchema } from '@outreacher/shared';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Outlet, redirect, useLoaderData, useNavigation } from 'react-router';
import { z } from 'zod';

export function loader({ request }: LoaderFunctionArgs) {
  return api('/projects', projectsSchema, 'GET', undefined, request.signal);
}

export async function action({ request }: ActionFunctionArgs) {
  return routeOperation(request, async ({ intent, payload }) => {
    const kind = z.enum(['create-project', 'rename-project']).parse(intent);
    const input = z.object({ id: idSchema.optional(), name: z.string() }).parse(payload);
    const project = await api(
      `/projects${kind === 'rename-project' ? `/${idSchema.parse(input.id)}` : ''}`,
      projectSchema,
      kind === 'rename-project' ? 'PUT' : 'POST',
      projectInputSchema.parse({ name: input.name }),
      request.signal,
    );
    if (kind === 'create-project') throw redirect(`/projects/${project.id}`);
    return project;
  });
}

export function RootLayout() {
  const projects = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {navigation.state !== 'idle' && (
        <div role="status" className="text-sm">
          {navigation.state === 'submitting' ? 'Saving…' : 'Loading…'}
        </div>
      )}
      <Outlet context={projects} />
    </>
  );
}
