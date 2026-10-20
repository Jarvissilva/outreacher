import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { HttpError, isDuplicate } from '../lib/HttpError.js';

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  next,
) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        message: 'Please check the supplied values.',
        details: error.issues.map(
          (issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`,
        ),
      },
    });
    return;
  }
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: { message: error.message } });
    return;
  }
  if (isDuplicate(error)) {
    response.status(409).json({
      error: {
        message:
          'That project name, email, or custom field key already exists.',
      },
    });
    return;
  }
  if (error instanceof SyntaxError && 'body' in error) {
    response
      .status(400)
      .json({ error: { message: 'Request body must contain valid JSON.' } });
    return;
  }
  if (
    error instanceof Error &&
    'type' in error &&
    error.type === 'entity.too.large'
  ) {
    response.status(413).json({
      error: {
        message:
          'Request is too large. Import files must be smaller than 1 MB.',
      },
    });
    return;
  }
  console.error(
    'Request failed:',
    error instanceof Error ? error.name : 'Unknown error',
  );
  response
    .status(500)
    .json({ error: { message: 'Something went wrong. Please try again.' } });
};
