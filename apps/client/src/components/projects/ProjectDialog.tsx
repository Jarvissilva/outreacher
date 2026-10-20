import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { projectInputSchema, projectSchema } from '@outreachit/shared';
import type { Project } from '@outreachit/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Modal } from '@/components/feedback/Modal';

export function ProjectDialog({
  project,
  onClose,
  onCreated,
}: {
  project?: Project;
  onClose(): void;
  onCreated?(project: Project): void;
}) {
  const client = useQueryClient();
  const [name, setName] = useState(project?.name ?? '');
  const save = useMutation({
    mutationFn: () =>
      api(
        `/projects${project ? `/${project.id}` : ''}`,
        projectSchema,
        project ? 'PUT' : 'POST',
        projectInputSchema.parse({ name }),
      ),
    onSuccess: async (saved) => {
      // Populate the directory before navigating to a newly created project.
      client.setQueryData<Project[]>(['projects'], (current) => {
        const items = current ?? [];
        return project
          ? items.map((item) => (item.id === saved.id ? saved : item))
          : [...items, saved];
      });
      onClose();
      if (!project) onCreated?.(saved);
      await client.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  return (
    <Modal
      title={project ? 'Rename project' : 'Create project'}
      onClose={() => {
        if (!save.isPending) onClose();
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
            disabled={save.isPending}
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button disabled={save.isPending}>
            {save.isPending
              ? 'Saving…'
              : project
                ? 'Save project'
                : 'Create project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
