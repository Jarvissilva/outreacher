import { useQuery } from '@tanstack/react-query';
import { projectsSchema } from '@outreachit/shared';
import { api } from '@/lib/api';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => api('/projects', projectsSchema),
  });
}
