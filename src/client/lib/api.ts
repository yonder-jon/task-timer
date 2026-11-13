// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

// Talking to the server: typed client (Hono RPC), the state query, and a helper for actions.
import { useCallback, useSyncExternalStore } from 'react';
import { hc } from 'hono/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import type { ApiType } from '../../server/app.ts';
import type { PublicState, ApiError } from '../../shared/types.ts';

export const api = hc<ApiType>('/api');

const STATE_KEY = ['state'] as const;

// ----- server clock -----
let clockOffset = 0; // serverNow - Date.now()
/** Current time on the server's clock. */
export const serverNow = () => Date.now() + clockOffset;

class ApiFailure extends Error {
  state?: PublicState;
  constructor(body: ApiError) {
    super(body.error);
    this.state = body.state;
  }
}

async function unwrap(res: { ok: boolean; json(): Promise<unknown> }): Promise<PublicState> {
  const body = (await res.json()) as PublicState | ApiError;
  if (!res.ok) throw new ApiFailure(body as ApiError);
  const s = body as PublicState;
  clockOffset = s.serverNow - Date.now();
  return s;
}

/** The whole app state. Polls so other devices and the server's notes timeout show up. */
export function useAppState() {
  return useQuery({
    queryKey: STATE_KEY,
    queryFn: async () => unwrap(await api.state.$get()),
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}
/** For components rendered only once state has loaded. */
export function useS(): PublicState {
  const { data } = useAppState();
  if (!data) throw new Error('State not loaded');
  return data;
}

export function useRefresh() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries({ queryKey: STATE_KEY }), [qc]);
}

/**
 * Run an API call that returns the new state. Updates the cache on success; shows the
 * error message on failure. Resolves to true on success.
 *
 *   const run = useAction();
 *   run(() => api.tasks[':id'].start.$post({ param: { id }, json: {} }));
 */
export function useAction() {
  const qc = useQueryClient();
  return useCallback(async (call: () => Promise<{ ok: boolean; json(): Promise<unknown> }>): Promise<boolean> => {
    try {
      qc.setQueryData(STATE_KEY, await unwrap(await call()));
      return true;
    } catch (e) {
      if (e instanceof ApiFailure && e.state) qc.setQueryData(STATE_KEY, e.state);
      notifications.show({ color: 'red', message: e instanceof ApiFailure ? e.message : 'Can’t reach the server' });
      return false;
    }
  }, [qc]);
}

// ----- a shared 1-second tick -----
const listeners = new Set<() => void>();
let tick = 0;
setInterval(() => { tick++; listeners.forEach((l) => l()); }, 1000);
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

/** Server-clock "now", re-rendering the calling component every second. */
export function useNow(): number {
  useSyncExternalStore(subscribe, () => tick);
  return serverNow();
}

// ----- browser helpers -----
export const toast = (message: string) => notifications.show({ color: 'green', message });

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied');
  } catch {
    window.prompt('Copy:', text); // clipboard API needs https or localhost
  }
}

export function download(filename: string, text: string, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000); // Safari needs it to outlive the click
}
