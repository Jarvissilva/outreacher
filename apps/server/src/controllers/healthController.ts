import mongoose from 'mongoose';
import type { RequestHandler } from 'express';
import type { HealthResponse } from '@outreachit/shared';

export const getHealth: RequestHandler = (_request, response) => {
  const connected = mongoose.connection.readyState === 1;
  const health: HealthResponse = {
    status: connected ? 'ok' : 'error',
    database: connected ? 'connected' : 'disconnected',
  };
  response.status(connected ? 200 : 503).json(health);
};
