// Close several sessions at once: the manual "End day…" dialog, and the next-morning prompt
// for sessions left open from a previous day.
import { app, api, toast, copyText, nowMs } from '../state.js';
import { esc, hm, dayKey, timeKey } from '../format.js';
import { task, openSessions, staleSessions, sessionMs, sessionNotes, sessLabel, whenLabel, live } from '../model.js';

export function openCloseDialog(mode) {
  const list = mode === 'morning' ? staleSessions() : openSessions();
  app.dialog = { type: 'close', mode, ids: list.map((s) => s.id), selected: new Set(list.map((s) => s.id)), runningEnd: '' };
}

/** On the first interaction of a new day, offer to close sessions left open. Returns true if it opened. */
export function maybeDayCheck() {
  const S = app.S;
  if (!S || S.pending || app.dialog) return false;
  if (S.lastDayCheck === dayKey(nowMs())) return false;
  if (!staleSessions().length) return false;
  openCloseDialog('morning');
  return true;
}

export function renderCloseDialog(root) {
  const d = app.dialog, S = app.S;
  const prev = document.getElementById('cd-running-end');
  if (prev) d.runningEnd = prev.value; // keep what was typed across re-renders
  const list = d.ids.map((id) => S.sessions.find((s) => s.id === id && !s.closedAt)).filter(Boolean);
  if (!list.length) { app.dialog = null; root.innerHTML = ''; return; }
  const morning = d.mode === 'morning';
  const runningSess = S.running && list.find((s) => s.taskId === S.running.taskId);
  const selectedMs = list.filter((s) => d.selected.has(s.id)).reduce((a, s) => a + sessionMs(s), 0);

  root.innerHTML = `<div class="backdrop"><div class="modal" role="dialog" aria-modal="true">
    <h2>${morning ? 'Sessions left open from a previous day' : 'End of day'}</h2>
    <div class="hint">${morning
      ? 'Closing a session records its total and starts the task at 0:00 today. Untick any you want to carry on into today.'
      : 'Here are your open sessions. Enter the totals on the platform, then close them so each task starts at 0:00 tomorrow.'}</div>
    <div class="sess-list">
      ${list.map((s) => {
        const notes = sessionNotes(s);
        return `<div class="item">
          <div class="line">
            <label><input type="checkbox" ${d.selected.has(s.id) ? 'checked' : ''} data-change="cd-toggle" data-id="${s.id}">
              <span style="min-width:0">${sessLabel(s)}<br><span class="hint">opened ${whenLabel(s.openedAt)}${runningSess === s ? ' · <b>timer running</b>' : ''}</span></span></label>
            <span class="t num">${live('sid:' + s.id)}</span>
            <button class="btn small ghost" ${notes ? '' : 'disabled'} data-action="copy-notes" data-id="${s.id}">Copy notes</button>
          </div>
          ${notes ? `<div class="notes">${esc(notes)}</div>` : ''}
        </div>`;
      }).join('')}
    </div>
    ${runningSess && d.selected.has(runningSess.id) ? (morning
      ? `<div class="warnbox">The timer on <b>${esc(task(runningSess.taskId).name)}</b> has been running since ${whenLabel(S.running.start)}. When did you actually stop?
          <div style="margin-top:6px"><input type="datetime-local" id="cd-running-end" value="${esc(d.runningEnd)}"
            min="${dayKey(S.running.start)}T${timeKey(S.running.start)}"></div></div>`
      : `<div class="warnbox">The timer on <b>${esc(task(runningSess.taskId).name)}</b> is still running.
          <button class="btn small" data-action="stop">Stop it now</button> (you'll be asked for notes), or untick it.</div>`) : ''}
    <div class="actions">
      <span class="hint" style="margin-right:auto; align-self:center">Selected: <b>${hm(selectedMs)}</b></span>
      <button class="btn" data-action="${morning ? 'cd-keep' : 'dialog-close'}">${morning ? 'Keep all open' : 'Cancel'}</button>
      <button class="btn primary" ${d.selected.size ? '' : 'disabled'} data-action="cd-submit">Close ${d.selected.size} session${d.selected.size === 1 ? '' : 's'}</button>
    </div>
  </div></div>`;
}

async function submit() {
  const d = app.dialog, S = app.S;
  const ids = [...d.selected];
  const runningSess = S.running && S.sessions.find((s) => ids.includes(s.id) && s.taskId === S.running.taskId);
  const body = { ids };
  if (d.mode === 'morning') body.day = dayKey(nowMs());
  if (runningSess) {
    if (d.mode !== 'morning') return toast('Stop the running timer first, or untick it');
    const v = document.getElementById('cd-running-end')?.value;
    if (!v) return toast('Enter when the running timer should have stopped');
    body.runningEnd = new Date(v).getTime();
  }
  if (await api('sessions/close', body)) {
    app.dialog = null;
    toast(`Closed ${ids.length} session${ids.length === 1 ? '' : 's'}`, true);
    return true;
  }
}

// Actions return true when the dialog needs re-rendering.
export const actions = {
  'end-day': () => { openCloseDialog('endday'); return true; },
  'cd-submit': submit,
  'cd-keep': async () => {
    app.dialog = null;
    await api('daycheck', { day: dayKey(nowMs()) });
    return true;
  },
};

export const changes = {
  'cd-toggle': (el) => { el.checked ? app.dialog.selected.add(el.dataset.id) : app.dialog.selected.delete(el.dataset.id); return true; },
};
