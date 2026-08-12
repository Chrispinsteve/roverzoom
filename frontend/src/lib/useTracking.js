import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

// ============================================================
// useTracking — polls the public tracking endpoint
// ============================================================
// WHY POLLING RATHER THAN SUPABASE REALTIME
//
// Realtime would be the obvious choice, and it is the wrong one here.
// Realtime's postgres_changes authorises subscriptions through RLS,
// which evaluates auth.uid(). RoverZoom riders have no Supabase Auth
// session at all — bookings are anonymous, identified by a reference and
// a phone number. There is no uid to write a policy against.
//
// The only way to make Realtime work for an anonymous rider would be an
// RLS policy permissive enough for a rider with no identity to read a
// driver's live position — and any policy loose enough to allow that is
// loose enough to let anyone stream every driver's position. That is not
// a trade worth making to save a polling loop.
//
// So the rider polls a service-role endpoint that authorises on
// possession of a 128-bit token and returns a narrow, PII-free
// projection. At a 5-second cadence during an active trip, combined with
// client-side interpolation between fixes (useAnimatedPosition), this is
// indistinguishable from a socket to the person watching.
//
// If this ever needs to scale past what polling comfortably handles, the
// upgrade path is Realtime BROADCAST on a per-booking channel with a
// server-signed token — not postgres_changes.
// ============================================================

// Backoff ceiling after repeated failures. Prevents a tracking page left
// open on a locked phone from hammering a struggling API forever.
const MAX_BACKOFF_MS = 60000;

export function useTracking(token) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const timerRef = useRef(null);
  const failuresRef = useRef(0);
  const stoppedRef = useRef(false);

  const poll = useCallback(async () => {
    if (!token || stoppedRef.current) return;

    try {
      const next = await api.track(token);
      setData(next);
      setError(null);
      failuresRef.current = 0;

      // A finished trip has nothing left to poll for. Stopping matters:
      // riders leave this tab open for hours after arriving, and a
      // forgotten 5-second loop is a slow leak on both the phone's
      // battery and the API's request budget.
      if (['completed', 'canceled'].includes(next.status)) {
        stoppedRef.current = true;
        return;
      }

      // Cadence comes from the server, so it can be tuned without a
      // frontend deploy: 5s while a car is moving, 30s while the booking
      // is merely scheduled.
      timerRef.current = setTimeout(poll, next.pollIntervalMs || 10000);
    } catch (err) {
      // 404 (bad token) and 410 (expired) are terminal — retrying cannot
      // fix either, and continuing would just generate noise. A 403
      // device_locked is terminal too: this device is not the bound one,
      // and only the phone-number recovery flow can change that, so stop
      // and let the UI offer it rather than re-polling into the same wall.
      if (err.status === 404 || err.status === 410 || err.code === 'device_locked') {
        stoppedRef.current = true;
        setError(err);
        return;
      }

      failuresRef.current += 1;
      setError(err);
      const backoff = Math.min(2000 * 2 ** (failuresRef.current - 1), MAX_BACKOFF_MS);
      timerRef.current = setTimeout(poll, backoff);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Resume polling after a terminal stop that has since been resolved —
  // specifically a device lock cleared by phone-number recovery.
  const retry = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    stoppedRef.current = false;
    failuresRef.current = 0;
    setError(null);
    setLoading(true);
    poll();
  }, [poll]);

  useEffect(() => {
    stoppedRef.current = false;
    failuresRef.current = 0;
    setLoading(true);
    poll();

    // Pause while the tab is hidden and resume immediately on return.
    // Two reasons: no point polling a page nobody is looking at, and
    // coming back to a stale car and then watching it catch up is worse
    // than a single immediate refresh.
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !stoppedRef.current) {
        if (timerRef.current) clearTimeout(timerRef.current);
        poll();
      } else if (document.visibilityState === 'hidden') {
        if (timerRef.current) clearTimeout(timerRef.current);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stoppedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [poll]);

  return { data, error, loading, retry };
}
