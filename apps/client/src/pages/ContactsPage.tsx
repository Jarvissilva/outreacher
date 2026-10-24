import { ContactForm } from '@/components/contacts/ContactForm';
import { ImportContacts } from '@/components/contacts/ImportContacts';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { api, mutate } from '@/lib/api';
import { projectPath, routeOperation, useRouteAction } from '@/lib/route-data';
import type { Contact, Project } from '@outreacher/shared';
import { contactInputSchema, contactListSchema, csvHeadersSchema, fieldsSchema, importPreviewSchema, importRequestSchema, importResultSchema, overviewSchema } from '@outreacher/shared';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Pencil,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  UserCheck,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { Link, useLoaderData, useLocation, useNavigation, useOutletContext, useSearchParams } from 'react-router';
import { z } from 'zod';

export function ContactsPage() {
  const { id: projectId } = useOutletContext<Project>();
  const data = useLoaderData<typeof loader>();
  const [committedParams, setParams] = useSearchParams();
  const navigation = useNavigation();
  const location = useLocation();
  const params = navigation.location?.pathname === location.pathname ? new URLSearchParams(navigation.location.search) : committedParams;
  const search = params.get('search') ?? '';
  const fieldKey = params.get('fieldKey') ?? '';
  const fieldValue = params.get('fieldValue') ?? '';
  const status = params.get('status') ?? 'all';
  const page = Math.max(1, Number(params.get('page')) || 1);
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.set('page', '1');
    if (key === 'fieldKey') next.delete('fieldValue');
    setParams(next, { replace: true });
  }
  const setSearch = (v: string) => filter('search', v);
  const setFieldKey = (v: string) => filter('fieldKey', v);
  const setFieldValue = (v: string) => filter('fieldValue', v);
  const setStatus = (v: string) => filter('status', v);
  const setPage = (value: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(value));
    setParams(next);
  };
  const [form, setForm] = useState<{ contact?: Contact } | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [notice, setNotice] = useState('');
  const contacts = data.contacts;
  const fields = data.fields;
  const overview = data.overview;
  const remove = useRouteAction();
  const removing = remove.busy;
  const [removeError, setRemoveError] = useState<unknown>();
  async function deleteContact(contact: Contact) {
    setRemoveError(undefined);
    try {
      await remove.submit('delete-contact', { id: contact.id }, z.unknown());
      setDeleting(null);
      setPage(1);
      setNotice('Contact deleted. Its email and suppression preference are preserved.');
    } catch (e) { setRemoveError(e); }
  }
  const items = contacts.items ?? [];
  const total = contacts.total ?? 0;
  const hasFilters = Boolean(search || fieldKey || status !== 'all');

  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Contacts</h1>
        </div>
        <div className="actions">
          <Button
            variant="outline"
            onClick={() => setImporting(true)}
          >
            <ArrowDownToLine size={16} />
            Import CSV
          </Button>
          <Button onClick={() => setForm({})}>
            <Plus size={17} />
            Add contact
          </Button>
        </div>
      </div>
      <div className="stats-grid">
        {[
          {
            label: 'Total contacts',
            value: overview.contacts,
            icon: Users,
          },
          {
            label: 'Ready for outreach',
            value: overview.active,
            icon: UserCheck,
          },
          {
            label: 'Do not contact',
            value: overview.suppressed,
            icon: UserMinus,
          },
        ].map(({ label, value, icon: Icon }) => (
          <div className="stat-card" key={label}>
            <div className="stat-top">
              <span>{label}</span>
              <Icon size={17} />
            </div>
            <strong>
              {value === undefined ? '—' : value.toLocaleString()}
            </strong>
          </div>
        ))}
      </div>
      {notice && (
        <div className="alert success" role="status">
          <span>{notice}</span>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Dismiss notification"
            onClick={() => setNotice('')}
          >
            <X size={16} />
          </Button>
        </div>
      )}
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>
              All contacts <span className="count-badge">{total}</span>
            </h2>
          </div>
          <Link
            to={`/projects/${projectId}/settings#custom-fields`}
            className="text-link"
          >
            <SlidersHorizontal size={15} />
            Custom fields
          </Link>
        </div>
        <div className="toolbar">
          <label className="search-input">
            <Search size={17} />
            <Input
              aria-label="Search contacts"
              placeholder="Search name, email, company…"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
              }}
            />
          </label>
          <select
            aria-label="Filter by outreach status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
            }}
          >
            <option value="all">All statuses</option>
            <option value="active">Ready for outreach</option>
            <option value="suppressed">Do not contact</option>
          </select>
        </div>
        {!!fields.length && (
          <div className="toolbar custom-filter">
            <select
              aria-label="Filter by custom field"
              value={fieldKey}
              onChange={(event) => {
                setFieldKey(event.target.value);
              }}
            >
              <option value="">Any custom field</option>
              {fields.map((field) => (
                <option value={field.key} key={field.id}>
                  {field.label}
                </option>
              ))}
            </select>
            {fieldKey && (
              <Input
                aria-label="Custom field contains"
                placeholder="Contains…"
                value={fieldValue}
                onChange={(event) => {
                  setFieldValue(event.target.value);
                }}
              />
            )}
          </div>
        )}
        {!items.length ? (
          <EmptyState
            icon={<Users size={28} />}
            title={
              hasFilters ? 'No contacts match these filters' : 'No contacts yet'
            }
            description={
              hasFilters
                ? 'Try a different search or clear your filters.'
                : 'Add a contact or import a CSV file.'
            }
            action={
              hasFilters ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setParams({});
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button onClick={() => setForm({})}>
                  <Plus size={16} />
                  Add your first contact
                </Button>
              )
            }
          />
        ) : (
          <>
            <div className="table-scroll">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell>
                        <Button
                          variant="ghost"
                          className="contact-name h-auto justify-start p-0"
                          onClick={() => setForm({ contact })}
                        >
                          <span className="avatar">
                            {(contact.firstName || contact.email)
                              .charAt(0)
                              .toUpperCase()}
                          </span>
                          <span>
                            <strong>
                              {[contact.firstName, contact.lastName]
                                .filter(Boolean)
                                .join(' ') || contact.email}
                            </strong>
                            <small>{contact.email}</small>
                          </span>
                        </Button>
                      </TableCell>
                      <TableCell>
                        {contact.company || <span className="muted">—</span>}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`status ${contact.suppressed ? 'muted-status' : 'active'}`}
                        >
                          <span className="status-dot" />
                          {contact.suppressed ? 'Do not contact' : 'Ready'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="actions">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit ${contact.email}`}
                            onClick={() => setForm({ contact })}
                          >
                            <Pencil size={16} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive"
                            aria-label={`Delete ${contact.email}`}
                            onClick={() => {
                              setRemoveError(undefined);
                              setDeleting(contact);
                            }}
                          >
                            <Trash2 size={16} />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="pagination">
              <span>
                Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of{' '}
                {total} contacts
              </span>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => {
                    setPage(page - 1);
                  }}
                >
                  <ArrowLeft size={14} />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * 20 >= total}
                  onClick={() => {
                    setPage(page + 1);
                  }}
                >
                  Next
                  <ArrowRight size={14} />
                </Button>
              </div>
            </div>
          </>
        )}
      </section>
      {form && (
        <ContactForm
          contact={form.contact}
          projectId={projectId}
          customFields={fields}
          onClose={() => setForm(null)}
        />
      )}
      {importing && (
        <ImportContacts
          projectId={projectId}
          customFields={fields}
          onClose={() => setImporting(false)}
        />
      )}
      {deleting && (
        <Modal
          title="Delete contact?"
          description={`Remove ${deleting.email} from your active contacts. Its email remains reserved to prevent accidental reimport.`}
          onClose={() => {
            if (!removing) setDeleting(null);
          }}
        >
          <div className="modal-body">
            <ErrorMessage error={removeError} />
            <p>This contact will no longer appear in the contact list.</p>
          </div>
          <div className="modal-footer">
            <Button
              variant="outline"
              disabled={removing}
              onClick={() => setDeleting(null)}
            >
              Keep contact
            </Button>
            <Button
              variant="destructive"
              disabled={removing}
              onClick={() => void deleteContact(deleting)}
            >
              {removing ? 'Deleting…' : 'Delete contact'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export async function loader({ params, request }: LoaderFunctionArgs) {
  const base = projectPath(params.projectId);
  const query = new URL(request.url).searchParams;
  const [contacts, fields, overview] = await Promise.all([
    api(`${base}/contacts?${query}`, contactListSchema, 'GET', undefined, request.signal),
    api(`${base}/custom-fields`, fieldsSchema, 'GET', undefined, request.signal),
    api(`${base}/overview`, overviewSchema, 'GET', undefined, request.signal),
  ]);
  return { contacts, fields, overview };
}
export function contactSearchLoader({ params, request }: LoaderFunctionArgs) {
  return api(`${projectPath(params.projectId)}/contacts?${new URL(request.url).searchParams}`, contactListSchema, 'GET', undefined, request.signal);
}
export async function action({ params, request }: ActionFunctionArgs) {
  return routeOperation(request, async ({ intent, payload }) => {
    const kind = z.enum(['save-contact', 'delete-contact', 'import-headers', 'import-preview', 'import-commit']).parse(intent);
    const base = `${projectPath(params.projectId)}/contacts`;
    if (kind === 'delete-contact') { const { id } = z.object({ id: z.string().min(1) }).parse(payload); return mutate(`${base}/${id}`, 'DELETE', undefined, request.signal); }
    if (kind === 'save-contact') {
      const { id, input } = z.object({ id: z.string().optional(), input: contactInputSchema }).parse(payload);
      return mutate(`${base}${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', input, request.signal);
    }
    if (kind === 'import-headers') return api(`${base}/import/headers`, csvHeadersSchema, 'POST', z.object({ csv: z.string() }).parse(payload), request.signal);
    const input = importRequestSchema.parse(payload);
    return kind === 'import-preview'
      ? api(`${base}/import/preview`, importPreviewSchema, 'POST', input, request.signal)
      : api(`${base}/import`, importResultSchema, 'POST', input, request.signal);
  });
}
