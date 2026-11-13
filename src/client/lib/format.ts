// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

// Pure formatting helpers.

export const pad = (n: number) => String(n).padStart(2, '0');

/** 3725000 → "1:02:05" */
export function clock(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** 3725000 → "1h 02m" */
export function hm(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60000);
  return `${Math.floor(m / 60)}h ${pad(m % 60)}m`;
}

/** Decimal hours, 2dp: 5400000 → "1.50" */
export const hours = (ms: number) => (ms / 3600000).toFixed(2);

export const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const fmtDate = (t: number) => new Date(t).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });

/** Local "YYYY-MM-DD". */
export const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** Local "HH:MM". */
export const timeKey = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
/** Local "YYYY-MM-DD" + "HH:MM" → epoch ms. */
export const fromLocal = (date: string, time: string) => new Date(`${date}T${time}`).getTime();

/** "h:mm" or "h" → minutes ("1:30" → 90, "2" → 120); null if invalid. */
export function parseDuration(v: string): number | null {
  const m = v.trim().match(/^(\d+)(?::(\d{1,2}))?$/);
  if (!m || Number(m[2] ?? 0) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2] ?? 0);
}

/** "HH:MM" → minutes since midnight. */
export const minutesOf = (hhmm: string) => { const [h = 0, m = 0] = hhmm.split(':').map(Number); return h * 60 + m; };
/** Minutes since midnight → "HH:MM". */
export const hhmmOf = (mins: number) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

/** Rows → CSV text (all cells quoted). */
export const toCsv = (rows: unknown[][]) =>
  rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
