import { useRouteAction } from '@/lib/route-data';
import type { loader } from '@/pages/SettingsPage';
import type { EmailAccount } from '@outreacher/shared';
import {
  emailAccountInputSchema,
  emailAccountSchema,
  sendingSettingsSchema,
} from '@outreacher/shared';
import { useState } from 'react';
import { useLoaderData } from 'react-router';
import { z } from 'zod';
import { IncomingSettings } from './IncomingSettings';

import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
function AccountForm({
  projectId,
  account,
  onClose,
}: {
  projectId: string;
  account?: EmailAccount;
  onClose: () => void;
}) {
  const operation = useRouteAction(`/projects/${projectId}/settings`);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  async function save(form: HTMLFormElement) {
    setBusy(true);
    setError(undefined);
    try {
      const data = new FormData(form);
      const input = emailAccountInputSchema.parse({
        ...Object.fromEntries(data),
        port: Number(data.get('port')),
      });
      await operation.submit('save-account', { id: account?.id, input }, emailAccountSchema);
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="my-4 grid max-w-2xl gap-4 rounded border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save(e.currentTarget);
      }}
    >
      <h3>{account ? 'Edit mail account' : 'Add mail account'}</h3>
      {(
        [
          'name',
          'host',
          'port',
          'username',
          'password',
          'senderName',
          'senderEmail',
          'replyTo',
        ] as const
      ).map((key) => (
        <label key={key} className="grid gap-1 text-sm">
          {
            {
              name: 'Account name',
              host: 'SMTP host',
              port: 'Port',
              username: 'Username (optional)',
              password: 'Password (blank preserves saved password)',
              senderName: 'Sender name',
              senderEmail: 'Sender email',
              replyTo: 'Reply-to email',
            }[key]
          }
          <Input
            name={key}
            type={
              key === 'password'
                ? 'password'
                : key === 'port'
                  ? 'number'
                  : ['senderEmail', 'replyTo'].includes(key)
                    ? 'email'
                    : 'text'
            }
            defaultValue={
              key === 'password'
                ? ''
                : (account?.[key] ?? (key === 'port' ? 587 : ''))
            }
            required={['name', 'host', 'port', 'senderEmail'].includes(key)}
            autoComplete={key === 'password' ? 'new-password' : 'off'}
          />
        </label>
      ))}
      {account && (
        <p>Password configured: {account.passwordConfigured ? 'yes' : 'no'}.</p>
      )}
      <label>
        TLS mode
        <select
          className="block border p-2"
          name="tlsMode"
          defaultValue={account?.tlsMode ?? 'starttls'}
        >
          <option value="starttls">Require STARTTLS</option>
          <option value="tls">Implicit TLS</option>
          <option value="none">Unencrypted (local SMTP capture)</option>
        </select>
      </label>
      <ErrorMessage error={error} />
      <div className="flex gap-2">
        <Button disabled={busy}>Save mail account</Button>
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
function AccountCard({
  projectId,
  account,
  onEdit,
}: {
  projectId: string;
  account: EmailAccount;
  onEdit: () => void;
}) {
  const operation = useRouteAction(`/projects/${projectId}/settings`);
  const [recipient, setRecipient] = useState('');
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function action(kind: 'verify' | 'test' | 'delete') {
    if (
      kind === 'delete' &&
      !window.confirm(`Remove mail account "${account.name}"?`)
    )
      return;
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      await operation.submit(`${kind === 'delete' ? 'delete' : kind === 'verify' ? 'verify' : 'test'}-account`, { id: account.id, input: kind === 'test' ? { recipient } : {} }, z.unknown());
      if (kind !== 'delete') setMessage(kind === 'verify' ? 'SMTP connection verified.' : 'Test email submitted to SMTP.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="flex w-full min-w-0 max-w-full flex-none flex-col gap-3 rounded-lg border bg-card p-4 sm:w-96">
      <div className="min-w-0 space-y-1">
        <h3 className="break-words text-sm font-semibold">{account.name}</h3>
        <p className="break-all text-sm">{account.senderEmail}</p>
        {account.senderName && (
          <p className="break-words text-xs text-muted-foreground">
            {account.senderName}
          </p>
        )}
        <p className="break-all text-xs text-muted-foreground">
          {account.host}:{account.port}
        </p>
        <p className="text-xs text-muted-foreground">
          Password configured: {account.passwordConfigured ? 'yes' : 'no'}.
        </p>
      </div>
      {account.sendingError && (
        <p role="alert" className="break-words text-xs text-destructive">
          {account.sendingError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="xs" variant="outline" onClick={onEdit} disabled={busy}>
          Edit account
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => void action('verify')}
          disabled={busy}
        >
          Verify connection
        </Button>
        <Button
          size="xs"
          variant="destructive"
          onClick={() => void action('delete')}
          disabled={busy}
        >
          Remove account
        </Button>
      </div>
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-3">
        <label className="min-w-0 flex-1 basis-40">
          <span className="sr-only">
            Explicit test recipient for {account.name}
          </span>
          <Input
            className="mt-0 h-8 text-xs"
            type="email"
            placeholder="Test recipient email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </label>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !recipient}
          onClick={() => void action('test')}
        >
          Send test email
        </Button>
      </div>
      <IncomingSettings projectId={projectId} account={account} />
      <ErrorMessage error={error} />
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
    </article>
  );
}
function SendingSettings({ projectId }: { projectId: string }) {
  const operation = useRouteAction(`/projects/${projectId}/settings`);
  const { settings } = useLoaderData<typeof loader>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save(form: HTMLFormElement) {
    setBusy(true);
    setError(undefined);
    setMessage('');
    try {
      const data = new FormData(form);
      await operation.submit('save-sending', { hourlyLimit: Number(data.get('hourlyLimit')), timeZone: data.get('timeZone') }, sendingSettingsSchema);
      setMessage('Sending settings saved.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="my-6 grid max-w-2xl gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save(e.currentTarget);
      }}
    >
      <h3>Project sending settings</h3>
      <p className="text-sm">
        The sending limit is shared across all mail accounts and campaigns in
        this project.
      </p>
      <label>
        Messages per hour
        <Input
          name="hourlyLimit"
          type="number"
          min="1"
          max="10000"
          defaultValue={settings.hourlyLimit}
          required
        />
      </label>
      <label>
        IANA time zone
        <Input name="timeZone" defaultValue={settings.timeZone} required />
      </label>
      <p className="text-sm">
        Your browser time zone:{' '}
        {Intl.DateTimeFormat().resolvedOptions().timeZone}
      </p>
      <Button disabled={busy}>Save sending settings</Button>
      <ErrorMessage error={error} />
      <p role="status">{message}</p>
    </form>
  );
}
export function EmailSettings({ projectId }: { projectId: string }) {
  const { accounts } = useLoaderData<typeof loader>();
  const [editing, setEditing] = useState<EmailAccount | 'new' | null>(null);
  return (
    <section className="my-8">
      <div className="flex items-center justify-between gap-4">
        <h2>Mail accounts</h2>
        <Button onClick={() => setEditing('new')}>Add mail account</Button>
      </div>
      <p className="my-2 text-sm">
        Add SMTP accounts here, then choose which account to use in each
        campaign or template test.
      </p>
      {accounts?.length === 0 && <p>No mail accounts yet.</p>}
      {editing && (
        <AccountForm
          key={editing === 'new' ? 'new' : editing.id}
          projectId={projectId}
          account={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
      <div className="flex flex-wrap gap-3">
        {accounts?.map((account) => (
          <AccountCard
            key={account.id}
            projectId={projectId}
            account={account}
            onEdit={() => setEditing(account)}
          />
        ))}
      </div>
      <SendingSettings projectId={projectId} />
    </section>
  );
}
