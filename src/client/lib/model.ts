// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

// Derived values. Pure functions of (state, now) so they're easy to test.
import type { State, Session, Stint, Task } from '../../shared/types.ts';
import { dayKey, fmtDate, fmtTime } from './format.ts';

export const project = (s: State, id: string) => s.projects.find((p) => p.id === id);
export const task = (s: State, id: string) => s.tasks.find((t) => t.id === id);
export const openSession = (s: State, tid: string) => s.sessions.find((x) => x.taskId === tid && !x.closedAt);
export const stintsOf = (s: State, sid: string): Stint[] =>
  s.stints.filter((st) => st.sessionId === sid).sort((a, b) => a.start - b.start);
export const projectTasks = (s: State, pid: string) => s.tasks.filter((t) => t.projectId === pid);
export const openSessions = (s: State) => s.sessions.filter((x) => !x.closedAt && task(s, x.taskId));

const sum = (stints: Stint[]) => stints.reduce((a, st) => a + st.end - st.start, 0);

/** The in-progress stint for a task (running, or stopped but awaiting notes). */
export function liveMs(s: State, tid: string, now: number): number {
  if (s.running?.taskId === tid) return now - s.running.start;
  if (s.pending?.taskId === tid) return s.pending.stoppedAt - s.pending.start;
  return 0;
}
export const sessionMs = (s: State, sess: Session, now: number) =>
  sum(stintsOf(s, sess.id)) + (sess.closedAt ? 0 : liveMs(s, sess.taskId, now));
export function taskSessionMs(s: State, tid: string, now: number): number {
  const sess = openSession(s, tid);
  return sess ? sessionMs(s, sess, now) : liveMs(s, tid, now);
}
export const taskTotalMs = (s: State, tid: string, now: number) =>
  sum(s.stints.filter((st) => st.taskId === tid)) + liveMs(s, tid, now);
export const projectSessionMs = (s: State, pid: string, now: number) =>
  projectTasks(s, pid).reduce((a, t) => a + taskSessionMs(s, t.id, now), 0);
export const projectTotalMs = (s: State, pid: string, now: number) =>
  projectTasks(s, pid).reduce((a, t) => a + taskTotalMs(s, t.id, now), 0);
export const openSessionsMs = (s: State, now: number) =>
  openSessions(s).reduce((a, x) => a + sessionMs(s, x, now), 0);
export const sessionNotes = (s: State, sess: Session) =>
  stintsOf(s, sess.id).map((st) => st.notes).filter(Boolean).join('\n');

export const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** Time only if it's today, otherwise with the date. */
export const whenLabel = (t: number, now: number) => (dayKey(t) === dayKey(now) ? fmtTime(t) : `${fmtDate(t)} ${fmtTime(t)}`);

/** A task's sessions closed today (oldest first): their totals still need entering on the platform. */
export const closedTodaySessions = (s: State, tid: string, now: number) =>
  s.sessions.filter((x) => x.taskId === tid && x.closedAt && x.closedAt >= startOfDay(now)).sort((a, b) => a.closedAt! - b.closedAt!);

/**
 * A project's tasks as the dashboard shows them: active tasks and tasks ended today stay in place
 * (creation order); tasks ended before today go to `ended`, most recently ended first.
 */
export function dashboardTasks(s: State, pid: string, now: number): { current: Task[]; ended: Task[] } {
  const today = startOfDay(now);
  const tasks = projectTasks(s, pid);
  const endedEarlier = (t: Task) => t.status === 'finished' && (t.finishedAt ?? 0) < today;
  return {
    current: tasks.filter((t) => !endedEarlier(t)),
    ended: tasks.filter(endedEarlier).sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)),
  };
}

/** Sessions opened before today that are still open. */
export const staleSessions = (s: State, now: number) => openSessions(s).filter((x) => x.openedAt < startOfDay(now));
/** Should the next-day prompt be offered? */
export const needsDayCheck = (s: State, now: number) =>
  !s.pending && s.lastDayCheck !== dayKey(now) && staleSessions(s, now).length > 0;
