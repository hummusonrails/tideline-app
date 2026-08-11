/**
 * Turning the lights down.
 *
 * The app's background is painted on `html`, `body` *and* `#root` (see
 * index.css), and `#root` is a 430px column centred on the page. A dark panel
 * inside that column therefore leaves a pale sage gutter either side of it on
 * anything wider than a phone, and a fixed backdrop *inside* `#root` can't fix
 * it — `#root` isn't a stacking context, so a negative z-index child paints
 * behind its own parent's background.
 *
 * The reliable answer is to change the thing that's actually painting: put a
 * class on the document element while an arcade screen is mounted, and take it
 * off on the way out. One class, no layout, no z-index arithmetic.
 */

import { useEffect } from 'react';

const ROOM_CLASS = 'arcade-room';

export function useArcadeRoom(): void {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add(ROOM_CLASS);
    return () => root.classList.remove(ROOM_CLASS);
  }, []);
}
