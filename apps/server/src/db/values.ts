import { randomBytes } from 'node:crypto';

export const newId = () => randomBytes(12).toString('hex');

export const nowIso = () => new Date().toISOString();

export const iso = (value: Date) => value.toISOString();

export const toDate = (value: string) => new Date(value);

export const toNullableDate = (value: string | null) =>
  value === null ? null : new Date(value);

export const toBoolean = (value: number) => value === 1;

export const fromBoolean = (value: boolean) => (value ? 1 : 0);

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error('Stored JSON is invalid.');
  }
}

export function jsonObject(value: string): Record<string, string> {
  const parsed = parseJson(value);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((entry) => typeof entry !== 'string')
  )
    throw new Error('Stored custom fields are invalid.');
  return parsed as Record<string, string>;
}

export function jsonArray(value: string): string[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string'))
    throw new Error('Stored list is invalid.');
  return parsed;
}

export function jsonNumberArray(value: string): number[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'number'))
    throw new Error('Stored number list is invalid.');
  return parsed;
}
