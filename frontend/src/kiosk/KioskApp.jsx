import { useEffect, useState } from 'react';
import Attract from './screens/Attract';
import RouteStep from './screens/RouteStep';
import PhoneStep from './screens/PhoneStep';
import PayStep from './screens/PayStep';
import Confirm from './screens/Confirm';
import TrackRide from './screens/TrackRide';
import MyRides from './screens/MyRides';
import VoiceAssistant from './components/VoiceAssistant';

const EMPTY_BOOKING = {
  pickup: null, dropoff: null,
  dayIso: null, dayLabel: null, timeLabel: null,
  quote: null,
  name: '', phoneDigits: '', phone: '',
  payment: null,
};

export default function KioskApp() {
  const [screen, setScreen] = useState('attract'); // attract | route | phone | pay | confirm | track | rides
  const [booking, setBooking] = useState(EMPTY_BOOKING);
  const [confirmedBooking, setConfirmedBooking] = useState(null);
  const [trackToken, setTrackToken] = useState(null); // booking UUID id (unguessable)
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantBooking, setAssistantBooking] = useState(null);

  const patch = (fields) => setBooking((b) => ({ ...b, ...fields }));

  const reset = () => {
    setBooking(EMPTY_BOOKING);
    setConfirmedBooking(null);
    setTrackToken(null);
    // Drop a lingering ?track=… so a later refresh starts clean at Attract.
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    setScreen('attract');
  };

  const track = (token) => {
    if (!token) return;
    // Keep the token in the URL so a refresh or bookmark reloads straight into
    // live tracking. It's the booking's unguessable UUID, so the link is
    // private — nothing about it is surfaced on the shared kiosk entrance.
    window.history.replaceState({}, '', `?track=${encodeURIComponent(token)}`);
    setTrackToken(token);
    setScreen('track');
  };

  // Deep link: the "a driver accepted" SMS points the rider's own phone at
  // `…/?track=<uuid>`. Opening that URL lands directly on live tracking for
  // that specific ride — the private bridge from the shared tablet to the
  // rider's own phone.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('track');
    if (token) track(token);
    else if (params.get('talk') !== null) setAssistantOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The voice assistant is an overlay layer — it opens over whatever screen is
  // showing and, if it booked a ride, drops the rider into live tracking on close.
  const closeAssistant = () => {
    setAssistantOpen(false);
    const b = assistantBooking;
    setAssistantBooking(null);
    if (b && b.booking_id) track(b.booking_id);
  };
  const assistantLayer = assistantOpen ? (
    <VoiceAssistant onClose={closeAssistant} onBooked={setAssistantBooking} />
  ) : null;

  if (screen === 'attract') {
    return (
      <>
        <Attract
          onBookHere={() => setScreen('route')}
          onMyRides={() => setScreen('rides')}
          onTalk={() => setAssistantOpen(true)}
        />
        {assistantLayer}
      </>
    );
  }
  if (screen === 'route') {
    return (
      <RouteStep
        booking={booking}
        onChange={patch}
        onNext={() => setScreen('phone')}
        onBack={reset}
      />
    );
  }
  if (screen === 'phone') {
    return (
      <PhoneStep
        booking={booking}
        onChange={patch}
        onNext={() => setScreen('pay')}
        onBack={() => setScreen('route')}
      />
    );
  }
  if (screen === 'pay') {
    return (
      <PayStep
        booking={booking}
        onChange={patch}
        onConfirmed={(result) => { setConfirmedBooking(result); setScreen('confirm'); }}
        onBack={() => setScreen('phone')}
      />
    );
  }
  if (screen === 'confirm') {
    return (
      <Confirm
        confirmedBooking={confirmedBooking}
        onTrack={() => track(confirmedBooking?.id)}
        onReset={reset}
      />
    );
  }
  if (screen === 'track') {
    return (
      <TrackRide
        reference={trackToken}
        initialBooking={confirmedBooking && confirmedBooking.id === trackToken ? confirmedBooking : null}
        onBack={reset}
        onNewRide={reset}
      />
    );
  }
  if (screen === 'rides') {
    return <MyRides onBack={reset} onTrack={track} />;
  }
  return null;
}
