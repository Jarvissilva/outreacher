import mongoose from 'mongoose';
import type { RequestHandler } from 'express';

export const requireDatabase: RequestHandler = (_request, response, next) => {
  if (mongoose.connection.readyState !== 1) {
    response.status(503).json({
      error: {
        message:
          'Database unavailable. Start MongoDB and check the server configuration.',
      },
    });
    return;
  }
  next();
};
