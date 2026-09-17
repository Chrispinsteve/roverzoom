import { useEffect, useRef } from 'react';

// ============================================================
// useBackGesture — make the device Back button mean something
// ============================================================
// The driver app is a single page with no router, so the browser knew about
// exactly one history entry: the app itself. Opening a ride's details changed
// React state and nothing else. Pressing Back — or swiping from the left edge
// on iOS, which is how most people navigate a phone — did not go back a screen,
// it LEFT THE APP. The only way out was to refresh, which a driver should never
// have to do mid-shift.
//
// Each "deeper" screen gets one history entry. Back pops it and runs the same
// close handler the on-screen arrow uses, so the two can never drift apart.
//
// Deliberately NOT a router: the URL is already doing real work here (?driver=1
// for driver mode, ?series= and ?track= for token links, ?confirmed=1 after
// email). A state-only entry leaves all of that untouched.

// Screens nest — a driver on the Requests tab can open a ride, so two hooks are
// live at once. Without a shared stack BOTH would answer a single popstate, and
// closing the ride with the arrow would also throw them back to the home tab.
// Only the topmost screen responds; the one underneath stays put.
const stack = [];

// Set while we unwind our own entry on close, so the popstate that causes does
// not get read as the driver pressing Back.
let selfPop = false;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (selfPop) { selfPop = false; return; }
    const top = stack.pop();
    if (top) top.current?.();
  });
}

export default function useBackGesture(active, onBack) {
  // In a ref so the effect depends only on `active`. Otherwise every parent
  // re-render would make a new handler and push a second entry for a screen
  // that is already open.
  const handler = useRef(onBack);
  handler.current = onBack;

  useEffect(() => {
    if (!active) return undefined;

    const entry = handler;
    stack.push(entry);
    window.history.pushState({ rzBack: true }, '');

    return () => {
      const i = stack.lastIndexOf(entry);
      // Still on the stack means this screen was closed from inside the app,
      // not by Back. Remove our entry, or the driver's next Back press lands on
      // a screen they have already left.
      if (i !== -1) {
        stack.splice(i, 1);
        selfPop = true;
        window.history.back();
      }
    };
  }, [active]);
}
