import type { action } from '@/layouts/RootLayout';
import { useEffect, useState } from 'react';
import { useFetcher } from 'react-router';

import type { Project } from '@outreacher/shared';

import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Modal } from '@/components/feedback/Modal';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ProjectDialog({
  project,
  onClose,

}: {
  project?: Project;
  onClose(): void;

}) {
  const [name, setName] = useState(project?.name ?? '');
  const save = useFetcher<typeof action>();
  const busy = save.state !== 'idle';
  useEffect(() => { if (save.state === 'idle' && save.data?.ok) onClose(); }, [save.state, save.data, onClose]);
  return (
    <Modal
      title={project ? 'Rename project' : 'Create project'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <save.Form method="post" action="/"
        onSubmit={(event) => {
          event.preventDefault();
          void save.submit(JSON.stringify({ intent: project ? 'rename-project' : 'create-project', payload: { id: project?.id, name } }), { method: 'post', encType: 'application/json', action: '/' });
        }}
      >
        <div className="modal-body">
          <ErrorMessage error={save.data && !save.data.ok ? new Error(save.data.error) : undefined} />
          <label>
            Project name
            <Input
              autoFocus
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </div>
        <div className="modal-footer">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button disabled={busy}>
            {busy
              ? 'Saving…'
              : project
                ? 'Save project'
                : 'Create project'}
          </Button>
        </div>
      </save.Form>
    </Modal>
  );
}
