import { app, api } from '../state.js';
import { esc, hm } from '../format.js';
import {
  project, task, projectTasks, openSession, openSessions, busy, live, whenLabel, taskSessionMs,
} from '../model.js';

export function renderNow(el) {
  const { running, pending } = app.S;
  if (running) {
    el.className = 'now live';
    el.innerHTML = `<span class="dot"></span><span class="label">${esc(task(running.taskId)?.name ?? '')}</span>
      <span class="clock">${live('run-sess')}</span>
      <button class="btn small" data-action="stop">Stop</button>`;
  } else {
    el.className = 'now';
    el.textContent = pending ? 'Waiting for stint notes…' : 'No timer running';
  }
}

export function renderDashboard(root) {
  const S = app.S;
  const active = S.projects.filter((p) => p.status === 'active');
  // Re-rendering replaces inputs; keep whichever one has focus.
  const focused = document.activeElement;
  const keepFocus = focused?.dataset?.focusKey;
  const keepVal = focused?.value;
  const r = S.running, rt = r && task(r.taskId);

  root.innerHTML = `
    ${rt ? `<section class="hero">
      <div class="who">
        <div class="proj">${esc(project(rt.projectId)?.name ?? '')}</div>
        <div class="task">${esc(rt.name)}</div>
        <div class="stint">This stint ${live('run-stint')} · started ${whenLabel(r.start)}</div>
      </div>
      <div class="times">
        <div class="cap">Session</div>
        <div class="big clock">${live('run-sess')}</div>
        <div class="total clock"><span class="muted" style="font-weight:400">Task total</span> ${live('run-total')}</div>
      </div>
      <div class="actions">
        <button class="btn" data-action="add-time" data-id="${rt.id}">+ Time</button>
        <button class="btn primary" data-action="stop">Stop</button>
      </div>
    </section>` : ''}
    <div class="toolbar">
      <form class="inline" data-submit="add-project">
        <input type="text" name="name" placeholder="New project name…" data-focus-key="new-project" autocomplete="off">
        <button class="btn primary">Add project</button>
      </form>
      <span class="today">Open sessions: <b class="num">${live('today')}</b></span>
      <button class="btn" ${busy() || !openSessions().length ? 'disabled' : ''} data-action="end-day">End day…</button>
    </div>
    ${active.length ? `<div class="grid">${active.map(projectCard).join('')}</div>`
      : `<div class="empty">No active projects. Add one above to get started.</div>`}
  `;
  if (keepFocus) {
    const el = root.querySelector(`[data-focus-key="${keepFocus}"]`);
    if (el) { el.value = keepVal; el.focus(); }
  }
}

function projectCard(p) {
  const tasks = projectTasks(p.id).filter((t) => t.status === 'active');
  const isLive = tasks.some((t) => app.S.running?.taskId === t.id);
  return `<section class="card ${isLive ? 'live' : ''}">
    <div class="card-head">
      <h2>${esc(p.name)}</h2>
      <div class="sum">session <b class="num">${live('psess:' + p.id)}</b><br>total <span class="num">${live('ptot:' + p.id)}</span></div>
      <button class="btn small ghost" ${busy() ? 'disabled' : ''} data-action="finish-project" data-id="${p.id}">Finish</button>
    </div>
    <ul class="tasks">
      ${tasks.map(taskRow).join('') || `<li class="muted">No active tasks</li>`}
    </ul>
    <form class="inline" data-submit="add-task" data-id="${p.id}">
      <input type="text" name="name" placeholder="Add a task…" data-focus-key="new-task:${p.id}" autocomplete="off">
      <button class="btn small">Add</button>
    </form>
  </section>`;
}

function taskRow(t) {
  const running = app.S.running?.taskId === t.id;
  const dis = busy() ? 'disabled' : '';
  return `<li class="${running ? 'live' : ''}">
    <div class="task-top">
      <span class="name">${esc(t.name)}</span>
      <div class="task-times">
        <div class="sess clock" title="Current session">${live('sess:' + t.id)}</div>
        <div class="tot">total <span class="clock">${live('tot:' + t.id)}</span></div>
      </div>
    </div>
    <div class="task-actions">
      ${running
        ? `<button class="btn small primary" ${dis} data-action="stop">Stop</button>`
        : `<button class="btn small go" ${dis} data-action="start" data-id="${t.id}">Start</button>`}
      <button class="btn small" ${dis} data-action="add-time" data-id="${t.id}">+ Time</button>
      <span style="flex:1"></span>
      <button class="btn small ghost" ${dis || !openSession(t.id) ? 'disabled' : ''} data-action="close-session" data-id="${t.id}"
        title="Record this session's total and reset to 0:00">Close session</button>
      <button class="btn small ghost" ${dis} data-action="finish-task" data-id="${t.id}">Finish</button>
    </div>
  </li>`;
}

export const actions = {
  'stop': () => api('stop', {}),
  'start': (el) => api(`tasks/${el.dataset.id}/start`, {}),
  'finish-task': (el) => {
    const t = task(el.dataset.id);
    if (confirm(`Finish task "${t.name}"? Its open session will be closed.`)) api(`tasks/${t.id}/finish`, {});
  },
  'finish-project': (el) => {
    const p = project(el.dataset.id);
    if (confirm(`Finish project "${p.name}" and all its tasks?`)) api(`projects/${p.id}/finish`, {});
  },
  'close-session': (el) => {
    const t = task(el.dataset.id);
    if (confirm(`Close the session for "${t.name}" at ${hm(taskSessionMs(t.id))}? The session counter resets to 0:00.`)) {
      api(`tasks/${t.id}/close-session`, {});
    }
  },
};

export const submits = {
  'add-project': (form) => {
    const name = form.name.value.trim();
    if (name) api('projects', { name });
    form.name.value = '';
  },
  'add-task': (form) => {
    const name = form.name.value.trim();
    if (name) api('tasks', { projectId: form.dataset.id, name });
    form.name.value = '';
  },
};
