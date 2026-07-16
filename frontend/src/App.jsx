import { useState } from 'react';
import DriverEntry from './components/DriverEntry';
import KioskApp from './kiosk/KioskApp';
import DriverApp from './driver/DriverApp';

export default function App() {
  const [mode, setMode] = useState('rider'); // 'rider' | 'driver'

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
