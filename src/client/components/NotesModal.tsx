// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

// The notes pop-up shown whenever a running timer stops (driven by state.pending).
import { useEffect, useRef, useState } from 'react';
import { Button, Group, Modal, Text, Textarea } from '@mantine/core';
import { useDebouncedCallback, useMediaQuery } from '@mantine/hooks';
import type { Pending } from '../../shared/types.ts';
import { api, useAction, useNow, useRefresh, useS } from '../lib/api.ts';
import { project, task, whenLabel } from '../lib/model.ts';
import { clock, fmtTime } from '../lib/format.ts';

const TITLES: Record<Pending['action'], string> = {
  stop: 'Stint stopped',
  finishTask: 'Ending task',
  finishProject: 'Ending project',
  closeSession: 'Closing session',
};

export function NotesModal() {
  const s = useS();
  const mobile = useMediaQuery('(max-width: 48em)');
  const p = s.pending;
  const t = p && task(s, p.taskId);
  return (
    <Modal
      opened={!!p}
      onClose={() => {}}
      withCloseButton={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      fullScreen={mobile}
      size="lg"
      zIndex={300}
      title={p && <Text fw={700} size="lg">{TITLES[p.action]}: {t?.name}</Text>}
    >
      {/* Keyed so a new stop starts with a fresh form. */}
      {p && <NotesForm key={`${p.taskId}:${p.stoppedAt}`} pending={p} />}
    </Modal>
  );
}

function NotesForm({ pending: p }: { pending: Pending }) {
  const s = useS();
  const run = useAction();
  const refresh = useRefresh();
  const now = useNow();
  const [notes, setNotes] = useState(p.draft);
  const t = task(s, p.taskId);
  const next = p.thenStart ? task(s, p.thenStart) : undefined;

  const saveDraft = useDebouncedCallback((value: string) => { api.pending.draft.$post({ json: { notes: value } }).catch(() => {}); }, 800);
  const resolve = (dismissed: boolean) => {
    saveDraft.cancel?.();
    run(() => api.pending.resolve.$post({ json: { notes, dismissed } }));
  };

  const left = p.stoppedAt + s.notesGraceMs - now;
  // Once the window has passed the server closes it; fetch that result (once).
  const expired = useRef(false);
  useEffect(() => {
    if (left <= 0 && !expired.current) { expired.current = true; refresh(); }
  }, [left, refresh]);

  const countdown = <Text span fw={600} c={left < 120_000 ? 'orange' : undefined} className="num">{clock(left)}</Text>;
  return (
    <>
      <Text size="sm" c="dimmed">
        {project(s, t?.projectId ?? '')?.name} · {whenLabel(p.start, now)} – {fmtTime(p.stoppedAt)} ({clock(p.stoppedAt - p.start)})
        {next && <> · <b>{next.name}</b> starts when you close this</>}
      </Text>
      <Textarea
        mt="md"
        label="What did you do in this stint? (optional)"
        autosize
        minRows={4}
        maxRows={12}
        data-autofocus
        value={notes}
        onChange={(e) => { setNotes(e.currentTarget.value); saveDraft(e.currentTarget.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) resolve(false); }}
      />
      <Text size="sm" c="dimmed" mt="xs">
        {notes.trim()
          ? <>Saving now records the stint up to now (note-writing time counts). This closes in {countdown}, after which it ends at {fmtTime(p.stoppedAt)}.</>
          : <>With no notes the stint ends at {fmtTime(p.stoppedAt)}. This closes automatically in {countdown}.</>}
      </Text>
      <Group justify="flex-end" mt="lg">
        <Button variant="default" onClick={() => resolve(true)}>Skip</Button>
        <Button onClick={() => resolve(false)}>Save notes</Button>
      </Group>
    </>
  );
}
