import { Button } from '@/components/ui/button';
import { api, mutate } from '@/lib/api';
import { projectPath, routeOperation } from '@/lib/route-data';
import type { Project } from '@outreacher/shared';
import { contactListSchema, emailAccountSchema, previewSchema, templateInputSchema, templateSchema } from '@outreacher/shared';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Link, redirect, useLoaderData, useOutletContext, useParams } from 'react-router';
import { z } from 'zod';

import { TemplateForm } from '@/components/templates/TemplateForm';
export function TemplatesPage() {
  const templates = useLoaderData<typeof loader>();
  return (
    <>
      <div className="page-heading">
        <h1>Templates</h1>
        <Button asChild>
          <Link to="new">New template</Link>
        </Button>
      </div>
      {templates?.length === 0 && <p>Create your first email template.</p>}
      <div className="grid gap-4">
        {templates?.map((t) => (
          <Link key={t.id} className="rounded border p-4" to={t.id}>
            <h2>{t.name}</h2>
            <p>{t.subject}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
export function TemplateEditorPage() {
  const project = useOutletContext<Project>();
  const { templateId } = useParams();
  const { template } = useLoaderData<typeof editorLoader>();
  return (
    <TemplateForm
      key={`${project.id}/${templateId ?? 'new'}`}
      projectId={project.id}
      template={template}
    />
  );
}

export function loader({ params, request }: LoaderFunctionArgs) {
  return api(`${projectPath(params.projectId)}/templates`, z.array(templateSchema), 'GET', undefined, request.signal);
}
export async function editorLoader({ params, request }: LoaderFunctionArgs) {
  const base = projectPath(params.projectId);
  const [template, accounts, contacts] = await Promise.all([
    params.templateId ? api(`${base}/templates/${params.templateId}`, templateSchema, 'GET', undefined, request.signal) : undefined,
    api(`${base}/email-accounts`, z.array(emailAccountSchema), 'GET', undefined, request.signal),
    api(`${base}/contacts?limit=100`, contactListSchema, 'GET', undefined, request.signal),
  ]);
  return { template, accounts, contacts };
}
export async function action({ params, request }: ActionFunctionArgs) {
  return routeOperation(request, async ({ intent, payload }) => {
    const kind = z.enum(['save', 'preview', 'test', 'delete']).parse(intent);
    const base = projectPath(params.projectId);
    if (kind === 'save') {
      const template = await api(`${base}/templates${params.templateId ? `/${params.templateId}` : ''}`, templateSchema, params.templateId ? 'PUT' : 'POST', templateInputSchema.parse(payload), request.signal);
      if (params.templateId !== template.id) throw redirect(`${base}/templates/${template.id}`);
      return template;
    }
    if (kind === 'preview') return api(`${base}/templates/preview`, previewSchema, 'POST', payload, request.signal);
    if (kind === 'test') {
      const input = z.object({ emailAccountId: z.string().min(1), recipient: z.email(), contactId: z.string().min(1) }).parse(payload);
      return api(`${base}/email-accounts/${input.emailAccountId}/test`, z.object({ ok: z.boolean() }), 'POST', { recipient: input.recipient, contactId: input.contactId, templateId: z.string().min(1).parse(params.templateId) }, request.signal);
    }
    await mutate(`${base}/templates/${z.string().min(1).parse(params.templateId)}`, 'DELETE', undefined, request.signal);
    throw redirect(`${base}/templates`);
  });
}
