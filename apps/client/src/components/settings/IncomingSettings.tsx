import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { emailAccountSchema, incomingInputSchema } from '@outreachit/shared';
import type { EmailAccount } from '@outreachit/shared';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/feedback/ErrorMessage';
export function IncomingSettings({ projectId, account }: { projectId: string; account: EmailAccount }) {
  const client = useQueryClient();
  const s = account.incoming;
  const [enabled, setEnabled] = useState(s?.enabled ?? false);
  const [reuse, setReuse] = useState(s?.useSmtpCredentials ?? true);
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  const [status, setStatus] = useState('');
  const path = `/projects/${projectId}/email-accounts/${account.id}/incoming`;
  async function run(work: () => Promise<void>) {
    setBusy(true); setError(undefined); setStatus('');
    try { await work(); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return <details className="border-t pt-3"><summary className="cursor-pointer text-sm">Incoming mail (IMAP){s?.enabled ? ' — enabled' : ''}</summary>
    <form className="mt-3 grid gap-3 text-sm" onSubmit={e => {
      e.preventDefault(); const data = new FormData(e.currentTarget);
      void run(async () => {
        await api(path, emailAccountSchema, 'PUT', incomingInputSchema.parse({
          enabled, useSmtpCredentials: reuse, host: data.get('host') ?? '', port: Number(data.get('port') ?? 993),
          tlsMode: data.get('tlsMode') ?? 'tls', username: data.get('username') ?? '', password: data.get('password') ?? '',
        }));
        await client.invalidateQueries({ queryKey: ['project', projectId, 'email-accounts'] });
        setStatus('Incoming settings saved.');
      });
    }}>
      <label className="flex gap-2"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />Enable incoming mail</label>
      <label>IMAP host<Input name="host" required={enabled} defaultValue={s?.host ?? ''} /></label>
      <label>IMAP port<Input type="number" name="port" min={1} max={65535} required defaultValue={s?.port ?? 993} /></label>
      <label>TLS mode<select className="block w-full border p-2" name="tlsMode" defaultValue={s?.tlsMode ?? 'tls'}><option value="tls">Implicit TLS</option><option value="starttls">Require STARTTLS</option><option value="none">Unencrypted (local capture)</option></select></label>
      <label className="flex gap-2"><input type="checkbox" checked={reuse} onChange={e => setReuse(e.target.checked)} />Use saved SMTP credentials</label>
      {!reuse && <><label>IMAP username<Input name="username" defaultValue={s?.username ?? ''} required={enabled} /></label><label>IMAP password<Input type="password" name="password" autoComplete="new-password" placeholder="Blank preserves saved password" /></label><p>Password configured: {s?.passwordConfigured ? 'yes' : 'no'}.</p></>}
      <p className="text-xs text-muted-foreground">Use your provider’s IMAP settings. Save changes before verifying. Inbox access is read-only.</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy}>Save incoming settings</Button><Button type="button" size="sm" variant="outline" disabled={busy || !s?.enabled} onClick={() => void run(async () => { await api(`${path}/verify`, z.object({ ok: z.boolean() }), 'POST', {}); setStatus('Incoming connection verified.'); })}>Verify incoming connection</Button></div>
      <ErrorMessage error={error} />{status && <p role="status">{status}</p>}
    </form>
  </details>;
}
