import { useCallback, useEffect, useRef, useState } from 'react';
import { driverApi } from '../lib/driverApi';

// ============================================================
// useDriverLocation — GPS capture and upload for an active trip
// ============================================================
// Samples the device's position while a trip is live and ships it to the
// API in batches.
//
// The whole design is shaped by one fact: this runs on a phone, in a
// car, for hours, through parking garages and highway underpasses, in a
// browser tab the operating system is free to suspend at any moment. The
// naive version — watchPosition, POST each fix — fails badly in exactly
// the conditions it most needs to work.
//
// So:
//   * Fixes are BUFFERED and uploaded on an interval, not per fix. Fewer
//     requests, far less battery, and a driver in a dead zone
//     accumulates their route instead of losing it.
//   * A failed upload keeps its batch and retries with the next one, so
//     a dropped connection costs nothing.
//   * The buffer is CAPPED. An hour with no signal must not grow an
//     unbounded array until the tab is killed.
//   * The buffer is flushed on page hide, because a backgrounded or
//     closed tab may never get another interval tick.
// ============================================================

// Sample rate. Every 5s at city speeds is roughly a fix every 40-60 m,
// which is enough to draw a smooth path without oversampling a car
// sitting at a red light.
const SAMPLE_INTERVAL_MS = 5000;

// Upload rate. Batching four-ish fixes per request cuts request volume
// ~4x versus per-fix posting, while keeping the rider's view no more
// than one upload cycle behind.
const UPLOAD_INTERVAL_MS = 20000;

// ~40 minutes of buffered samples. Past this, the oldest are dropped:
// recent positions matter far more than a stale backlog, and the trail
// is a supporting record rather than the live view.
const MAX_BUFFER = 500;

const GEO_OPTIONS = {
  enableHighAccuracy: true,   // GPS chip, not wifi triangulation — non-negotiable for navigation
  maximumAge: 3000,           // a fix up to 3s old is fine, and cheaper than forcing a new one
  timeout: 15000,
};

const MS_PER_SEC_TO_MPH = 2.236936;

/**
 * @param {object} params
 * @param {string|null} params.bookingId  trip to attribute fixes to
 * @param {boolean} params.active         capture only while true
 */
export function useDriverLocation({ bookingId = null, active = false } = {}) {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState(null);
  const [permission, setPermission] = useState('unknown'); // unknown | granted | denied | unavailable

  const bufferRef = useRef([]);
  const watchIdRef = useRef(null);
  const uploadTimerRef = useRef(null);
  const lastSampleRef = useRef(0);
  const inFlightRef = useRef(false);
  // bookingId is mirrored into a ref so the upload function can read the
  // current value without being re-created (and re-scheduling its
  // interval) every time the prop changes.
  const bookingIdRef = useRef(bookingId);

  useEffect(() => { bookingIdRef.current = bookingId; }, [bookingId]);

  const flush = useCallback(async () => {
    if (inFlightRef.current) return;              // never overlap uploads
    if (bufferRef.current.length === 0) return;

    // Take the batch out of the buffer, but hold onto it: if the upload
    // fails it goes back. Clearing on send would lose the batch on every
    // transient network error, which on a phone is constant.
    const batch = bufferRef.current;
    bufferRef.current = [];
    inFlightRef.current = true;

    try {
      await driverApi.sendLocation({ bookingId: bookingIdRef.current, pings: batch });
      setError(null);
    } catch (err) {
      // Re-queue at the FRONT so chronological order survives, then
      // re-apply the cap in case the buffer grew while in flight.
      bufferRef.current = [...batch, ...bufferRef.current].slice(-MAX_BUFFER);
      setError(err.message || 'Could not sync location.');
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active) return;

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setPermission('unavailable');
      setError('This device cannot share its location.');
      return;
    }

    const onFix = (pos) => {
      setPermission('granted');
      const { latitude, longitude, heading, speed, accuracy } = pos.coords;

      const ping = {
        lat: latitude,
        lng: longitude,
        // heading and speed are null on most devices when stationary,
        // and on desktop always. The server stores null rather than
        // fabricating a value, and the map falls back to deriving
        // heading from consecutive positions.
        heading: heading != null && !Number.isNaN(heading) ? heading : null,
        speedMph: speed != null && !Number.isNaN(speed) ? speed * MS_PER_SEC_TO_MPH : null,
        accuracy: accuracy ?? null,
        recordedAt: new Date(pos.timestamp).toISOString(),
      };

      // Always update the local view — the driver's own map should track
      // the device at full rate regardless of upload throttling.
      setPosition(ping);

      // Throttle what gets BUFFERED. watchPosition can fire many times a
      // second on a good GPS lock; buffering all of it would flood the
      // API with data far finer than any consumer uses.
      const now = Date.now();
      if (now - lastSampleRef.current < SAMPLE_INTERVAL_MS) return;
      lastSampleRef.current = now;

      bufferRef.current.push(ping);
      if (bufferRef.current.length > MAX_BUFFER) {
        bufferRef.current = bufferRef.current.slice(-MAX_BUFFER);
      }
    };

    const onError = (err) => {
      if (err.code === err.PERMISSION_DENIED) {
        setPermission('denied');
        setError('Location permission is required to run a trip.');
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        // Routine in a garage or tunnel. Not surfaced as a hard error —
        // the buffer keeps filling and flushes when signal returns.
        setError('Searching for GPS signal…');
      } else {
        setError('Location timed out. Retrying…');
      }
    };

    watchIdRef.current = navigator.geolocation.watchPosition(onFix, onError, GEO_OPTIONS);
    uploadTimerRef.current = setInterval(flush, UPLOAD_INTERVAL_MS);

    // A backgrounded tab may never see another interval tick, and on
    // mobile the OS can kill it outright without warning. visibilitychange
    // is the last reliable moment to get buffered fixes out.
    //
    // pagehide rather than beforeunload: iOS Safari does not fire
    // beforeunload reliably, and pagehide also covers the back/forward
    // cache path.
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);

    return () => {
      if (watchIdRef.current != null) navigator.geolocation.clearWatch(watchIdRef.current);
      if (uploadTimerRef.current) clearInterval(uploadTimerRef.current);
      watchIdRef.current = null;
      uploadTimerRef.current = null;
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      // Final flush so ending a trip does not discard the last leg.
      flush();
    };
  }, [active, flush]);

  return {
    position,
    error,
    permission,
    pendingCount: bufferRef.current.length,
    flushNow: flush,
  };
}

// ============================================================
// useWakeLock — keep the screen on during a trip
// ============================================================
// A phone that sleeps mid-trip stops the browser's timers and, on some
// platforms, the geolocation watch with them. The result is a driver who
// looks offline to dispatch and a rider watching a frozen car. Holding a
// wake lock while a trip is live avoids the whole class of problem.
//
// The API is not universally supported and the lock is dropped whenever
// the tab is hidden, so it is re-acquired on visibility change rather
// than assumed to persist. Every failure is non-fatal — this is a
// reliability improvement, not a dependency.
export function useWakeLock(enabled) {
  const lockRef = useRef(null);

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let cancelled = false;

    const acquire = async () => {
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (cancelled) { lock.release().catch(() => {}); return; }
        lockRef.current = lock;
      } catch {
        // Denied, unsupported, or the tab is not visible. Nothing to do.
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };

    acquire();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      lockRef.current?.release().catch(() => {});
      lockRef.current = null;
    };
  }, [enabled]);
}
