import { Suspense, lazy, useEffect, useState } from 'react';
import Shell from './components/Shell';
import DriverEntry from './components/DriverEntry';
import Landing from './steps/Landing';
import FormFlow from './steps/FormFlow';
import AIFlow from './steps/AIFlow';
import VoiceFlow from './steps/VoiceFlow';
import AICheckout from './steps/AICheckout';
import Confirmation from './steps/Confirmation';
import { api } from './lib/api';

// Lazy-loaded because both pull in the Google Maps library. Neither is
// reachable from the landing page, so riders going straight through the
// booking flow never download it.
const DriverApp = lazy(() => import('./driver/DriverApp'));
const TrackRide = lazy(() => import('./steps/TrackRide'));
// Pulls in the Stripe libraries — lazy so riders paying cash never load them.
const CardPayment = lazy(() => import('./steps/CardPayment'));

function ScreenLoading() {
  return (
    <div className="app" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p className="muted">Loading…</p>
    </div>
  );
}

// Matches /track/<32 hex chars>. The strict pattern means a malformed or
// truncated link falls through to the normal booking flow rather than
// rendering an error page for what is probably just a bad paste.
function readTrackToken() {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(/^\/track\/([a-f0-9]{32})\/?$/i);
  return m ? m[1] : null;
}

export default function App() {
  const [screen, setScreen] = useState('landing');
  const [mode, setMode] = useState('rider'); // 'rider' | 'driver'
  const [aiEnabled, setAiEnabled] = useState(false);
  const [draft, setDraft] = useState(null);
  const [booking, setBooking] = useState(null);
  // Addresses set on the landing page, passed to the form flow
  const [initPickup, setInitPickup] = useState(null);
  const [initDropoff, setInitDropoff] = useState(null);

  // --- Rider tracking deep link: /track/<token> ---
  //
  // Read straight from the URL rather than through a router, because
  // this app has no router — it is a single-screen wizard driven by
  // local state. Adding react-router purely to serve one public link
  // would be a much larger change than the link is worth.
  //
  // Held in state and initialised lazily so it survives re-renders, and
  // kept in sync with the back/forward buttons via popstate below.
  const [trackToken, setTrackToken] = useState(() => readTrackToken());

  useEffect(() => {
    const onPop = () => setTrackToken(readTrackToken());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

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

  // Every booking flow finishes here. A card booking detours through the
  // Stripe payment screen first; cash goes straight to the confirmation.
  // CardPayment itself falls through to 'done' when Stripe isn't configured,
  // so this stays correct whether or not card charging is live.
  const finishBooking = (b) => {
    setBooking(b);
    setScreen(b && b.payment_method === 'card' ? 'pay' : 'done');
  };

  // Tracking is a standalone public page: no driver entry point, no
  // booking wizard chrome. Checked before everything else so a rider
  // opening the link from an SMS lands directly on their trip.
  if (trackToken) {
    return (
      <Suspense fallback={<ScreenLoading />}>
        <TrackRide
          token={trackToken}
          onExit={() => {
            window.history.pushState({}, '', '/');
            setTrackToken(null);
          }}
        />
      </Suspense>
    );
  }

  if (mode === 'driver') {
    return (
      <Suspense fallback={<ScreenLoading />}>
        <DriverApp onExit={() => setMode('rider')} />
      </Suspense>
    );
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
        onComplete={finishBooking}
      />
    );
  } else if (screen === 'voice') {
    content = (
      <VoiceFlow
        onBack={reset}
        onSwitchToText={() => setScreen('ai')}
        onBookingComplete={finishBooking}
      />
    );
  } else if (screen === 'ai') {
    content = <AIFlow onBack={reset} onBookingComplete={finishBooking} />;
  } else if (screen === 'aiCheckout') {
    content = <AICheckout draft={draft} onBack={() => setScreen('ai')} onComplete={finishBooking} />;
  } else if (screen === 'pay') {
    content = (
      <Suspense fallback={<ScreenLoading />}>
        <CardPayment booking={booking} onDone={() => setScreen('done')} />
      </Suspense>
    );
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
