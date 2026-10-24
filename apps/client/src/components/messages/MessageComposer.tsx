import { useContactSearch } from '@/hooks/use-contact-search';
import { useRouteAction } from '@/lib/route-data';
import type { loader, messagesLoader, reportLoader } from '@/pages/ComposePage';
import type { StandaloneMessage } from '@outreacher/shared';
import { messagePreviewSchema, messageSchema } from '@outreacher/shared';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Italic, Link2, List, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useFetcher, useLoaderData, useNavigate } from 'react-router';
import { z } from 'zod';

import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RecipientInput } from '@/components/messages/RecipientInput';

export function MessageComposer({ projectId, message, onNew }: { projectId: string; message?: StandaloneMessage; onNew(): void }) {
  const navigate = useNavigate();
  const operation = useRouteAction();
  const data = useLoaderData<typeof loader>();
  const savedId = useRef(message?.id);
  const [subject, setSubject] = useState(message?.subject ?? '');
  const [accountId, setAccountId] = useState(message?.emailAccountId ?? '');
  const [contactIds, setContactIds] = useState(message?.contactIds ?? []);
  const [addresses, setAddresses] = useState(message?.addresses ?? []);
  const [addressInput, setAddressInput] = useState('');
  const [search, setSearch] = useState('');
  const [pickingContacts, setPickingContacts] = useState(false);
  const [view, setView] = useState<'compose' | 'drafts' | 'history'>('compose');
  const [error, setError] = useState<unknown>(), [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<z.infer<typeof messagePreviewSchema>>();
  const [confirmation, setConfirmation] = useState(false);
  const [page, setPage] = useState(1);
  const isReply = message?.kind === 'reply';
  const editable = !message || message.state === 'draft';
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } })], content: message?.html ?? '<p></p>', editable,
    onUpdate: () => { setPreview(undefined); setConfirmation(false); },
    editorProps: { attributes: { class: 'compose-email-body prose outline-none', role: 'textbox', 'aria-label': 'Email body', 'aria-multiline': 'true' } }
  });
  const accounts = data.accounts;
  const templates = data.templates;
  const contacts = useContactSearch(projectId, new URLSearchParams({ limit: '100', search }).toString());
  const messageList = useFetcher<typeof messagesLoader>();
  const { load: loadMessages } = messageList;
  const messagesUrl = `/projects/${projectId}/resources/messages`;
  useEffect(() => { void loadMessages(messagesUrl); }, [loadMessages, messagesUrl]);
  useEffect(() => {
    if (messageList.state !== 'idle') return;
    const timer = window.setTimeout(() => void loadMessages(messagesUrl), 5000);
    return () => window.clearTimeout(timer);
  }, [loadMessages, messagesUrl, messageList.state, messageList.data]);
  const messages = messageList.data;
  const report = useFetcher<typeof reportLoader>();
  const { load } = report;
  const reportId = !editable ? message?.id : undefined;
  useEffect(() => { if (reportId) void load(`/projects/${projectId}/resources/messages/${reportId}/report?page=${page}`); }, [load, projectId, reportId, page]);
  const input = () => ({ subject, html: editor?.getHTML() ?? '', emailAccountId: accountId || null, contactIds, addresses: [...addresses, ...addressInput.split(/[\s,;]+/).filter(Boolean)] });
  async function run(work: () => Promise<void>) { setBusy(true); setError(undefined); try { await work(); } catch (e) { setError(e); } finally { setBusy(false); } }
  async function save() {
    const saved = await operation.submit('save', { id: savedId.current, input: input() }, messageSchema);
    savedId.current = saved.id;
    return saved;
  }

  async function review() {
    if (!accountId) throw new Error('Choose a mail account.');
    const result = await operation.submit('preview', { id: isReply ? message.id : undefined, input: input() }, messagePreviewSchema);
    if (!result.eligible) throw new Error('No eligible recipients.');
    setPreview(result); setConfirmation(true);
  }
  return <div className="compose-workspace">
    <div className="compose-heading">
      <h1>{view === 'drafts' ? 'Drafts' : view === 'history' ? 'Send history' : 'Compose'}</h1>
      <nav aria-label="Messages" className="flex flex-wrap gap-1">
        {view !== 'compose' && <Button size="sm" variant="ghost" onClick={() => setView('compose')}>Back to message</Button>}
        <Button size="sm" variant="ghost" onClick={() => setView('drafts')}>Drafts</Button>
        <Button size="sm" variant="ghost" onClick={() => setView('history')}>Send history</Button>
        <Button size="sm" variant="ghost" onClick={() => { onNew(); navigate(`/projects/${projectId}/compose`); }}>New message</Button>
      </nav>
    </div>
    <ErrorMessage error={error} />
    {view !== 'compose' ? <div className="grid gap-3">{messages?.filter(m => (view === 'drafts') === (m.state === 'draft')).map(m => <Link className="rounded border p-4" key={m.id} onClick={() => setView('compose')} to={`/projects/${projectId}/compose/${m.id}`}>
      <strong>{m.subject || 'Untitled draft'}</strong>
      <p>{m.state.replaceAll('_', ' ')} · {m.total} recipients · {new Date(m.createdAt).toLocaleString()}</p>
    </Link>)}{messages?.filter(m => (view === 'drafts') === (m.state === 'draft')).length === 0 && <p>{view === 'drafts' ? 'No saved drafts.' : 'No submitted messages.'}</p>}</div> : editable ? <div className="compose-mail">
      <div className="compose-envelope-row">
        <label htmlFor="compose-account">From</label>
        <select disabled={isReply} id="compose-account" aria-label="Mail account" value={accountId} onChange={e => { setAccountId(e.target.value); setConfirmation(false); }}>
          <option value="">Choose a mail account</option>
          {accounts?.map(a => <option key={a.id} value={a.id}>{a.name} — {a.senderEmail}</option>)}
        </select>
      </div>
      <div className="compose-envelope-row compose-to-row">
        <label htmlFor="compose-addresses">To</label>
        <RecipientInput
          addresses={addresses}
          inputValue={addressInput}
          contactCount={contactIds.length}
          readOnly={isReply}
          onAddressesChange={value => { setAddresses(value); setPreview(undefined); setConfirmation(false); }}
          onInputChange={value => { setAddressInput(value); setPreview(undefined); setConfirmation(false); }}
          onPickContacts={() => setPickingContacts(true)}
        />
      </div>
      <div className="compose-envelope-row">
        <label htmlFor="compose-subject">Subject</label>
        <Input id="compose-subject" value={subject} onChange={e => { setSubject(e.target.value); setPreview(undefined); }} placeholder="Subject" />
      </div>
      {isReply && message.replyContext && <details className="border-b p-4"><summary>Original message — {message.replyContext.subject}</summary><p>From: {message.replyContext.from}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap font-sans">{message.replyContext.text}</pre><p>Reply text is sent literally. No personalization or unsubscribe footer.</p></details>}
      <EditorContent editor={editor} />
      <div className="compose-tools">
        <div role="toolbar" aria-label="Text formatting" className="flex gap-1">
          <Button size="icon" variant="ghost" aria-label="Bold" title="Bold" onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={15} /></Button>
          <Button size="icon" variant="ghost" aria-label="Italic" title="Italic" onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={15} /></Button>
          <Button size="icon" variant="ghost" aria-label="Bullet list" title="Bullet list" onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={15} /></Button>
          <Button size="icon" variant="ghost" aria-label="Link" title="Link" onClick={() => { const href = window.prompt('Link URL (https://, http:// or mailto:)'); if (href && /^(https?:|mailto:)/i.test(href)) editor?.chain().focus().setLink({ href }).run(); }}><Link2 size={15} /></Button>
        </div>
        <select disabled={isReply} className="compose-template" aria-label="Copy from template" defaultValue="" onChange={e => { const t = templates?.find(t => t.id === e.target.value); if (t) { setSubject(t.subject); editor?.commands.setContent(t.html); setPreview(undefined); } e.target.value = ''; }}>
          <option value="">Use template</option>
          {templates?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <details hidden={isReply} className="compose-personalization">
          <summary>Personalize</summary>
          <p>Use {'{{firstName}}, {{company}}, or {{custom.field_key}}'}. An unsubscribe link is added automatically.</p>
        </details>
      </div>
      <div className="compose-footer">
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={busy} aria-label="Review and send" onClick={() => void run(review)}><Send size={14} />Send</Button>
          <Button disabled={busy} variant="ghost" onClick={() => void run(async () => { await save(); })}>Save draft</Button>
          <Button disabled={busy} variant="ghost" onClick={() => void run(async () => { setPreview(await operation.submit('preview', { id: isReply ? message.id : undefined, input: input() }, messagePreviewSchema)); })}>Preview</Button>
        </div>
        {message && <Button size="sm" disabled={busy} variant="ghost" className="text-muted-foreground" onClick={() => void run(async () => { await operation.submit('delete', { id: message.id }, z.unknown()); })}>Delete draft</Button>}
      </div>
      {pickingContacts && <Modal title="Add contacts" onClose={() => setPickingContacts(false)}>
        <div className="grid gap-4 p-6">
          <label>Find contacts<Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or email" /></label>
          <div className="max-h-72 overflow-auto">{contacts.data?.items.map(c => <label className="flex items-center gap-3 border-b py-3 text-sm" key={c.id}>
            <input type="checkbox" checked={contactIds.includes(c.id)} onChange={e => { setContactIds(e.target.checked ? [...contactIds, c.id] : contactIds.filter(id => id !== c.id)); setPreview(undefined); }} />{c.email}{c.suppressed ? ' (suppressed)' : ''}
          </label>)}</div>
          {contacts.state !== 'idle' && <p className="text-sm text-muted-foreground">Loading contacts…</p>}
          {contacts.data?.items.length === 0 && <p className="text-sm text-muted-foreground">No matching contacts.</p>}
          <p className="text-xs text-muted-foreground">Separate emails are sent to each recipient. Duplicates are combined; suppressed and deleted contacts are excluded. Up to 10,000 recipients.</p>
          <div className="flex items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => { setContactIds([]); setPreview(undefined); }}>Clear selection</Button>
            <Button onClick={() => setPickingContacts(false)}>Done{contactIds.length > 0 ? ` (${contactIds.length})` : ''}</Button>
          </div>
        </div>
      </Modal>}
      {preview && <section className="grid gap-3 border-t p-5">
        <p>{preview.eligible} eligible · {preview.excluded} excluded</p>{preview.recipients.slice(0, 20).map(r => <details key={r.email}>
          <summary>{r.email} — {r.subject}</summary>{r.warnings.map(w => <p key={w}>{w}</p>)}<iframe title={`Preview for ${r.email}`} sandbox="" className="h-80 w-full border" srcDoc={r.html} />
        </details>)}{preview.recipients.length > 20 && <p>Showing the first 20 personalized previews.</p>}</section>}
      {confirmation && preview && <Modal title="Confirm send" onClose={() => setConfirmation(false)}>
        <p>To: {preview.recipients.map(r => r.email).join(', ')}</p>
        <p>From: {accounts?.find(a => a.id === accountId)?.senderEmail}</p>
        <p>{preview.eligible} separate emails · {preview.excluded} excluded. Sending starts immediately and respects the project hourly limit.</p>
        <Button disabled={busy} onClick={() => void run(async () => { const saved = await operation.submit('save-for-send', { id: savedId.current, input: input() }, messageSchema); savedId.current = saved.id; await operation.submit('submit', { id: saved.id }, messageSchema); setConfirmation(false); })}>Confirm send</Button>
      </Modal>}
    </div> : message && <section className="grid gap-4">
      <h2>{message.subject}</h2>
      <p>{message.state.replaceAll('_', ' ')} · From: {message.senderEmail} · {message.total} recipients · {message.excluded} excluded</p>{message.error && <p role="alert">{message.error}</p>}<div className="flex gap-2">{message.state === 'paused' && <Button disabled={busy} onClick={() => void run(async () => { await operation.submit('resume', { id: message.id }, messageSchema); })}>Resume after correcting account</Button>}{message.state === 'preparation_failed' && <Button disabled={busy} onClick={() => void run(async () => { await operation.submit('retry', { id: message.id }, messageSchema); })}>Retry preparation</Button>}{['active', 'paused', 'preparing', 'preparation_failed'].includes(message.state) && <Button disabled={busy} variant="destructive" onClick={() => void run(async () => { await operation.submit('cancel', { id: message.id }, messageSchema); })}>Cancel remaining emails</Button>}</div>
      <p>SMTP accepted means the mail server accepted the email; delivery is unconfirmed. Unknown outcomes are never retried automatically.</p>
      <div className="flex flex-wrap gap-4">{Object.entries(report.data?.counts ?? {}).map(([state, count]) => <span key={state}>{state.replaceAll('_', ' ')}: {count}</span>)}</div>
      <table>
        <thead>
          <tr>
            <th>Recipient</th>
            <th>Result</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>{report.data?.items.map(r => <tr key={r.id}>
          <td>{r.email}</td>
          <td>{r.state.replaceAll('_', ' ')}</td>
          <td>{r.reason}<details>
            <summary>Attempts ({r.attempts.length})</summary>{r.attempts.map((a, i) => <p key={i}>{a.at} · {a.state.replaceAll('_', ' ')} · {a.reason}</p>)}</details>
          </td>
        </tr>)}</tbody>
      </table>
      <div className="flex gap-2">
        <Button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
        <span>Page {page}</span>
        <Button disabled={page * 100 >= (report.data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </section>}
  </div>;
}
