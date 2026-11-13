// SPDX-License-Identifier: BSD-2-Clause
// Copyright (c) 2026 Jon Gill

import { useEffect, useRef, useState } from 'react';
import { AppShell, Center, Container, Loader, Text } from '@mantine/core';
import { useAppState, serverNow } from './lib/api.ts';
import { needsDayCheck } from './lib/model.ts';
import { Header } from './components/Header.tsx';
import { Dashboard } from './components/Dashboard.tsx';
import { History } from './components/History.tsx';
import { NotesModal } from './components/NotesModal.tsx';
import { AddTimeModal } from './components/AddTimeModal.tsx';
import { CloseSessionsModal } from './components/CloseSessionsModal.tsx';
import type { CloseMode } from './components/CloseSessionsModal.tsx';

export type View = 'dashboard' | 'history';

export function App() {
  const { data: s, error } = useAppState();
  const [view, setView] = useState<View>('dashboard');
  const [addTimeFor, setAddTimeFor] = useState<string | null>(null);
  const [closeMode, setCloseMode] = useState<CloseMode | null>(null);

  useDayCheck(!!s, () => !addTimeFor && !closeMode && !!s && needsDayCheck(s, serverNow()), () => setCloseMode('morning'));

  if (!s) {
    return (
      <Center h="100dvh">
        {error ? <Text c="red">Can’t reach the server.</Text> : <Loader />}
      </Center>
    );
  }

  return (
    <AppShell header={{ height: 56 }} padding="md">
      <AppShell.Header>
        <Header view={view} onView={setView} />
      </AppShell.Header>
      <AppShell.Main>
        <Container size="xl" px={0}>
          {view === 'dashboard'
            ? <Dashboard onAddTime={setAddTimeFor} onEndDay={() => setCloseMode('endday')} />
            : <History />}
        </Container>
      </AppShell.Main>

      <AddTimeModal taskId={addTimeFor} onClose={() => setAddTimeFor(null)} />
      <CloseSessionsModal mode={closeMode} onClose={() => setCloseMode(null)} />
      <NotesModal />
    </AppShell>
  );
}

/**
 * The next-day prompt: on load, on returning to the tab, and on the first click or keypress
 * of a new day. Runs in the capture phase so the click that triggers it doesn't also act on the page.
 */
function useDayCheck(ready: boolean, shouldOpen: () => boolean, open: () => void) {
  const latest = useRef({ shouldOpen, open });
  latest.current = { shouldOpen, open };

  useEffect(() => {
    if (!ready) return;
    const check = (e?: Event) => {
      if (!latest.current.shouldOpen()) return;
      e?.stopPropagation();
      e?.preventDefault();
      latest.current.open();
    };
    const onVisible = () => { if (!document.hidden) check(); };
    check();
    document.addEventListener('click', check, true);
    document.addEventListener('keydown', check, true);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('click', check, true);
      document.removeEventListener('keydown', check, true);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [ready]);
}
