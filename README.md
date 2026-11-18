# Task Timer

A small, self-hosted time tracker for one person. Organise work into **projects** and **tasks**, run a
timer (one at a time), jot notes each time you stop, and get a per-task **session** total to copy into
whatever system you report time in at the end of the day.

It runs as a single Node process with a web UI that works on desktop and phone. All data lives in one
JSON file on your machine. No accounts, no database, no cloud.

## Features

- **One timer at a time.** Starting another task stops the current one.
- **Notes on every stop.** A pop-up asks what you did; skip it and the time is still recorded.
- **Sessions:** each task keeps a running total since you last closed it (normally one working day).
  Close a session when you've entered it elsewhere; today's closed sessions stay visible with a
  copy-notes button in case you need them again.
- **+ Time:** add time worked away from the timer (into the current session or a past one), or start the
  timer from an earlier time today. Overlapping time is refused.
- **End of day / next morning:** close all open sessions at once, with totals and notes to copy. Forgot?
  The next morning it offers to close yesterday's, and asks when a timer left running overnight really
  stopped.
- **History:** every session and stint, filterable by project, exportable as CSV.
- **End** a task when it's done: it stays in place (greyed out) for the rest of the day, then moves to the
  bottom of its project as a one-line summary with its total hours and end date. Reopen it any time.
- Rename tasks and projects; end whole projects (reopen them from History).
- Works on a phone (layout tested down to 375px); several open tabs/devices stay in sync.

## Quick start

Needs **Node 22.18 or newer** (the server is TypeScript run directly by Node, so there's no server build).

```
git clone https://github.com/yonder-jon/task-timer.git
cd task-timer
npm install
npm start          # builds the web UI, then serves it and the API on http://localhost:3000
```

`npm run serve` starts the server without rebuilding the UI.

### Configuration

Environment variables:

| Variable         | Default       | Meaning                                               |
|------------------|---------------|-------------------------------------------------------|
| `PORT`           | `3000`        | Port to listen on                                     |
| `HOST`           | `127.0.0.1`   | Address to bind to                                    |
| `DATA_FILE`      | `./data.json` | Where your data is stored                             |
| `NOTES_GRACE_MS` | `900000`      | How long the notes pop-up waits (ms) before its stint falls back to the stop time |

### Your data

Everything is in `data.json` (or `DATA_FILE`), rewritten atomically after every change. Back it up by
copying it. Older data formats are migrated automatically on start-up. If the file is unreadable the server
refuses to start rather than overwrite it.

### Using it from your phone

There is **no login**: anyone who can reach the server can read and change your data. By default it only
listens on `127.0.0.1`. To reach it from other devices, put it behind something that restricts access,
for example [Tailscale](https://tailscale.com):

```
tailscale serve --bg 3000    # https://<machine>.<tailnet>.ts.net, visible only on your tailnet
```

or bind to the machine's Tailscale address with `HOST=<tailscale-ip> npm start`. Don't expose it to the
public internet.

## How it works

### Terms
- **Project** contains **tasks**.
- **Stint**: one start→stop period of work on a task, with optional notes.
- **Session**: a task's running total since it was last closed, normally one working day. This is the
  number you report. **Close session** (or **End day…** for all of them) records it and resets the task's
  session counter to 0:00.

### Rules
- **Notes pop-up:** stopping a timer (Stop, Finish, Close session, or starting another task) asks for notes.
  - Notes saved within 15 minutes: the stint ends when you save.
  - Skipped, saved empty, or ignored for 15 minutes: the stint ends when you stopped the timer.
    Anything you typed is still kept.
- **+ Time** can do two things:
  - Add a stint you worked without the timer. It goes into the task's current session by default, or into
    a new or existing past session (these are already closed, so today's total is unaffected).
  - Start the timer from an earlier time today.
  - Either way, time can't overlap time already recorded, be in the future, or exceed 24 hours.
- **Next-day prompt:** on the first click or keypress of a new day, sessions left open from a previous day
  are offered for closing. A timer left running overnight asks when it really stopped.
- **End** closes the task's session (asking for notes first if its timer is running).
- Days roll over at local midnight. Copy buttons need HTTPS or localhost (otherwise a copy dialog appears).

## Development

```
npm run dev        # Vite on http://localhost:5173 (hot reload) + API on :3000 (restarts on change)
npm test           # Vitest
npm run check      # TypeScript type-check (server, client and tests)
```

`tailscale serve --bg 5173` lets you try the dev server on a phone (Vite allows `*.ts.net` hosts).

### Stack
- **Server:** [Hono](https://hono.dev) on Node, with [zod](https://zod.dev) request validation. Its typed
  RPC client gives the front end compile-time checked API calls.
- **Client:** React + [Mantine](https://mantine.dev), [TanStack Query](https://tanstack.com/query) for
  fetching and polling, built with Vite.
- **Tests:** Vitest.

### Layout
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
  components/            Dashboard, History and the dialogs
test/                    timer rules, storage/migration, HTTP, client model, formatting
```

## Licence

[BSD 2-Clause](LICENCE.md).
