import { useEffect, useState } from 'react';

/**
 * How many pixels the on-screen keyboard is covering.
 *
 * `position: fixed` is positioned against the layout viewport, which iOS does
 * not shrink when the keyboard appears — so a fixed composer sits underneath
 * the keyboard, hiding the text being typed. The visual viewport does track
 * it, so the gap between the two is exactly how far up the composer needs to
 * move.
 *
 * Returns 0 where `visualViewport` isn't available, which degrades to the
 * previous behaviour rather than breaking layout.
 */
export function useVisualViewportInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // offsetTop matters when the page itself has been scrolled by the
      // keyboard; without it the composer lands too high.
      const covered = window.innerHeight - vv.height - vv.offsetTop;
      setInset(Math.max(0, Math.round(covered)));
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
