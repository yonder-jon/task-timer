// Entry point: rendering, event delegation and timers.
import { app, api, onStateChange } from './state.js';
import { liveValue, task } from './model.js';
import * as dashboard from './views/dashboard.js';
import * as history from './views/history.js';
import * as notes from './views/notes.js';
import * as addTime from './views/addTime.js';
import * as closeSessions from './views/closeSessions.js';

const $ = (id) => document.getElementById(id);

function render() {
  if (!app.S) return;
  dashboard.renderNow($('now'));
  if (app.view === 'dashboard') dashboard.renderDashboard($('app'));
  else history.renderHistory($('app'));
  renderDialog();
  notes.renderNotes($('modal-root'));
}

function renderDialog() {
  const root = $('dialog-root');
  const d = app.dialog;
  if (!d) root.innerHTML = '';
  else if (d.type === 'addTime') addTime.renderAddTime(root);
  else if (d.type === 'close') closeSessions.renderCloseDialog(root);
}

function closeDialog() {
  app.dialog = null;
  renderDialog();
}

// ----- event delegation: elements declare data-action / data-change / data-submit -----
const actions = {
  ...dashboard.actions,
  ...history.actions,
  ...history.toggles,
  ...notes.actions,
  ...addTime.actions,
  ...closeSessions.actions,
  'nav': (el) => {
    app.view = el.dataset.view;
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b === el));
  },
  'dialog-close': closeDialog,
  'backdrop': (el, e) => { if (e.target === el) closeDialog(); },
};
const changes = { ...history.changes, ...closeSessions.changes };
const submits = { ...dashboard.submits };

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  const fn = el && !el.disabled && actions[el.dataset.action];
  if (!fn) return;
  await fn(el, e);
  render();
});
document.addEventListener('change', async (e) => {
  const fn = changes[e.target.dataset?.change];
  if (!fn) return;
  await fn(e.target, e);
  render();
});
document.addEventListener('submit', (e) => {
  const fn = submits[e.target.dataset?.submit];
  if (!fn) return;
  e.preventDefault();
  fn(e.target, e);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && app.dialog && !app.S?.pending) closeDialog();
});

// "First interaction of the day" check. Capture phase, so the click that triggers it
// opens the prompt instead of also acting on the page.
function dayCheck(e) {
  if (closeSessions.maybeDayCheck()) {
    e?.stopPropagation();
    e?.preventDefault();
    renderDialog();
  }
}
['click', 'keydown'].forEach((ev) => document.addEventListener(ev, dayCheck, { capture: true }));

// ----- timers -----
onStateChange(render);

// Tick only the numbers each second, so inputs aren't disturbed.
setInterval(() => {
  const S = app.S;
  if (!S) return;
  document.querySelectorAll('[data-live]').forEach((el) => { el.textContent = liveValue(el.dataset.live); });
  document.title = S.running ? `${liveValue('run-sess')} · ${task(S.running.taskId)?.name ?? ''}`
    : S.pending ? '📝 Notes pending · Task Timer' : 'Task Timer';
  notes.tickNotes();
}, 1000);

// Sync with other tabs / devices and the server's notes timeout.
setInterval(() => { if (!document.hidden) api('state'); }, 10000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) api('state').then(() => dayCheck());
});

api('state').then(() => dayCheck());
