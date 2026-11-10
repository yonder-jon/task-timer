// Derived values computed from server state.
import { app, nowMs } from './state.js';
import { clock, hm, esc, fmtTime, fmtDate, dayKey } from './format.js';

const S = () => app.S;

export const project = (id) => S().projects.find((p) => p.id === id);
export const task = (id) => S().tasks.find((t) => t.id === id);
export const openSession = (tid) => S().sessions.find((s) => s.taskId === tid && !s.closedAt);
export const stintsOf = (sid) => S().stints.filter((st) => st.sessionId === sid).sort((a, b) => a.start - b.start);
export const projectTasks = (pid) => S().tasks.filter((t) => t.projectId === pid);
export const openSessions = () => S().sessions.filter((s) => !s.closedAt && task(s.taskId));
export const busy = () => !!S().pending;

/** The in-progress stint for a task (running, or stopped but awaiting notes). */
export function liveMs(tid) {
  const { running, pending } = S();
  if (running?.taskId === tid) return nowMs() - running.start;
  if (pending?.taskId === tid) return pending.stoppedAt - pending.start;
  return 0;
}
export function sessionMs(sess) {
  let ms = stintsOf(sess.id).reduce((a, st) => a + st.end - st.start, 0);
  if (!sess.closedAt) ms += liveMs(sess.taskId);
  return ms;
}
export const taskSessionMs = (tid) => { const s = openSession(tid); return s ? sessionMs(s) : liveMs(tid); };
export const taskTotalMs = (tid) => S().stints.filter((st) => st.taskId === tid).reduce((a, st) => a + st.end - st.start, 0) + liveMs(tid);
export const projectSessionMs = (pid) => projectTasks(pid).reduce((a, t) => a + taskSessionMs(t.id), 0);
export const projectTotalMs = (pid) => projectTasks(pid).reduce((a, t) => a + taskTotalMs(t.id), 0);
export const sessionNotes = (sess) => stintsOf(sess.id).map((st) => st.notes).filter(Boolean).join('\n');

export const startOfToday = () => { const d = new Date(nowMs()); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const isToday = (t) => dayKey(t) === dayKey(nowMs());
export const whenLabel = (t) => (isToday(t) ? fmtTime(t) : `${fmtDate(t)} ${fmtTime(t)}`);
/** Sessions opened before today that are still open. */
export const staleSessions = () => openSessions().filter((s) => s.openedAt < startOfToday());

export const sessLabel = (sess) => {
  const t = task(sess.taskId);
  return `${esc(project(t.projectId)?.name ?? '')} › <b>${esc(t.name)}</b>`;
};

// Values that tick every second, keyed by data-live attributes.
export function liveValue(key) {
  const { running } = S();
  const [kind, id] = key.split(':');
  switch (kind) {
    case 'run-sess': return running ? clock(taskSessionMs(running.taskId)) : '';
    case 'run-total': return running ? clock(taskTotalMs(running.taskId)) : '';
    case 'run-stint': return running ? clock(nowMs() - running.start) : '';
    case 'sess': return clock(taskSessionMs(id));
    case 'tot': return clock(taskTotalMs(id));
    case 'psess': return hm(projectSessionMs(id));
    case 'ptot': return hm(projectTotalMs(id));
    case 'sid': { const s = S().sessions.find((x) => x.id === id); return s ? hm(sessionMs(s)) : ''; }
    case 'today': return hm(openSessions().reduce((a, s) => a + sessionMs(s), 0));
    default: return '';
  }
}
/** A span that the 1-second ticker keeps up to date. */
export const live = (key) => `<span data-live="${key}">${liveValue(key)}</span>`;
