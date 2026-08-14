import { useEffect, useRef, useState } from 'react';

// ============================================================
// useAnimatedPosition — turns discrete GPS fixes into smooth motion
// ============================================================
// This hook is the difference between a tracking map that reads as live
// and one that reads as broken.
//
// The raw data arrives in steps: the rider's tracking screen polls every
// 5 seconds, the driver's own GPS fires every few seconds. Bound a map
// marker straight to that and the car sits perfectly still for five
// seconds, teleports fifty metres, then freezes again. Users do not read
// that as "the data updates every 5s" — they read it as the app being
// broken, or the driver having stopped.
//
// So the marker is animated toward each new fix over roughly the
// interval until the next one is expected. The car is then always
// slightly behind reality (by design, up to one interval) but always
// moving, which is both more truthful about the underlying uncertainty
// and vastly more legible. Every serious ride app does this.
//
// Two details that are easy to get wrong:
//
//   1. Heading interpolation must take the SHORT way round the circle.
//      Naive lerp from 350° to 10° spins the car 340° backwards through
//      a full rotation instead of 20° forwards through north.
//
//   2. Large jumps must SNAP, not animate. A GPS fix that moves the car
//      two kilometres is a signal recovery or a bad fix, not driving.
//      Sliding smoothly across two kilometres of map looks absurd and
//      takes seconds to settle; jumping is honest about what happened.
// ============================================================

// Beyond this, treat the change as a correction rather than movement.
// ~0.009 degrees of latitude is roughly 1 km — well past what a car
// covers between fixes at any legal speed, but loose enough not to trip
// on a fast highway stretch.
const SNAP_THRESHOLD_DEG = 0.009;

// Below this, do not bother animating. Stationary GPS drifts by a few
// metres constantly; animating that makes a parked car look like it is
// creeping down the street forever.
const IDLE_THRESHOLD_DEG = 0.00002; // ~2 m

function shortestAngleDelta(from, to) {
  // Normalise the difference into (-180, 180] so the rotation always
  // takes the shorter arc.
  let delta = (to - from) % 360;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

// Bearing between two points, used when the device does not report a
// heading. Phones commonly return null for heading when stationary or
// when the compass is unavailable, and a car icon pointing permanently
// north on a westbound road is worse than no icon at all.
function bearingBetween(a, b) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Ease-out rather than linear. A car that decelerates into each new fix
// reads as a vehicle settling at a position; constant-velocity motion
// that stops dead reads as a mechanical animation.
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/**
 * @param {{lat:number,lng:number,heading?:number|null}|null} target
 * @param {{durationMs?:number, enabled?:boolean}} options
 * @returns {{lat:number,lng:number,heading:number}|null}
 */
export function useAnimatedPosition(target, { durationMs = 5000, enabled = true } = {}) {
  const [rendered, setRendered] = useState(target);

  // The animation runs entirely through refs and a single rAF loop.
  // Keeping the in-flight state out of React state is deliberate: this
  // updates ~60 times a second, and putting each frame through a setState
  // on a parent would re-render the whole map subtree 60x/s. Only the
  // final `rendered` value is state, and this hook is meant to be called
  // inside a small leaf component so those re-renders stay contained.
  const fromRef = useRef(target);
  const toRef = useRef(target);
  const startRef = useRef(0);
  const rafRef = useRef(null);
  const currentRef = useRef(target);

  useEffect(() => {
    if (!target || target.lat == null) return;

    // First fix ever — place the marker, do not animate it in from
    // nowhere.
    if (!currentRef.current) {
      const initial = { ...target, heading: target.heading ?? 0 };
      currentRef.current = initial;
      fromRef.current = initial;
      toRef.current = initial;
      setRendered(initial);
      return;
    }

    const current = currentRef.current;
    const dLat = Math.abs(target.lat - current.lat);
    const dLng = Math.abs(target.lng - current.lng);

    // Ignore GPS jitter while stationary.
    if (dLat < IDLE_THRESHOLD_DEG && dLng < IDLE_THRESHOLD_DEG) {
      // Heading can still legitimately change while parked (the driver
      // turning the car around), so let that through.
      if (target.heading != null && Math.abs(shortestAngleDelta(current.heading, target.heading)) > 5) {
        fromRef.current = current;
        toRef.current = { ...current, heading: target.heading };
        startRef.current = performance.now();
      } else {
        return;
      }
    } else if (!enabled || dLat > SNAP_THRESHOLD_DEG || dLng > SNAP_THRESHOLD_DEG) {
      // Snap: implausible jump, or animation disabled (reduced motion).
      const snapped = {
        ...target,
        heading: target.heading ?? bearingBetween(current, target),
      };
      currentRef.current = snapped;
      fromRef.current = snapped;
      toRef.current = snapped;
      setRendered(snapped);
      return;
    } else {
      // Normal case: animate from wherever the marker currently is —
      // not from the previous target. If a new fix arrives mid-animation
      // the car continues from its on-screen position rather than
      // jerking back to catch up.
      fromRef.current = { ...current };
      toRef.current = {
        ...target,
        heading: target.heading ?? bearingBetween(current, target),
      };
      startRef.current = performance.now();
    }

    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const tick = (now) => {
      const elapsed = now - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const eased = easeOut(t);

      const from = fromRef.current;
      const to = toRef.current;

      const next = {
        lat: from.lat + (to.lat - from.lat) * eased,
        lng: from.lng + (to.lng - from.lng) * eased,
        heading: (from.heading + shortestAngleDelta(from.heading, to.heading) * eased + 360) % 360,
      };

      currentRef.current = next;
      setRendered(next);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // target is compared by value below rather than by reference, since
    // each poll produces a fresh object even when the position is
    // unchanged — depending on the object itself would restart the
    // animation on every poll regardless of whether the car moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.lat, target?.lng, target?.heading, durationMs, enabled]);

  return rendered;
}

/**
 * Respects the OS "reduce motion" accessibility setting.
 *
 * Worth honouring here specifically: a marker gliding continuously
 * across a map is exactly the kind of sustained motion that triggers
 * discomfort for people with vestibular disorders. With this on, the
 * position still updates — it just jumps rather than slides, so no
 * information is lost.
 */
export function usePrefersReducedMotion() {
  const [prefers, setPrefers] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefers(mq.matches);
    const handler = (e) => setPrefers(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return prefers;
}
