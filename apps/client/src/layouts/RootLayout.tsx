import { Outlet } from 'react-router-dom';
import { useProjects } from '@/hooks/use-projects';
import { Button } from '@/components/ui/button';
import { ErrorMessage } from '@/components/feedback/ErrorMessage';

export function RootLayout() {
  const projects = useProjects();
  if (projects.isPending)
    return (
      <main id="main-content">
        <div className="loading-state" role="status">
          Loading projects…
        </div>
      </main>
    );
  if (!projects.data)
    return (
      <main id="main-content">
        <ErrorMessage error={projects.error} />
        <Button variant="outline" onClick={() => void projects.refetch()}>
          Try again
        </Button>
      </main>
    );
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <ErrorMessage error={projects.error} />
      <Outlet context={projects.data} />
    </>
  );
}
