import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function NotFoundPage({ title = 'Page not found' }: { title?: string }) {
  return (
    <main id="main-content" className="empty-state">
      <h1>{title}</h1>
      <Button asChild variant="outline" className="mt-4">
        <Link to="/">Choose a project</Link>
      </Button>
    </main>
  );
}
