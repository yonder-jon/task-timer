import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setup, stintsFor, duration, MIN, HOUR } from './helpers.js';

const rejects = (fn, status, re) => assert.throws(fn, (e) => e.status === status && (!re || re.test(e.message)));

describe('starting and stopping', () => {
  test('start then stop opens the notes window without recording a stint yet', () => {
    const { timer, clock, a } = setup();
    timer.start(a.id);
    clock.advance(30 * MIN);
    timer.requestStop();
    assert.equal(timer.state.running, null);
    assert.equal(timer.state.pending.stoppedAt - timer.state.pending.start, 30 * MIN);
    assert.equal(timer.state.stints.length, 0);
  });

  test('starting the running task again is a no-op', () => {
    const { timer, clock, a } = setup();
    timer.start(a.id);
    const start = timer.state.running.start;
    clock.advance(MIN);
    timer.start(a.id);
    assert.equal(timer.state.running.start, start);
    assert.equal(timer.state.pending, null);
  });

  test('stop with nothing running is refused', () => {
    const { timer } = setup();
    rejects(() => timer.requestStop(), 409);
  });

  test('only one timer: starting another task stops the current one and queues the new one', () => {
    const { timer, clock, a, b } = setup();
    timer.start(a.id);
    clock.advance(10 * MIN);
    timer.start(b.id);
    assert.equal(timer.state.running, null);
    assert.equal(timer.state.pending.taskId, a.id);
    assert.equal(timer.state.pending.thenStart, b.id);
    rejects(() => timer.start(a.id), 409, /pending/);

    clock.advance(MIN);
    timer.resolvePending({ notes: '', dismissed: true });
    assert.equal(timer.state.running.taskId, b.id);
    assert.equal(timer.state.running.start, clock.now);
  });
});

describe('notes window end-time rule', () => {
  function stopped(opts) {
    const ctx = setup(opts);
    ctx.timer.start(ctx.a.id);
    ctx.clock.advance(60 * MIN);
    ctx.timer.requestStop();
    return ctx;
  }

  test('notes saved within the window: stint runs until they are saved', () => {
    const { timer, clock, a } = stopped();
    clock.advance(5 * MIN);
    timer.resolvePending({ notes: 'did things' });
    const [st] = stintsFor(timer, a.id);
    assert.equal(duration(st), 65 * MIN);
    assert.equal(st.notes, 'did things');
  });

  test('empty notes: stint ends at the stop time', () => {
    const { timer, clock, a } = stopped();
    clock.advance(5 * MIN);
    timer.resolvePending({ notes: '   ' });
    assert.equal(duration(stintsFor(timer, a.id)[0]), 60 * MIN);
  });

  test('skipped: stint ends at the stop time and typed notes are discarded', () => {
    const { timer, clock, a } = stopped();
    clock.advance(5 * MIN);
    timer.resolvePending({ notes: 'typed', dismissed: true });
    const [st] = stintsFor(timer, a.id);
    assert.equal(duration(st), 60 * MIN);
    assert.equal(st.notes, '');
  });

  test('notes saved after the window: stint ends at the stop time but notes are kept', () => {
    const { timer, clock, a } = stopped();
    clock.advance(16 * MIN);
    timer.resolvePending({ notes: 'late' });
    const [st] = stintsFor(timer, a.id);
    assert.equal(duration(st), 60 * MIN);
    assert.equal(st.notes, 'late');
  });

  test('sweep auto-closes an ignored window after 15 minutes, keeping the draft', () => {
    const { timer, clock, a } = stopped();
    timer.saveDraft('half written');
    clock.advance(15 * MIN);
    assert.equal(timer.sweep(), false, 'not yet: exactly 15 minutes is still inside the window');
    clock.advance(1);
    assert.equal(timer.sweep(), true);
    assert.equal(timer.state.pending, null);
    const [st] = stintsFor(timer, a.id);
    assert.equal(duration(st), 60 * MIN);
    assert.equal(st.notes, 'half written');
  });

  test('notes from "start timer from" pre-fill the stop draft', () => {
    const { timer, clock, a } = setup();
    timer.start(a.id, { start: clock.now - 5 * MIN, notes: 'planned work' });
    timer.requestStop();
    assert.equal(timer.state.pending.draft, 'planned work');
  });
});

describe('sessions', () => {
  test('starting a timer opens a session; stints accumulate in it', () => {
    const { timer, clock, a } = setup();
    timer.start(a.id);
    const sess = timer.openSession(a.id);
    assert.ok(sess);
    clock.advance(20 * MIN); timer.requestStop(); timer.resolvePending({ dismissed: true });
    clock.advance(30 * MIN); // break
    timer.start(a.id);
    clock.advance(10 * MIN); timer.requestStop(); timer.resolvePending({ dismissed: true });
    const stints = stintsFor(timer, a.id);
    assert.equal(stints.length, 2);
    assert.ok(stints.every((st) => st.sessionId === sess.id));
  });

  test('closing a session while its timer runs goes through the notes window first', () => {
    const { timer, clock, a } = setup();
    timer.start(a.id);
    clock.advance(10 * MIN);
    timer.closeSession(a.id);
    assert.equal(timer.state.pending.action, 'closeSession');
    assert.equal(timer.openSession(a.id).closedAt, null);
    timer.resolvePending({ dismissed: true });
    assert.equal(timer.openSession(a.id), undefined);
    assert.ok(timer.state.sessions[0].closedAt);
  });

  test('a new stint after closing starts a fresh session', () => {
    const { timer, clock, a } = setup();
    timer.addManualStint(a.id, { start: clock.now - 2 * HOUR, end: clock.now - HOUR });
    const first = timer.openSession(a.id);
    timer.closeSession(a.id);
    timer.start(a.id);
    assert.notEqual(timer.openSession(a.id).id, first.id);
  });

  test('closeSessions stops an overnight timer at the given time', () => {
    const { timer, clock, a } = setup();
    timer.start(a.id);
    const start = clock.now;
    clock.advance(16 * HOUR); // left running overnight
    const sid = timer.openSession(a.id).id;
    rejects(() => timer.closeSessions([sid]), 400, /running timer/);
    timer.closeSessions([sid], start + 2 * HOUR);
    assert.equal(timer.state.running, null);
    assert.equal(duration(stintsFor(timer, a.id)[0]), 2 * HOUR);
    assert.ok(timer.state.sessions.find((s) => s.id === sid).closedAt);
  });

  test('closeSessions clamps the running end into [start, now]', () => {
    const { timer, clock, a } = setup();
    timer.start(a.id);
    clock.advance(HOUR);
    timer.closeSessions([timer.openSession(a.id).id], clock.now + 5 * HOUR);
    assert.equal(duration(stintsFor(timer, a.id)[0]), HOUR);
  });

  test('closing an empty session just drops it', () => {
    const { timer, a } = setup();
    timer.ensureOpenSession(a.id);
    timer.closeSession(a.id);
    assert.equal(timer.state.sessions.length, 0);
  });

  test('finishing a task closes its session; finishing a project finishes its tasks', () => {
    const { timer, clock, project, a, b } = setup();
    timer.addManualStint(a.id, { start: clock.now - HOUR, end: clock.now });
    timer.finishTask(a.id);
    assert.equal(timer.task(a.id).status, 'finished');
    assert.equal(timer.openSession(a.id), undefined);
    timer.finishProject(project.id);
    assert.equal(timer.task(b.id).status, 'finished');
    assert.equal(timer.project(project.id).status, 'finished');
    rejects(() => timer.start(b.id), 400);
  });

  test('finishing a project with a running timer asks for notes first', () => {
    const { timer, project, a } = setup();
    timer.start(a.id);
    timer.finishProject(project.id);
    assert.equal(timer.state.pending.action, 'finishProject');
    assert.equal(timer.project(project.id).status, 'active');
    timer.resolvePending({ dismissed: true });
    assert.equal(timer.project(project.id).status, 'finished');
  });

  test('reopening a task in a finished project reopens the project', () => {
    const { timer, project, a } = setup();
    timer.finishProject(project.id);
    timer.reopenTask(a.id);
    assert.equal(timer.project(project.id).status, 'active');
    assert.equal(timer.task(a.id).status, 'active');
  });
});

describe('+ Time', () => {
  test('adds a manual stint to the open session', () => {
    const { timer, clock, a } = setup();
    const st = timer.addManualStint(a.id, { start: clock.now - HOUR, end: clock.now - 30 * MIN, notes: ' offline ' });
    assert.equal(st.manual, true);
    assert.equal(st.notes, 'offline');
    assert.equal(st.sessionId, timer.openSession(a.id).id);
  });

  test('rejects bad ranges, future time, and > 24 hours', () => {
    const { timer, clock, a } = setup();
    rejects(() => timer.addManualStint(a.id, { start: clock.now, end: clock.now }), 400, /after start/);
    rejects(() => timer.addManualStint(a.id, { start: 'x', end: clock.now }), 400);
    rejects(() => timer.addManualStint(a.id, { start: clock.now, end: clock.now + 2 * MIN }), 400, /future/);
    rejects(() => timer.addManualStint(a.id, { start: clock.now - 25 * HOUR, end: clock.now }), 400, /24 hours/);
  });

  test('rejects overlaps with stints, the running timer and a pending stint', () => {
    const { timer, clock, a, b } = setup();
    timer.addManualStint(a.id, { start: clock.now - 3 * HOUR, end: clock.now - 2 * HOUR });
    rejects(() => timer.addManualStint(b.id, { start: clock.now - 150 * MIN, end: clock.now - 90 * MIN }), 400, /overlaps/);
    // touching is fine
    timer.addManualStint(b.id, { start: clock.now - 2 * HOUR, end: clock.now - 90 * MIN });

    timer.start(a.id, { start: clock.now - 30 * MIN });
    rejects(() => timer.addManualStint(b.id, { start: clock.now - 40 * MIN, end: clock.now - 20 * MIN }), 400, /overlaps/);
    clock.advance(MIN);
    timer.requestStop();
    rejects(() => timer.addManualStint(b.id, { start: clock.now - 10 * MIN, end: clock.now - 5 * MIN }), 400, /overlaps/);
  });

  test('start timer from an earlier time', () => {
    const { timer, clock, a, b } = setup();
    timer.start(a.id, { start: clock.now - 20 * MIN });
    assert.equal(timer.state.running.start, clock.now - 20 * MIN);
    rejects(() => timer.start(b.id, { start: clock.now - 5 * MIN }), 409, /Stop the running timer/);
  });

  test('start timer from: rejects the future, > 24h ago, and overlaps', () => {
    const { timer, clock, a } = setup();
    rejects(() => timer.start(a.id, { start: clock.now + 5 * MIN }), 400, /future/);
    rejects(() => timer.start(a.id, { start: clock.now - 25 * HOUR }), 400, /24 hours/);
    timer.addManualStint(a.id, { start: clock.now - HOUR, end: clock.now - 30 * MIN });
    rejects(() => timer.start(a.id, { start: clock.now - 40 * MIN }), 400, /overlaps/);
    assert.equal(timer.state.running, null);
  });

  test('deleting the last stint of a closed session removes the session', () => {
    const { timer, clock, a } = setup();
    const st = timer.addManualStint(a.id, { start: clock.now - HOUR, end: clock.now });
    timer.closeSession(a.id);
    timer.deleteStint(st.id);
    assert.equal(timer.state.stints.length, 0);
    assert.equal(timer.state.sessions.length, 0);
  });
});

describe('validation', () => {
  test('names are required and trimmed', () => {
    const { timer, project } = setup();
    rejects(() => timer.addProject('   '), 400);
    assert.equal(timer.addTask(project.id, '  x  ').name, 'x');
  });

  test('cannot start a task that does not exist', () => {
    const { timer } = setup();
    rejects(() => timer.start('nope'), 400);
  });
});
