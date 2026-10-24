import { useEffect, useRef } from 'react';
import {
  useFetcher,
  useFetchers,
  useNavigation,
  useRevalidator,
} from 'react-router';
import type { ShouldRevalidateFunctionArgs } from 'react-router';
import { z } from 'zod';
import { idSchema } from '@outreacher/shared';
import { ApiError } from './api';

export type OperationResult<T = unknown> = (
  | { ok: true; value: T }
  | { ok: false; error: string; status: number }
) & { requestId?: string };

export async function operation<T>(
  work: () => Promise<T>,
): Promise<OperationResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Operation failed.',
      status: error instanceof ApiError ? error.status : 400,
    };
  }
}

const operationInput = z.object({
  intent: z.string(),
  payload: z.unknown(),
  requestId: z.string().optional(),
});

export async function routeOperation<T>(
  request: Request,
  work: (input: z.infer<typeof operationInput>) => Promise<T>,
) {
  let requestId: string | undefined;
  const result = await operation(async () => {
    const input = operationInput.parse(await request.json());
    requestId = input.requestId;
    return work(input);
  });
  return { ...result, requestId };
}

export function projectPath(projectId: string | undefined) {
  return `/projects/${idSchema.parse(projectId)}`;
}

// Await a fetcher result for workflows such as save, review, then confirm. The
// route owns requests and validation. IDs correlate UI results, not SMTP retries.
export function useRouteAction(action?: string) {
  const fetcher = useFetcher<OperationResult>();
  const sequence = useRef(0);
  const pending = useRef<{
    requestId: string;
    resolve(value: unknown): void;
    reject(error: Error): void;
  } | undefined>(undefined);

  useEffect(() => {
    if (
      fetcher.state !== 'idle' ||
      !pending.current ||
      !fetcher.data ||
      fetcher.data.requestId !== pending.current.requestId
    ) return;
    const current = pending.current;
    pending.current = undefined;
    if (fetcher.data.ok) current.resolve(fetcher.data.value);
    else current.reject(new ApiError(fetcher.data.error, fetcher.data.status));
  }, [fetcher.state, fetcher.data]);

  useEffect(() => () => {
    pending.current?.reject(new DOMException('Operation cancelled', 'AbortError'));
    pending.current = undefined;
  }, []);

  async function submit<T>(
    intent: string,
    payload: unknown,
    decoder: { parse(value: unknown): T },
  ): Promise<T> {
    if (pending.current) throw new Error('An operation is already in progress.');
    const value = await new Promise<unknown>((resolve, reject) => {
      const requestId = String(++sequence.current);
      pending.current = { resolve, reject, requestId };
      void fetcher.submit(JSON.stringify({ intent, payload, requestId }), {
        method: 'post',
        encType: 'application/json',
        action,
      });
    });
    return decoder.parse(value);
  }
  return { submit, busy: fetcher.state !== 'idle' };
}

export function usePolling(interval: number, enabled = true) {
  const { revalidate, state } = useRevalidator();
  const fetching = useFetchers().some(fetcher => fetcher.state !== 'idle');
  const navigation = useNavigation();
  useEffect(() => {
    if (!enabled || state !== 'idle' || fetching || navigation.state !== 'idle') return;
    const timer = window.setTimeout(() => void revalidate(), interval);
    return () => window.clearTimeout(timer);
  }, [interval, enabled, revalidate, state, fetching, navigation.state]);
}

export function shouldRevalidate({
  actionResult,
  defaultShouldRevalidate,
}: ShouldRevalidateFunctionArgs) {
  return !z.object({ ok: z.literal(false) }).safeParse(actionResult).success &&
    defaultShouldRevalidate;
}
