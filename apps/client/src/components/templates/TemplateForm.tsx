import { useRouteAction } from '@/lib/route-data';
import type { editorLoader, action as templateAction } from '@/pages/TemplatesPage';
import type { EmailTemplate } from '@outreacher/shared';
import {
  previewSchema
} from '@outreacher/shared';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useState } from 'react';
import { Form, Link, useActionData, useLoaderData, useNavigation, useSubmit } from 'react-router';
import { z } from 'zod';

import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export function TemplateForm({
  projectId,
  template,
}: {
  projectId: string;
  template?: EmailTemplate;
}) {
  const operation = useRouteAction();
  const data = useLoaderData<typeof editorLoader>();
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [error, setError] = useState<unknown>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const saved = useActionData<typeof templateAction>();
  const busy = navigation.state !== 'idle' || operation.busy;
  const [contactId, setContactId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [emailAccountId, setEmailAccountId] = useState('');
  const accounts = data.accounts;
  const [preview, setPreview] = useState<z.infer<typeof previewSchema>>();
  const [status, setStatus] = useState('');
  const contacts = data.contacts;
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } })],
    content: template?.html ?? '<p>Hello {{firstName}},</p><p></p>',
    editorProps: {
      attributes: {
        class: 'min-h-64 rounded border p-4 outline-none prose',
        role: 'textbox',
        'aria-label': 'Email body',
        'aria-multiline': 'true',
      },
    },
  });
  async function action(kind: 'preview' | 'test' | 'delete') {
    setError(undefined);
    try {
      if (kind === 'preview')
        setPreview(
          await operation.submit('preview', { name, subject, html: editor?.getHTML(), contactId }, previewSchema),
        );
      if (kind === 'test' && template) {
        await operation.submit('test', { recipient, contactId, emailAccountId }, z.unknown());
        setStatus('Saved template test submitted to SMTP.');
      }
      if (kind === 'delete' && template) {
        await operation.submit('delete', {}, z.unknown());
      }
    } catch (e) {
      setError(e);
    }
  }
  return (
    <>
      <div className="page-heading">
        <h1>{template ? 'Edit template' : 'New template'}</h1>
        <Link to={`/projects/${projectId}/templates`}>All templates</Link>
      </div>
      <Form method="post"
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          setError(undefined);
          void submit(JSON.stringify({ intent: 'save', payload: { name, subject, html: editor?.getHTML() ?? '' } }), { method: 'post', encType: 'application/json' });
        }}
      >
        <label>
          Name
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label>
          Subject
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
        </label>
        <p className="text-sm">
          Personalize with{' '}
          {
            '{{firstName}}, {{lastName}}, {{email}}, {{company}}, {{phone}}, {{website}}, {{city}}, {{state}}, {{country}}, {{source}}, {{notes}}, {{custom.field_key}}, {{unsubscribeUrl}}'
          }
          . A missing unsubscribe link is added automatically.
        </p>
        <div
          className="flex flex-wrap gap-2"
          role="toolbar"
          aria-label="Text formatting"
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            Bold
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            Italic
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => editor?.chain().focus().toggleStrike().run()}
          >
            Strike
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }
          >
            Heading
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            Bullet list
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            Numbered list
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const href = window.prompt(
                'Link URL (https://, http:// or mailto:)',
              );
              if (href && /^(https?:|mailto:)/i.test(href))
                editor?.chain().focus().setLink({ href }).run();
            }}
          >
            Link
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => editor?.chain().focus().unsetLink().run()}
          >
            Remove link
          </Button>
        </div>
        <EditorContent editor={editor} />
        <Button disabled={busy}>Save template</Button>
      </Form>
      <ErrorMessage error={error ?? (saved && !saved.ok ? new Error(saved.error) : undefined)} />
      <p role="status">{status || (saved?.ok ? 'Template saved.' : '')}</p>
      <section className="my-8 grid gap-3">
        <h2>Preview and test</h2>
        <label>
          Preview contact
          <select
            className="block border p-2"
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
          >
            <option value="">Choose a contact</option>
            {contacts?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.email}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          onClick={() => void action('preview')}
          disabled={busy || !contactId}
        >
          Preview current content
        </Button>
        {preview && (
          <>
            <h3>{preview.subject}</h3>
            {preview.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={preview.html}
              className="h-80 w-full border"
            />
            <pre className="whitespace-pre-wrap">{preview.text}</pre>
          </>
        )}
        <label>
          Test mail account
          <select
            className="block border p-2"
            value={emailAccountId}
            onChange={(e) => setEmailAccountId(e.target.value)}
          >
            <option value="">Choose a mail account</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {a.senderEmail}
              </option>
            ))}
          </select>
        </label>
        <label>
          Explicit test recipient
          <Input
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          />
        </label>
        <Button
          variant="outline"
          disabled={busy || !template || !contactId || !recipient || !emailAccountId}
          onClick={() => void action('test')}
        >
          Send saved template test
        </Button>
      </section>
      {template && (
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => {
            if (window.confirm('Delete this template?')) void action('delete');
          }}
        >
          Delete template
        </Button>
      )}
    </>
  );
}
