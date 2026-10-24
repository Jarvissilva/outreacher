import { Button } from '@/components/ui/button';
import { api, mutate } from '@/lib/api';
import { projectPath, routeOperation, usePolling } from '@/lib/route-data';
import type { Project } from '@outreacher/shared';
import { audiencePreviewSchema, campaignInputSchema, campaignSchema, emailAccountSchema, fieldsSchema, previewSchema, reportSchema, sendingSettingsSchema, templateSchema } from '@outreacher/shared';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Link, redirect, useLoaderData, useOutletContext, useParams } from 'react-router';
import { z } from 'zod';

import { CampaignDraft } from '@/components/campaigns/CampaignDraft';
import { CampaignReport } from '@/components/campaigns/CampaignReport';
export function CampaignsPage() {
  const campaigns = useLoaderData<typeof loader>();
  usePolling(5000);
  return (
    <>
      <div className="page-heading">
        <h1>Campaigns</h1>
        <Button asChild>
          <Link to="new">New campaign</Link>
        </Button>
      </div>
      {campaigns?.length === 0 && <p>Create your first campaign.</p>}
      <div className="grid gap-4">
        {campaigns?.map((c) => (
          <Link key={c.id} className="rounded border p-4" to={c.id}>
            <h2>{c.name}</h2>
            <p>
              {c.state.replaceAll('_', ' ')} · {c.total} recipients
            </p>
            {c.error && <p>{c.error}</p>}
          </Link>
        ))}
      </div>
    </>
  );
}
export function CampaignEditorPage() {
  const project = useOutletContext<Project>();
  const { campaignId } = useParams();
  const { campaign } = useLoaderData<typeof editorLoader>();
  usePolling(5000, Boolean(campaignId));
  return campaign && campaign.state !== 'draft' ? (
    <CampaignReport key={`${project.id}/${campaignId}`} projectId={project.id} campaign={campaign} />
  ) : (
    <CampaignDraft
      key={`${project.id}/${campaignId ?? 'new'}`}
      projectId={project.id}
      campaign={campaign}
    />
  );
}

export function loader({ params, request }: LoaderFunctionArgs) {
  return api(`${projectPath(params.projectId)}/campaigns`, z.array(campaignSchema), 'GET', undefined, request.signal);
}
export async function editorLoader({ params, request }: LoaderFunctionArgs) {
  const base = projectPath(params.projectId);
  const [campaign, templates, accounts, settings, fields] = await Promise.all([
    params.campaignId ? api(`${base}/campaigns/${params.campaignId}`, campaignSchema, 'GET', undefined, request.signal) : undefined,
    api(`${base}/templates`, z.array(templateSchema), 'GET', undefined, request.signal),
    api(`${base}/email-accounts`, z.array(emailAccountSchema), 'GET', undefined, request.signal),
    api(`${base}/sending-settings`, sendingSettingsSchema, 'GET', undefined, request.signal),
    api(`${base}/custom-fields`, fieldsSchema, 'GET', undefined, request.signal),
  ]);
  return { campaign, templates, accounts, settings, fields };
}
export function reportLoader({ params, request }: LoaderFunctionArgs) {
  return api(`${projectPath(params.projectId)}/campaigns/${params.campaignId}/report?${new URL(request.url).searchParams}`, reportSchema, 'GET', undefined, request.signal);
}
export async function action({ params, request }: ActionFunctionArgs) {
  return routeOperation(request, async ({ intent, payload }) => {
    const kind = z.enum(['save', 'review', 'preview', 'delete', 'launch', 'pause', 'resume', 'cancel', 'draft', 'retry']).parse(intent);
    const base = `${projectPath(params.projectId)}/campaigns`;
    if (kind === 'preview') return api(`${projectPath(params.projectId)}/templates/preview`, previewSchema, 'POST', payload, request.signal);
    if (kind === 'save' || kind === 'review') {
      const input = z.object({ id: z.string().optional(), input: campaignInputSchema }).parse(payload);
      const campaign = await api(`${base}${input.id ? `/${input.id}` : ''}`, campaignSchema, input.id ? 'PUT' : 'POST', input.input, request.signal);
      if (kind === 'save') { if (params.campaignId !== campaign.id) throw redirect(`${base}/${campaign.id}`); return campaign; }
      const audience = await api(`${base}/audience-preview`, audiencePreviewSchema, 'POST', { audience: campaign.audience, templateId: campaign.templateId, message: campaign.message }, request.signal);
      return { campaign, audience };
    }
    const { id } = z.object({ id: z.string().min(1) }).parse(payload);
    if (kind === 'delete') { await mutate(`${base}/${id}`, 'DELETE', undefined, request.signal); throw redirect(base); }
    const campaign = await api(`${base}/${id}/${kind === 'retry' ? 'launch' : kind}`, campaignSchema, 'POST', kind === 'launch' || kind === 'retry' ? { confirmed: true, ...(kind === 'retry' ? { retry: true } : {}) } : {}, request.signal);
    if (kind === 'launch' && params.campaignId !== campaign.id) throw redirect(`${base}/${campaign.id}`);
    return campaign;
  });
}
