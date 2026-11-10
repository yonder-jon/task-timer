// HTTP layer: JSON API routes + static files from /public.
import fs from 'node:fs/promises';
import path from 'node:path';
import { HttpError } from './timer.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Each route: [method, pattern, (timer, params, body) => void]
const routes = [
  ['GET', '/api/state', () => {}],
  ['POST', '/api/projects', (t, p, b) => t.addProject(b.name)],
  ['POST', '/api/projects/:id/finish', (t, p) => t.finishProject(p.id)],
  ['POST', '/api/projects/:id/reopen', (t, p) => t.reopenProject(p.id)],
  ['POST', '/api/tasks', (t, p, b) => t.addTask(b.projectId, b.name)],
  ['POST', '/api/tasks/:id/start', (t, p, b) => t.start(p.id, { start: b.start, notes: b.notes })],
  ['POST', '/api/tasks/:id/stints', (t, p, b) => t.addManualStint(p.id, b)],
  ['POST', '/api/tasks/:id/finish', (t, p) => t.finishTask(p.id)],
  ['POST', '/api/tasks/:id/close-session', (t, p) => t.closeSession(p.id)],
  ['POST', '/api/tasks/:id/reopen', (t, p) => t.reopenTask(p.id)],
  ['POST', '/api/stop', (t) => t.requestStop('stop')],
  ['POST', '/api/sessions/close', (t, p, b) => {
    t.closeSessions(Array.isArray(b.ids) ? b.ids : [], b.runningEnd);
    if (b.day) t.setDayCheck(b.day);
  }],
  ['POST', '/api/daycheck', (t, p, b) => t.setDayCheck(b.day)],
  ['POST', '/api/stints/:id/delete', (t, p) => t.deleteStint(p.id)],
  ['POST', '/api/pending/draft', (t, p, b) => t.saveDraft(b.notes)],
  ['POST', '/api/pending/resolve', (t, p, b) => t.resolvePending({ notes: String(b.notes ?? ''), dismissed: !!b.dismissed })],
].map(([method, pattern, handler]) => {
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[\\w-]+)') + '$');
  return { method, re, handler };
});

export function createApp({ timer, save, publicDir }) {
  const publicState = () => ({ ...timer.state, serverNow: timer.now(), notesGraceMs: timer.graceMs });
  const root = path.resolve(publicDir);

  async function handleApi(req, res, pathname) {
    if (timer.sweep()) save(timer.state);
    for (const { method, re, handler } of routes) {
      const m = pathname.match(re);
      if (!m || req.method !== method) continue;
      const body = method === 'POST' ? await readBody(req) : {};
      const snapshot = JSON.stringify(timer.state);
      try {
        handler(timer, m.groups ?? {}, body);
      } catch (e) {
        timer.state = JSON.parse(snapshot); // no half-applied changes
        throw e;
      }
      if (method === 'POST') save(timer.state);
      return send(res, 200, publicState());
    }
    throw new HttpError(404, 'Not found');
  }

  async function handleStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) throw new HttpError(404, 'Not found');
    const type = MIME[path.extname(file)];
    if (!type) throw new HttpError(404, 'Not found');
    let data;
    try { data = await fs.readFile(file); } catch { throw new HttpError(404, 'Not found'); }
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  return async function handler(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');
    const isApi = pathname.startsWith('/api/');
    try {
      if (isApi) await handleApi(req, res, pathname);
      else await handleStatic(req, res, pathname);
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      if (isApi) send(res, status, { error: e.message, state: publicState() });
      else { res.writeHead(status, { 'Content-Type': 'text/plain' }); res.end(e.message); }
    }
  };
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) reject(new HttpError(413, 'Request too large'));
    });
    req.on('end', () => {
      try {
        const v = data ? JSON.parse(data) : {};
        resolve(v && typeof v === 'object' ? v : {});
      } catch { reject(new HttpError(400, 'Bad JSON')); }
    });
    req.on('error', reject);
  });
}
