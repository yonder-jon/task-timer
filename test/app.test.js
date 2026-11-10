// HTTP-level tests: routing, persistence on change, rollback on error, static files.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Timer } from '../src/server/timer.js';
import { emptyState } from '../src/server/store.js';
import { createApp } from '../src/server/app.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
let server, base, timer, saves;

before(async () => {
  timer = new Timer(emptyState());
  saves = 0;
  server = http.createServer(createApp({ timer, save: () => { saves++; }, publicDir }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const post = (p, body = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /api/state returns state plus server clock', async () => {
  const res = await fetch(base + '/api/state');
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.ok(Array.isArray(s.projects));
  assert.equal(typeof s.serverNow, 'number');
  assert.equal(s.notesGraceMs, 15 * 60 * 1000);
});

test('POSTs change state and save; full start → stop → notes flow', async () => {
  const before = saves;
  let s = await (await post('/api/projects', { name: 'P' })).json();
  const pid = s.projects.at(-1).id;
  s = await (await post('/api/tasks', { projectId: pid, name: 'T' })).json();
  const tid = s.tasks.at(-1).id;
  s = await (await post(`/api/tasks/${tid}/start`)).json();
  assert.equal(s.running.taskId, tid);
  s = await (await post('/api/stop')).json();
  assert.equal(s.pending.taskId, tid);
  s = await (await post('/api/pending/resolve', { notes: 'done' })).json();
  assert.equal(s.stints.at(-1).notes, 'done');
  assert.equal(saves - before, 5);
});

test('errors return status, message and current state, and roll back partial changes', async () => {
  const p = timer.addProject('Q');
  const t1 = timer.addTask(p.id, 'one');
  const t2 = timer.addTask(p.id, 'two');
  timer.start(t1.id);
  const s1 = timer.openSession(t1.id).id;
  timer.addManualStint(t2.id, { start: Date.now() - 3600000, end: Date.now() - 1800000 });
  const s2 = timer.openSession(t2.id).id;
  // s2 would close fine, then s1 fails (running, no end time) → nothing should change.
  const res = await post('/api/sessions/close', { ids: [s2, s1] });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /running timer/);
  assert.equal(body.state.sessions.find((s) => s.id === s2).closedAt, null, 'rolled back');
  assert.equal(timer.state.running.taskId, t1.id);
});

test('unknown API route → 404 JSON', async () => {
  const res = await fetch(base + '/api/nope');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error, 'Not found');
});

test('bad JSON → 400', async () => {
  const res = await fetch(base + '/api/projects', { method: 'POST', body: '{oops' });
  assert.equal(res.status, 400);
});

test('serves index, css and js modules with the right types', async () => {
  for (const [p, type] of [['/', 'text/html'], ['/styles.css', 'text/css'], ['/js/main.js', 'text/javascript'], ['/js/views/notes.js', 'text/javascript']]) {
    const res = await fetch(base + p);
    assert.equal(res.status, 200, p);
    assert.match(res.headers.get('content-type'), new RegExp(type), p);
  }
});

test('does not serve files outside /public', async () => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%2fsrc%2fserver%2fmain.js', '/js/../../data.json']) {
    const res = await fetch(base + p);
    assert.equal(res.status, 404, p);
  }
});
