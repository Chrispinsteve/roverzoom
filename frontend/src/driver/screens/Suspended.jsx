import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';

export default function Suspended({ onLogout }) {
  return (
    <DriverShell rightSlot={
      <button className="drv-icon-btn" aria-label="Log out" onClick={onLogout}>
        <Icon name="power" size={17} color="var(--ink)" />
      </button>
    }>
      <div className="body">
        <div style={{ textAlign: 'center', marginTop: 40 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%', background: 'rgba(239,68,68,0.12)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16,
          }}>
            <Icon name="shieldCheck" size={28} color="var(--danger)" />
          </div>
          <h1 className="title" style={{ fontSize: 24 }}>Account suspended</h1>
          <p className="subtitle">
            Your driver account has been suspended. Contact support if you believe this is a mistake.
          </p>
          <p style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 4 }}>support@roverzoom.com</p>
        </div>
      </div>
    </DriverShell>
  );
}
