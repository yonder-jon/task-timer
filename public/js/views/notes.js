// The notes pop-up shown whenever a running timer stops (driven by server state.pending).
import { app, api, post, nowMs } from '../state.js';
import { esc, clock, fmtTime } from '../format.js';
import { project, task, whenLabel } from '../model.js';

let modalKey = null; // which pending stint the open pop-up is for
let draftTimer = null;

const TITLES = { stop: 'Stint stopped', finishTask: 'Finishing task', finishProject: 'Finishing project', closeSession: 'Closing session' };

export function renderNotes(root) {
  const p = app.S.pending;
  if (!p) { root.innerHTML = ''; modalKey = null; return; }
  const key = p.taskId + ':' + p.stoppedAt;
  if (modalKey === key) { tickNotes(); return; } // already open — don't clobber typing
  modalKey = key;
  const t = task(p.taskId), proj = t && project(t.projectId);
  const next = p.thenStart && task(p.thenStart);
  root.innerHTML = `<div class="backdrop"><div class="modal" role="dialog" aria-modal="true">
    <h2>${TITLES[p.action] ?? 'Stint stopped'}: ${esc(t?.name ?? '')}</h2>
    <div class="hint">${esc(proj?.name ?? '')} · ${whenLabel(p.start)} – ${fmtTime(p.stoppedAt)}
      (${clock(p.stoppedAt - p.start)})${next ? ` · <b>${esc(next.name)}</b> starts when you close this` : ''}</div>
    <label for="notes">What did you do in this stint? (optional)</label>
    <textarea id="notes"></textarea>
    <div class="hint" id="notes-hint" style="margin-top:8px"></div>
    <div class="actions">
      <button class="btn" data-action="notes-skip">Skip</button>
      <button class="btn primary" data-action="notes-save">Save notes</button>
    </div>
  </div></div>`;
  const ta = root.querySelector('#notes');
  ta.value = p.draft || '';
  ta.addEventListener('input', () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => post('pending/draft', { notes: ta.value }), 800);
    tickNotes();
  });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) resolve(false); });
  ta.focus();
  tickNotes();
}

export function tickNotes() {
  const p = app.S?.pending, hint = document.getElementById('notes-hint');
  if (!p || !hint) return;
  const left = p.stoppedAt + app.S.notesGraceMs - nowMs();
  const cd = `<span class="countdown ${left < 120000 ? 'low' : ''}">${clock(left)}</span>`;
  hint.innerHTML = document.getElementById('notes').value.trim()
    ? `Saving now records the stint up to now (note-writing time counts). This closes in ${cd}, after which it ends at ${fmtTime(p.stoppedAt)}.`
    : `With no notes the stint ends at ${fmtTime(p.stoppedAt)}. This closes automatically in ${cd}.`;
  if (left <= 0) api('state'); // the server auto-resolves it
}

async function resolve(dismissed) {
  clearTimeout(draftTimer);
  await api('pending/resolve', { notes: document.getElementById('notes')?.value ?? '', dismissed });
}

export const actions = {
  'notes-skip': () => resolve(true),
  'notes-save': () => resolve(false),
};
