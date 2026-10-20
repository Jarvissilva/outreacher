import { Link, useOutletContext, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { templateSchema } from '@outreachit/shared';
import type { Project } from '@outreachit/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { TemplateForm } from '@/components/templates/TemplateForm';
export function TemplatesPage() {
  const project = useOutletContext<Project>();
  const query = useQuery({
    queryKey: ['project', project.id, 'templates'],
    queryFn: () =>
      api(`/projects/${project.id}/templates`, z.array(templateSchema)),
  });
  return (
    <>
      <div className="page-heading">
        <h1>Templates</h1>
        <Button asChild>
          <Link to="new">New template</Link>
        </Button>
      </div>
      <ErrorMessage error={query.error} />
      {query.isPending && <p>Loading templates…</p>}
      {query.data?.length === 0 && <p>Create your first email template.</p>}
      <div className="grid gap-4">
        {query.data?.map((t) => (
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
  const query = useQuery({
    queryKey: ['project', project.id, 'templates', templateId],
    queryFn: () =>
      api(`/projects/${project.id}/templates/${templateId}`, templateSchema),
    enabled: Boolean(templateId),
  });
  if (templateId && query.isPending) return <p>Loading template…</p>;
  if (query.error) return <ErrorMessage error={query.error} />;
  return (
    <TemplateForm
      key={`${project.id}/${templateId ?? 'new'}`}
      projectId={project.id}
      template={query.data}
    />
  );
}
