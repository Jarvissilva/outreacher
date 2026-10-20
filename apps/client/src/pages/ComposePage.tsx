import { useState } from 'react';
import { useOutletContext, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { messageSchema } from '@outreachit/shared';
import type { Project } from '@outreachit/shared';
import { api } from '@/lib/api';
import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { MessageComposer } from '@/components/messages/MessageComposer';

export function ComposePage() {
  const project = useOutletContext<Project>();
  const [revision, setRevision] = useState(0);
  const { messageId } = useParams();
  const query = useQuery({
    queryKey: ['project', project.id, 'messages', messageId],
    queryFn: () => api(`/projects/${project.id}/messages/${messageId}`, messageSchema),
    enabled: Boolean(messageId),
    refetchInterval: 3000,
  });
  if (messageId && query.isPending) return <p>Loading message…</p>;
  if (query.error) return <ErrorMessage error={query.error} />;
  return (
    <MessageComposer
      key={`${project.id}/${revision}/${messageId ?? 'new'}/${query.data?.state === 'draft' ? 'draft' : 'submitted'}`}
      projectId={project.id}
      message={query.data}
      onNew={() => setRevision(v => v + 1)}
    />
  );
}
