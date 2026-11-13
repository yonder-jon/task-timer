import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  ActionIcon, Box, Button, Card, Divider, Group, Menu, Paper, SimpleGrid, Stack, Text, TextInput, Title, Tooltip,
} from '@mantine/core';
import { IconCopy, IconDots, IconPlayerPlayFilled, IconPlayerStopFilled, IconPlus } from '@tabler/icons-react';
import type { Project, Task } from '../../shared/types.ts';
import { api, copyText, serverNow, useAction, useS } from '../lib/api.ts';
import {
  closedTodaySessions, openSession, openSessions, openSessionsMs, project, projectSessionMs, projectTasks, projectTotalMs,
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
  const tasks = projectTasks(s, p.id).filter((t) => t.status === 'active');
  const isLive = tasks.some((t) => s.running?.taskId === t.id);
  const addTask = async (e: FormEvent) => {
    e.preventDefault();
    if (name.trim() && await run(() => api.tasks.$post({ json: { projectId: p.id, name } }))) setName('');
  };
  const finish = () => {
    if (confirm(`Finish project "${p.name}" and all its tasks?`)) run(() => api.projects[':id'].finish.$post({ param: { id: p.id } }));
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
            <Menu.Item disabled={!!s.pending} onClick={finish}>Finish project</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
      <RenameModal opened={renaming} title="Rename project" name={p.name} onClose={() => setRenaming(false)}
        onSave={async (n) => !!(await run(() => api.projects[':id'].rename.$post({ param: { id: p.id }, json: { name: n } })))} />
      <Divider />
      {tasks.length
        ? tasks.map((t) => <TaskRow key={t.id} task={t} onAddTime={onAddTime} />)
        : <Text size="sm" c="dimmed" px="md" py="sm">No active tasks</Text>}
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

function TaskRow({ task: t, onAddTime }: { task: Task; onAddTime: (taskId: string) => void }) {
  const s = useS();
  const run = useAction();
  const running = s.running?.taskId === t.id;
  const busy = !!s.pending;
  const id = { param: { id: t.id } };
  const [renaming, setRenaming] = useState(false);

  const closeSession = () => {
    if (confirm(`Close the session for "${t.name}" at ${hm(taskSessionMs(s, t.id, serverNow()))}? The session counter resets to 0:00.`)) {
      run(() => api.tasks[':id']['close-session'].$post(id));
    }
  };
  const finish = () => {
    if (confirm(`Finish task "${t.name}"? Its open session will be closed.`)) run(() => api.tasks[':id'].finish.$post(id));
  };

  return (
    <Box px="md" py="sm" bg={running ? 'var(--mantine-color-green-light)' : undefined} style={{ borderBottom: '1px solid var(--mantine-color-default-border)' }}>
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <Text fw={500} style={{ flex: 1, overflowWrap: 'anywhere' }}>{t.name}</Text>
        <Box ta="right">
          <Text fz="xl" fw={700} lh={1.1} c={running ? 'green' : undefined} className="num" title="Current session">
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
          <Button size="xs" color="green" disabled={busy} leftSection={<IconPlayerPlayFilled size={14} />}
            onClick={() => run(() => api.tasks[':id'].start.$post({ ...id, json: {} }))}>Start</Button>
        )}
        <Button size="xs" variant="default" disabled={busy} leftSection={<IconPlus size={14} />} onClick={() => onAddTime(t.id)}>Time</Button>
        <Box style={{ flex: 1 }} />
        <Menu position="bottom-end" withinPortal>
          <Menu.Target>
            <ActionIcon variant="subtle" color="gray" aria-label="Task actions"><IconDots size={18} /></ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => setRenaming(true)}>Rename…</Menu.Item>
            <Menu.Item disabled={busy || !openSession(s, t.id)} onClick={closeSession}>Close session</Menu.Item>
            <Menu.Item disabled={busy} onClick={finish}>Finish task</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
      <RenameModal opened={renaming} title="Rename task" name={t.name} onClose={() => setRenaming(false)}
        onSave={async (n) => !!(await run(() => api.tasks[':id'].rename.$post({ ...id, json: { name: n } })))} />
    </Box>
  );
}
