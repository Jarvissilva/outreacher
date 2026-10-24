import type { Project } from '@outreacher/shared';
import { Navigate, useOutletContext, useParams } from 'react-router';

export function LegacyRedirect({ settings = false }: { settings?: boolean }) {
  const projects = useOutletContext<Project[]>();
  const project = projects.find((item) => item.isDefault);
  return (
    <Navigate
      to={
        project ? `/projects/${project.id}${settings ? '/settings' : ''}` : '/'
      }
      replace
    />
  );
}
export function ProjectRedirect({ settings = false }: { settings?: boolean }) {
  const { projectId } = useParams();
  return (
    <Navigate
      to={`/projects/${projectId}${settings ? '/settings' : ''}`}
      replace
    />
  );
}
