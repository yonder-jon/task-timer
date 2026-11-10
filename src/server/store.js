// Persistence: load / save the whole state as one JSON file, plus format migrations.
import fs from 'node:fs';
import crypto from 'node:crypto';

export function emptyState() {
  return { projects: [], tasks: [], sessions: [], stints: [], running: null, pending: null, lastDayCheck: null };
}

export function loadState(file, now = Date.now()) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return emptyState();
    throw new Error(`Could not read ${file}: ${e.message}`); // don't silently start empty over a corrupt file
  }
  return migrate(raw, now);
}

export function saveState(file, state) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file); // atomic replace
}

// v1 → v2: v1 "sessions" were start/stop periods (now "stints").
// Group them into one session per task per day; today's stay open.
export function migrate(raw, now = Date.now()) {
  const s = { ...emptyState(), ...raw };
  if (raw.stints || !Array.isArray(raw.sessions)) return s;

  s.stints = raw.sessions.map((st) => ({ ...st }));
  s.sessions = [];
  const dayKey = (t) => new Date(t).toDateString();
  const today = dayKey(now);
  const groups = new Map();
  for (const st of [...s.stints].sort((a, b) => a.start - b.start)) {
    const k = st.taskId + '|' + dayKey(st.start);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(st);
  }
  for (const list of groups.values()) {
    const open = dayKey(list[0].start) === today;
    const sess = { id: crypto.randomUUID(), taskId: list[0].taskId, openedAt: list[0].start, closedAt: open ? null : list.at(-1).end };
    s.sessions.push(sess);
    for (const st of list) st.sessionId = sess.id;
  }
  if (s.running && !s.sessions.some((x) => x.taskId === s.running.taskId && !x.closedAt)) {
    s.sessions.push({ id: crypto.randomUUID(), taskId: s.running.taskId, openedAt: s.running.start, closedAt: null });
  }
  if (s.pending?.action === 'pause') s.pending.action = 'stop';
  return s;
}
