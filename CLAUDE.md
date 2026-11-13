# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Single-user time tracker for work done on an online platform: projects > tasks, a timer (one at a time),
and per-task daily "session" totals that the user types into the platform at end of day. See README.md
for the user-facing rules (notes pop-up, + Time, next-day prompt) and terminology.

## Commands

```
npm run dev       # Vite (http://localhost:5173, hot reload) + API on :3000 via `node --watch`
npm start         # vite build, then serve app + API on :3000
npm test          # vitest run (all tests)
npx vitest run test/timer.test.ts        # one file
npx vitest run -t "past session"         # tests whose name matches
npm run check     # tsc type-check of server, client, tests and configs (no emit)
```

Node 22.18+: the server is TypeScript executed directly by Node's type stripping, with no build step. So
server code must use only erasable TS syntax (no enums, namespaces or parameter properties; `erasableSyntaxOnly`
is on) and import with explicit `.ts` extensions. The client is bundled by Vite (root `src/client`, output
`dist/client`, which the server serves; `/api` is proxied to :3000 in dev).

Env vars for the server: `PORT` (3000), `HOST` (127.0.0.1), `DATA_FILE` (`./data.json`), `NOTES_GRACE_MS` (15 min).

## Architecture

- **State is one JSON document.** `src/shared/types.ts` defines `State` (projects, tasks, sessions, stints,
  `running`, `pending`, `lastDayCheck`), used by both sides. The server keeps it in memory and rewrites
  `data.json` (tmp file + rename) after every change; `store.ts` loads it and migrates older formats
  (v1 "sessions" were start/stop periods, now stints). Bump the migration if the shape changes.
- **All rules live in `src/server/timer.ts`** (`Timer` class): pure in-memory logic over `State`, no I/O,
  with injectable `now`/`newId` so tests control the clock. Rule violations throw `HttpError(status, msg)`.
- **`src/server/app.ts`** is a thin Hono layer: zod-validated bodies, each route calls one `Timer` method,
  and **every API response is the full `PublicState`** (state + `serverNow` + `notesGraceMs`). A middleware
  runs `timer.sweep()` first and snapshots state so a failed request is rolled back. `createApp` returns
  `{ app, api }`; `ApiType` is exported for the typed client.
- **Client** (React + Mantine + TanStack Query): `lib/api.ts` uses Hono's `hc<ApiType>` RPC client, so API
  calls are type-checked against the server routes. A single `['state']` query (polled every 10 s) holds
  everything; `useAction` runs a call and puts the returned state straight into the cache. Times use
  `serverNow()` (clock offset from `serverNow`), and `useNow`/`<Live>` give a shared 1-second tick.
  Derived numbers (session/total times, which sessions are stale, etc.) are pure `(state, now)` functions in
  `lib/model.ts`; keep logic there, not in components, so it can be unit-tested.
- **Stop flow:** stopping creates `pending` (a stint awaiting notes) rather than a stint. Resolving within the
  grace window ends the stint at save time; otherwise at the stop time. `sweep()` auto-resolves expired ones
  (also on a 15 s server interval). `pending.thenStart` / `pending.action` carry what to do afterwards
  (switch task, finish, close session).
- **Sessions:** a task has at most one open session (`closedAt: null`); stints attach to it. Closing a session
  with no stints deletes it. Manual stints can also go into a new or existing closed ("past") session.

## Testing

Tests in `test/` cover timer rules, storage/migration, HTTP (via `app.request`, no network), client model and
formatting. `test/helpers.ts` has `setup()` (a `Timer` with a fake clock, a project and tasks `a`/`b`),
accessors like `running`/`pending`/`open`, and `rejects(fn, status, /msg/)` for `HttpError` assertions.

## Working on this repo

- `data.json` is the user's real data (git-ignored). For manual or browser testing, run a separate server on
  another port with a copied file, e.g. `PORT=3999 DATA_FILE=/path/to/copy.json node src/server/main.ts`.
  Don't kill server processes by pattern: the user's own dev/production server may be running.
- The app is reached from a phone over Tailscale (`tailscale serve` → :3000, or :5173 for live dev; Vite
  allows `.ts.net` hosts). Layouts must work at phone width (≈375px) without horizontal scroll.
- Dependency versions are pinned exactly in `package.json`.
