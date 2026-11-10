import { app, api, copyText, download, nowMs } from '../state.js';
import { esc, clock, hm, hours, fmtDate, fmtTime, dayKey, toCsv } from '../format.js';
import {
  project, task, stintsOf, sessionMs, sessionNotes, taskTotalMs, projectTotalMs, whenLabel, live,
} from '../model.js';

const inFilter = (tid) => !app.histFilter || task(tid)?.projectId === app.histFilter;
const filteredSessions = () => app.S.sessions.filter((s) => task(s.taskId) && inFilter(s.taskId));

export function renderHistory(root) {
  const S = app.S;
  const sessions = filteredSessions().sort((a, b) => b.openedAt - a.openedAt);
  const total = sessions.reduce((a, s) => a + sessionMs(s), 0);
  const finishedProjects = S.projects.filter((p) => p.status === 'finished');
  const finishedTasks = S.tasks.filter((t) => t.status === 'finished' && project(t.projectId)?.status === 'active');

  root.innerHTML = `
    <div class="toolbar">
      <select data-change="hist-filter">
        <option value="">All projects</option>
        ${S.projects.map((p) => `<option value="${p.id}" ${p.id === app.histFilter ? 'selected' : ''}>${esc(p.name)}${p.status === 'finished' ? ' (finished)' : ''}</option>`).join('')}
      </select>
      <span class="muted">${sessions.length} session${sessions.length === 1 ? '' : 's'} · ${hm(total)}</span>
      <span style="flex:1"></span>
      <button class="btn" data-action="export-sessions" ${sessions.length ? '' : 'disabled'}>Export sessions CSV</button>
      <button class="btn" data-action="export-stints" ${sessions.length ? '' : 'disabled'}>Export stints CSV</button>
    </div>
    ${sessions.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Project</th><th>Task</th><th>Session</th><th>Hours</th><th>Notes</th><th></th></tr></thead>
      <tbody>${sessions.map(sessionRows).join('')}</tbody></table></div>`
      : `<div class="empty">No sessions yet.</div>`}

    ${finishedTasks.length ? `<h3>Finished tasks (in active projects)</h3><div class="finished-list">
      ${finishedTasks.map((t) => `<div class="row"><span>${esc(project(t.projectId).name)} › ${esc(t.name)}</span>
        <span class="muted">${hm(taskTotalMs(t.id))}</span>
        <button class="btn small" data-action="reopen-task" data-id="${t.id}">Reopen</button></div>`).join('')}</div>` : ''}

    ${finishedProjects.length ? `<h3>Finished projects</h3><div class="finished-list">
      ${finishedProjects.map((p) => `<div class="row"><span>${esc(p.name)}</span>
        <span class="muted">${hm(projectTotalMs(p.id))}</span>
        <button class="btn small" data-action="reopen-project" data-id="${p.id}">Reopen</button></div>`).join('')}</div>` : ''}
  `;
}

function sessionRows(s) {
  const t = task(s.taskId), p = project(t.projectId);
  const stints = stintsOf(s.id);
  const open = app.expanded.has(s.id);
  const ms = sessionMs(s);
  const notes = sessionNotes(s);
  let html = `<tr>
    <td class="num">${fmtDate(s.openedAt)}${s.closedAt ? '' : ' <span class="pill open">open</span>'}</td>
    <td>${esc(p?.name ?? '?')}</td><td>${esc(t.name)}</td>
    <td class="num"><b>${s.closedAt ? clock(ms) : live('sid:' + s.id)}</b></td>
    <td class="num">${hours(ms)}</td>
    <td class="notes">${esc(notes) || '<span class="muted">—</span>'}</td>
    <td class="num">
      <button class="btn small ghost" data-action="toggle-stints" data-id="${s.id}">${stints.length} stint${stints.length === 1 ? '' : 's'} ${open ? '▾' : '▸'}</button>
      <button class="btn small ghost" data-action="copy-notes" data-id="${s.id}" ${notes ? '' : 'disabled'}>Copy notes</button>
    </td>
  </tr>`;
  if (open) {
    html += stints.map((st) => `<tr class="sub">
      <td></td><td colspan="2" class="num">${whenLabel(st.start)} – ${fmtTime(st.end)} ${st.manual ? '<span class="pill manual">added</span>' : ''}</td>
      <td class="num">${clock(st.end - st.start)}</td><td></td>
      <td class="notes">${esc(st.notes) || '<span class="muted">—</span>'}</td>
      <td><button class="btn small ghost" data-action="delete-stint" data-id="${st.id}">Delete</button></td></tr>`).join('');
    if (!stints.length) html += `<tr class="sub"><td></td><td colspan="6" class="muted">Only the running stint so far.</td></tr>`;
  }
  return html;
}

function exportSessions() {
  const rows = [['Date', 'Project', 'Task', 'Status', 'Hours', 'Duration', 'Stints', 'Notes']];
  for (const s of filteredSessions().sort((a, b) => a.openedAt - b.openedAt)) {
    const t = task(s.taskId), ms = sessionMs(s);
    rows.push([dayKey(s.openedAt), project(t.projectId)?.name, t.name, s.closedAt ? 'closed' : 'open',
      hours(ms), clock(ms), stintsOf(s.id).length, sessionNotes(s)]);
  }
  download(`sessions-${dayKey(nowMs())}.csv`, toCsv(rows));
}

function exportStints() {
  const rows = [['Date', 'Project', 'Task', 'Start', 'End', 'Hours', 'Duration', 'Added manually', 'Notes']];
  for (const st of app.S.stints.filter((st) => task(st.taskId) && inFilter(st.taskId)).sort((a, b) => a.start - b.start)) {
    const t = task(st.taskId);
    rows.push([dayKey(st.start), project(t.projectId)?.name, t.name, fmtTime(st.start), fmtTime(st.end),
      hours(st.end - st.start), clock(st.end - st.start), st.manual ? 'yes' : '', st.notes]);
  }
  download(`stints-${dayKey(nowMs())}.csv`, toCsv(rows));
}

export const actions = {
  'export-sessions': exportSessions,
  'export-stints': exportStints,
  'reopen-task': (el) => api(`tasks/${el.dataset.id}/reopen`, {}),
  'reopen-project': (el) => api(`projects/${el.dataset.id}/reopen`, {}),
  'copy-notes': (el) => {
    const s = app.S.sessions.find((x) => x.id === el.dataset.id);
    if (s) copyText(sessionNotes(s));
  },
  'delete-stint': (el) => {
    const st = app.S.stints.find((x) => x.id === el.dataset.id);
    if (st && confirm(`Delete the stint ${whenLabel(st.start)}–${fmtTime(st.end)} (${clock(st.end - st.start)})?`)) {
      api(`stints/${st.id}/delete`, {});
    }
  },
};

// Return true to ask main to re-render.
export const toggles = {
  'toggle-stints': (el) => {
    const id = el.dataset.id;
    app.expanded.has(id) ? app.expanded.delete(id) : app.expanded.add(id);
  },
};

export const changes = {
  'hist-filter': (el) => { app.histFilter = el.value; },
};
