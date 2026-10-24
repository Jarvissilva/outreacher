import { errorSchema } from '@outreacher/shared';

export class OutreachApi {
  private readonly baseUrl: URL;

  constructor(baseUrl: string, private readonly fetcher: typeof fetch = fetch) {
    this.baseUrl = new URL(baseUrl);
    if (
      !['http:', 'https:'].includes(this.baseUrl.protocol) ||
      this.baseUrl.username || this.baseUrl.password ||
      this.baseUrl.search || this.baseUrl.hash
    ) {
      throw new Error('Internal API URL must be an HTTP(S) API URL without credentials, query or fragment.');
    }
    this.baseUrl.pathname = `${this.baseUrl.pathname.replace(/\/+$/, '')}/`;
  }

  async request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
    format: 'json' | 'csv' = 'json',
  ): Promise<unknown> {
    const url = new URL(path, this.baseUrl);
    if (url.origin !== this.baseUrl.origin || !url.pathname.startsWith(this.baseUrl.pathname)) {
      throw new Error('API path must stay within the configured API base URL.');
    }
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method,
        headers: { Accept: format === 'csv' ? 'text/csv' : 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new Error('Cannot reach the Outreacher API or the request timed out. Check the server bind configuration. Mutations may have completed; check their state before retrying.');
    }
    if (response.status === 204) return { ok: true };
    if (response.ok && format === 'csv') {
      if (!response.headers.get('content-type')?.startsWith('text/csv')) {
        throw new Error('Outreacher returned an unexpected CSV content type.');
      }
      return {
        filename: /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'campaign-report.csv',
        mimeType: 'text/csv',
        csv: await response.text(),
      };
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new Error(`Outreacher returned a non-JSON response (HTTP ${response.status}). Check the API base URL.`);
    }
    if (!response.ok) {
      const error = errorSchema.safeParse(data);
      throw new Error(error.success
        ? `HTTP ${response.status}: ${error.data.error.message}${error.data.error.details?.length ? ` (${error.data.error.details.join('; ')})` : ''}`
        : `Outreacher API request failed (HTTP ${response.status}).`);
    }
    return data;
  }
}
