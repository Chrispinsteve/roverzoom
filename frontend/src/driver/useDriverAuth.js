import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Resolves "who is the current driver" from the live Supabase Auth session —
// the direct client-side query below relies on the drivers_select_own RLS
// policy (auth_user_id = auth.uid()), so no backend endpoint is needed just
// to answer "who am I". Every driver screen should read this instead of
// touching supabase.auth directly.
export function useDriverAuth() {
  const [state, setState] = useState({ loading: true, session: null, driver: null, error: null });

  useEffect(() => {
    let active = true;

    async function loadDriver(session) {
      if (!session) {
        if (active) setState({ loading: false, session: null, driver: null, error: null });
        return;
      }
      const { data, error } = await supabase
        .from('drivers')
        .select('*')
        .eq('auth_user_id', session.user.id)
        .maybeSingle();
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
