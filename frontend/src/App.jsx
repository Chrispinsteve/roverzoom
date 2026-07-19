import { useState } from 'react';
import DriverEntry from './components/DriverEntry';
import KioskApp from './kiosk/KioskApp';
import DriverApp from './driver/DriverApp';

export default function App() {
  // Returning from Stripe Connect onboarding lands on `…/?driver=payouts` —
  // open driver mode straight away so the driver sees their updated payout
  // status instead of the rider home.
  const [mode, setMode] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).has('driver') ? 'driver' : 'rider';
    } catch {
      return 'rider';
    }
  }); // 'rider' | 'driver'

  if (mode === 'driver') {
    return <DriverApp onExit={() => setMode('rider')} />;
  }

  return (
    <>
      <KioskApp />
      <DriverEntry onSelectDriverMode={() => setMode('driver')} />
    </>
  );
}
