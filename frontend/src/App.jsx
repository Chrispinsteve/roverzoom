import { useEffect, useState } from 'react';
import Shell from './components/Shell';
import Landing from './steps/Landing';
import FormFlow from './steps/FormFlow';
import AIFlow from './steps/AIFlow';
import VoiceFlow from './steps/VoiceFlow';
import AICheckout from './steps/AICheckout';
import Confirmation from './steps/Confirmation';
import { api } from './lib/api';

// Screens: landing → (form | ai → aiCheckout) → confirmation
export default function App() {
  const [screen, setScreen] = useState('landing');
  const [aiEnabled, setAiEnabled] = useState(false);
  const [draft, setDraft] = useState(null);
  const [booking, setBooking] = useState(null);

  useEffect(() => {
    api.aiStatus().then((s) => setAiEnabled(!!s.configured)).catch(() => setAiEnabled(false));
  }, []);

  const reset = () => { setScreen('landing'); setDraft(null); setBooking(null); };

  if (screen === 'landing') {
    return (
      <Shell step={0} totalSteps={0}>
        <Landing
          aiEnabled={aiEnabled}
          onPickForm={() => setScreen('form')}
          onPickAI={() => setScreen('voice')}
        />
      </Shell>
    );
  }

  if (screen === 'form') {
    return <FormFlow onBack={reset} onComplete={(b) => { setBooking(b); setScreen('done'); }} />;
  }

  if (screen === 'voice') {
    return (
      <VoiceFlow
        onBack={reset}
        onSwitchToText={() => setScreen('ai')}
        onConfirmDraft={(d) => { setDraft(d); setScreen('aiCheckout'); }}
      />
    );
  }

  if (screen === 'ai') {
    return <AIFlow onBack={reset} onConfirmDraft={(d) => { setDraft(d); setScreen('aiCheckout'); }} />;
  }

  if (screen === 'aiCheckout') {
    return <AICheckout draft={draft} onBack={() => setScreen('ai')} onComplete={(b) => { setBooking(b); setScreen('done'); }} />;
  }

  if (screen === 'done') {
    return <Confirmation booking={booking} onNewBooking={reset} />;
  }

  return null;
}
