import { api, ApiError, mutate } from '@/lib/api';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';

it('preserves HTTP status and validated server error details', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'Conflict.', details: ['Email is reserved.'] } }, { status: 409 })));
  const error = await api('/projects', z.array(z.unknown())).catch((value: unknown) => value);
  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ status: 409, message: 'Conflict. Email is reserved.' });
});

it('passes abort signals to reads and writes without replacing cancellation errors', async () => {
  const controller = new AbortController();
  const cancelled = new DOMException('Cancelled', 'AbortError');
  controller.abort();
  const fetch = vi.fn(async () => { throw cancelled; });
  vi.stubGlobal('fetch', fetch);
  await expect(api('/projects', z.array(z.unknown()), 'GET', undefined, controller.signal)).rejects.toBe(cancelled);
  await expect(mutate('/projects/example', 'DELETE', undefined, controller.signal)).rejects.toBe(cancelled);
  expect(fetch.mock.calls).toHaveLength(2);
  expect(fetch).toHaveBeenCalledWith('/api/projects', expect.objectContaining({ signal: controller.signal }));
});

it('validates successful API responses', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ unexpected: true })));
  await expect(api('/projects', z.array(z.object({ id: z.string() })))).rejects.toBeInstanceOf(z.ZodError);
});
