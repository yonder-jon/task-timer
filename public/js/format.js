// Pure formatting helpers (no app state), safe to unit-test in Node.

export const pad = (n) => String(n).padStart(2, '0');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** 3725000 → "1:02:05" */
export function clock(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** 3725000 → "1h 02m" */
export function hm(ms) {
  const m = Math.floor(Math.max(0, ms) / 60000);
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

/** decimal hours, 2dp: 5400000 → "1.50" */
export const hours = (ms) => (ms / 3600000).toFixed(2);

export const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (t) => new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

/** local "YYYY-MM-DD" */
export const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** local "HH:MM" */
export const timeKey = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** "h:mm" or "h" → minutes ("1:30" → 90, "2" → 120); null if invalid */
export function parseDuration(v) {
  const m = String(v).trim().match(/^(\d+)(?::(\d{1,2}))?$/);
  if (!m || +(m[2] ?? 0) > 59) return null;
  return +m[1] * 60 + +(m[2] ?? 0);
}

/** Rows → CSV text (all cells quoted). */
export const toCsv = (rows) => rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
