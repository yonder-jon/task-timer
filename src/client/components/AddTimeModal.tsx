// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

// "+ Time": add a completed stint, or start the timer from an earlier time today.
import { useState } from 'react';
import { Alert, Button, Group, Modal, Select, SimpleGrid, Tabs, Text, TextInput, Textarea } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { api, serverNow, toast, useAction, useS } from '../lib/api.ts';
import { openSession, project, sessionMs, task, taskSessionMs } from '../lib/model.ts';
import { dayKey, fmtDate, fromLocal, hhmmOf, hm, minutesOf, parseDuration, timeKey } from '../lib/format.ts';

const warn = (message: string) => notifications.show({ color: 'red', message });

export function AddTimeModal({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const s = useS();
  const mobile = useMediaQuery('(max-width: 48em)');
  const t = taskId ? task(s, taskId) : undefined;
  return (
    <Modal opened={!!t} onClose={onClose} fullScreen={mobile} size="lg"
      title={t && <><Text fw={700} size="lg">Add time: {t.name}</Text><Text size="sm" c="dimmed">{project(s, t.projectId)?.name}</Text></>}>
      {t && <AddTimeForm key={t.id} taskId={t.id} onDone={onClose} />}
    </Modal>
  );
}

function AddTimeForm({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const [tab, setTab] = useState<string | null>('add');
  return (
    <Tabs value={tab} onChange={setTab}>
      <Tabs.List mb="md">
        <Tabs.Tab value="add">Add a stint</Tabs.Tab>
        <Tabs.Tab value="start">Start timer from…</Tabs.Tab>
      </Tabs.List>
      <Tabs.Panel value="add"><AddStint taskId={taskId} onDone={onDone} /></Tabs.Panel>
      <Tabs.Panel value="start"><StartFrom taskId={taskId} onDone={onDone} /></Tabs.Panel>
    </Tabs>
  );
}

function AddStint({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const s = useS();
  const run = useAction();
  const [session, setSession] = useState<string>('current');
  const [initial] = useState(() => {
    const end = Math.floor(serverNow() / 60000) * 60000;
    return { date: dayKey(end), from: timeKey(end - 30 * 60000), to: timeKey(end) };
  });
  const [date, setDate] = useState(initial.date);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [dur, setDur] = useState('0:30');
  const [notes, setNotes] = useState('');

  // Keep From / To / Duration in step.
  const durationOf = (f: string, t: string) => {
    const m = minutesOf(t) - minutesOf(f);
    return m > 0 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : '';
  };
  const onFrom = (v: string) => { setFrom(v); if (v && to) setDur(durationOf(v, to)); };
  const onTo = (v: string) => { setTo(v); if (from && v) setDur(durationOf(from, v)); };
  const onDur = (v: string) => {
    setDur(v);
    const m = parseDuration(v);
    if (m != null && from && minutesOf(from) + m < 24 * 60) setTo(hhmmOf(minutesOf(from) + m));
  };

  // Which session the stint goes into: the open one, a new past one, or an existing past one.
  const now = serverNow();
  const past = s.sessions.filter((x) => x.taskId === taskId && x.closedAt).sort((a, b) => b.openedAt - a.openedAt);
  const sessionOptions = [
    { value: 'current', label: `Current session (${openSession(s, taskId) ? hm(taskSessionMs(s, taskId, now)) : 'new'})` },
    { value: 'new', label: 'New past session' },
    ...past.map((x) => ({ value: x.id, label: `Past: ${fmtDate(x.openedAt)} (${hm(sessionMs(s, x, now))})` })),
  ];
  const onSession = (v: string | null) => {
    const next = v ?? 'current';
    setSession(next);
    const sess = past.find((x) => x.id === next);
    if (sess) setDate(dayKey(sess.openedAt)); // most likely the same day
    else if (next === 'new' && date === dayKey(now)) setDate(dayKey(now - 86400000)); // most likely yesterday or earlier
  };

  const submit = async () => {
    if (!date || !from || !to) return warn('Fill in the date and times');
    const start = fromLocal(date, from), end = fromLocal(date, to);
    if (end <= start) return warn('“To” must be after “From”');
    if (await run(() => api.tasks[':id'].stints.$post({ param: { id: taskId }, json: { start, end, notes, session } }))) {
      toast(session === 'current' ? `Added ${hm(end - start)}` : `Added ${hm(end - start)} to a past session`);
      onDone();
    }
  };

  return (
    <>
      <Text size="sm" c="dimmed" mb="sm">Record time you worked without the timer.</Text>
      <Select mb="sm" label="Add to" allowDeselect={false} data={sessionOptions} value={session} onChange={onSession}
        description={session === 'current' ? 'Counts towards the session you’re working on now.' : 'Kept in History as a closed session; today’s session is unaffected.'} />
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <TextInput label="Date" type="date" value={date} max={dayKey(serverNow())} onChange={(e) => setDate(e.currentTarget.value)} />
        <TextInput label="From" type="time" value={from} onChange={(e) => onFrom(e.currentTarget.value)} />
        <TextInput label="To" type="time" value={to} onChange={(e) => onTo(e.currentTarget.value)} />
        <TextInput label="Duration (h:mm)" inputMode="numeric" placeholder="0:30" value={dur} onChange={(e) => onDur(e.currentTarget.value)} />
      </SimpleGrid>
      <Textarea mt="sm" label="Notes (optional)" autosize minRows={3} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={onDone}>Cancel</Button>
        <Button onClick={submit}>Add stint</Button>
      </Group>
    </>
  );
}

function StartFrom({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const s = useS();
  const run = useAction();
  const [at, setAt] = useState(() => timeKey(serverNow() - 15 * 60000));
  const [notes, setNotes] = useState('');
  const blocked = s.running || s.pending;

  const submit = async () => {
    if (!at) return warn('Choose a start time');
    const start = fromLocal(dayKey(serverNow()), at);
    if (start > serverNow()) return warn('Start time is in the future');
    if (await run(() => api.tasks[':id'].start.$post({ param: { id: taskId }, json: { start, notes } }))) onDone();
  };

  return (
    <>
      <Text size="sm" c="dimmed" mb="sm">Start the timer as if you'd pressed Start at an earlier time today.</Text>
      {blocked ? (
        <Alert color="orange">
          {s.running?.taskId === taskId ? 'This task’s timer is already running.' : 'Another timer is running. Stop it first, then come back here.'}
        </Alert>
      ) : (
        <>
          <TextInput label="Started at" type="time" w={160} value={at} onChange={(e) => setAt(e.currentTarget.value)} />
          <Textarea mt="sm" label="Notes (optional, pre-filled when you stop)" autosize minRows={3} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        </>
      )}
      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={onDone}>Cancel</Button>
        <Button color="green" disabled={!!blocked} onClick={submit}>Start timer</Button>
      </Group>
    </>
  );
}
