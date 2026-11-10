// Task Timer — tiny zero-dependency Node server.
// Run: node server.js  (then open http://localhost:3000)
//
// Terms:
//   Project  > Task  > Session (a task's running total for the day, closed at end of day)
//                    > Stint   (one start→stop period of work, with optional notes)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const NOTES_GRACE_MS = Number(process.env.NOTES_GRACE_MS) || 15 * 60 * 1000; // notes window before falling back to the stop time
const MAX_STINT_MS = 24 * 60 * 60 * 1000;

// ---------- persistence ----------
function emptyState() {
  return { projects: [], tasks: [], sessions: [], stints: [], running: null, pending: null, lastDayCheck: null };
}
const id = () => crypto.randomUUID();
const now = () => Date.now();

function load() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return emptyState(); }
  const s = { ...emptyState(), ...raw };
  // v1 → v2: old "sessions" were start/stop periods (now "stints"). Group them per task per day.
  if (!raw.stints && Array.isArray(raw.sessions)) {
    s.stints = raw.sessions;
    s.sessions = [];
    const dayKey = (t) => new Date(t).toDateString();
    const today = dayKey(now());
    const groups = new Map();
    for (const st of s.stints.sort((a, b) => a.start - b.start)) {
      const k = st.taskId + '|' + dayKey(st.start);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(st);
    }
    for (const list of groups.values()) {
      const open = dayKey(list[0].start) === today;
      const sess = { id: id(), taskId: list[0].taskId, openedAt: list[0].start, closedAt: open ? null : list.at(-1).end };
      s.sessions.push(sess);
      for (const st of list) st.sessionId = sess.id;
    }
    if (s.running && !s.sessions.some((x) => x.taskId === s.running.taskId && !x.closedAt)) {
      s.sessions.push({ id: id(), taskId: s.running.taskId, openedAt: s.running.start, closedAt: null });
    }
    if (s.pending?.action === 'pause') s.pending.action = 'stop';
  }
  return s;
}
let state = load();
function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
save();

// ---------- domain logic ----------
const findProject = (pid) => state.projects.find((p) => p.id === pid);
const findTask = (tid) => state.tasks.find((t) => t.id === tid);
const openSession = (tid) => state.sessions.find((s) => s.taskId === tid && !s.closedAt);
function ensureOpenSession(tid, at = now()) {
  let s = openSession(tid);
  if (!s) {
    s = { id: id(), taskId: tid, openedAt: at, closedAt: null };
    state.sessions.push(s);
  }
  return s;
}
function closeSession(tid) {
  const s = openSession(tid);
  if (!s) return;
  if (!state.stints.some((st) => st.sessionId === s.id)) {
    state.sessions = state.sessions.filter((x) => x !== s); // nothing recorded — drop it
  } else s.closedAt = now();
}
function addStint(taskId, start, end, notes = '', extra = {}) {
  const sess = ensureOpenSession(taskId, start);
  state.stints.push({ id: id(), taskId, sessionId: sess.id, start, end, notes, ...extra });
}

// Does [start, end) overlap any recorded or in-progress stint?
function overlaps(start, end) {
  const spans = state.stints.map((s) => [s.start, s.end]);
  if (state.running) spans.push([state.running.start, now()]);
  if (state.pending) spans.push([state.pending.start, state.pending.stoppedAt]);
  return spans.some(([a, b]) => start < b && end > a);
}

function assertTaskActive(taskId) {
  const task = findTask(taskId);
  if (!task || task.status !== 'active') throw httpError(400, 'Task not found or not active');
  const project = findProject(task.projectId);
  if (!project || project.status !== 'active') throw httpError(400, 'Project is not active');
  return task;
}

function startTask(taskId, { start, notes } = {}) {
  assertTaskActive(taskId);
  if (state.running || state.pending) throw httpError(409, 'Another timer is active');
  const t = now();
  if (start != null) {
    start = Number(start);
    if (!Number.isFinite(start) || start > t + 60000) throw httpError(400, 'Start time can’t be in the future');
    start = Math.min(start, t);
    if (t - start > MAX_STINT_MS) throw httpError(400, 'Start time is more than 24 hours ago');
    if (overlaps(start, t)) throw httpError(400, 'That start time overlaps time already recorded');
  } else start = t;
  ensureOpenSession(taskId, start);
  state.running = { taskId, start, notes: String(notes || '').slice(0, 20000) };
}

// Stop the running timer and open the notes window.
// action: 'stop' | 'finishTask' | 'finishProject' | 'closeSession' ; thenStart: task id to start afterwards
function requestStop(action = 'stop', thenStart = null) {
  if (state.pending) throw httpError(409, 'Notes for the previous stint are still pending');
  if (!state.running) throw httpError(409, 'No timer is running');
  state.pending = {
    taskId: state.running.taskId,
    start: state.running.start,
    stoppedAt: now(),
    action,
    thenStart,
    draft: state.running.notes || '',
  };
  state.running = null;
}

// Close the notes window and record the stint.
// End-time rule: if notes were written and submitted within 15 minutes, the stint runs
// until submission (time spent writing notes counts). If notes are empty, dismissed, or the
// window was ignored for over 15 minutes, the stint ends when the timer was stopped.
function resolvePending({ notes, dismissed = false, timedOut = false } = {}) {
  const p = state.pending;
  if (!p) throw httpError(409, 'Nothing pending');
  const text = (notes ?? p.draft ?? '').trim();
  const t = now();
  const withinGrace = t - p.stoppedAt <= NOTES_GRACE_MS;
  const end = !dismissed && !timedOut && text && withinGrace ? t : p.stoppedAt;
  addStint(p.taskId, p.start, end, dismissed ? '' : text);
  state.pending = null;

  const task = findTask(p.taskId);
  if (p.action === 'finishTask' && task) finishTask(task.id);
  if (p.action === 'finishProject' && task) finishProject(task.projectId);
  if (p.action === 'closeSession' && task) closeSession(task.id);
  if (p.thenStart) {
    try { startTask(p.thenStart); } catch { /* target vanished; ignore */ }
  }
}

function finishTask(taskId) {
  const task = findTask(taskId);
  if (!task) throw httpError(404, 'Task not found');
  task.status = 'finished';
  task.finishedAt = now();
  closeSession(taskId);
}
function finishProject(projectId) {
  const project = findProject(projectId);
  if (!project) throw httpError(404, 'Project not found');
  project.status = 'finished';
  project.finishedAt = now();
  for (const t of state.tasks) if (t.projectId === projectId && t.status === 'active') finishTask(t.id);
}
const taskIsLive = (taskId) => state.running?.taskId === taskId || state.pending?.taskId === taskId;
const projectIsLive = (projectId) => state.tasks.some((t) => t.projectId === projectId && taskIsLive(t.id));

// Close several sessions at once (end of day / next-morning reset).
// If one of them belongs to the running timer, it is stopped at `runningEnd`.
function closeSessions(ids, runningEnd) {
  for (const sid of ids) {
    const s = state.sessions.find((x) => x.id === sid && !x.closedAt);
    if (!s) continue;
    if (state.pending?.taskId === s.taskId) throw httpError(409, 'Finish the pending notes first');
    if (state.running?.taskId === s.taskId) {
      const end = Number(runningEnd);
      if (!Number.isFinite(end)) throw httpError(400, 'Choose when the running timer should stop');
      const r = state.running;
      addStint(r.taskId, r.start, Math.min(Math.max(end, r.start), now()), r.notes || '');
      state.running = null;
    }
    closeSession(s.taskId);
  }
}

function addManualStint(taskId, { start, end, notes }) {
  assertTaskActive(taskId);
  start = Number(start); end = Number(end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw httpError(400, 'End must be after start');
  if (end > now() + 60000) throw httpError(400, 'Can’t add time in the future');
  if (end - start > MAX_STINT_MS) throw httpError(400, 'That’s more than 24 hours');
  if (overlaps(start, end)) throw httpError(400, 'That overlaps time already recorded');
  addStint(taskId, start, end, String(notes || '').trim().slice(0, 20000), { manual: true });
}

function deleteStint(stintId) {
  const st = state.stints.find((s) => s.id === stintId);
  if (!st) throw httpError(404, 'Stint not found');
  state.stints = state.stints.filter((s) => s !== st);
  const sess = state.sessions.find((s) => s.id === st.sessionId);
  if (sess?.closedAt && !state.stints.some((s) => s.sessionId === sess.id)) {
    state.sessions = state.sessions.filter((s) => s !== sess);
  }
}

// Auto-close the notes window once it has been ignored for 15 minutes.
function sweep() {
  if (state.pending && now() - state.pending.stoppedAt > NOTES_GRACE_MS) {
    resolvePending({ timedOut: true });
    save();
  }
}
setInterval(sweep, 15 * 1000);

// ---------- HTTP ----------
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { reject(httpError(400, 'Bad JSON')); }
    });
    req.on('error', reject);
  });
}
function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
const publicState = () => ({ ...state, serverNow: now(), notesGraceMs: NOTES_GRACE_MS });
const requireName = (b) => {
  const name = String(b.name || '').trim();
  if (!name) throw httpError(400, 'Name is required');
  return name.slice(0, 200);
};

const routes = [
  ['GET', /^\/api\/state$/, () => {}],
  ['POST', /^\/api\/projects$/, (m, b) => {
    state.projects.push({ id: id(), name: requireName(b), status: 'active', createdAt: now() });
  }],
  ['POST', /^\/api\/projects\/([\w-]+)\/finish$/, ([, pid]) => {
    if (projectIsLive(pid)) {
      if (state.pending) throw httpError(409, 'Finish the pending notes first');
      requestStop('finishProject');
    } else finishProject(pid);
  }],
  ['POST', /^\/api\/projects\/([\w-]+)\/reopen$/, ([, pid]) => {
    const p = findProject(pid);
    if (!p) throw httpError(404, 'Project not found');
    p.status = 'active';
    delete p.finishedAt;
  }],
  ['POST', /^\/api\/tasks$/, (m, b) => {
    const p = findProject(b.projectId);
    if (!p || p.status !== 'active') throw httpError(400, 'Project not found or not active');
    state.tasks.push({ id: id(), projectId: p.id, name: requireName(b), status: 'active', createdAt: now() });
  }],
  ['POST', /^\/api\/tasks\/([\w-]+)\/start$/, ([, tid], b) => {
    if (state.running?.taskId === tid) return;
    if (state.pending) throw httpError(409, 'Finish the pending notes first');
    if (state.running) {
      if (b.start != null) throw httpError(409, 'Stop the running timer before starting one at a set time');
      requestStop('stop', tid); // switching: stop current, start this after notes
    } else startTask(tid, { start: b.start, notes: b.notes });
  }],
  ['POST', /^\/api\/tasks\/([\w-]+)\/stints$/, ([, tid], b) => addManualStint(tid, b)],
  ['POST', /^\/api\/stop$/, () => requestStop('stop')],
  ['POST', /^\/api\/tasks\/([\w-]+)\/finish$/, ([, tid]) => {
    if (state.running?.taskId === tid) requestStop('finishTask');
    else if (state.pending?.taskId === tid) throw httpError(409, 'Finish the pending notes first');
    else finishTask(tid);
  }],
  ['POST', /^\/api\/tasks\/([\w-]+)\/close-session$/, ([, tid]) => {
    if (state.running?.taskId === tid) requestStop('closeSession');
    else if (state.pending?.taskId === tid) throw httpError(409, 'Finish the pending notes first');
    else closeSession(tid);
  }],
  ['POST', /^\/api\/tasks\/([\w-]+)\/reopen$/, ([, tid]) => {
    const t = findTask(tid);
    if (!t) throw httpError(404, 'Task not found');
    const p = findProject(t.projectId);
    if (p && p.status !== 'active') { p.status = 'active'; delete p.finishedAt; }
    t.status = 'active';
    delete t.finishedAt;
  }],
  ['POST', /^\/api\/sessions\/close$/, (m, b) => {
    closeSessions(Array.isArray(b.ids) ? b.ids : [], b.runningEnd);
    if (b.day) state.lastDayCheck = String(b.day);
  }],
  ['POST', /^\/api\/daycheck$/, (m, b) => { state.lastDayCheck = String(b.day || ''); }],
  ['POST', /^\/api\/stints\/([\w-]+)\/delete$/, ([, sid]) => deleteStint(sid)],
  ['POST', /^\/api\/pending\/draft$/, (m, b) => {
    if (!state.pending) throw httpError(409, 'Nothing pending');
    state.pending.draft = String(b.notes || '').slice(0, 20000);
  }],
  ['POST', /^\/api\/pending\/resolve$/, (m, b) => {
    resolvePending({ notes: String(b.notes ?? '').slice(0, 20000), dismissed: !!b.dismissed });
  }],
];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      sweep();
      for (const [method, re, handler] of routes) {
        const m = url.pathname.match(re);
        if (m && req.method === method) {
          const body = method === 'POST' ? await readBody(req) : {};
          const snapshot = JSON.stringify(state);
          try { handler(m, body); } catch (e) { state = JSON.parse(snapshot); throw e; } // no half-applied changes
          if (method === 'POST') save();
          return send(res, 200, publicState());
        }
      }
      return send(res, 404, { error: 'Not found' });
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return send(res, 200, fs.readFileSync(path.join(__dirname, 'public', 'index.html')), 'text/html; charset=utf-8');
    }
    send(res, 404, 'Not found', 'text/plain');
  } catch (e) {
    send(res, e.status || 500, { error: e.message, state: publicState() });
  }
});

server.listen(PORT, HOST, () => console.log(`Task Timer running at http://${HOST}:${PORT}`));
