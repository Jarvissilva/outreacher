export const host = process.env.HOST ?? '127.0.0.1';
export const port = Number(process.env.PORT ?? 3001);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

export function internalApiUrl(bindHost: string, bindPort: number): string {
  const address = bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost === '::' ? '::1' : bindHost;
  return `http://${address.includes(':') ? `[${address}]` : address}:${bindPort}/api`;
}
