import type { QueryClient } from '@tanstack/react-query';

export async function invalidateProject(
  client: QueryClient,
  projectId: string,
) {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['project', projectId] }),
    client.invalidateQueries({ queryKey: ['projects'] }),
  ]);
}
