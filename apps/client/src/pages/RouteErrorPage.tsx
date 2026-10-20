import { Link, useRouteError } from 'react-router-dom';
import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Button } from '@/components/ui/button';

export function RouteErrorPage() {
  const error = useRouteError();
  return (
    <main id="main-content">
      <h1>Could not open this page</h1>
      <ErrorMessage error={error} />
      <Button asChild variant="outline">
        <Link to="/">Choose a project</Link>
      </Button>
    </main>
  );
}
