// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

import { Fragment, useState } from 'react';
import {
  ActionIcon, Badge, Button, Collapse, Group, Menu, Paper, Select, Stack, Table, Text, Title, Tooltip,
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { IconChevronDown, IconChevronRight, IconCopy, IconDownload, IconTrash } from '@tabler/icons-react';
import type { Session, State, Stint } from '../../shared/types.ts';
import { api, copyText, download, serverNow, useAction, useS } from '../lib/api.ts';
import { project, projectTotalMs, sessionMs, sessionNotes, stintsOf, task, taskTotalMs, whenLabel } from '../lib/model.ts';
import { clock, dayKey, fmtDate, fmtTime, hm, hours, toCsv } from '../lib/format.ts';
import { Live } from './Live.tsx';

export function History() {
  const s = useS();
  const run = useAction();
  const mobile = useMediaQuery('(max-width: 48em)');
  const [filter, setFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const inFilter = (tid: string) => !filter || task(s, tid)?.projectId === filter;
  const sessions = s.sessions.filter((x) => task(s, x.taskId) && inFilter(x.taskId)).sort((a, b) => b.openedAt - a.openedAt);
  const total = sessions.reduce((a, x) => a + sessionMs(s, x, serverNow()), 0);
  const finishedProjects = s.projects.filter((p) => p.status === 'finished');
  const finishedTasks = s.tasks.filter((t) => t.status === 'finished' && project(s, t.projectId)?.status === 'active');
  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  const deleteStint = (st: Stint) => {
    if (confirm(`Delete the stint ${whenLabel(st.start, serverNow())}–${fmtTime(st.end)} (${clock(st.end - st.start)})?`)) {
      run(() => api.stints[':id'].delete.$post({ param: { id: st.id } }));
    }
  };

  return (
    <Stack gap="md">
      <Group gap="sm" wrap="nowrap">
        <Select
          style={{ flex: '1 1 0', maxWidth: 280, minWidth: 0 }}
          placeholder="All projects"
          clearable
          value={filter}
          onChange={setFilter}
          data={s.projects.map((p) => ({ value: p.id, label: p.name + (p.status === 'finished' ? ' (finished)' : '') }))}
        />
        <Text size="sm" c="dimmed" style={{ flex: 1 }} visibleFrom="xs">
          {sessions.length} session{sessions.length === 1 ? '' : 's'} · {hm(total)}
        </Text>
        <Menu position="bottom-end">
          <Menu.Target>
            <Button variant="default" style={{ flex: 'none' }} leftSection={<IconDownload size={16} />} disabled={!sessions.length}>Export</Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => exportSessions(s, sessions)}>Sessions (CSV)</Menu.Item>
            <Menu.Item onClick={() => exportStints(s, inFilter)}>Stints (CSV)</Menu.Item>
          </Menu.Dropdown>
        </Menu>
      </Group>
      <Text size="sm" c="dimmed" hiddenFrom="xs">{sessions.length} session{sessions.length === 1 ? '' : 's'} · {hm(total)}</Text>

      {!sessions.length ? (
        <Text c="dimmed" ta="center" py="xl">No sessions yet.</Text>
      ) : mobile ? (
        <Stack gap="sm">
          {sessions.map((x) => (
            <SessionCard key={x.id} session={x} open={expanded.has(x.id)} onToggle={() => toggle(x.id)} onDelete={deleteStint} />
          ))}
        </Stack>
      ) : (
        <Paper withBorder>
          <Table verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36} />
                <Table.Th>Date</Table.Th><Table.Th>Project</Table.Th><Table.Th>Task</Table.Th>
                <Table.Th>Session</Table.Th><Table.Th>Hours</Table.Th><Table.Th>Notes</Table.Th><Table.Th w={40} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {sessions.map((x) => (
                <SessionRows key={x.id} session={x} open={expanded.has(x.id)} onToggle={() => toggle(x.id)} onDelete={deleteStint} />
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}

      {finishedTasks.length > 0 && (
        <FinishedList title="Finished tasks (in active projects)" items={finishedTasks.map((t) => ({
          id: t.id, label: `${project(s, t.projectId)?.name} › ${t.name}`, ms: taskTotalMs(s, t.id, serverNow()),
          reopen: () => run(() => api.tasks[':id'].reopen.$post({ param: { id: t.id } })),
        }))} />
      )}
      {finishedProjects.length > 0 && (
        <FinishedList title="Finished projects" items={finishedProjects.map((p) => ({
          id: p.id, label: p.name, ms: projectTotalMs(s, p.id, serverNow()),
          reopen: () => run(() => api.projects[':id'].reopen.$post({ param: { id: p.id } })),
        }))} />
      )}
    </Stack>
  );
}

interface RowProps { session: Session; open: boolean; onToggle: () => void; onDelete: (st: Stint) => void }

/** Session time: ticking while open, fixed once closed. */
function SessionTime({ session: x }: { session: Session }) {
  const s = useS();
  return x.closedAt ? <>{clock(sessionMs(s, x, serverNow()))}</> : <Live>{(now) => clock(sessionMs(s, x, now))}</Live>;
}

function CopyNotes({ notes }: { notes: string }) {
  return (
    <Tooltip label="Copy notes">
      <ActionIcon variant="subtle" color="gray" disabled={!notes} onClick={() => copyText(notes)} aria-label="Copy notes">
        <IconCopy size={16} />
      </ActionIcon>
    </Tooltip>
  );
}

function DeleteStint({ stint, onDelete }: { stint: Stint; onDelete: (st: Stint) => void }) {
  return (
    <Tooltip label="Delete stint">
      <ActionIcon variant="subtle" color="red" aria-label="Delete stint" onClick={() => onDelete(stint)}>
        <IconTrash size={16} />
      </ActionIcon>
    </Tooltip>
  );
}

const Dash = () => <Text span c="dimmed">—</Text>;

// Wide screens: a table row per session, with its stints as sub-rows.
function SessionRows({ session: x, open, onToggle, onDelete }: RowProps) {
  const s = useS();
  const t = task(s, x.taskId)!;
  const stints = stintsOf(s, x.id);
  const notes = sessionNotes(s, x);
  return (
    <Fragment>
      <Table.Tr>
        <Table.Td>
          <ActionIcon variant="subtle" color="gray" onClick={onToggle} aria-label={open ? 'Hide stints' : 'Show stints'}>
            {open ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          </ActionIcon>
        </Table.Td>
        <Table.Td style={{ whiteSpace: 'nowrap' }}>
          {fmtDate(x.openedAt)} {!x.closedAt && <Badge size="xs" color="green" variant="light">open</Badge>}
        </Table.Td>
        <Table.Td>{project(s, t.projectId)?.name}</Table.Td>
        <Table.Td>{t.name}</Table.Td>
        <Table.Td fw={700} className="num"><SessionTime session={x} /></Table.Td>
        <Table.Td className="num">{hours(sessionMs(s, x, serverNow()))}</Table.Td>
        <Table.Td className="pre-wrap" maw={420}>{notes || <Dash />}</Table.Td>
        <Table.Td><CopyNotes notes={notes} /></Table.Td>
      </Table.Tr>
      {open && stints.map((st) => (
        <Table.Tr key={st.id} bg="var(--mantine-color-default-hover)">
          <Table.Td />
          <Table.Td colSpan={3} className="num" fz="sm">
            {whenLabel(st.start, serverNow())} – {fmtTime(st.end)} {st.manual && <Badge size="xs" variant="light">added</Badge>}
          </Table.Td>
          <Table.Td className="num" fz="sm">{clock(st.end - st.start)}</Table.Td>
          <Table.Td />
          <Table.Td className="pre-wrap" fz="sm">{st.notes || <Dash />}</Table.Td>
          <Table.Td><DeleteStint stint={st} onDelete={onDelete} /></Table.Td>
        </Table.Tr>
      ))}
      {open && !stints.length && (
        <Table.Tr><Table.Td /><Table.Td colSpan={7} c="dimmed" fz="sm">Only the running stint so far.</Table.Td></Table.Tr>
      )}
    </Fragment>
  );
}

// Phones: a card per session, stints expand underneath.
function SessionCard({ session: x, open, onToggle, onDelete }: RowProps) {
  const s = useS();
  const t = task(s, x.taskId)!;
  const stints = stintsOf(s, x.id);
  const notes = sessionNotes(s, x);
  return (
    <Paper withBorder p="sm">
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Text size="xs" c="dimmed">
            {fmtDate(x.openedAt)} {!x.closedAt && <Badge size="xs" color="green" variant="light">open</Badge>}
          </Text>
          <Text size="sm" c="dimmed" truncate>{project(s, t.projectId)?.name}</Text>
          <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{t.name}</Text>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Text fz="lg" fw={700} className="num"><SessionTime session={x} /></Text>
          <Text size="xs" c="dimmed" className="num">{hours(sessionMs(s, x, serverNow()))} h</Text>
        </div>
      </Group>
      {notes && <Text size="sm" mt="xs" className="pre-wrap">{notes}</Text>}
      <Group gap="xs" mt="xs">
        <Button size="compact-sm" variant="subtle" color="gray"
          leftSection={open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />} onClick={onToggle}>
          {stints.length} stint{stints.length === 1 ? '' : 's'}
        </Button>
        <div style={{ flex: 1 }} />
        <CopyNotes notes={notes} />
      </Group>
      <Collapse expanded={open}>
        <Stack gap={0} mt="xs">
          {stints.map((st) => (
            <Group key={st.id} gap="sm" wrap="nowrap" align="flex-start" py={6}
              style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Text size="sm" className="num">
                  {whenLabel(st.start, serverNow())} – {fmtTime(st.end)} · <b>{clock(st.end - st.start)}</b>{' '}
                  {st.manual && <Badge size="xs" variant="light">added</Badge>}
                </Text>
                {st.notes && <Text size="sm" c="dimmed" className="pre-wrap">{st.notes}</Text>}
              </div>
              <DeleteStint stint={st} onDelete={onDelete} />
            </Group>
          ))}
          {!stints.length && <Text size="sm" c="dimmed">Only the running stint so far.</Text>}
        </Stack>
      </Collapse>
    </Paper>
  );
}

function FinishedList({ title, items }: { title: string; items: { id: string; label: string; ms: number; reopen: () => void }[] }) {
  return (
    <Stack gap="xs">
      <Title order={5} mt="md">{title}</Title>
      {items.map((it) => (
        <Paper key={it.id} withBorder px="md" py="xs">
          <Group gap="sm" wrap="nowrap">
            <Text style={{ flex: 1, overflowWrap: 'anywhere' }}>{it.label}</Text>
            <Text c="dimmed" size="sm" className="num">{hm(it.ms)}</Text>
            <Button size="xs" variant="default" onClick={it.reopen}>Reopen</Button>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}

function exportSessions(s: State, sessions: Session[]) {
  const now = serverNow();
  const rows: unknown[][] = [['Date', 'Project', 'Task', 'Status', 'Hours', 'Duration', 'Stints', 'Notes']];
  for (const x of [...sessions].sort((a, b) => a.openedAt - b.openedAt)) {
    const t = task(s, x.taskId)!, ms = sessionMs(s, x, now);
    rows.push([dayKey(x.openedAt), project(s, t.projectId)?.name, t.name, x.closedAt ? 'closed' : 'open',
      hours(ms), clock(ms), stintsOf(s, x.id).length, sessionNotes(s, x)]);
  }
  download(`sessions-${dayKey(now)}.csv`, toCsv(rows));
}

function exportStints(s: State, inFilter: (tid: string) => boolean) {
  const rows: unknown[][] = [['Date', 'Project', 'Task', 'Start', 'End', 'Hours', 'Duration', 'Added manually', 'Notes']];
  for (const st of s.stints.filter((x) => task(s, x.taskId) && inFilter(x.taskId)).sort((a, b) => a.start - b.start)) {
    const t = task(s, st.taskId)!;
    rows.push([dayKey(st.start), project(s, t.projectId)?.name, t.name, fmtTime(st.start), fmtTime(st.end),
      hours(st.end - st.start), clock(st.end - st.start), st.manual ? 'yes' : '', st.notes]);
  }
  download(`stints-${dayKey(serverNow())}.csv`, toCsv(rows));
}
