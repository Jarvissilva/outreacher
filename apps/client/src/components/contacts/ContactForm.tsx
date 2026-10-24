import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { action } from '@/pages/ContactsPage';
import { useEffect, useState } from 'react';
import { useFetcher } from 'react-router';

import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Modal } from '@/components/feedback/Modal';
import type { Contact, ContactInput, CustomField } from '@outreacher/shared';

const fields = [
  ['email', 'Email address', 'email'],
  ['firstName', 'First name', 'text'],
  ['lastName', 'Last name', 'text'],
  ['company', 'Company', 'text'],
  ['phone', 'Phone', 'tel'],
  ['website', 'Website', 'url'],
  ['city', 'City', 'text'],
  ['state', 'State / region', 'text'],
  ['country', 'Country', 'text'],
  ['source', 'Source', 'text'],
] as const;

export function ContactForm({
  contact,
  projectId,
  customFields,
  onClose,
}: {
  contact?: Contact;
  projectId: string;
  customFields: CustomField[];
  onClose(): void;
}) {
  const save = useFetcher<typeof action>();
  const busy = save.state !== 'idle';
  useEffect(() => { if (save.state === 'idle' && save.data?.ok) onClose(); }, [save.state, save.data, onClose]);
  const [values, setValues] = useState<ContactInput>(() =>
    contact
      ? {
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        company: contact.company,
        phone: contact.phone,
        website: contact.website,
        city: contact.city,
        state: contact.state,
        country: contact.country,
        source: contact.source,
        notes: contact.notes,
        customFields: contact.customFields,
        suppressed: contact.suppressed,
      }
      : {
        email: '',
        firstName: '',
        lastName: '',
        company: '',
        phone: '',
        website: '',
        city: '',
        state: '',
        country: '',
        source: '',
        notes: '',
        customFields: {},
        suppressed: false,
      },
  );
  const [email, setEmail] = useState(contact?.email ?? '');
  return (
    <Modal
      title={contact ? 'Edit contact' : 'Add contact'}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <save.Form method="post"
        onSubmit={(event) => {
          event.preventDefault();
          void save.submit(JSON.stringify({ intent: 'save-contact', payload: { id: contact?.id, input: { ...values, email } } }), { method: 'post', encType: 'application/json', action: `/projects/${projectId}?index` });
        }}
      >
        <div className="modal-body">
          <ErrorMessage error={save.data && !save.data.ok ? new Error(save.data.error) : undefined} />
          <div className="form-grid">
            {fields.map(([key, label, type]) => (
              <label key={key}>
                {label}
                {key === 'email' && <span className="required"> *</span>}
                <Input
                  type={type}
                  required={key === 'email'}
                  maxLength={
                    key === 'email' ? 254 : key === 'website' ? 500 : 160
                  }
                  value={key === 'email' ? email : values[key]}
                  onChange={(event) =>
                    key === 'email'
                      ? setEmail(event.target.value)
                      : setValues({ ...values, [key]: event.target.value })
                  }
                />
              </label>
            ))}
          </div>
          {customFields.length > 0 && (
            <>
              <h3 className="section-label">Custom fields</h3>
              <div className="form-grid">
                {customFields.map((field) => (
                  <label key={field.id}>
                    {field.label}
                    <Input
                      maxLength={1000}
                      value={values.customFields[field.key] ?? ''}
                      onChange={(event) =>
                        setValues({
                          ...values,
                          customFields: {
                            ...values.customFields,
                            [field.key]: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </>
          )}
          <label className="block-label">
            Notes
            <Textarea
              rows={3}
              maxLength={4000}
              value={values.notes}
              onChange={(event) =>
                setValues({ ...values, notes: event.target.value })
              }
            />
          </label>
          <label className="suppression-option">
            <input
              type="checkbox"
              checked={values.suppressed}
              onChange={(event) =>
                setValues({ ...values, suppressed: event.target.checked })
              }
            />
            <span>
              <strong>Do not contact</strong>
              <small>Exclude this person from email outreach.</small>
            </span>
          </label>
        </div>
        <div className="modal-footer">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button disabled={busy}>
            {busy ? 'Saving…' : 'Save contact'}
          </Button>
        </div>
      </save.Form>
    </Modal>
  );
}
