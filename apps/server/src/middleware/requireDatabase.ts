import type { RequestHandler } from 'express';
import { isDatabaseReady } from '../db/database.js';

export const requireDatabase: RequestHandler = (_request, response, next) => {
  if (!isDatabaseReady()) {
    response.status(503).json({
      error: {
        message:
          'Database unavailable. Check that the configured data directory is writable and restart the server.',
      },
    });
    return;
  }
  next();
};
