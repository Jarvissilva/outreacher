import type { RequestHandler } from 'express';
import type { HealthResponse } from '@outreacher/shared';
import { isDatabaseReady } from '../db/database.js';

export const getHealth: RequestHandler = (_request, response) => {
  const connected = isDatabaseReady();
  const health: HealthResponse = {
    status: connected ? 'ok' : 'error',
    database: connected ? 'connected' : 'disconnected',
  };
  response.status(connected ? 200 : 503).json(health);
};
