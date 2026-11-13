// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

// Data shapes shared by the server and the client.
//
// Terms:
//   Project > Task > Session (a task's running total for the day, closed at end of day)
//                  > Stint   (one start→stop period of work, with optional notes)
// All times are epoch milliseconds.

export type Status = 'active' | 'finished';

export interface Project {
  id: string;
  name: string;
  status: Status;
  createdAt: number;
  finishedAt?: number;
}

export interface Task {
  id: string;
  projectId: string;
  name: string;
  status: Status;
  createdAt: number;
  finishedAt?: number;
}

export interface Session {
  id: string;
  taskId: string;
  openedAt: number;
  closedAt: number | null;
}

export interface Stint {
  id: string;
  taskId: string;
  sessionId: string;
  start: number;
  end: number;
  notes: string;
  /** Added via "+ Time" rather than the timer. */
  manual?: boolean;
}

export interface Running {
  taskId: string;
  start: number;
  /** Notes entered when starting from an earlier time; pre-fill the stop pop-up. */
  notes: string;
}

export type StopAction = 'stop' | 'finishTask' | 'finishProject' | 'closeSession';

/** A stopped stint waiting for notes. */
export interface Pending {
  taskId: string;
  start: number;
  stoppedAt: number;
  action: StopAction;
  /** Task to start once the notes are dealt with (switching timers). */
  thenStart: string | null;
  draft: string;
}

export interface State {
  projects: Project[];
  tasks: Task[];
  sessions: Session[];
  stints: Stint[];
  running: Running | null;
  pending: Pending | null;
  /** Local "YYYY-MM-DD" on which the next-day prompt was last dealt with. */
  lastDayCheck: string | null;
}

/** What the API returns: the state plus the server clock, so clients can correct for drift. */
export interface PublicState extends State {
  serverNow: number;
  notesGraceMs: number;
}

export interface ApiError {
  error: string;
  state?: PublicState;
}
