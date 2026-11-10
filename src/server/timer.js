// The timer rules. Pure in-memory logic over a state object; no I/O.
//
// Terms:
//   Project > Task > Session (a task's running total for the day, closed at end of day)
//                  > Stint   (one start→stop period of work, with optional notes)
import crypto from 'node:crypto';

export const DEFAULT_GRACE_MS = 15 * 60 * 1000; // notes window before falling back to the stop time
export const MAX_STINT_MS = 24 * 60 * 60 * 1000;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => { throw new HttpError(status, message); };
const text = (v, max = 20000) => String(v ?? '').slice(0, max);

export class Timer {
  constructor(state, { now = Date.now, graceMs = DEFAULT_GRACE_MS, newId = () => crypto.randomUUID() } = {}) {
    this.state = state;
    this.now = now;
    this.graceMs = graceMs;
    this.newId = newId;
  }

  // ----- lookups -----
  project(pid) { return this.state.projects.find((p) => p.id === pid); }
  task(tid) { return this.state.tasks.find((t) => t.id === tid); }
  openSession(tid) { return this.state.sessions.find((s) => s.taskId === tid && !s.closedAt); }
  isLive(tid) { return this.state.running?.taskId === tid || this.state.pending?.taskId === tid; }

  activeTask(tid) {
    const task = this.task(tid);
    if (!task || task.status !== 'active') fail(400, 'Task not found or not active');
    const project = this.project(task.projectId);
    if (!project || project.status !== 'active') fail(400, 'Project is not active');
    return task;
  }

  // ----- projects & tasks -----
  addProject(name) {
    const p = { id: this.newId(), name: requireName(name), status: 'active', createdAt: this.now() };
    this.state.projects.push(p);
    return p;
  }
  addTask(projectId, name) {
    const p = this.project(projectId);
    if (!p || p.status !== 'active') fail(400, 'Project not found or not active');
    const t = { id: this.newId(), projectId, name: requireName(name), status: 'active', createdAt: this.now() };
    this.state.tasks.push(t);
    return t;
  }
  finishTask(tid) {
    if (this.state.running?.taskId === tid) return this.requestStop('finishTask');
    if (this.state.pending?.taskId === tid) fail(409, 'Finish the pending notes first');
    this._finishTask(tid);
  }
  finishProject(pid) {
    if (this.state.tasks.some((t) => t.projectId === pid && this.isLive(t.id))) {
      if (this.state.pending) fail(409, 'Finish the pending notes first');
      return this.requestStop('finishProject');
    }
    this._finishProject(pid);
  }
  reopenProject(pid) {
    const p = this.project(pid) ?? fail(404, 'Project not found');
    p.status = 'active';
    delete p.finishedAt;
  }
  reopenTask(tid) {
    const t = this.task(tid) ?? fail(404, 'Task not found');
    const p = this.project(t.projectId);
    if (p && p.status !== 'active') this.reopenProject(p.id);
    t.status = 'active';
    delete t.finishedAt;
  }
  _finishTask(tid) {
    const task = this.task(tid) ?? fail(404, 'Task not found');
    task.status = 'finished';
    task.finishedAt = this.now();
    this._closeSession(tid);
  }
  _finishProject(pid) {
    const project = this.project(pid) ?? fail(404, 'Project not found');
    project.status = 'finished';
    project.finishedAt = this.now();
    for (const t of this.state.tasks) if (t.projectId === pid && t.status === 'active') this._finishTask(t.id);
  }

  // ----- sessions -----
  ensureOpenSession(tid, at = this.now()) {
    let s = this.openSession(tid);
    if (!s) {
      s = { id: this.newId(), taskId: tid, openedAt: at, closedAt: null };
      this.state.sessions.push(s);
    }
    return s;
  }
  closeSession(tid) {
    if (this.state.running?.taskId === tid) return this.requestStop('closeSession');
    if (this.state.pending?.taskId === tid) fail(409, 'Finish the pending notes first');
    this._closeSession(tid);
  }
  _closeSession(tid) {
    const s = this.openSession(tid);
    if (!s) return;
    if (this.state.stints.some((st) => st.sessionId === s.id)) s.closedAt = this.now();
    else this.state.sessions = this.state.sessions.filter((x) => x !== s); // nothing recorded — drop it
  }
  // Close several sessions at once (end of day / next-morning reset).
  // If one belongs to the running timer, it is stopped at `runningEnd` without the notes pop-up.
  closeSessions(ids = [], runningEnd) {
    for (const sid of ids) {
      const s = this.state.sessions.find((x) => x.id === sid && !x.closedAt);
      if (!s) continue;
      if (this.state.pending?.taskId === s.taskId) fail(409, 'Finish the pending notes first');
      const r = this.state.running;
      if (r?.taskId === s.taskId) {
        const end = Number(runningEnd);
        if (runningEnd == null || !Number.isFinite(end)) fail(400, 'Choose when the running timer should stop');
        this.addStint(r.taskId, r.start, Math.min(Math.max(end, r.start), this.now()), r.notes || '');
        this.state.running = null;
      }
      this._closeSession(s.taskId);
    }
  }
  setDayCheck(day) { this.state.lastDayCheck = text(day, 20); }

  // ----- stints -----
  addStint(taskId, start, end, notes = '', extra = {}) {
    const sess = this.ensureOpenSession(taskId, start);
    const st = { id: this.newId(), taskId, sessionId: sess.id, start, end, notes, ...extra };
    this.state.stints.push(st);
    return st;
  }
  // Does [start, end) overlap any recorded or in-progress stint?
  overlaps(start, end) {
    const { stints, running, pending } = this.state;
    const spans = stints.map((s) => [s.start, s.end]);
    if (running) spans.push([running.start, this.now()]);
    if (pending) spans.push([pending.start, pending.stoppedAt]);
    return spans.some(([a, b]) => start < b && end > a);
  }
  addManualStint(taskId, { start, end, notes } = {}) {
    this.activeTask(taskId);
    start = Number(start); end = Number(end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) fail(400, 'End must be after start');
    if (end > this.now() + 60000) fail(400, 'Can’t add time in the future');
    if (end - start > MAX_STINT_MS) fail(400, 'That’s more than 24 hours');
    if (this.overlaps(start, end)) fail(400, 'That overlaps time already recorded');
    return this.addStint(taskId, start, end, text(notes).trim(), { manual: true });
  }
  deleteStint(stintId) {
    const st = this.state.stints.find((s) => s.id === stintId) ?? fail(404, 'Stint not found');
    this.state.stints = this.state.stints.filter((s) => s !== st);
    const sess = this.state.sessions.find((s) => s.id === st.sessionId);
    if (sess?.closedAt && !this.state.stints.some((s) => s.sessionId === sess.id)) {
      this.state.sessions = this.state.sessions.filter((s) => s !== sess);
    }
  }

  // ----- the running timer -----
  // Start a task. If another is running, stop it (notes pop-up) and start this one afterwards.
  start(tid, { start, notes } = {}) {
    const { running, pending } = this.state;
    if (running?.taskId === tid) return;
    if (pending) fail(409, 'Finish the pending notes first');
    if (running) {
      if (start != null) fail(409, 'Stop the running timer before starting one at a set time');
      return this.requestStop('stop', tid);
    }
    this._start(tid, { start, notes });
  }
  _start(tid, { start, notes } = {}) {
    this.activeTask(tid);
    if (this.state.running || this.state.pending) fail(409, 'Another timer is active');
    const t = this.now();
    if (start != null) {
      start = Number(start);
      if (!Number.isFinite(start) || start > t + 60000) fail(400, 'Start time can’t be in the future');
      start = Math.min(start, t);
      if (t - start > MAX_STINT_MS) fail(400, 'Start time is more than 24 hours ago');
      if (this.overlaps(start, t)) fail(400, 'That start time overlaps time already recorded');
    } else start = t;
    this.ensureOpenSession(tid, start);
    this.state.running = { taskId: tid, start, notes: text(notes) };
  }

  // Stop the running timer and open the notes window.
  // action: 'stop' | 'finishTask' | 'finishProject' | 'closeSession'; thenStart: task to start afterwards.
  requestStop(action = 'stop', thenStart = null) {
    const r = this.state.running;
    if (this.state.pending) fail(409, 'Notes for the previous stint are still pending');
    if (!r) fail(409, 'No timer is running');
    this.state.pending = { taskId: r.taskId, start: r.start, stoppedAt: this.now(), action, thenStart, draft: r.notes || '' };
    this.state.running = null;
  }
  saveDraft(notes) {
    if (!this.state.pending) fail(409, 'Nothing pending');
    this.state.pending.draft = text(notes);
  }

  // Close the notes window and record the stint.
  // End-time rule: notes written and saved within the grace window → the stint runs until saving
  // (note-writing time counts). Empty, dismissed, or ignored past the window → it ends at the stop time.
  resolvePending({ notes, dismissed = false, timedOut = false } = {}) {
    const p = this.state.pending ?? fail(409, 'Nothing pending');
    const body = text(notes ?? p.draft).trim();
    const t = this.now();
    const withinGrace = t - p.stoppedAt <= this.graceMs;
    const end = !dismissed && !timedOut && body && withinGrace ? t : p.stoppedAt;
    this.addStint(p.taskId, p.start, end, dismissed ? '' : body);
    this.state.pending = null;

    const task = this.task(p.taskId);
    if (task && p.action === 'finishTask') this._finishTask(task.id);
    if (task && p.action === 'finishProject') this._finishProject(task.projectId);
    if (task && p.action === 'closeSession') this._closeSession(task.id);
    if (p.thenStart) {
      try { this._start(p.thenStart); } catch { /* target vanished; ignore */ }
    }
  }

  // Auto-close a notes window that has been ignored past the grace period. Returns true if it did.
  sweep() {
    const p = this.state.pending;
    if (!p || this.now() - p.stoppedAt <= this.graceMs) return false;
    this.resolvePending({ timedOut: true });
    return true;
  }
}

function requireName(v) {
  const name = text(v, 200).trim();
  if (!name) fail(400, 'Name is required');
  return name;
}
