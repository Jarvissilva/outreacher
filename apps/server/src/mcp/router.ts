import { Router, json } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { host, port, internalApiUrl } from '../config/server.js';
import { OutreachApi } from './api.js';
import { createMcpServer } from './server.js';

function entries(value: string | undefined): string[] {
  return value?.split(',').map(entry => entry.trim()).filter(Boolean) ?? [];
}

export function createMcpRouter({
  bindHost = host,
  bindPort = port,
  allowedHosts = entries(process.env.MCP_ALLOWED_HOSTS),
  allowedOrigins = entries(process.env.MCP_ALLOWED_ORIGINS),
  api = new OutreachApi(internalApiUrl(bindHost, bindPort)),
} = {}): Router {
  const router = Router();
  const localOrigins = ['localhost', '127.0.0.1', '[::1]'].map(address => new URL(`http://${address}:${bindPort}`));
  const hosts = new Set([...localOrigins.map(url => url.host), ...allowedHosts.map(value => value.toLowerCase())]);
  const origins = new Set([...localOrigins.map(url => url.origin), ...allowedOrigins]);

  router.use((request, response, next) => {
    const requestHost = request.headers.host;
    const origin = request.headers.origin;
    if (!requestHost || !hosts.has(requestHost.toLowerCase()) || (origin !== undefined && !origins.has(origin))) {
      response.status(403).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'MCP Host or Origin is not allowed.' } });
      return;
    }
    next();
  });
  router.post('/', json({ limit: '2mb' }), async (request, response) => {
    const server = createMcpServer(api);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    let closed = false;
    const cleanup = async () => {
      if (closed) return;
      closed = true;
      // Closing the server closes its connected transport as well.
      await server.close();
    };
    const onClose = () => { void cleanup().catch(() => {}); };
    response.once('close', onClose);
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch {
      if (!response.headersSent && !response.destroyed) {
        response.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'MCP request failed.' } });
      }
    } finally {
      response.off('close', onClose);
      await cleanup();
    }
  });
  router.all('/', (_request, response) => {
    response.set('Allow', 'POST').status(405).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed.' } });
  });
  return router;
}
