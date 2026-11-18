// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  ActionIcon, Badge, Box, Button, Card, Divider, Group, Menu, Paper, SimpleGrid, Stack, Text, TextInput, Title, Tooltip, UnstyledButton,
} from '@mantine/core';
import { IconCircleCheck, IconCopy, IconDots, IconPlayerPlayFilled, IconPlayerStopFilled, IconPlus } from '@tabler/icons-react';
import type { Project, Task } from '../../shared/types.ts';
import { api, copyText, serverNow, useAction, useS } from '../lib/api.ts';
import {
  closedTodaySessions, dashboardTasks, openSession, openSessions, openSessionsMs, project, projectSessionMs, projectTotalMs,
  sessionMs, sessionNotes, task, taskSessionMs, taskTotalMs, whenLabel,
} from '../lib/model.ts';
import { clock, dayKey, fmtDate, fmtTime, hm } from '../lib/format.ts';
import { Live } from './Live.tsx';
import { RenameModal } from './RenameModal.tsx';

interface Props {
  onAddTime: (taskId: string) => void;
  onEndDay: () => void;
}

export function Dashboard({ onAddTime, onEndDay }: Props) {
  const s = useS();
  const active = s.projects.filter((p) => p.status === 'active');
  return (
    <Stack gap="md">
      <NowPanel onAddTime={onAddTime} />
      <Toolbar onEndDay={onEndDay} />
      {active.length ? (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {active.map((p) => <ProjectCard key={p.id} project={p} onAddTime={onAddTime} />)}
        </SimpleGrid>
      ) : (
        <Text c="dimmed" ta="center" py="xl">No active projects. Add one above to get started.</Text>
      )}
    </Stack>
  );
}

/**
 * The running timer, big. The same layout is shown when idle (with placeholders), so
 * starting and stopping never shifts the page.
 */
function NowPanel({ onAddTime }: { onAddTime: (taskId: string) => void }) {
  const s = useS();
  const run = useAction();
  const r = s.running;
  const t = r && task(s, r.taskId);
  const p = t && project(s, t.projectId);
  return (
    <Paper withBorder p="md" radius="lg" style={r ? { borderColor: 'var(--mantine-color-green-6)', boxShadow: '0 0 0 1px var(--mantine-color-green-6)' } : undefined}>
      <Group justify="space-between" align="center" gap="md">
        <Box miw={0} style={{ flex: '1 1 200px' }}>
          <Text size="sm" c="dimmed" truncate>{p ? p.name : 'No timer running'}</Text>
          <Text size="lg" fw={600} truncate>{t ? t.name : 'Press Start on a task'}</Text>
          <Text size="sm" c="dimmed" className="num">
            {r ? <>This stint <Live>{(now) => clock(now - r.start)}</Live> · started <Live>{(now) => whenLabel(r.start, now)}</Live></> : ' '}
          </Text>
        </Box>
        <Box ta={{ base: 'left', xs: 'right' }}>
          <Text size="xs" tt="uppercase" c="dimmed" fw={600} lts={0.5}>Session</Text>
          <Text fz={{ base: 40, sm: 52 }} fw={700} lh={1} c={r ? 'green' : 'dimmed'} className="num">
            {r ? <Live>{(now) => clock(taskSessionMs(s, r.taskId, now))}</Live> : '0:00:00'}
          </Text>
          <Text size="md" fw={600} mt={4} className="num">
            <Text span c="dimmed" fw={400}>Task total </Text>
            {r ? <Live>{(now) => clock(taskTotalMs(s, r.taskId, now))}</Live> : '–'}
          </Text>
        </Box>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconPlus size={16} />} disabled={!r} onClick={() => r && onAddTime(r.taskId)}>Time</Button>
          <Button color="red" leftSection={<IconPlayerStopFilled size={16} />} disabled={!r} onClick={() => run(() => api.stop.$post())}>Stop</Button>
        </Group>
      </Group>
    </Paper>
  );
}

function Toolbar({ onEndDay }: { onEndDay: () => void }) {
  const s = useS();
  const run = useAction();
  const [name, setName] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && await run(() => api.projects.$post({ json: { name } }))) setName('');
  };
  return (
    <Group gap="sm" align="center">
      <form onSubmit={submit} style={{ flex: '1 1 280px' }}>
        <Group gap="xs" wrap="nowrap">
          <TextInput style={{ flex: 1 }} placeholder="New project name…" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Button type="submit">Add project</Button>
        </Group>
      </form>
      <Group gap="sm" wrap="nowrap">
        <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
          Open sessions <Text span fw={700} c="var(--mantine-color-text)" className="num"><Live>{(now) => hm(openSessionsMs(s, now))}</Live></Text>
        </Text>
        <Button variant="default" disabled={!!s.pending || !openSessions(s).length} onClick={onEndDay}>End day…</Button>
      </Group>
    </Group>
  );
}

function ProjectCard({ project: p, onAddTime }: { project: Project; onAddTime: (taskId: string) => void }) {
  const s = useS();
  const run = useAction();
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const { current, ended } = dashboardTasks(s, p.id, serverNow());
  const isLive = current.some((t) => s.running?.taskId === t.id);
  const addTask = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && await run(() => api.tasks.$post({ json: { projectId: p.id, name } }))) setName('');
  };
  const finish = () => {
    if (confirm(`End project "${p.name}" and all its tasks?`)) run(() => api.projects[':id'].finish.$post({ param: { id: p.id } }));
  };

  return (
    <Card withBorder padding={0} radius="md" style={isLive ? { borderColor: 'var(--mantine-color-green-6)' } : undefined}>
      <Group px="md" py="sm" gap="sm" wrap="nowrap">
        <Title order={5} style={{ flex: 1, overflowWrap: 'anywhere' }}>{p.name}</Title>
        <Text size="xs" c="dimmed" ta="right" className="num" style={{ whiteSpace: 'nowrap' }}>
          session <b><Live>{(now) => hm(projectSessionMs(s, p.id, now))}</Live></b><br />
          total <Live>{(now) => hm(projectTotalMs(s, p.id, now))}</Live>
        </Text>
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" aria-label="Project actions"><IconDots size={18} /></ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => setRenaming(true)}>Rename…</Menu.Item>
            <Menu.Item disabled={!!s.pending} onClick={finish}>End project</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
      <RenameModal opened={renaming} title="Rename project" name={p.name} onClose={() => setRenaming(false)}
        onSave={async (n) => !!(await run(() => api.projects[':id'].rename.$post({ param: { id: p.id }, json: { name: n } })))} />
      <Divider />
      {current.length
        ? current.map((t) => <TaskRow key={t.id} task={t} onAddTime={onAddTime} />)
        : <Text size="sm" c="dimmed" px="md" py="sm" style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>No active tasks</Text>}
      <EndedTasks tasks={ended} />
      <form onSubmit={addTask}>
        <Group gap="xs" px="md" py="sm" wrap="nowrap">
          <TextInput size="sm" style={{ flex: 1 }} placeholder="Add a task…" value={name} onChange={(e) => setName(e.currentTarget.value)} />
          <Button size="sm" variant="default" type="submit">Add</Button>
        </Group>
      </form>
    </Card>
  );
}

/** Sessions closed today, so their totals can still be entered on the platform after closing. */
function ClosedToday({ taskId }: { taskId: string }) {
  const s = useS();
  const now = serverNow();
  const list = closedTodaySessions(s, taskId, now);
  if (!list.length) return null;
  return (
    <Stack gap={0} mt={4}>
      {list.map((x) => {
        const notes = sessionNotes(s, x);
        const opened = dayKey(x.openedAt) === dayKey(now) ? '' : ` · ${fmtDate(x.openedAt)}`;
        return (
          <Group key={x.id} gap={6} wrap="nowrap" justify="flex-end">
            <Text size="sm" c="dimmed" className="num" truncate miw={0}>Closed {fmtTime(x.closedAt!)}{opened}</Text>
            <Text size="sm" fw={700} className="num" style={{ whiteSpace: 'nowrap' }}>{clock(sessionMs(s, x, now))}</Text>
            <Tooltip label={notes ? 'Copy notes' : 'No notes'}>
              <ActionIcon size="sm" variant="subtle" color="gray" disabled={!notes} onClick={() => copyText(notes)} aria-label="Copy notes">
                <IconCopy size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        );
      })}
    </Stack>
  );
}

const ENDED_SHOWN = 5;

/** Tasks ended before today: one summary line each, at the bottom of the project card. */
function EndedTasks({ tasks }: { tasks: Task[] }) {
  const [all, setAll] = useState(false);
  if (!tasks.length) return null;
  const shown = all ? tasks : tasks.slice(0, ENDED_SHOWN);
  return (
    <Box style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
      {shown.map((t) => <EndedRow key={t.id} task={t} />)}
      {tasks.length > ENDED_SHOWN && (
        <UnstyledButton px="md" pb={6} onClick={() => setAll(!all)}>
          <Text size="xs" c="dimmed" td="underline">{all ? 'Show fewer' : `Show ${tasks.length - ENDED_SHOWN} more ended`}</Text>
        </UnstyledButton>
      )}
    </Box>
  );
}

function EndedRow({ task: t }: { task: Task }) {
  const s = useS();
  const run = useAction();
  const [renaming, setRenaming] = useState(false);
  const id = { param: { id: t.id } };
  return (
    <Group px="md" py={4} gap="xs" wrap="nowrap">
      <IconCircleCheck size={16} color="var(--mantine-color-dimmed)" style={{ flex: 'none' }} />
      {/* Name first; the hours and date drop below it when there isn't room. */}
      <Group gap={0} justify="space-between" style={{ flex: 1, columnGap: "var(--mantine-spacing-sm)" }} miw={0}>
        <Text size="sm" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{t.name}</Text>
        <Text size="sm" c="dimmed" className="num" style={{ whiteSpace: 'nowrap' }}>
          <b>{hm(taskTotalMs(s, t.id, serverNow()))}</b> · ended {t.finishedAt ? fmtDate(t.finishedAt) : '—'}
        </Text>
      </Group>
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon size="sm" variant="subtle" color="gray" aria-label="Ended task actions"><IconDots size={16} /></ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item onClick={() => run(() => api.tasks[':id'].reopen.$post(id))}>Reopen task</Menu.Item>
          <Menu.Item onClick={() => setRenaming(true)}>Rename…</Menu.Item>
        </Menu.Dropdown>
      </Menu>
      <RenameModal opened={renaming} title="Rename task" name={t.name} onClose={() => setRenaming(false)}
        onSave={async (n) => !!(await run(() => api.tasks[':id'].rename.$post({ ...id, json: { name: n } })))} />
    </Group>
  );
}

function TaskRow({ task: t, onAddTime }: { task: Task; onAddTime: (taskId: string) => void }) {
  const s = useS();
  const run = useAction();
  const running = s.running?.taskId === t.id;
  const ended = t.status === 'finished'; // ended today: stays in place, greyed out, until tomorrow
  const busy = !!s.pending;
  const id = { param: { id: t.id } };
  const [renaming, setRenaming] = useState(false);

  const closeSession = () => {
    if (confirm(`Close the session for "${t.name}" at ${hm(taskSessionMs(s, t.id, serverNow()))}? The session counter resets to 0:00.`)) {
      run(() => api.tasks[':id']['close-session'].$post(id));
    }
  };
  const end = () => {
    const open = openSession(s, t.id) || running ? ` Its session (${hm(taskSessionMs(s, t.id, serverNow()))}) will be closed.` : '';
    if (confirm(`End task "${t.name}"?${open} It moves to the bottom of the project tomorrow.`)) run(() => api.tasks[':id'].finish.$post(id));
  };

  return (
    <Box px="md" py="sm" bg={running ? 'var(--mantine-color-green-light)' : undefined} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <Text component="div" fw={500} c={ended ? 'dimmed' : undefined} style={{ flex: 1, overflowWrap: 'anywhere' }}>
          {t.name}{ended && <> <Badge component="span" size="sm" variant="light" color="gray" style={{ verticalAlign: 'middle' }}>Ended</Badge></>}
        </Text>
        <Box ta="right">
          <Text fz="xl" fw={700} lh={1.1} c={running ? 'green' : ended ? 'dimmed' : undefined} className="num" title="Current session">
            <Live>{(now) => clock(taskSessionMs(s, t.id, now))}</Live>
          </Text>
          <Text size="xs" c="dimmed" className="num">total <Live>{(now) => clock(taskTotalMs(s, t.id, now))}</Live></Text>
        </Box>
      </Group>
      <ClosedToday taskId={t.id} />
      <Group gap="xs" mt="xs" wrap="nowrap">
        {running ? (
          <Button size="xs" color="red" disabled={busy} leftSection={<IconPlayerStopFilled size={14} />} onClick={() => run(() => api.stop.$post())}>Stop</Button>
        ) : (
          <Button size="xs" color="green" disabled={busy || ended} leftSection={<IconPlayerPlayFilled size={14} />}
            onClick={() => run(() => api.tasks[':id'].start.$post({ ...id, json: {} }))}>Start</Button>
        )}
        <Button size="xs" variant="default" disabled={busy || ended} leftSection={<IconPlus size={14} />} onClick={() => onAddTime(t.id)}>Time</Button>
        <Button size="xs" variant="default" disabled={busy || ended} leftSection={<IconCircleCheck size={14} />} onClick={end}>
          End
        </Button>
        <Box style={{ flex: 1 }} />
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" aria-label="Task actions"><IconDots size={18} /></ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => setRenaming(true)}>Rename…</Menu.Item>
            {ended
              ? <Menu.Item disabled={busy} onClick={() => run(() => api.tasks[':id'].reopen.$post(id))}>Reopen task</Menu.Item>
              : <Menu.Item disabled={busy || !openSession(s, t.id)} onClick={closeSession}>Close session</Menu.Item>}
          </Menu.Dropdown>
        </Menu>
      </Group>
      <RenameModal opened={renaming} title="Rename task" name={t.name} onClose={() => setRenaming(false)}
        onSave={async (n) => !!(await run(() => api.tasks[':id'].rename.$post({ ...id, json: { name: n } })))} />
    </Box>
  );
}
