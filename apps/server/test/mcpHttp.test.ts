import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import express from 'express';
import request from 'supertest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpRouter } from '../src/mcp/router.js';
import { OutreachApi } from '../src/mcp/api.js';
import { internalApiUrl } from '../src/config/server.js';

function fixture(allowedHosts: string[] = [], allowedOrigins: string[] = []) {
  const calls: string[] = [];
  const api = new OutreachApi('http://127.0.0.1:3001/api', async input => {
    calls.push(String(input));
    return Response.json({ url: String(input) });
  });
  const app = express();
  app.use('/api/mcp', createMcpRouter({ api, bindPort: 3001, allowedHosts, allowedOrigins }));
  function rpc(id: number, method: string, params: unknown) {
    return request(app).post('/api/mcp').set('Host', 'localhost:3001')
      .set('Accept', 'application/json, text/event-stream')
      .set('MCP-Protocol-Version', '2025-11-25')
      .send({ jsonrpc: '2.0', id, method, params });
  }
  return { app, rpc, calls };
}

test('HTTP initialization, discovery and tools use JSON without persistent sessions and clean up each transport', async () => {
  const f = fixture();
  const close = mock.method(StreamableHTTPServerTransport.prototype, 'close');
  const serverClose = mock.method(McpServer.prototype, 'close');
  try {
    const initialized = await f.rpc(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'http-test', version: '1' } }).expect(200);
    assert.equal(initialized.body.result.serverInfo.name, 'outreacher');
    assert.equal(initialized.headers['mcp-session-id'], undefined);
    assert.match(initialized.headers['content-type'] ?? '', /application\/json/);
    const list = await f.rpc(2, 'tools/list', {}).expect(200);
    assert.ok(list.body.result.tools.some((tool: { name: string }) => tool.name === 'update_incoming_settings'));
    const called = await f.rpc(3, 'tools/call', { name: 'get_health', arguments: {} }).expect(200);
    assert.equal(called.body.result.isError, undefined);
    assert.deepEqual(f.calls, ['http://127.0.0.1:3001/api/health']);
    assert.equal(close.mock.callCount(), 3);
    assert.equal(serverClose.mock.callCount(), 3);
  } finally { mock.restoreAll(); }
});

test('GET and DELETE return protocol-compatible method errors', async () => {
  const f = fixture();
  for (const method of ['get', 'delete'] as const) {
    const response = await request(f.app)[method]('/api/mcp').set('Host', 'localhost:3001').expect(405);
    assert.equal(response.headers.allow, 'POST');
    assert.deepEqual(response.body, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Method not allowed.' } });
  }
});

test('validates Host and supplied Origin, ignores forwarded headers and supports explicit proxy allowlists', async () => {
  const f = fixture(['outreach.example.com'], ['https://outreach.example.com']);
  for (const host of ['localhost:9999', 'attacker.example', 'localhost:3001.attacker.example']) {
    await request(f.app).post('/api/mcp').set('Host', host).set('X-Forwarded-Host', 'localhost:3001').send({}).expect(403);
  }
  for (const origin of ['null', 'https://attacker.example', 'http://localhost:3002']) {
    await f.rpc(1, 'tools/list', {}).set('Origin', origin).expect(403);
  }
  for (const host of ['127.0.0.1:3001', '[::1]:3001', 'localhost:3001']) {
    await f.rpc(1, 'tools/list', {}).set('Host', host).expect(200);
  }
  await f.rpc(1, 'tools/list', {}).set('Origin', 'http://localhost:3001').expect(200);
  await f.rpc(1, 'tools/list', {}).set('Host', 'outreach.example.com').set('Origin', 'https://outreach.example.com').expect(200);
  assert.equal(f.calls.length, 0);
});

test('concurrent HTTP calls have isolated IDs, responses and transports', async () => {
  const f = fixture();
  const connect = mock.method(McpServer.prototype, 'connect');
  try {
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => f.rpc(i, 'tools/call', {
      name: 'get_project_overview', arguments: { projectId: String(i + 1).repeat(24) },
    }).expect(200)));
    responses.forEach((response, i) => {
      assert.equal(response.body.id, i);
      assert.match(response.body.result.content[0].text, new RegExp(`projects/${String(i + 1).repeat(24)}/overview`));
      assert.equal(response.headers['mcp-session-id'], undefined);
    });
    assert.equal(new Set(connect.mock.calls.map(call => call.arguments[0])).size, 8);
    assert.equal(new Set(connect.mock.calls.map(call => call.this)).size, 8);
  } finally { mock.restoreAll(); }
});

test('internal API URL follows bind configuration and uses loopback for wildcard addresses', () => {
  assert.equal(internalApiUrl('0.0.0.0', 6004), 'http://127.0.0.1:6004/api');
  assert.equal(internalApiUrl('::', 6004), 'http://[::1]:6004/api');
  assert.equal(internalApiUrl('127.0.0.1', 3001), 'http://127.0.0.1:3001/api');
  assert.equal(internalApiUrl('::1', 3001), 'http://[::1]:3001/api');
  assert.equal(internalApiUrl('private.example.com', 6004), 'http://private.example.com:6004/api');
});

test('disconnect closes the request server and transport while a tool is pending', { timeout: 5000 }, async () => {
  let started: () => void = () => {};
  let release: () => void = () => {};
  let closed: () => void = () => {};
  const began = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const cleaned = new Promise<void>(resolve => { closed = resolve; });
  const api = new OutreachApi('http://127.0.0.1:3001/api', async () => {
    started();
    await pending;
    return Response.json({ ok: true });
  });
  const app = express();
  app.use('/api/mcp', createMcpRouter({ api, bindPort: 3001 }));
  const httpServer = app.listen(0);
  await new Promise<void>((resolve) => httpServer.once('listening', resolve));
  const originalClose = McpServer.prototype.close;
  const transportClose = mock.method(StreamableHTTPServerTransport.prototype, 'close');
  mock.method(McpServer.prototype, 'close', async function(this: McpServer) {
    await originalClose.call(this);
    closed();
  });
  const call = request(httpServer).post('/api/mcp').set('Host', 'localhost:3001')
    .set('Accept', 'application/json, text/event-stream')
    .send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_health', arguments: {} } });
  try {
    call.end(() => {});
    await began;
    call.abort();
    await cleaned;
    assert.equal(transportClose.mock.callCount(), 1);
  } finally {
    release();
    call.abort();
    httpServer.closeAllConnections();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    mock.restoreAll();
  }
});
