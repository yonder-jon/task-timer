// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

// Entry point: `npm start` (build + serve) or `npm run dev`.
import fs from 'node:fs';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { loadState, saveState } from './store.ts';
import { Timer, DEFAULT_GRACE_MS } from './timer.ts';
import { createApp } from './app.ts';
import type { State } from '../shared/types.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_FILE = process.env.DATA_FILE || path.join(ROOT, 'data.json');
const GRACE_MS = Number(process.env.NOTES_GRACE_MS) || DEFAULT_GRACE_MS;
const STATIC_DIR = path.join(ROOT, 'dist/client');

const timer = new Timer(loadState(DATA_FILE), { graceMs: GRACE_MS });
const save = (state: State) => saveState(DATA_FILE, state);
save(timer.state); // writes any migration straight away

// Auto-close ignored notes windows even when no browser is open.
setInterval(() => { if (timer.sweep()) save(timer.state); }, 15 * 1000).unref();

const hasClient = fs.existsSync(path.join(STATIC_DIR, 'index.html'));
if (!hasClient) console.warn('No built client in dist/client: API only. Run `npm run build`, or use `npm run dev`.');

const { app } = createApp({ timer, save, staticDir: hasClient ? STATIC_DIR : undefined });

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, () => {
  console.log(`Task Timer running at http://${HOST}:${PORT} (data: ${DATA_FILE})`);
});
