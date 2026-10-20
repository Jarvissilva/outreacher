import { AlertCircle } from 'lucide-react';
import { ZodError } from 'zod';

export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="alert error" role="alert">
      <AlertCircle size={17} />
      <span>
        {error instanceof ZodError
          ? error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join(' ')
          : error instanceof Error
            ? error.message
            : 'Something went wrong.'}
      </span>
    </div>
  );
}
