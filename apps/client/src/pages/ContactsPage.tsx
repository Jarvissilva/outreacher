import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useOutletContext } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Pencil,
  Trash2,
  Plus,
  Search,
  SlidersHorizontal,
  Users,
  UserCheck,
  UserMinus,
  X,
} from 'lucide-react';
import {
  contactListSchema,
  fieldsSchema,
  overviewSchema,
} from '@outreachit/shared';
import type { Contact, Project } from '@outreachit/shared';
import { api, mutate } from '@/lib/api';
import { invalidateProject } from '@/lib/projects';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Modal } from '@/components/feedback/Modal';
import { ContactForm } from '@/components/contacts/ContactForm';
import { ImportContacts } from '@/components/contacts/ImportContacts';

export function ContactsPage() {
  const { id: projectId } = useOutletContext<Project>();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [fieldKey, setFieldKey] = useState('');
  const [fieldValue, setFieldValue] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<{ contact?: Contact } | null>(null);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [notice, setNotice] = useState('');
  const contacts = useQuery({
    queryKey: [
      'project',
      projectId,
      'contacts',
      search,
      status,
      page,
      fieldKey,
      fieldValue,
    ],
    queryFn: () =>
      api(
        `/projects/${projectId}/contacts?${new URLSearchParams({ search, status, page: String(page), ...(fieldKey ? { fieldKey, fieldValue } : {}) })}`,
        contactListSchema,
      ),
  });
  const fields = useQuery({
    queryKey: ['project', projectId, 'fields'],
    queryFn: () => api(`/projects/${projectId}/custom-fields`, fieldsSchema),
  });
  const overview = useQuery({
    queryKey: ['project', projectId, 'overview'],
    queryFn: () => api(`/projects/${projectId}/overview`, overviewSchema),
  });
  const remove = useMutation({
    mutationFn: (contact: Contact) =>
      mutate(`/projects/${projectId}/contacts/${contact.id}`, 'DELETE'),
    onSuccess: async () => {
      setDeleting(null);
      setPage(1);
      setNotice(
        'Contact deleted. Its email and suppression preference are preserved.',
      );
      await invalidateProject(queryClient, projectId);
    },
  });
  const items = contacts.data?.items ?? [];
  const total = contacts.data?.total ?? 0;
  const resetPage = () => {
    setPage(1);
  };
  const canEdit = fields.isSuccess;
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
            disabled={!canEdit}
            onClick={() => setImporting(true)}
          >
            <ArrowDownToLine size={16} />
            Import CSV
          </Button>
          <Button disabled={!canEdit} onClick={() => setForm({})}>
            <Plus size={17} />
            Add contact
          </Button>
        </div>
      </div>
      <div className="stats-grid">
        {[
          {
            label: 'Total contacts',
            value: overview.data?.contacts,
            icon: Users,
          },
          {
            label: 'Ready for outreach',
            value: overview.data?.active,
            icon: UserCheck,
          },
          {
            label: 'Do not contact',
            value: overview.data?.suppressed,
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
      <ErrorMessage error={contacts.error ?? fields.error ?? overview.error} />
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
                resetPage();
              }}
            />
          </label>
          <select
            aria-label="Filter by outreach status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              resetPage();
            }}
          >
            <option value="all">All statuses</option>
            <option value="active">Ready for outreach</option>
            <option value="suppressed">Do not contact</option>
          </select>
        </div>
        {!!fields.data?.length && (
          <div className="toolbar custom-filter">
            <select
              aria-label="Filter by custom field"
              value={fieldKey}
              onChange={(event) => {
                setFieldKey(event.target.value);
                setFieldValue('');
                resetPage();
              }}
            >
              <option value="">Any custom field</option>
              {fields.data.map((field) => (
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
                  resetPage();
                }}
              />
            )}
          </div>
        )}
        {contacts.isPending ? (
          <div className="loading-state" role="status">
            Loading your contacts…
          </div>
        ) : contacts.isError ? (
          <EmptyState
            icon={<Users size={28} />}
            title="Your contacts are unavailable"
            description="Check the database connection, then try again."
            action={
              <Button
                variant="outline"
                onClick={() => void invalidateProject(queryClient, projectId)}
              >
                Try again
              </Button>
            }
          />
        ) : !items.length ? (
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
                    setSearch('');
                    setStatus('all');
                    setFieldKey('');
                    setFieldValue('');
                    resetPage();
                  }}
                >
                  Clear filters
                </Button>
              ) : (
                <Button disabled={!canEdit} onClick={() => setForm({})}>
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
                          disabled={!canEdit}
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
                            disabled={!canEdit}
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
                              remove.reset();
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
          customFields={fields.data ?? []}
          onClose={() => setForm(null)}
        />
      )}
      {importing && (
        <ImportContacts
          projectId={projectId}
          customFields={fields.data ?? []}
          onClose={() => setImporting(false)}
        />
      )}
      {deleting && (
        <Modal
          title="Delete contact?"
          description={`Remove ${deleting.email} from your active contacts. Its email remains reserved to prevent accidental reimport.`}
          onClose={() => {
            if (!remove.isPending) setDeleting(null);
          }}
        >
          <div className="modal-body">
            <ErrorMessage error={remove.error} />
            <p>This contact will no longer appear in the contact list.</p>
          </div>
          <div className="modal-footer">
            <Button
              variant="outline"
              disabled={remove.isPending}
              onClick={() => setDeleting(null)}
            >
              Keep contact
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate(deleting)}
            >
              {remove.isPending ? 'Deleting…' : 'Delete contact'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
