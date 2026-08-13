import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { driverApi } from '../lib/driverApi';

// Resolves "who is the current driver" from the live Supabase Auth session —
// the direct client-side query below relies on the drivers_select_own RLS
// policy (auth_user_id = auth.uid()), so no backend endpoint is needed just
// to answer "who am I". Every driver screen should read this instead of
// touching supabase.auth directly.
export function useDriverAuth() {
  const [state, setState] = useState({ loading: true, session: null, driver: null, error: null });
  // Track which users we've already tried to self-heal, so a genuine failure
  // can't loop us calling ensure-profile on every auth event.
  const healedRef = useRef(new Set());

  useEffect(() => {
    let active = true;

    async function loadDriver(session) {
      if (!session) {
        if (active) setState({ loading: false, session: null, driver: null, error: null });
        return;
      }
      let { data, error } = await supabase
        .from('drivers')
        .select('*')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();

      // Authenticated, no error, but no profile row — the signup trigger never
      // created one. Try once to build it from this account's own signup data,
      // then use whatever comes back. Turns the old "no driver profile, contact
      // support" dead-end into a silent repair.
      if (!error && !data && !healedRef.current.has(session.user.id)) {
        healedRef.current.add(session.user.id);
        try {
          const res = await driverApi.ensureProfile();
          if (res?.driver) data = res.driver;
        } catch (e) {
          if (!active) return;
          setState({ loading: false, session, driver: null, error: e.message || null });
          return;
        }
      }

      if (!active) return;
      setState({ loading: false, session, driver: data || null, error: error?.message || null });
    }

    supabase.auth.getSession().then(({ data }) => loadDriver(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => loadDriver(session));

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
