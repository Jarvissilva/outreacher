import { ProjectDialog } from '@/components/projects/ProjectDialog';
import { CustomFieldsSettings } from '@/components/settings/CustomFieldsSettings';
import { EmailSettings } from '@/components/settings/EmailSettings';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api, mutate } from '@/lib/api';
import { projectPath, routeOperation } from '@/lib/route-data';
import type { Project } from '@outreacher/shared';
import { emailAccountInputSchema, emailAccountSchema, fieldInputSchema, fieldsSchema, incomingInputSchema, sendingSettingsInputSchema, sendingSettingsSchema } from '@outreacher/shared';
import { useState } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { useOutletContext } from 'react-router';
import { z } from 'zod';

export function SettingsPage() {
  const project = useOutletContext<Project>();
  const [renaming, setRenaming] = useState(false);
  return (
    <>
      <div className="page-heading">
        <h1>Settings</h1>
      </div>
      <Card className="mb-8">
        <CardContent className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm">Project name</h2>
            <p className="mt-1 break-words text-sm">{project.name}</p>
          </div>
          <Button variant="outline" onClick={() => setRenaming(true)}>
            Rename project
          </Button>
        </CardContent>
      </Card>
      <EmailSettings projectId={project.id} />
      <section id="custom-fields" aria-labelledby="custom-fields-heading">
        <CustomFieldsSettings projectId={project.id} />
      </section>
      {renaming && (
        <ProjectDialog project={project} onClose={() => setRenaming(false)} />
      )}
    </>
  );
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const base = projectPath(params.projectId);
  const [fields, accounts, settings] = await Promise.all([
    api(`${base}/custom-fields`, fieldsSchema, 'GET', undefined, request.signal),
    api(`${base}/email-accounts`, z.array(emailAccountSchema), 'GET', undefined, request.signal),
    api(`${base}/sending-settings`, sendingSettingsSchema, 'GET', undefined, request.signal),
  ]);
  return { fields, accounts, settings };
}
export async function action({ params, request }: ActionFunctionArgs) {
  return routeOperation(request, async ({ intent, payload }) => {
    const kind = z.enum(['save-field', 'delete-field', 'save-account', 'delete-account', 'verify-account', 'test-account', 'save-sending', 'save-incoming', 'verify-incoming']).parse(intent);
    const base = projectPath(params.projectId);
    if (kind === 'save-sending') return api(`${base}/sending-settings`, sendingSettingsSchema, 'PUT', sendingSettingsInputSchema.parse(payload), request.signal);
    const { id, input } = z.object({ id: z.string().optional(), input: z.unknown() }).parse(payload);
    if (kind === 'save-field') return mutate(`${base}/custom-fields${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', fieldInputSchema.parse(input), request.signal);
    if (kind === 'delete-field') return mutate(`${base}/custom-fields/${z.string().min(1).parse(id)}`, 'DELETE', undefined, request.signal);
    if (kind === 'save-account') return api(`${base}/email-accounts${id ? `/${id}` : ''}`, emailAccountSchema, id ? 'PUT' : 'POST', emailAccountInputSchema.parse(input), request.signal);
    const account = `${base}/email-accounts/${z.string().min(1).parse(id)}`;
    if (kind === 'delete-account') return mutate(account, 'DELETE', undefined, request.signal);
    if (kind === 'save-incoming') return api(`${account}/incoming`, emailAccountSchema, 'PUT', incomingInputSchema.parse(input), request.signal);
    const path = kind === 'verify-incoming' ? `${account}/incoming/verify` : `${account}/${kind === 'test-account' ? 'test' : 'verify'}`;
    return api(path, z.object({ ok: z.boolean() }), 'POST', kind === 'test-account' ? z.object({ recipient: z.email() }).parse(input) : {}, request.signal);
  });
}
