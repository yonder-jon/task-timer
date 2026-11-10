// Entry point: npm start  (then open http://localhost:3000)
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadState, saveState } from './store.js';
import { Timer, DEFAULT_GRACE_MS } from './timer.js';
import { createApp } from './app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data.json');
const GRACE_MS = Number(process.env.NOTES_GRACE_MS) || DEFAULT_GRACE_MS;

const timer = new Timer(loadState(DATA_FILE), { graceMs: GRACE_MS });
const save = (state) => saveState(DATA_FILE, state);
save(timer.state); // writes any migration straight away

// Auto-close ignored notes windows even when no browser is open.
setInterval(() => { if (timer.sweep()) save(timer.state); }, 15 * 1000).unref();

http
  .createServer(createApp({ timer, save, publicDir: path.join(ROOT, 'public') }))
  .listen(PORT, HOST, () => console.log(`Task Timer running at http://${HOST}:${PORT} (data: ${DATA_FILE})`));
