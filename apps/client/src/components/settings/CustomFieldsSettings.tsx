import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Braces, Pencil, Plus, Trash2 } from 'lucide-react';
import { fieldInputSchema, fieldsSchema } from '@outreachit/shared';
import type { CustomField } from '@outreachit/shared';
import { api, mutate } from '@/lib/api';
import { invalidateProject } from '@/lib/projects';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Modal } from '@/components/feedback/Modal';

export function CustomFieldsSettings({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const fields = useQuery({
    queryKey: ['project', projectId, 'fields'],
    queryFn: () => api(`/projects/${projectId}/custom-fields`, fieldsSchema),
  });
  const [editing, setEditing] = useState<{ field?: CustomField } | null>(null);
  const [deleting, setDeleting] = useState<CustomField | null>(null);
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const save = useMutation({
    mutationFn: () =>
      mutate(
        `/projects/${projectId}/custom-fields${editing?.field ? `/${editing.field.id}` : ''}`,
        editing?.field ? 'PUT' : 'POST',
        fieldInputSchema.parse({ label, key }),
      ),
    onSuccess: async () => {
      setEditing(null);
      await invalidateProject(queryClient, projectId);
    },
  });
  const remove = useMutation({
    mutationFn: (field: CustomField) =>
      mutate(`/projects/${projectId}/custom-fields/${field.id}`, 'DELETE'),
    onSuccess: async () => {
      setDeleting(null);
      await invalidateProject(queryClient, projectId);
    },
  });
  function open(field?: CustomField) {
    save.reset();
    setLabel(field?.label ?? '');
    setKey(field?.key ?? '');
    setEditing({ field });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h2 id="custom-fields-heading">Custom fields</h2>
        </div>
        <Button onClick={() => open()}>
          <Plus size={17} />
          Create field
        </Button>
      </div>
      <ErrorMessage error={fields.error} />
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>
              Contact fields{' '}
              <span className="count-badge">{fields.data?.length ?? 0}</span>
            </h2>
            <p>
              Text fields appear on contact forms and in CSV column mapping.
            </p>
          </div>
        </div>
        {fields.isPending ? (
          <div className="loading-state" role="status">
            Loading custom fields…
          </div>
        ) : fields.isError ? (
          <EmptyState
            icon={<Braces size={28} />}
            title="Custom fields are unavailable"
            description="Check the server connection and try again."
            action={
              <Button variant="outline" onClick={() => void fields.refetch()}>
                Try again
              </Button>
            }
          />
        ) : !fields.data.length ? (
          <EmptyState
            icon={<Braces size={28} />}
            title="No custom fields yet"
            description="Create a text field to store additional contact details."
            action={
              <Button onClick={() => open()}>
                <Plus size={16} />
                Create your first field
              </Button>
            }
          />
        ) : (
          <div className="catalog-list">
            {fields.data.map((field) => (
              <div className="catalog-row" key={field.id}>
                <div>
                  <strong>{field.label}</strong>
                  <code>{field.key}</code>
                  <span className="muted">Text</span>
                </div>
                <div className="actions">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${field.label}`}
                    onClick={() => open(field)}
                  >
                    <Pencil size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    aria-label={`Delete ${field.label}`}
                    onClick={() => {
                      remove.reset();
                      setDeleting(field);
                    }}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {editing && (
        <Modal
          title={editing.field ? 'Edit field' : 'Create custom field'}
          onClose={() => {
            if (!save.isPending) setEditing(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <div className="modal-body">
              <ErrorMessage error={save.error} />
              <label>
                Label
                <Input
                  required
                  maxLength={80}
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="e.g. Interest"
                />
              </label>
              <label className="block-label">
                Field key
                <Input
                  required
                  maxLength={40}
                  pattern="[a-z][a-z0-9_]*"
                  disabled={!!editing.field}
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder="e.g. interest"
                />
                <small>
                  Lowercase letters, numbers, and underscores. The key stays
                  fixed after creation.
                </small>
              </label>
            </div>
            <div className="modal-footer">
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
              <Button disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save field'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {deleting && (
        <Modal
          title={`Delete “${deleting.label}”?`}
          description="Fields with saved values cannot be deleted. Clear those values from contacts first."
          onClose={() => {
            if (!remove.isPending) setDeleting(null);
          }}
        >
          <div className="modal-body">
            <ErrorMessage error={remove.error} />
          </div>
          <div className="modal-footer">
            <Button
              variant="outline"
              disabled={remove.isPending}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => remove.mutate(deleting)}
            >
              {remove.isPending ? 'Deleting…' : 'Delete field'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
