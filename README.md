# Task Timer

Simple local time tracker. Only one timer runs at a time.

```
node server.js                       # http://localhost:3000
HOST=<tailscale-ip> node server.js    # or bind to the Tailscale IP (or use `tailscale serve 3000`)
```

No dependencies (Node 18+). Data is saved to `data.json` next to `server.js`, rewritten after every change.
You can change this with the `PORT` / `HOST` / `DATA_FILE` environment variables.

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
