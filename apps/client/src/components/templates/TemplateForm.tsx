import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  templateSchema,
  emailAccountSchema,
  previewSchema,
  contactListSchema,
} from '@outreachit/shared';
import type { EmailTemplate } from '@outreachit/shared';
import { api, mutate } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorMessage } from '@/components/feedback/ErrorMessage';
export function TemplateForm({
  projectId,
  template,
}: {
  projectId: string;
  template?: EmailTemplate;
}) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [name, setName] = useState(template?.name ?? '');
  const [subject, setSubject] = useState(template?.subject ?? '');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [contactId, setContactId] = useState('');
  const [recipient, setRecipient] = useState('');
  const [emailAccountId, setEmailAccountId] = useState('');
  const accounts = useQuery({
    queryKey: ['project', projectId, 'email-accounts'],
    queryFn: () =>
      api(`/projects/${projectId}/email-accounts`, z.array(emailAccountSchema)),
  });
  const [preview, setPreview] = useState<z.infer<typeof previewSchema>>();
  const [status, setStatus] = useState('');
  const contacts = useQuery({
    queryKey: ['project', projectId, 'preview-contacts'],
    queryFn: () =>
      api(`/projects/${projectId}/contacts?limit=100`, contactListSchema),
  });
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
  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const t = await api(
        `/projects/${projectId}/templates${template ? `/${template.id}` : ''}`,
        templateSchema,
        template ? 'PUT' : 'POST',
        { name, subject, html: editor?.getHTML() ?? '' },
      );
      await client.invalidateQueries({
        queryKey: ['project', projectId, 'templates'],
      });
      navigate(`/projects/${projectId}/templates/${t.id}`);
      setStatus('Template saved.');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function action(kind: 'preview' | 'test' | 'delete') {
    setError(undefined);
    try {
      if (kind === 'preview')
        setPreview(
          await api(
            `/projects/${projectId}/templates/preview`,
            previewSchema,
            'POST',
            { name, subject, html: editor?.getHTML(), contactId },
          ),
        );
      if (kind === 'test' && template) {
        await api(
          `/projects/${projectId}/email-accounts/${emailAccountId}/test`,
          z.object({ ok: z.boolean() }),
          'POST',
          { recipient, contactId, templateId: template.id },
        );
        setStatus('Saved template test submitted to SMTP.');
      }
      if (kind === 'delete' && template) {
        await mutate(
          `/projects/${projectId}/templates/${template.id}`,
          'DELETE',
        );
        await client.invalidateQueries({
          queryKey: ['project', projectId, 'templates'],
        });
        navigate(`/projects/${projectId}/templates`);
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
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
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
      </form>
      <ErrorMessage error={error} />
      <p role="status">{status}</p>
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
            {contacts.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.email}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          onClick={() => void action('preview')}
          disabled={!contactId}
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
            {accounts.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} — {a.senderEmail}
              </option>
            ))}
          </select>
        </label>
        <ErrorMessage error={accounts.error} />
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
          disabled={!template || !contactId || !recipient || !emailAccountId}
          onClick={() => void action('test')}
        >
          Send saved template test
        </Button>
      </section>
      {template && (
        <Button
          variant="destructive"
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
