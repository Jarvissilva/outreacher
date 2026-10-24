import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { operation, projectPath, routeOperation } from '@/lib/route-data';
import type { Project } from '@outreacher/shared';
import { emailAccountSchema, inboxIdentitySchema, inboxListSchema, inboxMessageSchema, messageSchema } from '@outreacher/shared';
import { useState } from 'react';
import { Tabs } from 'radix-ui';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Link, redirect, useFetcher, useLoaderData, useOutletContext } from 'react-router';
import { z } from 'zod';

export function InboxPage() {
  const project = useOutletContext<Project>();
  const [accountId, setAccountId] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{ uidValidity: string; uid: number }>();
  const accounts = useLoaderData<typeof loader>();
  const account = accounts.find(a => a.id === accountId);
  const inbox = useFetcher<typeof inboxHeadersLoader>();
  const mail = useFetcher<typeof inboxMessageLoader>();
  const reply = useFetcher<typeof action>();
  const headers = inbox.data?.ok && inbox.data.value.accountId === accountId && inbox.data.value.page === page ? inbox.data.value : undefined;
  const body = mail.data?.ok && mail.data.value.accountId === accountId && mail.data.value.uid === selected?.uid && mail.data.value.uidValidity === selected?.uidValidity ? mail.data.value : undefined;
  function selectAccount(id: string) {
    if (id === accountId) return;
    setAccountId(id);
    setPage(1);
    setSelected(undefined);
    inbox.reset();
    mail.reset();
    reply.reset();
    if (accounts.find(item => item.id === id)?.incoming?.enabled) loadHeaders(id, 1);
  }
  function loadHeaders(id: string, nextPage: number) {
    setSelected(undefined); mail.reset();
    void inbox.load(`/projects/${project.id}/resources/inbox/${id}?page=${nextPage}`);
  }
  return <section className="grid gap-4">
    <h1>Inbox</h1>
    <Tabs.Root value={accountId} onValueChange={selectAccount} activationMode="manual" className="grid min-w-0 gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Tabs.List aria-label="Mail accounts" className="flex min-w-0 flex-1 gap-1 overflow-x-auto border-b">
          {accounts.map(item => (
            <Tabs.Trigger
              key={item.id}
              value={item.id}
              className="grid shrink-0 gap-1 border-b-2 border-transparent px-4 py-3 text-left text-muted-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring data-[state=active]:border-primary data-[state=active]:text-foreground"
            >
              <span className="text-sm font-medium">{item.name}</span>
              <span className="text-xs">{item.senderEmail}</span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Button variant="outline" disabled={!account?.incoming?.enabled || inbox.state !== 'idle'} onClick={() => loadHeaders(accountId, page)}>Refresh</Button>
      </div>
      {!accountId && accounts.length > 0 && <p>Select a mail account tab to read its Inbox.</p>}
      {accounts.length === 0 && <p>Enable incoming mail in <Link className="underline" to={`/projects/${project.id}/settings`}>mail account settings</Link>. Enter the IMAP settings supplied by your provider.</p>}
      {account && <Tabs.Content key={account.id} value={account.id} className="grid min-w-0 gap-4 outline-none">
        <ErrorMessage error={reply.data && !reply.data.ok ? new Error(reply.data.error) : inbox.data && !inbox.data.ok ? new Error(inbox.data.error) : mail.data && !mail.data.ok ? new Error(mail.data.error) : undefined} />
        {!account.incoming?.enabled && <p>Enable incoming mail in <Link className="underline" to={`/projects/${project.id}/settings`}>mail account settings</Link>. Enter the IMAP settings supplied by your provider.</p>}
        {account?.incoming?.enabled && <div className="grid min-w-0 gap-4 md:grid-cols-[minmax(240px,1fr)_2fr]">
          <div className={selected ? 'hidden md:block' : ''}>
            {(inbox.state !== 'idle') && <p>Loading Inbox…</p>}
            {headers?.items.length === 0 && <p>No messages on this page.</p>}
            <ul className="divide-y rounded border">{headers?.items.map(m => <li key={`${m.uidValidity}/${m.uid}`}>
              <button className={`grid w-full gap-1 p-3 text-left ${m.unread ? 'font-semibold' : ''}`} aria-pressed={selected?.uid === m.uid && selected.uidValidity === m.uidValidity} onClick={() => { setSelected({ uidValidity: m.uidValidity, uid: m.uid }); mail.reset(); void mail.load(`/projects/${project.id}/resources/inbox/${accountId}/${m.uidValidity}/${m.uid}`); }}>
                <span className="break-all">{m.unread && <span aria-label="Unread">● </span>}{m.from || 'Unknown sender'}</span>
                <span className="break-words">{m.subject || '(No subject)'}</span><span className="text-xs font-normal">{m.date ? new Date(m.date).toLocaleString() : 'Unknown date'}</span>
              </button>
            </li>)}</ul>
            <div className="mt-3 flex items-center gap-2"><Button variant="outline" disabled={page === 1 || (inbox.state !== 'idle')} onClick={() => { setPage(page - 1); loadHeaders(accountId, page - 1); }}>Previous</Button><span>Page {page}</span><Button variant="outline" disabled={!headers || page * 50 >= headers.total || (inbox.state !== 'idle')} onClick={() => { setPage(page + 1); loadHeaders(accountId, page + 1); }}>Next</Button></div>
          </div>
          <article className={`${selected ? '' : 'hidden md:block'} min-w-0 space-y-3 rounded border p-4`}>
            {selected ? <><Button className="md:hidden" variant="ghost" onClick={() => setSelected(undefined)}>Back to Inbox</Button>
              {(mail.state !== 'idle') && <p>Loading message…</p>}
              {body && <><h2 className="break-words">{body.subject || '(No subject)'}</h2><p className="break-all">From: {body.from}</p><p> {body.date ? new Date(body.date).toLocaleString() : ''}</p>
                <Button disabled={reply.state !== 'idle' || !body.recipient} onClick={() => { void reply.submit({ intent: 'reply', payload: { accountId, ...selected } }, { method: 'post', encType: 'application/json' }); }}>Reply</Button>
                {!body.recipient && <p>No valid reply address.</p>}
                {body.html ? <iframe title="Received message" sandbox="" referrerPolicy="no-referrer" className="h-[60vh] w-full border-0" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'">${body.html}`} /> : <pre className="whitespace-pre-wrap break-words font-sans">{body.text}</pre>}
                <p className="text-xs text-muted-foreground">Remote images are blocked. Opening a message leaves its read status unchanged.</p>
              </>}
            </> : <p>Select a message to read it.</p>}
          </article>
        </div>}
      </Tabs.Content>}
    </Tabs.Root>
  </section>;
}

export function loader({ params, request }: LoaderFunctionArgs) {
  return api(`${projectPath(params.projectId)}/email-accounts`, z.array(emailAccountSchema), 'GET', undefined, request.signal);
}
export function inboxHeadersLoader({ params, request }: LoaderFunctionArgs) {
  return operation(() => api(`${projectPath(params.projectId)}/email-accounts/${params.accountId}/inbox?${new URL(request.url).searchParams}`, inboxListSchema, 'GET', undefined, request.signal));
}
export function inboxMessageLoader({ params, request }: LoaderFunctionArgs) {
  const identity = inboxIdentitySchema.parse({ uidValidity: params.uidValidity, uid: params.uid });
  return operation(() => api(`${projectPath(params.projectId)}/email-accounts/${params.accountId}/inbox/${identity.uidValidity}/${identity.uid}`, inboxMessageSchema, 'GET', undefined, request.signal));
}
export function action({ params, request }: ActionFunctionArgs) {
  return routeOperation(request, async ({ intent, payload }) => {
    z.literal('reply').parse(intent);
    const { accountId, ...identity } = inboxIdentitySchema.extend({ accountId: z.string().min(1) }).parse(payload);
    const draft = await api(`${projectPath(params.projectId)}/email-accounts/${accountId}/inbox/reply`, messageSchema, 'POST', identity, request.signal);
    throw redirect(`${projectPath(params.projectId)}/compose/${draft.id}`);
  });
}
