import { useRouteAction } from '@/lib/route-data';
import type { reportLoader } from '@/pages/CampaignsPage';
import type { Campaign } from '@outreacher/shared';
import {
  campaignSchema,
  recipientStates,
} from '@outreacher/shared';
import { useEffect, useState } from 'react';
import { Link, useFetcher } from 'react-router';

import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Button } from '@/components/ui/button';
export function CampaignReport({
  projectId,
  campaign,
}: {
  projectId: string;
  campaign: Campaign;
}) {
  const operation = useRouteAction();
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const query = useFetcher<typeof reportLoader>();
  const { load } = query;
  useEffect(() => { void load(`/projects/${projectId}/resources/campaigns/${campaign.id}/report?page=${page}${state ? `&state=${state}` : ''}`); }, [load, projectId, campaign.id, page, state]);
  async function action(action: string) {
    setError(undefined);
    setBusy(true);
    try {
      await operation.submit(action, { id: campaign.id }, campaignSchema);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>{campaign.name}</h1>
        <Link to={`/projects/${projectId}/campaigns`}>All campaigns</Link>
      </div>
      <p>Status: {campaign.state.replaceAll('_', ' ')}</p>
      <p>Sending from: {campaign.senderEmail || 'No sender snapshot'}</p>
      {campaign.scheduledAt && (
        <p>
          Scheduled: {new Date(campaign.scheduledAt).toLocaleString()} · Sending
          window: {campaign.timeZone}
        </p>
      )}
      <p>{campaign.error}</p>
      <div className="my-4 flex flex-wrap gap-2">
        {(campaign.state === 'active'
          ? ['pause', 'cancel']
          : campaign.state === 'paused'
            ? ['resume', 'cancel']
            : campaign.state === 'scheduled'
              ? ['draft', 'cancel']
              : campaign.state === 'preparation_failed'
                ? ['retry', 'draft']
                : []
        ).map((a) => (
          <Button
            disabled={busy}
            variant="outline"
            key={a}
            onClick={() => {
              if (
                a !== 'cancel' ||
                window.confirm('Cancel remaining campaign submissions?')
              )
                void action(a);
            }}
          >
            {a === 'draft'
              ? 'Return to draft'
              : a === 'retry'
                ? 'Retry preparation'
                : a[0]?.toUpperCase() + a.slice(1)}
          </Button>
        ))}
      </div>
      <ErrorMessage error={error} />
      <h2>Sending report</h2>
      <p className="my-2 text-sm">
        SMTP accepted means the SMTP server accepted the message. Confirmed
        delivery is not measured. Outcome unknown messages are never
        automatically resent.
      </p>
      <div className="my-4 flex flex-wrap gap-4">
        {Object.entries(query.data?.counts ?? {}).map(([key, count]) => (
          <p key={key}>
            {key === 'claimed'
              ? 'Preparing submission'
              : key.replaceAll('_', ' ')}
            : {count}
          </p>
        ))}
      </div>
      <label>
        Filter recipient status
        <select
          className="mx-2 border p-2"
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All</option>
          {recipientStates.map((s) => (
            <option key={s} value={s}>
              {s.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <a
        className="underline"
        href={`/api/projects/${projectId}/campaigns/${campaign.id}/report?format=csv${state ? `&state=${state}` : ''}`}
      >
        Export CSV
      </a>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              <th>Recipient</th>
              <th>Status</th>
              <th>Reason / attempts</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.items.map((j) => (
              <tr key={j.id}>
                <td className="p-2">{j.email}</td>
                <td>{j.state.replaceAll('_', ' ')}</td>
                <td>
                  {j.reason}
                  <details>
                    <summary>Attempt history</summary>
                    {j.attempts.map((a, i) => (
                      <p key={i}>
                        {new Date(a.at).toLocaleString()} ·{' '}
                        {a.state.replaceAll('_', ' ')} {a.reason}
                      </p>
                    ))}
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </Button>
        <span>
          Page {page} · {query.data?.total ?? 0} recipients
        </span>
        <Button
          variant="outline"
          disabled={page * 100 >= (query.data?.total ?? 0)}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
    </>
  );
}
