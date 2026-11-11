# Task Timer

Single-user time tracker. Only one timer runs at a time.

```
npm install
npm start              # build the client, then serve app + API on http://localhost:3000
npm run serve          # serve the last build without rebuilding
npm run dev            # development: Vite on http://localhost:5173 (hot reload) + API on :3000
npm test               # Vitest
npm run check          # TypeScript type-check (server, client and tests)

HOST=<tailscale-ip> npm start   # bind to the Tailscale IP (or keep localhost and use `tailscale serve 3000`)
```

Needs Node 22.18+. The server is TypeScript run directly by Node (type stripping), so it has no build step.
Data is saved to `data.json` in the project root, rewritten after every change.
You can change this with the `PORT` / `HOST` / `DATA_FILE` environment variables.

## Stack
- **Server:** [Hono](https://hono.dev) on Node with zod request validation. Its typed RPC client gives the
  front end compile-time checked API calls.
- **Client:** React + [Mantine](https://mantine.dev) UI, [TanStack Query](https://tanstack.com/query) for
  fetching/polling, built with Vite.
- **Tests:** Vitest.

## Layout
```
src/shared/types.ts      data shapes used by both sides
src/server/
  main.ts                entry point: config, load data, serve
  app.ts                 Hono routes + validation, rollback on error, static client
  timer.ts               the timer rules (Timer class): no I/O, clock injectable for tests
  store.ts               load/save data.json, format migrations
src/client/
  main.tsx, App.tsx      providers, layout, next-day prompt
  lib/api.ts             typed API client, state query, actions, 1-second tick
  lib/model.ts           derived values: pure functions of (state, now)
  lib/format.ts          formatting helpers
  components/            Header, Dashboard, History, NotesModal, AddTimeModal, CloseSessionsModal, Live
test/                    timer rules, storage/migration, HTTP, client model, formatting
```

## Terms
- **Project** contains **tasks**.
- **Stint**: one start→stop period of work on a task, with optional notes.
- **Session**: a task's running total since it was last closed, normally one working day. This is the
  number you enter on the platform. **Close session** (or **End day…** for all of them) records it and
  resets the task's session counter to 0:00.

## Rules
- **Notes pop-up:** stopping a timer (Stop, Finish, Close session, or starting another task) asks for notes.
  - Notes saved within 15 min: the stint ends when you save.
  - Skipped, saved empty, or ignored for 15 min: the stint ends when you stopped the timer.
    Anything you typed is still kept.
- **+ Time** can do two things:
  - Add a stint you worked without the timer. It goes into the task's current session by default, or into
    a new past session or an existing past one (these are already closed, so today's total is unaffected).
  - Start the timer from an earlier time today.
  - Either way, time can't overlap time already recorded.
- **Next-day prompt:** on the first click or keypress of a new day, sessions left open from a previous day
  are offered for closing. A timer left running overnight asks when it really stopped.
