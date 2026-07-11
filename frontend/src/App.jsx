import { useEffect, useState } from 'react';
import Shell from './components/Shell';
import DriverEntry from './components/DriverEntry';
import Landing from './steps/Landing';
import FormFlow from './steps/FormFlow';
import AIFlow from './steps/AIFlow';
import VoiceFlow from './steps/VoiceFlow';
import AICheckout from './steps/AICheckout';
import Confirmation from './steps/Confirmation';
import DriverApp from './driver/DriverApp';
import { api } from './lib/api';

export default function App() {
  const [screen, setScreen] = useState('landing');
  const [mode, setMode] = useState('rider'); // 'rider' | 'driver'
  const [aiEnabled, setAiEnabled] = useState(false);
  const [draft, setDraft] = useState(null);
  const [booking, setBooking] = useState(null);
  // Addresses set on the landing page, passed to the form flow
  const [initPickup, setInitPickup] = useState(null);
  const [initDropoff, setInitDropoff] = useState(null);

  useEffect(() => {
    api.aiStatus().then((s) => setAiEnabled(!!s.configured)).catch(() => setAiEnabled(false));
  }, []);

  const reset = () => {
    setScreen('landing');
    setDraft(null);
    setBooking(null);
    setInitPickup(null);
    setInitDropoff(null);
  };

  if (mode === 'driver') {
    return <DriverApp onExit={() => setMode('rider')} />;
  }

  let content = null;

  if (screen === 'landing') {
    content = (
      <Shell step={0} totalSteps={0}>
        <Landing
          aiEnabled={aiEnabled}
          onContinue={(p, d) => {
            setInitPickup(p);
            setInitDropoff(d);
            setScreen('form');
          }}
          onTalkToBob={() => setScreen('voice')}
        />
      </Shell>
    );
  } else if (screen === 'form') {
    content = (
      <FormFlow
        initialPickup={initPickup}
        initialDropoff={initDropoff}
        onBack={reset}
        onComplete={(b) => { setBooking(b); setScreen('done'); }}
      />
    );
  } else if (screen === 'voice') {
    content = (
      <VoiceFlow
        onBack={reset}
        onSwitchToText={() => setScreen('ai')}
        onBookingComplete={(b) => { setBooking(b); setScreen('done'); }}
      />
    );
  } else if (screen === 'ai') {
    content = <AIFlow onBack={reset} onBookingComplete={(b) => { setBooking(b); setScreen('done'); }} />;
  } else if (screen === 'aiCheckout') {
    content = <AICheckout draft={draft} onBack={() => setScreen('ai')} onComplete={(b) => { setBooking(b); setScreen('done'); }} />;
  } else if (screen === 'done') {
    content = <Confirmation booking={booking} onNewBooking={reset} />;
  }

  return (
    <>
      {content}
      <DriverEntry onSelectDriverMode={() => setMode('driver')} />
    </>
  );
}
