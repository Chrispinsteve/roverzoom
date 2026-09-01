import { useEffect, useRef, useState } from 'react';
import Attract from './screens/Attract';
import RouteStep from './screens/RouteStep';
import FlightStep from './screens/FlightStep';
import PhoneStep from './screens/PhoneStep';
import PayStep from './screens/PayStep';
import Confirm from './screens/Confirm';
import TrackRide from './screens/TrackRide';
import MyRides from './screens/MyRides';
import VoiceAssistant from './components/VoiceAssistant';
import { reportBookingConversion } from '../lib/gtag';
import { track as trackEvent } from '../lib/track';
import { req } from '../lib/api';

const EMPTY_BOOKING = {
  pickup: null, dropoff: null,
  dayIso: null, dayLabel: null, timeLabel: null,
  quote: null,
  name: '', phoneDigits: '', phone: '', email: '',
  flight: null,
  payment: null,
};

export default function KioskApp({ onDriverMode }) {
  const [screen, setScreen] = useState('attract'); // attract | route | phone | pay | confirm | track | rides
  const [booking, setBooking] = useState(EMPTY_BOOKING);
  const [confirmedBooking, setConfirmedBooking] = useState(null);
  const [trackToken, setTrackToken] = useState(null); // booking UUID id (unguessable)
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantBooking, setAssistantBooking] = useState(null);
  // Whether either end of this trip is an airport, answered by the server so
  // the question is asked on exactly the trips the driver would otherwise have
  // to ask about. Null means "not an airport ride" and the step is skipped.
  const [airport, setAirport] = useState(null);
  // The flow gains a step on airport rides, so the progress dots have to say
  // four rather than lying about three.
  const totalSteps = airport ? 4 : 3;

  useEffect(() => {
    const pickup = booking.pickup?.address;
    const dropoff = booking.dropoff?.address;
    if (!pickup || !dropoff) { setAirport(null); return undefined; }
    let live = true;
    const q = new URLSearchParams({ pickup, dropoff });
    req(`/bookings/airport-leg?${q}`)
      .then((r) => { if (live) setAirport(r?.airport || null); })
      // A failed lookup must never block a booking. The rider simply does not
      // get asked, which is exactly where things stand today.
      .catch(() => { if (live) setAirport(null); });
    return () => { live = false; };
  }, [booking.pickup?.address, booking.dropoff?.address]);

  // Funnel steps fire at most once per visit. Without this, `patch` would
  // re-report pickup_set on every keystroke that touches the address.
  const firedSteps = useRef(new Set());
  const once = (step, opts) => {
    if (firedSteps.current.has(step)) return;
    firedSteps.current.add(step);
    trackEvent(step, opts);
  };

  useEffect(() => { once('visit'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Every booking field flows through here, so three of the funnel steps can
  // be recorded in one place rather than scattered across the screens.
  const patch = (fields) => {
    setBooking((b) => ({ ...b, ...fields }));
    if (fields.pickup) once('pickup_set');
    if (fields.dropoff) once('dropoff_set');
    if (fields.quote) once('quote_viewed', { value: fields.quote.fare });
  };

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
    // The assistant books without passing through PayStep, so this path needs
    // its own reporting: the funnel would otherwise show these riders
    // abandoning at the price step, and Google Ads would never learn that an
    // ad click turned into a booking.
    if (b) {
      once('booked', { bookingRef: b.reference });
      reportBookingConversion(b);
    }
    if (b && b.booking_id) track(b.booking_id);
  };
  const assistantLayer = assistantOpen ? (
    <VoiceAssistant onClose={closeAssistant} onBooked={setAssistantBooking} />
  ) : null;

  if (screen === 'attract') {
    return (
      <>
        <Attract
          onBookHere={() => { once('booking_started'); setScreen('route'); }}
          onMyRides={() => setScreen('rides')}
          onTalk={() => { once('booking_started'); setAssistantOpen(true); }}
          onDriverMode={onDriverMode}
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
        onNext={() => { once('checkout_started'); setScreen('pay'); }}
        onBack={() => setScreen('route')}
      />
    );
  }
  if (screen === 'pay') {
    return (
      <PayStep
        booking={booking}
        onChange={patch}
        onConfirmed={(result) => {
          setConfirmedBooking(result);
          reportBookingConversion(result);
          once('booked', { bookingRef: result?.reference });
          setScreen('confirm');
        }}
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
