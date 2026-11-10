# Task Timer

Simple local time tracker. Only one timer runs at a time.

```
npm start        # http://localhost:3000
npm run dev      # same, restarts on server file changes
npm test         # node:test, no dependencies
HOST=<tailscale-ip> npm start   # bind to the Tailscale IP (or use `tailscale serve 3000`)
```

No dependencies and no build step (Node 20+). The browser loads `public/` as native ES modules.
Data is saved to `data.json` in the project root, rewritten after every change.
You can change this with the `PORT` / `HOST` / `DATA_FILE` environment variables.

## Layout
```
src/server/
  main.js      entry point: config, load data, start HTTP server
  app.js       HTTP: API routes, static files, rollback on error
  timer.js     the timer rules (Timer class): no I/O, clock injectable for tests
  store.js     load/save data.json, format migrations
public/
  index.html, styles.css
  js/main.js       rendering, event delegation (data-action / data-change / data-submit), tickers
  js/state.js      client state, API calls, toast/clipboard/download
  js/model.js      derived values (session/total times, live tickers)
  js/format.js     pure formatting helpers
  js/views/        dashboard, history, notes pop-up, + Time dialog, close-sessions dialog
test/              timer rules, storage/migration, HTTP, formatting
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
  - Add a stint you worked without the timer (it goes into the task's current session).
  - Start the timer from an earlier time today.
  - Either way, time can't overlap time already recorded.
- **Next-day prompt:** on the first click or keypress of a new day, sessions left open from a previous day
  are offered for closing. A timer left running overnight asks when it really stopped.
