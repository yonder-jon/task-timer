// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

import assert from 'node:assert/strict';
import { Timer, HttpError } from '../src/server/timer.ts';
import { emptyState } from '../src/server/store.ts';
import type { Stint } from '../src/shared/types.ts';

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;

/** A Timer with a controllable clock and predictable ids, plus one project with two tasks. */
export function setup({ graceMs = 15 * MIN } = {}) {
  let t = Date.UTC(2026, 10, 10, 9, 0, 0);
  let n = 0;
  const timer = new Timer(emptyState(), { now: () => t, graceMs, newId: () => `id${++n}` });
  const clock = {
    get now() { return t; },
    advance(ms: number) { t += ms; },
  };
  const project = timer.addProject('Project');
  const a = timer.addTask(project.id, 'Task A');
  const b = timer.addTask(project.id, 'Task B');
  return { timer, clock, project, a, b };
}

const present = <T>(v: T | null | undefined, what: string): T => {
  assert.ok(v != null, `expected ${what}`);
  return v;
};
export const running = (timer: Timer) => present(timer.state.running, 'a running timer');
export const pending = (timer: Timer) => present(timer.state.pending, 'a pending stint');
export const open = (timer: Timer, taskId: string) => present(timer.openSession(taskId), 'an open session');
export const stintsFor = (timer: Timer, taskId: string): Stint[] => timer.state.stints.filter((s) => s.taskId === taskId);
export const firstStint = (timer: Timer, taskId: string) => present(stintsFor(timer, taskId)[0], 'a stint');
export const duration = (st: Stint) => st.end - st.start;

/** Assert fn throws an HttpError with this status (and message matching re, if given). */
export const rejects = (fn: () => unknown, status: number, re?: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof HttpError && e.status === status && (!re || re.test(e.message)));
