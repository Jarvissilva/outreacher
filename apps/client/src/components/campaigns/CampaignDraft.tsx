import { useContactSearch } from '@/hooks/use-contact-search';
import { useRouteAction } from '@/lib/route-data';
import type { editorLoader } from '@/pages/CampaignsPage';
import type { Campaign, CampaignInput } from '@outreacher/shared';
import {
  audiencePreviewSchema,
  audienceSchema,
  campaignInputSchema,
  campaignSchema,
  previewSchema,
} from '@outreacher/shared';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { ArrowLeft, Eye, Mail, Send, ShieldCheck, Users } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useLoaderData, useNavigate } from 'react-router';
import { z } from 'zod';

import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
export function CampaignDraft({
  projectId,
  campaign,
}: {
  projectId: string;
  campaign?: Campaign;
}) {
  const navigate = useNavigate();
  const operation = useRouteAction();
  const data = useLoaderData<typeof editorLoader>();
  const draftId = useRef(campaign?.id);
  const [name, setName] = useState(campaign?.name ?? '');
  const [emailAccountId, setEmailAccountId] = useState(
    campaign?.emailAccountId ?? '',
  );
  const [templateId, setTemplateId] = useState(campaign?.templateId ?? '');
  const [emailSource, setEmailSource] = useState(
    campaign?.templateId ? 'template' : 'write',
  );
  const [subject, setSubject] = useState(campaign?.message?.subject ?? '');
  const [activeTab, setActiveTab] = useState<'compose' | 'preview'>('compose');
  const [previewContactId, setPreviewContactId] = useState('');
  const [previewRecipient, setPreviewRecipient] = useState('');
  const [preview, setPreview] = useState<z.infer<typeof previewSchema>>();
  const [previewError, setPreviewError] = useState<unknown>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } })],
    content: campaign?.message?.html ?? '<p>Hello {{firstName}},</p><p></p>',
    onUpdate: () => setPreview(undefined),
    editorProps: {
      attributes: {
        class: 'campaign-email-editor outline-none prose',
        role: 'textbox',
        'aria-label': 'Email body',
        'aria-multiline': 'true',
      },
    },
  });
  const [audience, setAudience] = useState(
    campaign?.audience ?? audienceSchema.parse({}),
  );
  const [scheduled, setScheduled] = useState(
    campaign?.scheduledAt
      ? new Date(
        new Date(campaign.scheduledAt).getTime() -
        new Date(campaign.scheduledAt).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
      : '',
  );
  const [weekdays, setWeekdays] = useState(campaign?.weekdays ?? []);
  const [startHour, setStartHour] = useState(
    campaign?.startHour?.toString() ?? '',
  );
  const [endHour, setEndHour] = useState(campaign?.endHour?.toString() ?? '');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{
    campaign: Campaign;
    audience: z.infer<typeof audiencePreviewSchema>;
  }>();
  const templates = data.templates;
  const [contactPage, setContactPage] = useState(1);
  const [contactSearch, setContactSearch] = useState('');
  const contactQuery = new URLSearchParams({ limit: '25', page: String(contactPage), search: audience.mode === 'filters' ? audience.filters.search : contactSearch });
  if (audience.mode === 'filters') {
    contactQuery.set('status', audience.filters.status);
    if (audience.filters.fieldKey) { contactQuery.set('fieldKey', audience.filters.fieldKey); contactQuery.set('fieldValue', audience.filters.fieldValue); }
  }
  const contacts = useContactSearch(projectId, contactQuery.toString());
  const settings = data.settings;
  const accounts = data.accounts;
  const selectedAccount = accounts.find(a => a.id === emailAccountId);
  const fields = data.fields;
  async function renderPreview() {
    setPreviewBusy(true);
    setPreviewError(undefined);
    setPreview(undefined);
    setPreviewRecipient(contacts.data?.items.find((contact) => contact.id === previewContactId)?.email ?? '');
    try {
      const template = templates?.find((t) => t.id === templateId);
      if (emailSource === 'template' && !template)
        throw new Error('Choose a template before previewing.');
      setPreview(await operation.submit('preview', {
        name: name.trim() || 'Campaign preview',
        subject: emailSource === 'template' ? template?.subject : subject,
        html: emailSource === 'template' ? template?.html : editor?.getHTML(),
        contactId: previewContactId,
      }, previewSchema));
    } catch (e) {
      setPreviewError(e);
    } finally {
      setPreviewBusy(false);
    }
  }
  async function save(forReview: boolean) {
    setError(undefined);
    if (!emailAccountId) {
      setError(new Error('Choose a mail account.'));
      return;
    }
    setBusy(true);
    try {
      const input: CampaignInput = campaignInputSchema.parse({
        name,
        templateId: emailSource === 'template' ? templateId || null : null,
        message: emailSource === 'write'
          ? { subject, html: editor?.getHTML() ?? '' }
          : null,
        emailAccountId: emailAccountId || undefined,
        audience,
        scheduledAt: scheduled ? new Date(scheduled).toISOString() : null,
        weekdays,
        startHour: startHour === '' ? null : Number(startHour),
        endHour: endHour === '' ? null : Number(endHour),
      });
      if (forReview) {
        const result = await operation.submit('review', { id: draftId.current, input }, z.object({ campaign: campaignSchema, audience: audiencePreviewSchema }));
        draftId.current = result.campaign.id;
        setReview(result);
      } else {
        const c = await operation.submit('save', { id: draftId.current, input }, campaignSchema);
        draftId.current = c.id;
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function deleteDraft() {
    if (!campaign || !window.confirm('Delete this draft?')) return;
    setError(undefined);
    setBusy(true);
    try {
      await operation.submit('delete', { id: draftId.current }, z.unknown());
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!review) return;
    setBusy(true);
    setError(undefined);
    try {
      await operation.submit('launch', { id: review.campaign.id }, campaignSchema);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  if (review)
    return (
      <>
        <h1>Review campaign</h1>
        <h2>{review.campaign.name}</h2>
        <p>
          Mail account:{' '}
          {
            accounts?.find((a) => a.id === review.campaign.emailAccountId)
              ?.name
          }
          <br />
          Sender:{' '}
          {
            accounts?.find((a) => a.id === review.campaign.emailAccountId)
              ?.senderName
          }{' '}
          &lt;
          {accounts?.find((a) => a.id === review.campaign.emailAccountId)
            ?.senderEmail ?? 'Not configured'}
          &gt;
        </p>
        <p>
          {review.campaign.message
            ? `Subject: ${review.campaign.message.subject}`
            : `Template: ${templates?.find((t) => t.id === review.campaign.templateId)?.name ?? 'Unavailable'}`}
        </p>
        <p>
          {review.audience.eligible} eligible recipients;{' '}
          {review.audience.excluded} excluded.
        </p>
        <p>
          {review.campaign.scheduledAt
            ? `Scheduled for ${new Date(review.campaign.scheduledAt).toLocaleString()}`
            : 'Start sending immediately'}
          .
        </p>
        <p>
          Sending window time zone:{' '}
          {settings?.timeZone ?? 'Configure email settings'}. Days:{' '}
          {weekdays.length
            ? weekdays
              .map(
                (d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d],
              )
              .join(', ')
            : 'Every day'}
          . Hours:{' '}
          {startHour || endHour
            ? `${startHour}:00–${endHour}:00`
            : 'Unrestricted'}
          .
        </p>
        <p>
          Confirmation freezes eligible contacts, addresses, sender, and
          personalized content. Suppressed contacts will be excluded again at
          submission.
        </p>
        <details className="my-4">
          <summary>
            Review eligible destination emails ({review.audience.eligible})
          </summary>
          <ul>
            {review.audience.recipients.map((c) => (
              <li key={c.contactId}>{c.email}</li>
            ))}
          </ul>
        </details>
        {review.audience.warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
        <ErrorMessage error={error} />
        <div className="my-4 flex gap-2">
          <Button
            disabled={
              busy ||
              !settings ||
              !accounts?.some(
                (a) => a.id === review.campaign.emailAccountId,
              )
            }
            onClick={() => void confirm()}
          >
            Confirm {scheduled ? 'schedule' : 'launch'}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              navigate(
                `/projects/${projectId}/campaigns/${review.campaign.id}`,
              );
              setReview(undefined);
            }}
          >
            Back to draft
          </Button>
        </div>
      </>
    );
  return (
    <>
      <header className="campaign-builder-heading">
        <Link className="campaign-back-link" to={`/projects/${projectId}/campaigns`}><ArrowLeft size={15} aria-hidden="true" /> All campaigns</Link>
        <h1>{campaign ? 'Edit draft' : 'New campaign'}</h1>
        <p>Select your contacts, compose your email, and review before sending.</p>
      </header>
      <form
        className="campaign-builder"
        onSubmit={(e) => {
          e.preventDefault();
          void save(false);
        }}
      >
        <section className="campaign-panel campaign-audience" aria-label="Campaign recipients">
          <div className="campaign-panel-heading">
            <h2><Users size={15} aria-hidden="true" /> Contacts</h2>
            <span className="campaign-status-badge">{audience.mode === 'selected' ? `${audience.contactIds.length} selected` : audience.mode === 'all' ? 'All contacts' : 'Filtered contacts'}</span>
          </div>
          <div className="campaign-panel-body">
            <p className="text-xs text-muted-foreground">Choose who receives this campaign. Suppressed contacts are excluded.</p>
            <label>
              Audience
              <select
                className="block border p-2"
                value={audience.mode}
                onChange={(e) => {
                  setContactPage(1);
                  setContactSearch('');
                  setAudience({
                    ...audience,
                    mode: audienceSchema.shape.mode.parse(e.target.value),
                  });
                }}
              >
                <option value="all">All project contacts</option>
                <option value="selected">Selected contacts</option>
                <option value="filters">Filtered contacts</option>
              </select>
            </label>
            {audience.mode !== 'filters' && (
              <fieldset className="grid min-w-0 gap-3">
                <legend>
                  {audience.mode === 'selected' ? `Select contacts (${audience.contactIds.length} selected)` : `Project contacts (${contacts.data?.total ?? '…'})`}
                </legend>
                {audience.mode === 'selected' && <label>
                  Find contacts
                  <Input
                    value={contactSearch}
                    onChange={(e) => {
                      setContactSearch(e.target.value);
                      setContactPage(1);
                    }}
                  />
                </label>}
                {audience.mode === 'selected' && <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!contacts.data?.items.some((c) => !c.suppressed)}
                    onClick={() => setAudience({
                      ...audience,
                      contactIds: [...new Set([
                        ...audience.contactIds,
                        ...(contacts.data?.items.filter((c) => !c.suppressed).map((c) => c.id) ?? []),
                      ])],
                    })}
                  >
                    Select this page
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!audience.contactIds.length}
                    onClick={() => setAudience({ ...audience, contactIds: [] })}
                  >
                    Clear selection
                  </Button>
                </div>}
                {contacts.state !== 'idle' && <p className="text-sm">Loading contacts…</p>}

                {contacts.data?.items.length === 0 && <p className="text-sm">No contacts found.</p>}
                <div className="campaign-contact-list">
                  {contacts.data?.items.map((c) => (
                    <label
                      className="campaign-contact-row"
                      key={c.id}
                    >
                      <input
                        className="mt-0.5"
                        type="checkbox"
                        aria-label={c.email}
                        disabled={c.suppressed || audience.mode !== 'selected'}
                        checked={audience.mode === 'all' ? !c.suppressed : audience.contactIds.includes(c.id)}
                        onChange={(e) => setAudience({
                          ...audience,
                          contactIds: e.target.checked
                            ? [...audience.contactIds, c.id]
                            : audience.contactIds.filter((id) => id !== c.id),
                        })}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{[c.firstName, c.lastName].filter(Boolean).join(' ') || c.email}</span>
                        <span className="block truncate text-xs text-muted-foreground">{c.email}</span>
                      </span>
                      <span className={c.suppressed ? 'campaign-contact-suppressed' : 'campaign-contact-active'}>{c.suppressed ? 'Suppressed' : 'Active'}</span>
                    </label>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={contactPage === 1}
                    onClick={() => setContactPage(contactPage - 1)}
                  >
                    Previous contacts
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={contactPage * 25 >= (contacts.data?.total ?? 0)}
                    onClick={() => setContactPage(contactPage + 1)}
                  >
                    Next contacts
                  </Button>
                </div>
              </fieldset>
            )}
            {audience.mode === 'filters' && (
              <>

                <label>
                  Search
                  <Input
                    value={audience.filters.search}
                    onChange={(e) =>
                      setAudience({
                        ...audience,
                        filters: { ...audience.filters, search: e.target.value },
                      })
                    }
                  />
                </label>
                <label>
                  Status
                  <select
                    className="block border p-2"
                    value={audience.filters.status}
                    onChange={(e) =>
                      setAudience({
                        ...audience,
                        filters: {
                          ...audience.filters,
                          status: z
                            .enum(['all', 'active', 'suppressed'])
                            .parse(e.target.value),
                        },
                      })
                    }
                  >
                    <option value="all">All</option>
                    <option value="active">Active</option>
                    <option value="suppressed">Suppressed</option>
                  </select>
                </label>
                <label>
                  Custom field
                  <select
                    className="block border p-2"
                    value={audience.filters.fieldKey ?? ''}
                    onChange={(e) =>
                      setAudience({
                        ...audience,
                        filters: {
                          ...audience.filters,
                          fieldKey: e.target.value || undefined,
                        },
                      })
                    }
                  >
                    <option value="">No custom field filter</option>
                    {fields?.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Field contains
                  <Input
                    value={audience.filters.fieldValue}
                    onChange={(e) =>
                      setAudience({
                        ...audience,
                        filters: {
                          ...audience.filters,
                          fieldValue: e.target.value,
                        },
                      })
                    }
                  />
                </label>
              </>
            )}
          </div>
        </section>
        <section className="campaign-panel campaign-composer" aria-label="Campaign email">
          <div className="campaign-panel-heading">
            <div
              className="campaign-tabs"
              role="tablist"
              aria-label="Email editor mode"
              onKeyDown={(e) => {
                if (previewBusy) return;
                const next = e.key === 'ArrowRight' || e.key === 'End'
                  ? 'preview'
                  : e.key === 'ArrowLeft' || e.key === 'Home' ? 'compose' : null;
                if (!next) return;
                e.preventDefault();
                setActiveTab(next);
                e.currentTarget.querySelector<HTMLButtonElement>(`#campaign-${next}-tab`)?.focus();
              }}
            >
              <button type="button" role="tab" id="campaign-compose-tab" aria-controls="campaign-compose-panel" aria-selected={activeTab === 'compose'} tabIndex={activeTab === 'compose' ? 0 : -1} disabled={previewBusy} onClick={() => setActiveTab('compose')}>
                <Mail size={14} aria-hidden="true" /> Compose
              </button>
              <button type="button" role="tab" id="campaign-preview-tab" aria-controls="campaign-preview-panel" aria-selected={activeTab === 'preview'} tabIndex={activeTab === 'preview' ? 0 : -1} disabled={previewBusy} onClick={() => setActiveTab('preview')}>
                <Eye size={14} aria-hidden="true" /> Preview
              </button>
            </div>
            <span className="campaign-status-badge">Draft</span>
          </div>
          <div className="campaign-panel-body">
            <div className="campaign-meta">
              <label>
                Name
                <Input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                Send from mail account
                <select
                  className="block w-full border p-2"
                  value={emailAccountId}
                  onChange={(e) => setEmailAccountId(e.target.value)}
                  required
                >
                  <option value="">Choose a mail account</option>
                  {accounts?.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} — {a.senderEmail}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedAccount && (
              <p className="text-sm">
                Sender: {selectedAccount.senderName} &lt;
                {selectedAccount.senderEmail}&gt;
              </p>
            )}
            {activeTab === 'compose' ? (
              <div id="campaign-compose-panel" role="tabpanel" aria-labelledby="campaign-compose-tab" className="campaign-compose-content">
                <label>
                  Email source
                  <select
                    className="block w-full rounded-md border p-2"
                    value={emailSource}
                    onChange={(e) => { setEmailSource(e.target.value); setPreview(undefined); }}
                  >
                    <option value="write">Write an email</option>
                    <option value="template">Use a template</option>
                  </select>
                </label>
                {emailSource === 'template' ? (
                  <>
                    <label>
                      Template
                      <select
                        className="block w-full rounded-md border p-2"
                        value={templateId}
                        onChange={(e) => { setTemplateId(e.target.value); setPreview(undefined); }}
                        required
                      >
                        <option value="">Choose a template</option>
                        {templates?.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </label>
                    {templates?.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        No templates yet. Choose “Write an email” to compose here.
                      </p>
                    )}

                  </>
                ) : (
                  <>
                    <label>
                      Subject
                      <Input
                        required
                        value={subject}
                        onChange={(e) => { setSubject(e.target.value); setPreview(undefined); }}
                      />
                    </label>
                    <div
                      className="campaign-formatting-toolbar"
                      role="toolbar"
                      aria-label="Text formatting"
                    >
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => editor?.chain().focus().toggleBold().run()}
                      >
                        Bold
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => editor?.chain().focus().toggleItalic().run()}
                      >
                        Italic
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => editor?.chain().focus().toggleBulletList().run()}
                      >
                        Bullet list
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          const href = window.prompt('Link URL (https://, http:// or mailto:)');
                          if (href && /^(https?:|mailto:)/i.test(href))
                            editor?.chain().focus().setLink({ href }).run();
                        }}
                      >
                        Link
                      </Button>
                    </div>
                    <EditorContent editor={editor} />
                    <p className="text-xs text-muted-foreground">
                      Personalize with {'{{firstName}}, {{company}}, or {{custom.field_key}}'}.
                      An unsubscribe link is added automatically when configured.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div id="campaign-preview-panel" role="tabpanel" aria-labelledby="campaign-preview-tab" className="campaign-preview-content">
                <div className="campaign-preview-controls">
                  <label>
                    Preview contact
                    <select value={previewContactId} disabled={previewBusy} onChange={(e) => { setPreviewContactId(e.target.value); setPreview(undefined); }}>
                      <option value="">Choose a contact</option>
                      {contacts.data?.items.map((contact) => <option key={contact.id} value={contact.id}>{contact.email}</option>)}
                    </select>
                  </label>
                  <Button type="button" size="sm" variant="outline" disabled={!contacts.data?.items.some((contact) => contact.id === previewContactId) || previewBusy} onClick={() => void renderPreview()}>
                    {previewBusy ? 'Rendering…' : 'Render preview'}
                  </Button>
                </div>
                <ErrorMessage error={previewError} />
                {preview ? (
                  <div className="campaign-email-preview">
                    <div className="campaign-email-envelope">
                      <h3>{preview.subject}</h3>
                      <p>From: {selectedAccount?.senderEmail ?? 'Choose a mail account'}</p>
                      <p>To: {previewRecipient}</p>
                    </div>
                    <iframe title="Campaign email preview" sandbox="" srcDoc={preview.html} />
                    {preview.warnings.map((warning) => <p key={warning} className="px-4 py-2 text-xs">{warning}</p>)}
                  </div>
                ) : (
                  <div className="campaign-preview-empty">
                    <Eye size={28} aria-hidden="true" />
                    <h3>See the email your contact will receive</h3>
                    <p>Choose a contact and render the current email with their details.</p>
                  </div>
                )}
              </div>
            )}
            <details
              className="border-t pt-4"
              open={Boolean(campaign?.scheduledAt || campaign?.weekdays.length || campaign?.startHour != null)}
            >
              <summary className="cursor-pointer text-sm font-medium">Schedule and sending window</summary>
              <div className="mt-4 grid gap-4">
                <label>
                  Scheduled time (leave empty to send immediately)
                  <Input
                    type="datetime-local"
                    value={scheduled}
                    onChange={(e) => setScheduled(e.target.value)}
                  />
                </label>
                <p className="text-sm">
                  Scheduled time uses your browser time zone (
                  {Intl.DateTimeFormat().resolvedOptions().timeZone}) and is stored in
                  UTC. Sending windows use the project time zone (
                  {settings?.timeZone ?? 'configure in Settings'}).
                </p>
                <fieldset>
                  <legend>Allowed weekdays (none means every day)</legend>
                  <div className="flex flex-wrap gap-4">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, i) => (
                      <label key={day}>
                        <input
                          type="checkbox"
                          checked={weekdays.includes(i)}
                          onChange={(e) =>
                            setWeekdays(
                              e.target.checked
                                ? [...weekdays, i]
                                : weekdays.filter((d) => d !== i),
                            )
                          }
                        />{' '}
                        {day}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div className="flex gap-4">
                  <label>
                    Start hour (0–23)
                    <Input
                      type="number"
                      min="0"
                      max="23"
                      value={startHour}
                      onChange={(e) => setStartHour(e.target.value)}
                    />
                  </label>
                  <label>
                    End hour (1–24)
                    <Input
                      type="number"
                      min="1"
                      max="24"
                      value={endHour}
                      onChange={(e) => setEndHour(e.target.value)}
                    />
                  </label>
                </div>
                <p className="text-sm">
                  Leave both hours empty for unrestricted sending.
                </p>
              </div>
            </details>
          </div>
        </section>
        <div className="campaign-action-bar">
          <div className="campaign-action-summary"><ShieldCheck size={17} aria-hidden="true" /><span>{audience.mode === 'selected' ? `${audience.contactIds.length} contacts selected` : audience.mode === 'all' ? 'All eligible project contacts' : 'Contacts matching your filters'}<small>{scheduled ? 'Scheduled sending' : 'Ready when you are'} · Review required before launch</small></span></div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy}>Save draft</Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void save(true)}
            >
              <Send size={14} aria-hidden="true" /> Review recipients and launch
            </Button>
          </div>
        </div>
      </form>
      {campaign && (
        <Button
          className="mt-4"
          variant="destructive"
          disabled={busy}
          onClick={() => void deleteDraft()}
        >
          Delete draft
        </Button>
      )}
      <ErrorMessage error={error} />
    </>
  );
}
