import { useEffect, useState } from 'react';
import Shell from './components/Shell';
import Landing from './steps/Landing';
import FormFlow from './steps/FormFlow';
import AIFlow from './steps/AIFlow';
import VoiceFlow from './steps/VoiceFlow';
import AICheckout from './steps/AICheckout';
import Confirmation from './steps/Confirmation';
import { api } from './lib/api';

export default function App() {
  const [screen, setScreen] = useState('landing');
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

  if (screen === 'landing') {
    return (
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
  }

  if (screen === 'form') {
    return (
      <FormFlow
        initialPickup={initPickup}
        initialDropoff={initDropoff}
        onBack={reset}
        onComplete={(b) => { setBooking(b); setScreen('done'); }}
      />
    );
  }

  if (screen === 'voice') {
    return (
      <VoiceFlow
        onBack={reset}
        onSwitchToText={() => setScreen('ai')}
        onBookingComplete={(b) => { setBooking(b); setScreen('done'); }}
      />
    );
  }

  if (screen === 'ai') {
    return <AIFlow onBack={reset} onBookingComplete={(b) => { setBooking(b); setScreen('done'); }} />;
  }

  if (screen === 'aiCheckout') {
    return <AICheckout draft={draft} onBack={() => setScreen('ai')} onComplete={(b) => { setBooking(b); setScreen('done'); }} />;
  }

  if (screen === 'done') {
    return <Confirmation booking={booking} onNewBooking={reset} />;
  }

  return null;
}
