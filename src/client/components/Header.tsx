import { useEffect } from 'react';
import { ActionIcon, Group, SegmentedControl, Text, Title, Tooltip, useMatches } from '@mantine/core';
import { IconClockHour4, IconPlayerStopFilled } from '@tabler/icons-react';
import { api, useAction, useS, serverNow } from '../lib/api.ts';
import { task, taskSessionMs } from '../lib/model.ts';
import { clock } from '../lib/format.ts';
import { Live } from './Live.tsx';
import type { View } from '../App.tsx';

// One fixed-height row at every width, so the header never changes height.
export function Header({ view, onView }: { view: View; onView: (v: View) => void }) {
  const size = useMatches({ base: 'xs', sm: 'sm' });
  return (
    <Group h="100%" px="md" gap="sm" wrap="nowrap" justify="space-between">
      <Group gap="sm" wrap="nowrap">
        <Group gap={6} wrap="nowrap">
          <IconClockHour4 size={24} stroke={2} />
          <Title order={4} visibleFrom="sm" style={{ whiteSpace: 'nowrap' }}>Task Timer</Title>
        </Group>
        <SegmentedControl
          size={size}
          value={view}
          onChange={(v) => onView(v as View)}
          data={[{ value: 'dashboard', label: 'Dashboard' }, { value: 'history', label: 'History' }]}
        />
      </Group>
      <NowPill />
    </Group>
  );
}

function NowPill() {
  const s = useS();
  const run = useAction();
  const running = s.running;
  const t = running && task(s, running.taskId);

  // Show the running clock in the browser tab too.
  useEffect(() => {
    if (!running) {
      document.title = s.pending ? '📝 Notes pending · Task Timer' : 'Task Timer';
      return;
    }
    const update = () => { document.title = `${clock(taskSessionMs(s, running.taskId, serverNow()))} · ${t?.name ?? ''}`; };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [s, running, t]);

  if (!running) {
    return <Text size="sm" c="dimmed" visibleFrom="xs" style={{ whiteSpace: 'nowrap' }}>{s.pending ? 'Notes pending…' : 'No timer running'}</Text>;
  }
  return (
    <Group gap={8} wrap="nowrap" miw={0}>
      <span className="live-dot" />
      <Text size="sm" truncate visibleFrom="md" maw={220}>{t?.name}</Text>
      <Text fw={700} c="green" className="num">
        <Live>{(now) => clock(taskSessionMs(s, running.taskId, now))}</Live>
      </Text>
      <Tooltip label="Stop">
        <ActionIcon variant="light" color="red" aria-label="Stop" onClick={() => run(() => api.stop.$post())}>
          <IconPlayerStopFilled size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
