import { useCallback, useEffect, useRef, useState } from 'react';
import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import { driverApi } from '../../lib/driverApi';

// Pending drivers land here until they're active. When Checkr background checks
// are configured, this is where the driver runs theirs — a cleared report
// activates the account automatically (via the Checkr webhook). When Checkr
// isn't configured, it falls back to the original "our team is reviewing" copy.
export default function PendingVerification({ onLogout }) {
  const [screening, setScreening] = useState(null); // { configured, status, url } | null = loading
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef(null);

  const load = useCallback(async () => {
    try { setScreening(await driverApi.getScreeningStatus()); }
    catch { setScreening({ configured: false }); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // While a check is pending, poll so a cleared result (which activates the
  // account server-side) surfaces without the driver refreshing manually.
  useEffect(() => {
    if (!screening || !screening.configured || screening.status !== 'pending') return undefined;
    pollRef.current = setInterval(load, 10000);
    return () => clearInterval(pollRef.current);
  }, [screening, load]);

  const start = async () => {
    setBusy(true); setError('');
    try {
      const r = await driverApi.startScreening();
      if (r.url) { window.location.href = r.url; return; } // Checkr-hosted flow
      await load();
    } catch (e) {
      setError(e.message || 'Could not start the background check.');
    } finally {
      setBusy(false);
    }
  };

  const configured = !!(screening && screening.configured);
  const status = screening && screening.status;
  const cleared = configured && status === 'clear';

  let title = 'Application under review';
  let body = 'Thanks for applying. Our team is reviewing your details — we’ll notify you by email once your account is verified.';
  let action = null;

  if (cleared) {
    title = 'You’re verified!';
    body = 'Your background check cleared. Enter to start driving.';
    action = <button className="btn" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>Enter RoverZoom</button>;
  } else if (configured && status === 'consider') {
    title = 'Under review';
    body = 'Your background check needs a closer look. Our team will review it and follow up by email.';
  } else if (configured && status === 'pending') {
    title = 'Background check in progress';
    body = 'Thanks — your check has started. This can take a little while; we’ll activate your account automatically once it clears.';
    if (screening.url) {
      action = <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={() => { window.location.href = screening.url; }}>Finish background check</button>;
    }
  } else if (configured) {
    // not_started
    title = 'One last step: background check';
    body = 'RoverZoom runs a quick background & driving-record check to keep riders safe. It’s handled securely by Checkr — your SSN never touches our servers.';
    action = <button className="btn" style={{ marginTop: 16 }} disabled={busy} onClick={start}>{busy ? 'Opening…' : 'Start background check'}</button>;
  }

  return (
    <DriverShell rightSlot={
      <button className="drv-icon-btn" aria-label="Log out" onClick={onLogout}>
        <Icon name="power" size={17} color="var(--ink)" />
      </button>
    }>
      <div className="body">
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', background: 'var(--canvas-2)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
          }}>
            <Icon name={cleared ? 'shieldCheck' : 'clockCheck'} size={28} color={cleared ? 'var(--positive)' : 'var(--ink-2)'} />
          </div>
          <h1 className="title" style={{ fontSize: 24 }}>{title}</h1>
          <p className="subtitle">{body}</p>
          {action}
          {error && <p className="error-text" style={{ marginTop: 12 }}>{error}</p>}
        </div>
      </div>
    </DriverShell>
  );
}
