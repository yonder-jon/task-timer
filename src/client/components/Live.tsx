import type { ReactNode } from 'react';
import { useNow } from '../lib/api.ts';

/**
 * Re-renders just its own contents every second, so ticking clocks don't re-render
 * (or disturb) the rest of the page.
 *
 *   <Live>{(now) => clock(now - start)}</Live>
 */
export function Live({ children }: { children: (now: number) => ReactNode }) {
  const now = useNow();
  return <>{children(now)}</>;
}
