import { Link, useOutletContext, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { campaignSchema } from '@outreachit/shared';
import type { Project } from '@outreachit/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { CampaignDraft } from '@/components/campaigns/CampaignDraft';
import { CampaignReport } from '@/components/campaigns/CampaignReport';
export function CampaignsPage() {
  const project = useOutletContext<Project>();
  const query = useQuery({
    queryKey: ['project', project.id, 'campaigns'],
    queryFn: () =>
      api(`/projects/${project.id}/campaigns`, z.array(campaignSchema)),
    refetchInterval: 5000,
  });
  return (
    <>
      <div className="page-heading">
        <h1>Campaigns</h1>
        <Button asChild>
          <Link to="new">New campaign</Link>
        </Button>
      </div>
      <ErrorMessage error={query.error} />
      {query.isPending && <p>Loading campaigns…</p>}
      {query.data?.length === 0 && <p>Create your first campaign.</p>}
      <div className="grid gap-4">
        {query.data?.map((c) => (
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
  const query = useQuery({
    queryKey: ['project', project.id, 'campaigns', campaignId],
    queryFn: () =>
      api(`/projects/${project.id}/campaigns/${campaignId}`, campaignSchema),
    enabled: Boolean(campaignId),
    refetchInterval: campaignId ? 5000 : false,
  });
  if (campaignId && query.isPending) return <p>Loading campaign…</p>;
  if (query.error) return <ErrorMessage error={query.error} />;
  return query.data && query.data.state !== 'draft' ? (
    <CampaignReport projectId={project.id} campaign={query.data} />
  ) : (
    <CampaignDraft
      key={`${project.id}/${campaignId ?? 'new'}`}
      projectId={project.id}
      campaign={query.data}
    />
  );
}
