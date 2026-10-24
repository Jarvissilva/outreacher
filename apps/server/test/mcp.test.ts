import assert from 'node:assert/strict';
import { z } from 'zod';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { OutreachApi } from '../src/mcp/api.js';
import { createMcpServer } from '../src/mcp/server.js';

const projectId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const id = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const accountId = 'cccccccccccccccccccccccc';

async function fixture() {
  const requests: { method: string; url: string; body: unknown }[] = [];
  const fetcher: typeof fetch = async (input, options) => {
    const url = new URL(String(input));
    const request = { method: options?.method ?? 'GET', url: url.pathname + url.search, body: typeof options?.body === 'string' ? JSON.parse(options.body) as unknown : null };
    requests.push(request);
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal);
    if (request.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.pathname.endsWith('/templates/' + id)) {
      return Response.json({ error: { message: 'Template not found.', details: ['Choose a template in this project.'] } }, { status: 404 });
    }
    if (url.pathname.endsWith('/non-json')) return new Response('<html>Unexpected proxy</html>');
    if (url.pathname.endsWith('/redirect')) throw new TypeError('Redirect rejected');
    return Response.json(request);
  };
  const api = new OutreachApi('http://localhost:3001/api', fetcher);
  const server = createMcpServer(api);
  const client = new Client({ name: 'outreacher-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, api, requests, async close() {
    await client.close();
    await server.close();
  } };
}

test('MCP discovery exposes schemas and correct side-effect hints', async () => {
  const f = await fixture();
  try {
    const { tools } = await f.client.listTools();
    assert.ok(tools.length >= 50);
    assert.equal(new Set(tools.map(t => t.name)).size, tools.length);
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok(tool.description);
      if (!['get_health', 'list_projects', 'create_project'].includes(tool.name)) {
        assert.ok(tool.inputSchema.required?.includes('projectId'), tool.name);
      }
    }
    assert.equal(tools.find(t => t.name === 'preview_message')?.annotations?.readOnlyHint, true);
    assert.equal(tools.find(t => t.name === 'submit_message')?.annotations?.destructiveHint, true);
    assert.equal(tools.find(t => t.name === 'submit_message')?.annotations?.idempotentHint, false);
  } finally { await f.close(); }
});

test('routes project-scoped operations, query encoding and shared defaults', async () => {
  const f = await fixture();
  try {
    await f.client.callTool({ name: 'get_health', arguments: {} });
    await f.client.callTool({ name: 'list_contacts', arguments: { projectId, query: { search: 'Alex & Co', status: 'suppressed', limit: 50 } } });
    await f.client.callTool({ name: 'create_contact', arguments: { projectId, data: { email: ' ALEX@example.com ' } } });
    await f.client.callTool({ name: 'delete_contact', arguments: { projectId, id } });
    assert.equal(f.requests[0]?.url, '/api/health');
    const search = new URL(f.requests[1]?.url ?? '', 'http://localhost');
    assert.equal(search.pathname, `/api/projects/${projectId}/contacts`);
    assert.equal(search.searchParams.get('search'), 'Alex & Co');
    assert.equal(search.searchParams.get('page'), '1');
    assert.equal(search.searchParams.get('status'), 'suppressed');
    assert.deepEqual(f.requests[2], { method: 'POST', url: `/api/projects/${projectId}/contacts`, body: {
      email: 'alex@example.com', firstName: '', lastName: '', company: '', phone: '', website: '', city: '', state: '', country: '', source: '', notes: '', customFields: {}, suppressed: false,
    } });
    assert.equal(f.requests[3]?.method, 'DELETE');
  } finally { await f.close(); }
});

test('rejects invalid IDs, unknown fields, invalid content sources and unconfirmed sends before HTTP', async () => {
  const f = await fixture();
  try {
    const calls = [
      { name: 'list_contacts', arguments: {} },
      { name: 'list_contacts', arguments: { projectId: '../other' } },
      { name: 'list_projects', arguments: { path: '/credentials' } },
      { name: 'create_campaign', arguments: { projectId, data: { name: 'Test', emailAccountId: accountId, audience: {} } } },
      { name: 'create_campaign', arguments: { projectId, data: { name: 'Test', emailAccountId: accountId, audience: {}, templateId: id, message: { subject: 'Test', html: '<p>Test</p>' } } } },
      { name: 'create_message', arguments: { projectId, data: { kind: 'reply' } } },
    ];
    for (const name of ['send_test_email', 'launch_campaign', 'submit_message', 'resume_campaign', 'resume_message']) {
      for (const confirmed of [undefined, false]) {
        const args = name === 'send_test_email' ? { projectId, accountId, data: { recipient: 'test@example.com' }, confirmed } : { projectId, id, confirmed };
        const result = await f.client.callTool({ name, arguments: args });
        assert.equal(result.isError, true, name);
      }
    }
    for (const call of calls) assert.equal((await f.client.callTool(call)).isError, true, call.name);
    assert.equal(f.requests.length, 0);
  } finally { await f.close(); }
});

test('forwards confirmed sends without retries and retains inbox identities', async () => {
  const f = await fixture();
  try {
    await f.client.callTool({ name: 'submit_message', arguments: { projectId, id, confirmed: true } });
    await f.client.callTool({ name: 'launch_campaign', arguments: { projectId, id, confirmed: true, retry: true } });
    await f.client.callTool({ name: 'send_test_email', arguments: { projectId, accountId, confirmed: true, data: { recipient: 'test@example.com' } } });
    await f.client.callTool({ name: 'read_inbox_message', arguments: { projectId, accountId, uidValidity: '1234', uid: 42 } });
    await f.client.callTool({ name: 'create_reply', arguments: { projectId, accountId, uidValidity: '1234', uid: 42 } });
    assert.deepEqual(f.requests.map(r => [r.method, r.url]), [
      ['POST', `/api/projects/${projectId}/messages/${id}/submit`],
      ['POST', `/api/projects/${projectId}/campaigns/${id}/launch`],
      ['POST', `/api/projects/${projectId}/email-accounts/${accountId}/test`],
      ['GET', `/api/projects/${projectId}/email-accounts/${accountId}/inbox/1234/42`],
      ['POST', `/api/projects/${projectId}/email-accounts/${accountId}/inbox/reply`],
    ]);
    assert.deepEqual(f.requests[0]?.body, { confirmed: true, retry: false });
    assert.deepEqual(f.requests[1]?.body, { confirmed: true, retry: true });
    assert.deepEqual(f.requests[2]?.body, { recipient: 'test@example.com' });
    assert.deepEqual(f.requests[4]?.body, { uidValidity: '1234', uid: 42 });
  } finally { await f.close(); }
});

test('returns useful API errors and handles empty, invalid and redirected responses', async () => {
  const f = await fixture();
  try {
    const missing = await f.client.callTool({ name: 'get_template', arguments: { projectId, id } });
    assert.equal(missing.isError, true);
    assert.match(JSON.stringify(missing.content), /HTTP 404: Template not found/);
    assert.deepEqual(await f.api.request('DELETE', `projects/${projectId}/contacts/${id}`), { ok: true });
    await assert.rejects(f.api.request('GET', 'non-json'), /non-JSON/);
    await assert.rejects(f.api.request('GET', 'redirect'), /check their state before retrying/);
    await assert.rejects(f.api.request('GET', '../outside'), /within the configured/);
    await assert.rejects(f.api.request('GET', 'https://example.invalid/api/health'), /within the configured/);
    for (const url of ['file:///tmp/api', 'http://user:pass@localhost/api', 'http://localhost/api?query=1']) {
      assert.throws(() => new OutreachApi(url), /must be an HTTP/);
    }
  } finally { await f.close(); }
});


test('CSV adapter retains full output and JSON errors without retrying', async () => {
  const csv = 'email,state,reason\r\n"a@example.com","failed","a,""quote""\r\nnext"';
  const calls: URL[] = [];
  const api = new OutreachApi('http://localhost:3001/api', async (input, options) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal);
    if (url.searchParams.get('state') === 'failed') return Response.json({ error: { message: 'Campaign not found.' } }, { status: 404 });
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="campaign-report.csv"' } });
  });
  const server = createMcpServer(api);
  const client = new Client({ name: 'csv-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  try {
    const result = await client.callTool({ name: 'export_campaign_report', arguments: { projectId, id } });
    assert.deepEqual(result.content, [{ type: 'text', text: JSON.stringify({ filename: 'campaign-report.csv', mimeType: 'text/csv', csv }) }]);
    assert.equal(calls[0]?.searchParams.get('format'), 'csv');
    assert.equal(calls[0]?.searchParams.has('page'), false);
    const failed = await client.callTool({ name: 'export_campaign_report', arguments: { projectId, id, state: 'failed' } });
    assert.equal(failed.isError, true);
    assert.match(JSON.stringify(failed.content), /HTTP 404: Campaign not found/);
    assert.equal(calls[1]?.searchParams.get('state'), 'failed');
    assert.equal(calls.length, 2);
  } finally { await client.close(); await server.close(); }
});

test('account tools validate shared inputs, forward write-only credentials and return password-free metadata', async () => {
  const calls: { url: string; method: string | undefined; body: unknown }[] = [];
  const data = { name: 'SMTP', host: 'smtp.example.com', port: 465, tlsMode: 'tls', username: 'smtp-user', password: 'smtp-secret', senderEmail: 'sender@example.com' };
  const metadata = {
    id: accountId, projectId, name: data.name, host: data.host, port: data.port, tlsMode: data.tlsMode,
    username: data.username, senderName: '', senderEmail: data.senderEmail, replyTo: '',
    passwordConfigured: true, incoming: null, sendingError: '',
  };
  const api = new OutreachApi('http://127.0.0.1:3001/api', async (input, options) => {
    calls.push({ url: new URL(String(input)).pathname, method: options?.method, body: typeof options?.body === 'string' ? JSON.parse(options.body) as unknown : null });
    return options?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(metadata);
  });
  const server = createMcpServer(api);
  const client = new Client({ name: 'account-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  await client.connect(ct);
  try {
    for (const name of ['create_email_account', 'update_email_account']) {
      const result = await client.callTool({ name, arguments: { projectId, ...(name === 'update_email_account' ? { accountId } : {}), data } });
      assert.equal(result.isError, undefined);
      assert.doesNotMatch(JSON.stringify(result), /smtp-secret|passwordEncrypted|"password"/);
    }
    await client.callTool({ name: 'update_email_account', arguments: { projectId, accountId, data: { ...data, password: '' } } });
    assert.equal(z.object({ password: z.string() }).parse(calls[2]?.body).password, '');
    for (const incoming of [
      { enabled: true, host: 'imap.example.com', useSmtpCredentials: false, password: 'imap-secret' },
      { enabled: false },
      { enabled: true, host: 'imap.example.com', useSmtpCredentials: true },
    ]) {
      const result = await client.callTool({ name: 'update_incoming_settings', arguments: { projectId, accountId, data: incoming } });
      assert.equal(result.isError, undefined);
      assert.doesNotMatch(JSON.stringify(result), /imap-secret/);
    }
    assert.deepEqual(calls.slice(0, 2).map(call => [call.method, call.url]), [
      ['POST', `/api/projects/${projectId}/email-accounts`],
      ['PUT', `/api/projects/${projectId}/email-accounts/${accountId}`],
    ]);
    assert.equal(calls[3]?.url, `/api/projects/${projectId}/email-accounts/${accountId}/incoming`);
    assert.equal(z.object({ password: z.string() }).parse(calls[3]?.body).password, 'imap-secret');
    const before = calls.length;
    assert.equal((await client.callTool({ name: 'update_incoming_settings', arguments: { projectId, accountId, data: { enabled: true } } })).isError, true);
    assert.equal(calls.length, before);
    assert.equal((await client.callTool({ name: 'delete_email_account', arguments: { projectId, accountId } })).isError, undefined);
    assert.equal(calls.at(-1)?.method, 'DELETE');
  } finally { await client.close(); await server.close(); }
});
