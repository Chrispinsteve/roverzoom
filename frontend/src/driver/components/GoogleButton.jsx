import { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';

// Sign in with Google.
//
// redirectTo carries ?driver=1 because App.jsx only opens driver mode when it
// is present — without it a driver completes the Google round trip and lands on
// the RIDER booking kiosk, with no sign anything worked.
export default function GoogleButton({ label = 'Continue with Google' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = async () => {
    setBusy(true); setError('');
    const { error: err } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/?driver=1` },
    });
    // On success the browser navigates away, so reaching here means it failed —
    // most often because the provider is not enabled on the Supabase project.
    if (err) {
      setError(/provider|not enabled/i.test(err.message)
        ? 'Google sign-in is not switched on yet. Use email and password for now.'
        : err.message);
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn btn-ghost drv-google" onClick={go} disabled={busy}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.3z" />
          <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.2l-7.1-5.5c-2 1.3-4.5 2.1-7.5 2.1-5.8 0-10.7-3.9-12.4-9.900h-7.3v5.7C8 40.3 15.4 46 24 46z" />
          <path fill="#FBBC05" d="M11.6 27.5c-.4-1.3-.7-2.7-.7-4.1s.3-2.8.7-4.1v-5.7H4.3C2.8 16.6 2 20.2 2 23.4s.8 6.8 2.3 9.8l7.3-5.7z" />
          <path fill="#EA4335" d="M24 10.8c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 4.2 30 2 24 2 15.4 2 8 7.7 4.3 13.6l7.3 5.7c1.7-6 6.6-9.9 12.4-9.9z" />
        </svg>
        {busy ? 'Opening Google…' : label}
      </button>
      {error && <p className="error-text center" style={{ marginTop: 10 }}>{error}</p>}
    </>
  );
}
