import type { contactSearchLoader } from '@/pages/ContactsPage';
import { useEffect } from 'react';
import { useFetcher } from 'react-router';
export function useContactSearch(projectId: string, query: string) {
  const fetcher = useFetcher<typeof contactSearchLoader>();
  const { load } = fetcher;
  useEffect(() => { void load(`/projects/${projectId}/resources/contacts?${query}`); }, [load, projectId, query]);
  return fetcher;
}
