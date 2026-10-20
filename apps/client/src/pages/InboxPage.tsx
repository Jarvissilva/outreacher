import { useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { emailAccountSchema, inboxListSchema, inboxMessageSchema, messageSchema } from '@outreachit/shared';
import type { Project } from '@outreachit/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/feedback/ErrorMessage';

export function InboxPage() {
  const project = useOutletContext<Project>();
  const navigate = useNavigate();
  const [accountId, setAccountId] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{ uidValidity: string; uid: number }>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const base = `/projects/${project.id}/email-accounts`;
  const accounts = useQuery({ queryKey: ['project', project.id, 'email-accounts'], queryFn: () => api(base, z.array(emailAccountSchema)) });
  const account = accounts.data?.find(a => a.id === accountId);
  const inbox = useQuery({ queryKey: ['project', project.id, 'inbox', accountId, page], queryFn: () => api(`${base}/${accountId}/inbox?page=${page}`, inboxListSchema), enabled: Boolean(account?.incoming?.enabled), retry: false });
  const mail = useQuery({ queryKey: ['project', project.id, 'inbox-message', accountId, selected], queryFn: () => api(`${base}/${accountId}/inbox/${selected?.uidValidity}/${selected?.uid}`, inboxMessageSchema), enabled: Boolean(selected), retry: false, gcTime: 0 });
  async function reply() {
    setBusy(true); setError(undefined);
    try {
      const draft = await api(`${base}/${accountId}/inbox/reply`, messageSchema, 'POST', selected);
      navigate(`/projects/${project.id}/compose/${draft.id}`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <section className="grid gap-4">
    <h1>Inbox</h1>
    <div className="flex flex-wrap items-center gap-3">
      <label>Mail account <select aria-label="Inbox account" className="rounded border p-2" value={accountId} onChange={e => { setAccountId(e.target.value); setPage(1); setSelected(undefined); setError(undefined); }}>
        <option value="">Choose an account</option>{accounts.data?.map(a => <option value={a.id} key={a.id}>{a.name} — {a.senderEmail}</option>)}
      </select></label>
      <Button variant="outline" disabled={!account?.incoming?.enabled || inbox.isFetching} onClick={() => { setSelected(undefined); setError(undefined); void inbox.refetch(); }}>Refresh</Button>
    </div>
    <ErrorMessage error={error ?? accounts.error ?? inbox.error ?? mail.error} />
    {accounts.isPending && <p>Loading accounts…</p>}
    {!accountId && <p>Choose a mail account to read its Inbox.</p>}
    {(accounts.data?.length === 0 || (account && !account.incoming?.enabled)) && <p>Enable incoming mail in <Link className="underline" to={`/projects/${project.id}/settings`}>mail account settings</Link>. Enter the IMAP settings supplied by your provider.</p>}
    {account?.incoming?.enabled && <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(240px,1fr)_2fr]">
      <div className={selected ? 'hidden md:block' : ''}>
        {inbox.isFetching && <p>Loading Inbox…</p>}
        {inbox.data?.items.length === 0 && <p>No messages on this page.</p>}
        <ul className="divide-y rounded border">{inbox.data?.items.map(m => <li key={`${m.uidValidity}/${m.uid}`}>
          <button className={`grid w-full gap-1 p-3 text-left ${m.unread ? 'font-semibold' : ''}`} aria-pressed={selected?.uid === m.uid && selected.uidValidity === m.uidValidity} onClick={() => setSelected({ uidValidity: m.uidValidity, uid: m.uid })}>
            <span className="break-all">{m.unread && <span aria-label="Unread">● </span>}{m.from || 'Unknown sender'}</span>
            <span className="break-words">{m.subject || '(No subject)'}</span><span className="text-xs font-normal">{m.date ? new Date(m.date).toLocaleString() : 'Unknown date'}</span>
          </button>
        </li>)}</ul>
        <div className="mt-3 flex items-center gap-2"><Button variant="outline" disabled={page === 1 || inbox.isFetching} onClick={() => { setPage(page - 1); setSelected(undefined); }}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={!inbox.data || page * 50 >= inbox.data.total || inbox.isFetching} onClick={() => { setPage(page + 1); setSelected(undefined); }}>Next</Button></div>
      </div>
      <article className={`${selected ? '' : 'hidden md:block'} min-w-0 space-y-3 rounded border p-4`}>
        {selected ? <><Button className="md:hidden" variant="ghost" onClick={() => setSelected(undefined)}>Back to Inbox</Button>
          {mail.isFetching && <p>Loading message…</p>}
          {mail.data && <><h2 className="break-words">{mail.data.subject || '(No subject)'}</h2><p className="break-all">From: {mail.data.from}</p><p> {mail.data.date ? new Date(mail.data.date).toLocaleString() : ''}</p>
            <Button disabled={busy || !mail.data.recipient} onClick={() => void reply()}>Reply</Button>
            {!mail.data.recipient && <p>No valid reply address.</p>}
            {mail.data.html ? <iframe title="Received message" sandbox="" referrerPolicy="no-referrer" className="h-[60vh] w-full border-0" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'">${mail.data.html}`} /> : <pre className="whitespace-pre-wrap break-words font-sans">{mail.data.text}</pre>}
            <p className="text-xs text-muted-foreground">Remote images are blocked. Opening a message leaves its read status unchanged.</p>
          </>}
        </> : <p>Select a message to read it.</p>}
      </article>
    </div>}
  </section>;
}
