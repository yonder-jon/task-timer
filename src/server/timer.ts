// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

// The timer rules. Pure in-memory logic over a State object; no I/O.
import crypto from 'node:crypto';
import type { State, Project, Task, Session, Stint, StopAction } from '../shared/types.ts';

export const DEFAULT_GRACE_MS = 15 * 60 * 1000; // notes window before falling back to the stop time
export const MAX_STINT_MS = 24 * 60 * 60 * 1000;

export class HttpError extends Error {
  status: 400 | 404 | 409;
  constructor(status: 400 | 404 | 409, message: string) {
    super(message);
    this.status = status;
  }
}
const fail = (status: 400 | 404 | 409, message: string): never => { throw new HttpError(status, message); };
const text = (v: unknown, max = 20000) => String(v ?? '').slice(0, max);

export interface TimerOptions {
  now?: () => number;
  graceMs?: number;
  newId?: () => string;
}

export interface StartOptions { start?: number | null; notes?: string }
/** `session`: omitted/'current' = the task's open session, 'new' = a new closed (past) session, or a closed session's id. */
export interface StintInput { start: number; end: number; notes?: string; session?: string }

export class Timer {
  state: State;
  now: () => number;
  graceMs: number;
  newId: () => string;

  constructor(state: State, { now = Date.now, graceMs = DEFAULT_GRACE_MS, newId = () => crypto.randomUUID() }: TimerOptions = {}) {
    this.state = state;
    this.now = now;
    this.graceMs = graceMs;
    this.newId = newId;
  }

  // ----- lookups -----
  project(pid: string): Project | undefined { return this.state.projects.find((p) => p.id === pid); }
  task(tid: string): Task | undefined { return this.state.tasks.find((t) => t.id === tid); }
  openSession(tid: string): Session | undefined { return this.state.sessions.find((s) => s.taskId === tid && !s.closedAt); }
  isLive(tid: string): boolean { return this.state.running?.taskId === tid || this.state.pending?.taskId === tid; }

  private activeTask(tid: string): Task {
    const task = this.task(tid);
    if (!task || task.status !== 'active') return fail(400, 'Task not found or not active');
    const project = this.project(task.projectId);
    if (!project || project.status !== 'active') fail(400, 'Project is not active');
    return task;
  }

  // ----- projects & tasks -----
  addProject(name: string): Project {
    const p: Project = { id: this.newId(), name: requireName(name), status: 'active', createdAt: this.now() };
    this.state.projects.push(p);
    return p;
  }
  addTask(projectId: string, name: string): Task {
    const p = this.project(projectId);
    if (!p || p.status !== 'active') fail(400, 'Project not found or not active');
    const t: Task = { id: this.newId(), projectId, name: requireName(name), status: 'active', createdAt: this.now() };
    this.state.tasks.push(t);
    return t;
  }
  renameProject(pid: string, name: string): void {
    (this.project(pid) ?? fail(404, 'Project not found')).name = requireName(name);
  }
  renameTask(tid: string, name: string): void {
    (this.task(tid) ?? fail(404, 'Task not found')).name = requireName(name);
  }
  finishTask(tid: string): void {
    if (this.state.running?.taskId === tid) return this.requestStop('finishTask');
    if (this.state.pending?.taskId === tid) fail(409, 'Finish the pending notes first');
    this._finishTask(tid);
  }
  finishProject(pid: string): void {
    if (this.state.tasks.some((t) => t.projectId === pid && this.isLive(t.id))) {
      if (this.state.pending) fail(409, 'Finish the pending notes first');
      return this.requestStop('finishProject');
    }
    this._finishProject(pid);
  }
  reopenProject(pid: string): void {
    const p = this.project(pid) ?? fail(404, 'Project not found');
    p.status = 'active';
    delete p.finishedAt;
  }
  reopenTask(tid: string): void {
    const t = this.task(tid) ?? fail(404, 'Task not found');
    const p = this.project(t.projectId);
    if (p && p.status !== 'active') this.reopenProject(p.id);
    t.status = 'active';
    delete t.finishedAt;
  }
  private _finishTask(tid: string): void {
    const task = this.task(tid) ?? fail(404, 'Task not found');
    task.status = 'finished';
    task.finishedAt = this.now();
    this._closeSession(tid);
  }
  private _finishProject(pid: string): void {
    const project = this.project(pid) ?? fail(404, 'Project not found');
    project.status = 'finished';
    project.finishedAt = this.now();
    for (const t of this.state.tasks) if (t.projectId === pid && t.status === 'active') this._finishTask(t.id);
  }

  // ----- sessions -----
  ensureOpenSession(tid: string, at = this.now()): Session {
    let s = this.openSession(tid);
    if (!s) {
      s = { id: this.newId(), taskId: tid, openedAt: at, closedAt: null };
      this.state.sessions.push(s);
    }
    return s;
  }
  closeSession(tid: string): void {
    if (this.state.running?.taskId === tid) return this.requestStop('closeSession');
    if (this.state.pending?.taskId === tid) fail(409, 'Finish the pending notes first');
    this._closeSession(tid);
  }
  private _closeSession(tid: string): void {
    const s = this.openSession(tid);
    if (!s) return;
    if (this.state.stints.some((st) => st.sessionId === s.id)) s.closedAt = this.now();
    else this.state.sessions = this.state.sessions.filter((x) => x !== s); // nothing recorded — drop it
  }
  /**
   * Close several sessions at once (end of day / next-morning reset).
   * If one belongs to the running timer, it is stopped at `runningEnd` without the notes pop-up.
   */
  closeSessions(ids: string[], runningEnd?: number | null): void {
    for (const sid of ids) {
      const s = this.state.sessions.find((x) => x.id === sid && !x.closedAt);
      if (!s) continue;
      if (this.state.pending?.taskId === s.taskId) fail(409, 'Finish the pending notes first');
      const r = this.state.running;
      if (r?.taskId === s.taskId) {
        if (runningEnd == null || !Number.isFinite(runningEnd)) fail(400, 'Choose when the running timer should stop');
        this.addStint(r.taskId, r.start, Math.min(Math.max(runningEnd!, r.start), this.now()), r.notes || '');
        this.state.running = null;
      }
      this._closeSession(s.taskId);
    }
  }
  setDayCheck(day: string): void { this.state.lastDayCheck = text(day, 20); }

  // ----- stints -----
  addStint(taskId: string, start: number, end: number, notes = '', extra: Partial<Stint> = {}): Stint {
    const sess = this.ensureOpenSession(taskId, start);
    const st: Stint = { id: this.newId(), taskId, sessionId: sess.id, start, end, notes, ...extra };
    this.state.stints.push(st);
    return st;
  }
  /** Does [start, end) overlap any recorded or in-progress stint? */
  overlaps(start: number, end: number): boolean {
    const { stints, running, pending } = this.state;
    const spans: [number, number][] = stints.map((s) => [s.start, s.end]);
    if (running) spans.push([running.start, this.now()]);
    if (pending) spans.push([pending.start, pending.stoppedAt]);
    return spans.some(([a, b]) => start < b && end > a);
  }
  addManualStint(taskId: string, { start, end, notes, session = 'current' }: StintInput): Stint {
    this.activeTask(taskId);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) fail(400, 'End must be after start');
    if (end > this.now() + 60000) fail(400, 'Can’t add time in the future');
    if (end - start > MAX_STINT_MS) fail(400, 'That’s more than 24 hours');
    if (this.overlaps(start, end)) fail(400, 'That overlaps time already recorded');
    const body = text(notes).trim();
    if (session === 'current') return this.addStint(taskId, start, end, body, { manual: true });

    let sess: Session;
    if (session === 'new') {
      sess = { id: this.newId(), taskId, openedAt: start, closedAt: end };
      this.state.sessions.push(sess);
    } else {
      sess = this.state.sessions.find((x) => x.id === session && x.taskId === taskId && x.closedAt) ?? fail(404, 'Past session not found');
      sess.openedAt = Math.min(sess.openedAt, start);
      sess.closedAt = Math.max(sess.closedAt!, end);
    }
    const st: Stint = { id: this.newId(), taskId, sessionId: sess.id, start, end, notes: body, manual: true };
    this.state.stints.push(st);
    return st;
  }
  deleteStint(stintId: string): void {
    const st = this.state.stints.find((s) => s.id === stintId) ?? fail(404, 'Stint not found');
    this.state.stints = this.state.stints.filter((s) => s !== st);
    const sess = this.state.sessions.find((s) => s.id === st.sessionId);
    if (sess?.closedAt && !this.state.stints.some((s) => s.sessionId === sess.id)) {
      this.state.sessions = this.state.sessions.filter((s) => s !== sess);
    }
  }

  // ----- the running timer -----
  /** Start a task. If another is running, stop it (notes pop-up) and start this one afterwards. */
  start(tid: string, opts: StartOptions = {}): void {
    const { running, pending } = this.state;
    if (running?.taskId === tid) return;
    if (pending) fail(409, 'Finish the pending notes first');
    if (running) {
      if (opts.start != null) fail(409, 'Stop the running timer before starting one at a set time');
      return this.requestStop('stop', tid);
    }
    this._start(tid, opts);
  }
  private _start(tid: string, { start, notes }: StartOptions = {}): void {
    this.activeTask(tid);
    if (this.state.running || this.state.pending) fail(409, 'Another timer is active');
    const t = this.now();
    let from = t;
    if (start != null) {
      if (!Number.isFinite(start) || start > t + 60000) fail(400, 'Start time can’t be in the future');
      from = Math.min(start, t);
      if (t - from > MAX_STINT_MS) fail(400, 'Start time is more than 24 hours ago');
      if (this.overlaps(from, t)) fail(400, 'That start time overlaps time already recorded');
    }
    this.ensureOpenSession(tid, from);
    this.state.running = { taskId: tid, start: from, notes: text(notes) };
  }

  /** Stop the running timer and open the notes window. */
  requestStop(action: StopAction = 'stop', thenStart: string | null = null): void {
    const r = this.state.running;
    if (this.state.pending) fail(409, 'Notes for the previous stint are still pending');
    if (!r) return fail(409, 'No timer is running');
    this.state.pending = { taskId: r.taskId, start: r.start, stoppedAt: this.now(), action, thenStart, draft: r.notes || '' };
    this.state.running = null;
  }
  saveDraft(notes: string): void {
    const p = this.state.pending ?? fail(409, 'Nothing pending');
    p.draft = text(notes);
  }

  /**
   * Close the notes window and record the stint.
   * End-time rule: notes written and saved within the grace window → the stint runs until saving
   * (note-writing time counts). Empty, dismissed, or ignored past the window → it ends at the stop time.
   */
  resolvePending({ notes, dismissed = false, timedOut = false }: { notes?: string; dismissed?: boolean; timedOut?: boolean } = {}): void {
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

  /** Auto-close a notes window that has been ignored past the grace period. Returns true if it did. */
  sweep(): boolean {
    const p = this.state.pending;
    if (!p || this.now() - p.stoppedAt <= this.graceMs) return false;
    this.resolvePending({ timedOut: true });
    return true;
  }
}

function requireName(v: unknown): string {
  const name = text(v, 200).trim();
  if (!name) fail(400, 'Name is required');
  return name;
}
