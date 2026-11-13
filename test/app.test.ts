// HTTP-level tests: routing, validation, persistence on change, rollback on error, static files.
import { test, beforeEach, beforeAll } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Timer } from '../src/server/timer.ts';
import { emptyState } from '../src/server/store.ts';
import { createApp } from '../src/server/app.ts';
import type { PublicState, ApiError } from '../src/shared/types.ts';

let timer: Timer;
let saves: number;
let app: ReturnType<typeof createApp>['app'];
let staticDir: string;

beforeAll(() => {
  // A stand-in for dist/client, plus a secret next to it that must never be served.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-timer-static-'));
  staticDir = path.join(root, 'client');
  fs.mkdirSync(path.join(staticDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>shell</title>');
  fs.writeFileSync(path.join(staticDir, 'assets', 'app.js'), 'console.log(1)');
  fs.writeFileSync(path.join(root, 'secret.json'), '{"secret":true}');
});

beforeEach(() => {
  timer = new Timer(emptyState());
  saves = 0;
  app = createApp({ timer, save: () => { saves++; }, staticDir }).app;
});

const post = (p: string, body: unknown = {}) =>
  app.request(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const json = async <T = PublicState>(res: Response) => (await res.json()) as T;

test('GET /api/state returns state plus server clock', async () => {
  const res = await app.request('/api/state');
  assert.equal(res.status, 200);
  const s = await json(res);
  assert.deepEqual(s.projects, []);
  assert.equal(typeof s.serverNow, 'number');
  assert.equal(s.notesGraceMs, 15 * 60 * 1000);
  assert.equal(saves, 0, 'reads do not save');
});

test('full start → stop → notes flow, saving after each change', async () => {
  let s = await json(await post('/api/projects', { name: 'P' }));
  const pid = s.projects[0]!.id;
  s = await json(await post('/api/tasks', { projectId: pid, name: 'T' }));
  const tid = s.tasks[0]!.id;
  s = await json(await post(`/api/tasks/${tid}/start`, {}));
  assert.equal(s.running?.taskId, tid);
  s = await json(await post('/api/stop'));
  assert.equal(s.pending?.taskId, tid);
  s = await json(await post('/api/pending/resolve', { notes: 'done' }));
  assert.equal(s.stints.at(-1)?.notes, 'done');
  assert.equal(saves, 5);
});

test('rename routes update the name and save', async () => {
  const p = timer.addProject('P');
  const t = timer.addTask(p.id, 'first task - tbd');
  let s = await json(await post(`/api/tasks/${t.id}/rename`, { name: 'Defined task' }));
  assert.equal(s.tasks[0]?.name, 'Defined task');
  s = await json(await post(`/api/projects/${p.id}/rename`, { name: 'Q' }));
  assert.equal(s.projects[0]?.name, 'Q');
  assert.equal(saves, 2);
  assert.equal((await post(`/api/tasks/${t.id}/rename`, { name: '' })).status, 400);
  assert.equal((await post(`/api/tasks/${t.id}/rename`, {})).status, 400);
});

test('rule errors return status, message and current state', async () => {
  const res = await post('/api/stop');
  assert.equal(res.status, 409);
  const body = await json<ApiError>(res);
  assert.equal(body.error, 'No timer is running');
  assert.ok(body.state);
  assert.equal(saves, 0, 'failed changes are not saved');
});

test('a failure part-way through rolls back the earlier changes', async () => {
  const p = timer.addProject('Q');
  const t1 = timer.addTask(p.id, 'one');
  const t2 = timer.addTask(p.id, 'two');
  timer.addManualStint(t2.id, { start: Date.now() - 3600000, end: Date.now() - 1800000 });
  timer.start(t1.id);
  const s1 = timer.openSession(t1.id)!.id;
  const s2 = timer.openSession(t2.id)!.id;
  // s2 would close fine, then s1 fails (timer running, no end time) → nothing should change.
  const res = await post('/api/sessions/close', { ids: [s2, s1] });
  assert.equal(res.status, 400);
  const body = await json<ApiError>(res);
  assert.match(body.error, /running timer/);
  assert.equal(timer.openSession(t2.id)?.id, s2, 'rolled back');
  assert.equal(timer.state.running?.taskId, t1.id);
});

test('request bodies are validated', async () => {
  for (const [p, body] of [
    ['/api/projects', {}],
    ['/api/projects', { name: 42 }],
    ['/api/tasks/x/stints', { start: 'yesterday', end: 1 }],
    ['/api/sessions/close', { ids: 'all' }],
  ] as const) {
    const res = await post(p, body);
    assert.equal(res.status, 400, p);
    assert.match((await json<ApiError>(res)).error, /Invalid request/, p);
  }
});

test('bad JSON → 400', async () => {
  const res = await app.request('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{oops' });
  assert.equal(res.status, 400);
});

test('unknown API route → 404 JSON', async () => {
  const res = await app.request('/api/nope');
  assert.equal(res.status, 404);
  assert.equal((await json<ApiError>(res)).error, 'Not found');
});

test('serves the built client, falling back to index.html for app paths', async () => {
  for (const [p, type] of [['/', 'text/html'], ['/assets/app.js', 'javascript'], ['/some/page', 'text/html']]) {
    const res = await app.request(p);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type') ?? '', new RegExp(type), p);
  }
});

test('does not serve files outside the client directory', async () => {
  for (const p of ['/../secret.json', '/%2e%2e/secret.json', '/..%2fsecret.json', '/assets/../../secret.json']) {
    const res = await app.request(p);
    assert.doesNotMatch(await res.text(), /secret/, p);
  }
});
