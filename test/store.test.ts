import { test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadState, saveState, migrate, emptyState } from '../src/server/store.ts';
import type { State } from '../src/shared/types.ts';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'task-timer-')), 'data.json');

test('missing file loads as empty state', () => {
  assert.deepEqual(loadState(tmpFile()), emptyState());
});

test('corrupt file is an error, not silently replaced', () => {
  const f = tmpFile();
  fs.writeFileSync(f, '{not json');
  assert.throws(() => loadState(f), /Could not read/);
});

test('save then load round-trips and leaves no temp file', () => {
  const f = tmpFile();
  const s: State = { ...emptyState(), projects: [{ id: 'p', name: 'P', status: 'active', createdAt: 1 }] };
  saveState(f, s);
  assert.deepEqual(loadState(f), s);
  assert.equal(fs.existsSync(f + '.tmp'), false);
});

test('migrates v1 sessions into stints grouped per task per day', () => {
  const now = new Date(2026, 10, 10, 15, 0).getTime();
  const yesterday = new Date(2026, 10, 9, 10, 0).getTime();
  const today = new Date(2026, 10, 10, 9, 0).getTime();
  const v1 = {
    projects: [], tasks: [],
    sessions: [
      { id: 's1', taskId: 'a', start: yesterday, end: yesterday + 1000, notes: 'y1' },
      { id: 's2', taskId: 'a', start: yesterday + 5000, end: yesterday + 6000, notes: 'y2' },
      { id: 's3', taskId: 'a', start: today, end: today + 1000, notes: 't1' },
      { id: 's4', taskId: 'b', start: today, end: today + 1000, notes: '' },
    ],
    running: { taskId: 'c', start: today + 2000 },
    pending: null,
  };
  const s = migrate(v1, now);
  assert.equal(s.stints.length, 4);
  assert.ok(s.stints.every((st) => st.sessionId));

  const sessOf = (id: string) => s.sessions.find((x) => x.id === s.stints.find((st) => st.id === id)?.sessionId)!;
  assert.equal(sessOf('s1'), sessOf('s2'), 'same task, same day → same session');
  assert.notEqual(sessOf('s1'), sessOf('s3'), 'different day → different session');
  assert.ok(sessOf('s1').closedAt, "yesterday's session is closed");
  assert.equal(sessOf('s3').closedAt, null, "today's session stays open");
  assert.ok(s.sessions.some((x) => x.taskId === 'c' && !x.closedAt), 'running task gets an open session');
  assert.equal(s.lastDayCheck, null);
});

test('v2 data passes through unchanged', () => {
  const v2 = { ...emptyState(), stints: [{ id: 'x' }], sessions: [{ id: 'y' }] };
  assert.deepEqual(migrate(v2), v2);
});
