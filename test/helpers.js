import { Timer } from '../src/server/timer.js';
import { emptyState } from '../src/server/store.js';

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;

/** A Timer with a controllable clock and predictable ids, plus one project with two tasks. */
export function setup({ graceMs = 15 * MIN } = {}) {
  let t = Date.UTC(2026, 10, 10, 9, 0, 0);
  let n = 0;
  const timer = new Timer(emptyState(), { now: () => t, graceMs, newId: () => `id${++n}` });
  const clock = {
    get now() { return t; },
    advance(ms) { t += ms; },
  };
  const project = timer.addProject('Project');
  const a = timer.addTask(project.id, 'Task A');
  const b = timer.addTask(project.id, 'Task B');
  return { timer, clock, project, a, b, state: () => timer.state };
}

export const stintsFor = (timer, taskId) => timer.state.stints.filter((s) => s.taskId === taskId);
export const duration = (st) => st.end - st.start;
