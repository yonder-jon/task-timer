// Client state + talking to the server.

export const app = {
  S: null,              // latest server state
  clockOffset: 0,       // serverNow - Date.now()
  view: 'dashboard',
  histFilter: '',
  expanded: new Set(),  // history: expanded session ids
  dialog: null,         // client-side dialog: {type:'addTime'|'close', ...}
};

export const nowMs = () => Date.now() + app.clockOffset;

let onChange = () => {};
/** Register the function to call when server state actually changes. */
export const onStateChange = (fn) => { onChange = fn; };

let lastSig = '';
export function setState(s) {
  app.clockOffset = s.serverNow - Date.now();
  const { serverNow, ...rest } = s;
  // Ignore draft-only changes so typing in the notes box doesn't trigger re-renders.
  const sig = JSON.stringify({ ...rest, pending: rest.pending && { ...rest.pending, draft: null } });
  app.S = s;
  if (sig === lastSig) return;
  lastSig = sig;
  onChange();
}

/** GET (no body) or POST (body) to /api/<path>. Returns true on success; toasts errors. */
export async function api(path, body) {
  try {
    const res = await fetch('/api/' + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || 'Something went wrong');
      if (data.state) setState(data.state);
      return false;
    }
    setState(data);
    return true;
  } catch {
    toast('Can’t reach the server');
    return false;
  }
}

/** Fire-and-forget POST that doesn't update local state (used for draft autosave). */
export function post(path, body) {
  return fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
}

export function toast(msg, ok = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (ok ? ' ok' : '');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied', true); }
  catch { prompt('Copy:', text); } // clipboard API needs https or localhost
}

export function download(filename, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
}
