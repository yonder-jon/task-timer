// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

// Persistence: load / save the whole state as one JSON file, plus format migrations.
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { State, Session, Stint } from '../shared/types.ts';

export function emptyState(): State {
  return { projects: [], tasks: [], sessions: [], stints: [], running: null, pending: null, lastDayCheck: null };
}

export function loadState(file: string, now = Date.now()): State {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    // Don't silently start empty over a corrupt file.
    throw new Error(`Could not read ${file}: ${(e as Error).message}`);
  }
  return migrate(raw as Record<string, unknown>, now);
}

export function saveState(file: string, state: State): void {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file); // atomic replace
}

/** v1 stored start/stop periods as "sessions"; those are now stints. */
interface V1Period { id: string; taskId: string; start: number; end: number; notes: string }

// v1 → v2: group the old periods into one session per task per day; today's stay open.
export function migrate(raw: Record<string, unknown>, now = Date.now()): State {
  const s = { ...emptyState(), ...raw } as State;
  if (raw.stints || !Array.isArray(raw.sessions)) return s;

  const periods = raw.sessions as V1Period[];
  const stints: Stint[] = periods.map((p) => ({ ...p, sessionId: '' }));
  const sessions: Session[] = [];
  const dayKey = (t: number) => new Date(t).toDateString();
  const today = dayKey(now);
  const groups = new Map<string, Stint[]>();
  for (const st of [...stints].sort((a, b) => a.start - b.start)) {
    const k = st.taskId + '|' + dayKey(st.start);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(st);
  }
  for (const list of groups.values()) {
    const first = list[0]!, last = list.at(-1)!;
    const open = dayKey(first.start) === today;
    const sess: Session = { id: crypto.randomUUID(), taskId: first.taskId, openedAt: first.start, closedAt: open ? null : last.end };
    sessions.push(sess);
    for (const st of list) st.sessionId = sess.id;
  }
  s.stints = stints;
  s.sessions = sessions;
  if (s.running) {
    s.running.notes ??= '';
    if (!sessions.some((x) => x.taskId === s.running!.taskId && !x.closedAt)) {
      sessions.push({ id: crypto.randomUUID(), taskId: s.running.taskId, openedAt: s.running.start, closedAt: null });
    }
  }
  if ((s.pending?.action as string) === 'pause') s.pending!.action = 'stop';
  return s;
}
