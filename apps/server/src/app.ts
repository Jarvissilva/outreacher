import express from 'express';
import type { HealthResponse } from '@outreachit/shared';

export const app = express();

app.disable('x-powered-by');
app.use(express.json());

app.get('/api/health', (_request, response) => {
  const health: HealthResponse = { status: 'ok' };
  response.json(health);
});
