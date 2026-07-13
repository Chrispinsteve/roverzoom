import { useState } from 'react';
import DriverShell from '../DriverShell';
import { supabase } from '../../lib/supabaseClient';

export default function Login({ onSwitchToSignup }) {
  const [mode, setMode] = useState('login'); // 'login' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const submitLogin = async () => {
    if (!email.trim() || !password || submitting) return;
    setSubmitting(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(error.message);
    setSubmitting(false);
    // On success, useDriverAuth's onAuthStateChange picks up the new session
    // automatically — no explicit navigation needed here.
  };

  const submitReset = async () => {
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    setSubmitting(false);
    if (error) { setError(error.message); return; }
    setResetSent(true);
  };

  if (mode === 'reset') {
    return (
      <DriverShell>
        <div className="body">
          <h1 className="title" style={{ fontSize: 26 }}>Reset password</h1>
          <p className="subtitle">Enter your email and we’ll send you a reset link.</p>

          {resetSent ? (
            <p className="muted" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
              If an account exists for <strong style={{ color: 'var(--ink)' }}>{email.trim()}</strong>, a reset link is on its way.
            </p>
          ) : (
            <>
              <div className="field">
                <label className="label">Email</label>
                <input
                  className="input" type="email" autoComplete="email" placeholder="you@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitReset(); }}
                />
              </div>
              {error && <p className="error-text">{error}</p>}
              <button className="btn" disabled={!email.trim() || submitting} onClick={submitReset} style={{ marginTop: 8 }}>
                {submitting ? 'Sending…' : 'Send reset link'}
              </button>
            </>
          )}

          <button
            className="center"
            onClick={() => { setMode('login'); setError(''); setResetSent(false); }}
            style={{ marginTop: 18, color: 'var(--ink-2)', fontSize: 13.5, width: '100%' }}
          >
            Back to log in
          </button>
        </div>
      </DriverShell>
    );
  }

  return (
    <DriverShell>
      <div className="body">
        <h1 className="title">Driver Log In</h1>
        <p className="subtitle">Log in to go online and manage your trips.</p>

        <div className="field">
          <label className="label">Email</label>
          <input
            className="input" type="email" autoComplete="email" placeholder="you@example.com"
            value={email} onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label">Password</label>
          <input
            className="input" type="password" autoComplete="current-password" placeholder="••••••••"
            value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submitLogin(); }}
          />
        </div>

        {error && <p className="error-text">{error}</p>}

        <button className="btn" disabled={!email.trim() || !password || submitting} onClick={submitLogin} style={{ marginTop: 8 }}>
          {submitting ? 'Logging in…' : 'Log In'}
        </button>

        <div className="center" style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={() => setMode('reset')} style={{ color: 'var(--ink-2)', fontSize: 13.5 }}>
            Forgot password?
          </button>
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            Don’t have an account?{' '}
            <button onClick={onSwitchToSignup} style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: 'underline' }}>
              Sign up
            </button>
          </p>
        </div>
      </div>
    </DriverShell>
  );
}
