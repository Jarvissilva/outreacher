import { errorSchema } from '@outreacher/shared';

interface Decoder<T> {
  parse(value: unknown): T;
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

async function send(path: string, method: string, body?: unknown, signal?: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      signal,
      ...(body === undefined
        ? {}
        : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    throw new Error(
      'Cannot reach the server. Check that the development server is running.',
      { cause: error },
    );
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const parsed = errorSchema.safeParse(await response.json());
      if (parsed.success)
        message = [
          parsed.data.error.message,
          ...(parsed.data.error.details ?? []),
        ].join(' ');
    } catch (error) {
      if (signal?.aborted) throw error;
      /* A proxy error may not contain JSON. */
    }
    throw new ApiError(message, response.status);
  }
  return response;
}

export async function api<T>(
  path: string,
  decoder: Decoder<T>,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await send(path, method, body, signal);
  const value: unknown = await response.json();
  return decoder.parse(value);
}

export async function mutate(
  path: string,
  method: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<void> {
  await send(path, method, body, signal);
}
