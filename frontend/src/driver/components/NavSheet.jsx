import { useEffect, useRef, useState } from 'react';
import { usePrefersReducedMotion } from '../../lib/useAnimatedPosition';

// ============================================================
// NavSheet — the bottom card's grip and its motion
// ============================================================
// Two problems with the toggle this replaces.
//
// It SNAPPED. The content was mounted and unmounted, so the card's height
// changed in one frame and the map jumped with it. On a screen a driver is
// glancing at, a layout that teleports costs a moment of re-orientation every
// time it moves.
//
// And it was TAP-ONLY, on a 36px bar. A driver reaching for it one-handed in a
// moving car has poor aim, so the gesture they will actually make — a shove up
// or down — did nothing at all.
//
// Now the content stays mounted and its height is animated, and the sheet
// answers a swipe in either direction as well as a tap. The whole grip row is
// the target, not just the bar drawn inside it.
export default function NavSheet({ expanded, onToggle, label, header, children }) {
  const reduced = usePrefersReducedMotion();
  const contentRef = useRef(null);
  const dragFrom = useRef(null);
  const [contentH, setContentH] = useState(0);

  // Measured rather than a fixed max-height guess: a card with a two-line
  // address is taller than one with a single line, and a guess either clips the
  // content or leaves the animation easing through empty space.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return undefined;
    const measure = () => setContentH(el.scrollHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  const down = (e) => { dragFrom.current = e.clientY ?? e.touches?.[0]?.clientY ?? null; };
  const up = (e) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from == null) return;
    const to = e.clientY ?? e.changedTouches?.[0]?.clientY ?? from;
    const dy = to - from;
    // A short movement is a tap with an unsteady hand, not a swipe.
    if (Math.abs(dy) < 10) onToggle(!expanded);
    else if (dy < 0) onToggle(true);
    else onToggle(false);
  };

  return (
    <>
      <div
        className="drv-nav-expand"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-label={label}
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={() => { dragFrom.current = null; }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(!expanded); } }}
      >
        <span className="drv-nav-grip" />
      </div>
      {/* Always visible, and part of the grip's reach: the driver can start the
          drag anywhere on the card's top block, not just on the bar. */}
      {header}
      <div
        className="drv-nav-sheet"
        style={{
          maxHeight: expanded ? contentH : 0,
          // Honour reduce-motion: the sheet still opens, it just does not
          // animate. Sustained sliding motion is exactly what triggers
          // discomfort for people with vestibular disorders.
          transition: reduced ? 'none' : undefined,
        }}
        aria-hidden={!expanded}
      >
        <div ref={contentRef}>{children}</div>
      </div>
    </>
  );
}
