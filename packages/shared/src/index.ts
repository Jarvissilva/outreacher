export * from './contacts.js';

export interface HealthResponse {
  status: 'ok' | 'error';
  database: 'connected' | 'disconnected';
}

export * from './email.js';
