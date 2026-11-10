// "+ Time" dialog: add a completed stint, or start the timer from an earlier time today.
import { app, api, toast, nowMs } from '../state.js';
import { esc, hm, pad, dayKey, timeKey, parseDuration } from '../format.js';
import { project, task } from '../model.js';

export function openAddTime(taskId) {
  const end = Math.floor(nowMs() / 60000) * 60000;
  app.dialog = { type: 'addTime', taskId, mode: 'add', start: end - 30 * 60000, end, rendered: false };
}

export function renderAddTime(root) {
  const d = app.dialog;
  if (d.rendered) return; // render once; re-rendering would wipe what's been typed
  d.rendered = true;
  const t = task(d.taskId);
  const { running, pending } = app.S;
  const blocked = running || pending;
  root.innerHTML = `<div class="backdrop" data-action="backdrop"><div class="modal" role="dialog" aria-modal="true">
    <h2>Add time: ${esc(t.name)}</h2>
    <div class="hint">${esc(project(t.projectId)?.name ?? '')}</div>
    <div class="tabs">
      <button class="${d.mode === 'add' ? 'on' : ''}" data-action="at-mode" data-mode="add">Add a stint</button>
      <button class="${d.mode === 'start' ? 'on' : ''}" data-action="at-mode" data-mode="start">Start timer from…</button>
    </div>
    ${d.mode === 'add' ? `
      <div class="hint">Record time you worked without the timer. It's added to this task's current session.</div>
      <div class="fields">
        <div><label>Date</label><input type="date" id="at-date" value="${dayKey(d.start)}" max="${dayKey(nowMs())}"></div>
        <div><label>From</label><input type="time" id="at-from" value="${timeKey(d.start)}"></div>
        <div><label>To</label><input type="time" id="at-to" value="${timeKey(d.end)}"></div>
        <div><label>Duration (h:mm)</label><input type="text" id="at-dur" inputmode="numeric" placeholder="0:30"></div>
      </div>
      <label for="at-notes">Notes (optional)</label>
      <textarea id="at-notes"></textarea>
      <div class="actions">
        <button class="btn" data-action="dialog-close">Cancel</button>
        <button class="btn primary" data-action="at-submit-add">Add stint</button>
      </div>`
    : `
      <div class="hint">Start the timer as if you'd pressed Start at an earlier time today.</div>
      ${blocked ? `<div class="warnbox">${running?.taskId === t.id ? 'This task’s timer is already running.' : 'Another timer is running. Stop it first, then come back here.'}</div>` : `
      <div class="fields">
        <div><label>Started at</label><input type="time" id="at-start" value="${timeKey(nowMs() - 15 * 60000)}"></div>
      </div>
      <label for="at-snotes">Notes (optional, pre-filled when you stop)</label>
      <textarea id="at-snotes"></textarea>`}
      <div class="actions">
        <button class="btn" data-action="dialog-close">Cancel</button>
        <button class="btn go" ${blocked ? 'disabled' : ''} data-action="at-submit-start">Start timer</button>
      </div>`}
  </div></div>`;
  if (d.mode === 'add') wireDuration(root);
}

// Keep From / To / Duration in step with each other.
function wireDuration(root) {
  const from = root.querySelector('#at-from'), to = root.querySelector('#at-to'), dur = root.querySelector('#at-dur');
  const mins = (v) => { const [h, m] = v.split(':').map(Number); return h * 60 + m; };
  const syncDur = () => {
    if (!from.value || !to.value) return;
    const m = mins(to.value) - mins(from.value);
    dur.value = m > 0 ? `${Math.floor(m / 60)}:${pad(m % 60)}` : '';
  };
  const syncTo = () => {
    const m = parseDuration(dur.value);
    if (m == null || !from.value) return;
    const e = mins(from.value) + m;
    if (e < 24 * 60) to.value = `${pad(Math.floor(e / 60))}:${pad(e % 60)}`;
  };
  from.addEventListener('input', syncDur);
  to.addEventListener('input', syncDur);
  dur.addEventListener('input', syncTo);
  syncDur();
}

const val = (id) => document.getElementById(id)?.value ?? '';

async function submitAdd() {
  const date = val('at-date'), from = val('at-from'), to = val('at-to');
  if (!date || !from || !to) return toast('Fill in the date and times');
  const start = new Date(`${date}T${from}`).getTime(), end = new Date(`${date}T${to}`).getTime();
  if (end <= start) return toast('“To” must be after “From”');
  if (await api(`tasks/${app.dialog.taskId}/stints`, { start, end, notes: val('at-notes') })) {
    app.dialog = null;
    toast(`Added ${hm(end - start)}`, true);
    return true;
  }
}

async function submitStart() {
  const v = val('at-start');
  if (!v) return toast('Choose a start time');
  const start = new Date(`${dayKey(nowMs())}T${v}`).getTime();
  if (start > nowMs()) return toast('Start time is in the future');
  if (await api(`tasks/${app.dialog.taskId}/start`, { start, notes: val('at-snotes') })) {
    app.dialog = null;
    return true;
  }
}

// Actions return true when the dialog needs re-rendering.
export const actions = {
  'add-time': (el) => { openAddTime(el.dataset.id); return true; },
  'at-mode': (el) => { app.dialog.mode = el.dataset.mode; app.dialog.rendered = false; return true; },
  'at-submit-add': submitAdd,
  'at-submit-start': submitStart,
};
