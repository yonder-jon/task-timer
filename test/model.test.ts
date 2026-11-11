// Client-side derived values (session/total times, the next-day check).
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { emptyState } from '../src/server/store.ts';
import {
  closedTodaySessions, liveMs, sessionMs, taskSessionMs, taskTotalMs, projectSessionMs, sessionNotes, staleSessions, needsDayCheck,
} from '../src/client/lib/model.ts';
import { dayKey } from '../src/client/lib/format.ts';
import type { State } from '../src/shared/types.ts';

const MIN = 60_000, HOUR = 60 * MIN;
const now = new Date(2026, 10, 10, 15, 0).getTime();
const yesterday = new Date(2026, 10, 9, 10, 0).getTime();

function fixture(): State {
  return {
    ...emptyState(),
    projects: [{ id: 'p', name: 'P', status: 'active', createdAt: 0 }],
    tasks: [
      { id: 'a', projectId: 'p', name: 'A', status: 'active', createdAt: 0 },
      { id: 'b', projectId: 'p', name: 'B', status: 'active', createdAt: 0 },
    ],
    sessions: [
      { id: 'old', taskId: 'a', openedAt: yesterday - 24 * HOUR, closedAt: yesterday - 20 * HOUR },
      { id: 'sa', taskId: 'a', openedAt: now - 3 * HOUR, closedAt: null },
      { id: 'sb', taskId: 'b', openedAt: yesterday, closedAt: null },
    ],
    stints: [
      { id: '1', taskId: 'a', sessionId: 'old', start: yesterday - 24 * HOUR, end: yesterday - 23 * HOUR, notes: 'old' },
      { id: '2', taskId: 'a', sessionId: 'sa', start: now - 3 * HOUR, end: now - 2 * HOUR, notes: 'first' },
      { id: '3', taskId: 'a', sessionId: 'sa', start: now - 90 * MIN, end: now - 60 * MIN, notes: '' },
      { id: '4', taskId: 'b', sessionId: 'sb', start: yesterday, end: yesterday + HOUR, notes: 'b work' },
    ],
    running: { taskId: 'a', start: now - 20 * MIN, notes: '' },
  };
}

test('running time counts towards the open session and the task total', () => {
  const s = fixture();
  assert.equal(liveMs(s, 'a', now), 20 * MIN);
  assert.equal(sessionMs(s, s.sessions[1]!, now), HOUR + 30 * MIN + 20 * MIN);
  assert.equal(taskSessionMs(s, 'a', now), 110 * MIN);
  assert.equal(taskTotalMs(s, 'a', now), 2 * HOUR + 30 * MIN + 20 * MIN);
});

test('closed sessions do not include the running stint', () => {
  const s = fixture();
  assert.equal(sessionMs(s, s.sessions[0]!, now), HOUR);
});

test('a pending stint counts up to its stop time', () => {
  const s: State = { ...fixture(), running: null, pending: { taskId: 'a', start: now - 20 * MIN, stoppedAt: now - 5 * MIN, action: 'stop', thenStart: null, draft: '' } };
  assert.equal(liveMs(s, 'a', now), 15 * MIN);
});

test('project session total sums its tasks', () => {
  assert.equal(projectSessionMs(fixture(), 'p', now), 110 * MIN + HOUR);
});

test('session notes join non-empty stint notes in order', () => {
  const s = fixture();
  assert.equal(sessionNotes(s, s.sessions[1]!), 'first');
});

test('stale sessions are open ones opened before today', () => {
  const s = fixture();
  assert.deepEqual(staleSessions(s, now).map((x) => x.id), ['sb']);
});

test('next-day check: only when stale sessions exist, not already handled today, nothing pending', () => {
  const s = fixture();
  assert.equal(needsDayCheck(s, now), true);
  assert.equal(needsDayCheck({ ...s, lastDayCheck: dayKey(now) }, now), false);
  assert.equal(needsDayCheck({ ...s, sessions: s.sessions.filter((x) => x.id !== 'sb') }, now), false);
  const pending = { taskId: 'a', start: now - MIN, stoppedAt: now, action: 'stop' as const, thenStart: null, draft: '' };
  assert.equal(needsDayCheck({ ...s, running: null, pending }, now), false);
});

test('closedTodaySessions: only this task\'s sessions closed since midnight', () => {
  const s = fixture();
  s.sessions.push(
    { id: 'c2', taskId: 'a', openedAt: now - 5 * HOUR, closedAt: now - HOUR },
    { id: 'c1', taskId: 'a', openedAt: yesterday, closedAt: now - 6 * HOUR }, // yesterday's, closed this morning
    { id: 'cb', taskId: 'b', openedAt: now - 5 * HOUR, closedAt: now - 4 * HOUR },
  );
  assert.deepEqual(closedTodaySessions(s, 'a', now).map((x) => x.id), ['c1', 'c2']);
});
