import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { unsubscribe } from './controllers/emailController.js';
import express from 'express';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use('/api', apiRouter);
app.get('/unsubscribe/:token', unsubscribe);
app.post('/unsubscribe/:token', unsubscribe);
const clientPath = fileURLToPath(
  new URL('../../client/dist/', import.meta.url),
);
if (existsSync(clientPath)) {
  app.use(express.static(clientPath));
  app.get('/{*path}', (request, response, next) => {
    if (/^\/(api|unsubscribe)(\/|$)/.test(request.path)) {
      next();
      return;
    }
    response.sendFile(resolve(clientPath, 'index.html'));
  });
}
app.use((_request, response) => {
  response.status(404).json({ error: { message: 'Endpoint not found.' } });
});
app.use(errorHandler);
