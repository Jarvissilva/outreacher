import { errorSchema } from '@outreachit/shared';

interface Decoder<T> {
  parse(value: unknown): T;
}

async function send(path: string, method: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }),
    });
  } catch {
    throw new Error(
      'Cannot reach the server. Check that the development server is running.',
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
    } catch {
      /* A proxy error may not contain JSON. */
    }
    throw new Error(message);
  }
  return response;
}

export async function api<T>(
  path: string,
  decoder: Decoder<T>,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await send(path, method, body);
  const value: unknown = await response.json();
  return decoder.parse(value);
}

export async function mutate(
  path: string,
  method: string,
  body?: unknown,
): Promise<void> {
  await send(path, method, body);
}
