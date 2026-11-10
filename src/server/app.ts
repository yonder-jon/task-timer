// HTTP layer: the JSON API (Hono + zod) and, in production, the built client.
import { Hono } from 'hono';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { serveStatic } from '@hono/node-server/serve-static';
import { z } from 'zod';
import type { ZodType } from 'zod';
import { HttpError } from './timer.ts';
import type { Timer } from './timer.ts';
import type { PublicState, State, ApiError } from '../shared/types.ts';

export interface AppDeps {
  timer: Timer;
  save: (state: State) => void;
  /** Directory of the built client (dist/client). Omit to serve the API only. */
  staticDir?: string;
}

// Request bodies.
const name = z.object({ name: z.string() });
const newTask = z.object({ projectId: z.string(), name: z.string() });
const start = z.object({ start: z.number().nullish(), notes: z.string().optional() });
const stint = z.object({ start: z.number(), end: z.number(), notes: z.string().optional() });
const closeSessions = z.object({ ids: z.array(z.string()), runningEnd: z.number().nullish(), day: z.string().optional() });
const day = z.object({ day: z.string() });
const draft = z.object({ notes: z.string() });
const resolve = z.object({ notes: z.string().optional(), dismissed: z.boolean().optional() });

/** JSON body validator that reports problems in the same { error } shape as everything else. */
const body = <T extends ZodType>(schema: T) =>
  zValidator('json', schema, (result, c) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      return c.json({ error: `Invalid request: ${issue?.path.join('.') || 'body'} ${issue?.message ?? ''}`.trim() }, 400);
    }
  });

export function createApp({ timer, save, staticDir }: AppDeps) {
  const publicState = (): PublicState => ({ ...timer.state, serverNow: timer.now(), notesGraceMs: timer.graceMs });
  /** Every API call answers with the full state. */
  const ok = (c: Context) => c.json(publicState());

  const api = new Hono()
    // Close ignored notes windows before anything else; snapshot so a failed change leaves no trace.
    .use(async (c, next) => {
      if (timer.sweep()) save(timer.state);
      const snapshot = JSON.stringify(timer.state);
      await next();
      if (c.error) timer.state = JSON.parse(snapshot);
      else if (c.req.method === 'POST' && c.res.ok) save(timer.state);
    })
    .get('/state', (c) => ok(c))
    .post('/projects', body(name), (c) => { timer.addProject(c.req.valid('json').name); return ok(c); })
    .post('/projects/:id/finish', (c) => { timer.finishProject(c.req.param('id')); return ok(c); })
    .post('/projects/:id/reopen', (c) => { timer.reopenProject(c.req.param('id')); return ok(c); })
    .post('/tasks', body(newTask), (c) => { const b = c.req.valid('json'); timer.addTask(b.projectId, b.name); return ok(c); })
    .post('/tasks/:id/start', body(start), (c) => { timer.start(c.req.param('id'), c.req.valid('json')); return ok(c); })
    .post('/tasks/:id/stints', body(stint), (c) => { timer.addManualStint(c.req.param('id'), c.req.valid('json')); return ok(c); })
    .post('/tasks/:id/finish', (c) => { timer.finishTask(c.req.param('id')); return ok(c); })
    .post('/tasks/:id/close-session', (c) => { timer.closeSession(c.req.param('id')); return ok(c); })
    .post('/tasks/:id/reopen', (c) => { timer.reopenTask(c.req.param('id')); return ok(c); })
    .post('/stop', (c) => { timer.requestStop('stop'); return ok(c); })
    .post('/sessions/close', body(closeSessions), (c) => {
      const b = c.req.valid('json');
      timer.closeSessions(b.ids, b.runningEnd);
      if (b.day) timer.setDayCheck(b.day);
      return ok(c);
    })
    .post('/daycheck', body(day), (c) => { timer.setDayCheck(c.req.valid('json').day); return ok(c); })
    .post('/stints/:id/delete', (c) => { timer.deleteStint(c.req.param('id')); return ok(c); })
    .post('/pending/draft', body(draft), (c) => { timer.saveDraft(c.req.valid('json').notes); return ok(c); })
    .post('/pending/resolve', body(resolve), (c) => { timer.resolvePending(c.req.valid('json')); return ok(c); });

  const app = new Hono().route('/api', api);

  app.notFound((c) => {
    if (c.req.path.startsWith('/api/')) return c.json<ApiError>({ error: 'Not found' }, 404);
    return c.text('Not found', 404);
  });
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json<ApiError>({ error: err.message, state: publicState() }, err.status);
    if (err instanceof HTTPException) return c.json<ApiError>({ error: err.message || 'Bad request' }, err.status);
    console.error(err);
    return c.json<ApiError>({ error: 'Internal error', state: publicState() }, 500);
  });

  if (staticDir) {
    app.use('/*', serveStatic({ root: staticDir }));
    // Unknown non-API paths get the app shell.
    app.get('*', (c, next) => (c.req.path.startsWith('/api/') ? next() : serveStatic({ root: staticDir, path: 'index.html' })(c, next)));
  }

  return { app, api };
}

/** Type of the API routes, for the typed client (hc). */
export type ApiType = ReturnType<typeof createApp>['api'];
