import { Link, isRouteErrorResponse, useRevalidator, useRouteError } from 'react-router';
import { ErrorMessage } from '@/components/feedback/ErrorMessage';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';

export function RouteErrorPage() {
  const error: unknown = useRouteError();
  const revalidator = useRevalidator();
  const status = error instanceof ApiError || isRouteErrorResponse(error) ? error.status : undefined;
  return (
    <main id="main-content">
      <h1>{status === 404 ? 'Page not found' : 'Could not open this page'}</h1>
      <ErrorMessage error={isRouteErrorResponse(error) ? new Error(error.statusText) : error} />
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={revalidator.state !== 'idle'}
          onClick={() => void revalidator.revalidate()}
        >
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link to="/">Choose a project</Link>
        </Button>
      </div>
    </main>
  );
}
