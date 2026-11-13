// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

// Close several sessions at once: the manual "End day…" dialog, and the next-morning prompt
// for sessions left open from a previous day.
import { useState } from 'react';
import { ActionIcon, Alert, Button, Checkbox, Group, Modal, Paper, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconCopy } from '@tabler/icons-react';
import { api, copyText, serverNow, toast, useAction, useS } from '../lib/api.ts';
import { openSessions, project, sessionMs, sessionNotes, staleSessions, task, whenLabel } from '../lib/model.ts';
import { dayKey, hm, timeKey } from '../lib/format.ts';
import { Live } from './Live.tsx';

export type CloseMode = 'endday' | 'morning';

export function CloseSessionsModal({ mode, onClose }: { mode: CloseMode | null; onClose: () => void }) {
  const mobile = useMediaQuery('(max-width: 48em)');
  const s = useS();
  const morning = mode === 'morning';
  const keepAll = () => {
    onClose();
    api.daycheck.$post({ json: { day: dayKey(serverNow()) } }).catch(() => {});
  };
  return (
    <Modal
      opened={!!mode && !s.pending}
      onClose={morning ? keepAll : onClose}
      fullScreen={mobile}
      size="lg"
      title={<Text fw={700} size="lg">{morning ? 'Sessions left open from a previous day' : 'End of day'}</Text>}
    >
      {mode && <CloseForm key={mode} mode={mode} onCancel={morning ? keepAll : onClose} onDone={onClose} />}
    </Modal>
  );
}

function CloseForm({ mode, onCancel, onDone }: { mode: CloseMode; onCancel: () => void; onDone: () => void }) {
  const s = useS();
  const run = useAction();
  const morning = mode === 'morning';
  // The list is fixed when the dialog opens; everything starts ticked.
  const [ids] = useState(() => (morning ? staleSessions(s, serverNow()) : openSessions(s)).map((x) => x.id));
  const [selected, setSelected] = useState(() => new Set(ids));
  const [runningEnd, setRunningEnd] = useState('');

  const list = ids.map((id) => s.sessions.find((x) => x.id === id && !x.closedAt)).filter((x) => x !== undefined);
  const runningSess = s.running ? list.find((x) => x.taskId === s.running!.taskId) : undefined;
  const runningSelected = !!runningSess && selected.has(runningSess.id);
  const chosen = list.filter((x) => selected.has(x.id));

  const toggle = (id: string, on: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const submit = async () => {
    let end: number | undefined;
    if (runningSelected) {
      if (!morning) return notifications.show({ color: 'red', message: 'Stop the running timer first, or untick it' });
      if (!runningEnd) return notifications.show({ color: 'red', message: 'Enter when the running timer should have stopped' });
      end = new Date(runningEnd).getTime();
    }
    const json = { ids: chosen.map((x) => x.id), runningEnd: end, day: morning ? dayKey(serverNow()) : undefined };
    if (await run(() => api.sessions.close.$post({ json }))) {
      toast(`Closed ${chosen.length} session${chosen.length === 1 ? '' : 's'}`);
      onDone();
    }
  };

  if (!list.length) {
    return (
      <>
        <Text c="dimmed">No open sessions.</Text>
        <Group justify="flex-end" mt="lg"><Button onClick={onDone}>Close</Button></Group>
      </>
    );
  }

  return (
    <>
      <Text size="sm" c="dimmed">
        {morning
          ? 'Closing a session records its total and starts the task at 0:00 today. Untick any you want to carry on into today.'
          : 'Here are your open sessions. Enter the totals on the platform, then close them so each task starts at 0:00 tomorrow.'}
      </Text>

      <Paper withBorder mt="md">
        {list.map((x, i) => {
          const t = task(s, x.taskId)!;
          const notes = sessionNotes(s, x);
          return (
            <Stack key={x.id} gap={4} p="sm" style={i ? { borderTop: '1px solid var(--mantine-color-default-border)' } : undefined}>
              <Group gap="sm" wrap="nowrap" align="flex-start">
                <Checkbox mt={4} checked={selected.has(x.id)} onChange={(e) => toggle(x.id, e.currentTarget.checked)} aria-label={`Close ${t.name}`} />
                <div style={{ flex: 1, minWidth: 0 }} onClick={() => toggle(x.id, !selected.has(x.id))}>
                  <Text size="sm" c="dimmed" truncate>{project(s, t.projectId)?.name}</Text>
                  <Text fw={600} style={{ overflowWrap: 'anywhere' }}>{t.name}</Text>
                  <Text size="xs" c="dimmed">
                    opened <Live>{(now) => whenLabel(x.openedAt, now)}</Live>{runningSess === x && <> · <b>timer running</b></>}
                  </Text>
                </div>
                <Text fz="lg" fw={700} className="num"><Live>{(now) => hm(sessionMs(s, x, now))}</Live></Text>
                <Tooltip label="Copy notes">
                  <ActionIcon variant="subtle" color="gray" disabled={!notes} onClick={() => copyText(notes)} aria-label="Copy notes">
                    <IconCopy size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
              {notes && <Text size="sm" c="dimmed" className="pre-wrap" pl={34}>{notes}</Text>}
            </Stack>
          );
        })}
      </Paper>

      {runningSelected && s.running && (morning ? (
        <Alert color="orange" mt="md">
          The timer on <b>{task(s, s.running.taskId)?.name}</b> has been running since {whenLabel(s.running.start, serverNow())}. When did you actually stop?
          <TextInput mt="xs" type="datetime-local" w={240} value={runningEnd}
            min={`${dayKey(s.running.start)}T${timeKey(s.running.start)}`} onChange={(e) => setRunningEnd(e.currentTarget.value)} />
        </Alert>
      ) : (
        <Alert color="orange" mt="md">
          The timer on <b>{task(s, s.running.taskId)?.name}</b> is still running.{' '}
          <Button size="compact-sm" variant="white" color="orange" onClick={() => run(() => api.stop.$post())}>Stop it now</Button>{' '}
          (you'll be asked for notes), or untick it.
        </Alert>
      ))}

      <Group mt="lg" gap="sm">
        <Text size="sm" c="dimmed" style={{ flex: 1 }}>
          Selected: <b className="num"><Live>{(now) => hm(chosen.reduce((a, x) => a + sessionMs(s, x, now), 0))}</Live></b>
        </Text>
        <Button variant="default" onClick={onCancel}>{morning ? 'Keep all open' : 'Cancel'}</Button>
        <Button disabled={!chosen.length} onClick={submit}>Close {chosen.length} session{chosen.length === 1 ? '' : 's'}</Button>
      </Group>
    </>
  );
}
