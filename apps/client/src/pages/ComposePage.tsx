import { api, mutate } from '@/lib/api';
import { projectPath, routeOperation, usePolling } from '@/lib/route-data';
import type { Project } from '@outreacher/shared';
import { emailAccountSchema, messageDraftInputSchema, messagePreviewSchema, messageReportSchema, messageSchema, templateSchema } from '@outreacher/shared';
import { useState } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { redirect, useLoaderData, useOutletContext, useParams } from 'react-router';
import { z } from 'zod';

import { MessageComposer } from '@/components/messages/MessageComposer';

export function ComposePage() {
  const project = useOutletContext<Project>();
  const [revision, setRevision] = useState(0);
  const { messageId } = useParams();
  const { message } = useLoaderData<typeof loader>();
  usePolling(messageId ? 3000 : 5000);
  return (
    <MessageComposer
      key={`${project.id}/${revision}/${messageId ?? 'new'}/${message?.state === 'draft' ? 'draft' : 'submitted'}`}
      projectId={project.id}
      message={message}
      onNew={() => setRevision(v => v + 1)}
    />
  );
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const base = projectPath(params.projectId);
  const [message, accounts, templates] = await Promise.all([
    params.messageId ? api(`${base}/messages/${params.messageId}`, messageSchema, 'GET', undefined, request.signal) : undefined,
    api(`${base}/email-accounts`, z.array(emailAccountSchema), 'GET', undefined, request.signal),
    api(`${base}/templates`, z.array(templateSchema), 'GET', undefined, request.signal),
  ]);
  return { message, accounts, templates };
}
export function messagesLoader({ params, request }: LoaderFunctionArgs) {
  return api(`${projectPath(params.projectId)}/messages`, z.array(messageSchema), 'GET', undefined, request.signal);
}
export function reportLoader({ params, request }: LoaderFunctionArgs) {
  return api(`${projectPath(params.projectId)}/messages/${params.messageId}/report?${new URL(request.url).searchParams}`, messageReportSchema, 'GET', undefined, request.signal);
}
export async function action({ params, request }: ActionFunctionArgs) {
  return routeOperation(request, async ({ intent, payload }) => {
    const kind = z.enum(['save', 'save-for-send', 'preview', 'submit', 'delete', 'resume', 'cancel', 'retry']).parse(intent);
    const base = `${projectPath(params.projectId)}/messages`;
    const input = z.object({ id: z.string().optional(), input: messageDraftInputSchema.optional() }).parse(payload);
    const id = input.id ?? params.messageId;
    if (kind === 'preview') return api(input.id ? `${base}/${input.id}/preview` : `${base}/preview`, messagePreviewSchema, 'POST', messageDraftInputSchema.parse(input.input), request.signal);
    if (kind === 'save' || kind === 'save-for-send') {
      const saved = await api(`${base}${id ? `/${id}` : ''}`, messageSchema, id ? 'PUT' : 'POST', messageDraftInputSchema.parse(input.input), request.signal);
      if (kind === 'save' && params.messageId !== saved.id) throw redirect(`${projectPath(params.projectId)}/compose/${saved.id}`);
      return saved;
    }
    const messageId = z.string().min(1).parse(id);
    if (kind === 'submit') {
      const submitted = await api(`${base}/${messageId}/submit`, messageSchema, 'POST', { confirmed: true }, request.signal);
      if (params.messageId !== submitted.id) throw redirect(`${projectPath(params.projectId)}/compose/${submitted.id}`);
      return submitted;
    }
    if (kind === 'delete') { await mutate(`${base}/${messageId}`, 'DELETE', undefined, request.signal); throw redirect(`${projectPath(params.projectId)}/compose`); }
    return api(`${base}/${messageId}/${kind === 'retry' ? 'submit' : kind}`, messageSchema, 'POST', kind === 'retry' ? { confirmed: true, retry: true } : undefined, request.signal);
  });
}
