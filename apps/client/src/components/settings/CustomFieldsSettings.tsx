import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRouteAction } from '@/lib/route-data';
import type { loader } from '@/pages/SettingsPage';
import { Braces, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useLoaderData } from 'react-router';
import { z } from 'zod';

import { EmptyState } from '@/components/feedback/EmptyState';
import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Modal } from '@/components/feedback/Modal';
import type { CustomField } from '@outreacher/shared';

export function CustomFieldsSettings({ projectId }: { projectId: string }) {
  const { fields } = useLoaderData<typeof loader>();
  const operation = useRouteAction(`/projects/${projectId}/settings`);
  const [error, setError] = useState<unknown>();
  async function save() {
    setError(undefined);
    try { await operation.submit('save-field', { id: editing?.field?.id, input: { label, key } }, z.unknown()); setEditing(null); } catch (e) { setError(e); }
  }
  async function remove(field: CustomField) {
    setError(undefined);
    try { await operation.submit('delete-field', { id: field.id }, z.unknown()); setDeleting(null); } catch (e) { setError(e); }
  }
  const [editing, setEditing] = useState<{ field?: CustomField } | null>(null);
  const [deleting, setDeleting] = useState<CustomField | null>(null);
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  function open(field?: CustomField) {
    setError(undefined);
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
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>
              Contact fields{' '}
              <span className="count-badge">{fields.length ?? 0}</span>
            </h2>
            <p>
              Text fields appear on contact forms and in CSV column mapping.
            </p>
          </div>
        </div>
        {!fields.length ? (
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
            {fields.map((field) => (
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
                      setError(undefined);
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
            if (!operation.busy) setEditing(null);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="modal-body">
              <ErrorMessage error={error} />
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
                disabled={operation.busy}
                onClick={() => setEditing(null)}
              >
                Cancel
              </Button>
              <Button disabled={operation.busy}>
                {operation.busy ? 'Saving…' : 'Save field'}
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
            if (!operation.busy) setDeleting(null);
          }}
        >
          <div className="modal-body">
            <ErrorMessage error={error} />
          </div>
          <div className="modal-footer">
            <Button
              variant="outline"
              disabled={operation.busy}
              onClick={() => setDeleting(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={operation.busy}
              onClick={() => void remove(deleting)}
            >
              {operation.busy ? 'Deleting…' : 'Delete field'}
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
