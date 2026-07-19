import { useEffect, useState } from 'react';
import Attract from './screens/Attract';
import RouteStep from './screens/RouteStep';
import PhoneStep from './screens/PhoneStep';
import PayStep from './screens/PayStep';
import Confirm from './screens/Confirm';
import TrackRide from './screens/TrackRide';
import MyRides from './screens/MyRides';

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
  const [trackReference, setTrackReference] = useState(null);

  const patch = (fields) => setBooking((b) => ({ ...b, ...fields }));

  const reset = () => {
    setBooking(EMPTY_BOOKING);
    setConfirmedBooking(null);
    setTrackReference(null);
    // Drop a lingering ?track=… so a later refresh starts clean at Attract.
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
    setScreen('attract');
  };

  const track = (reference) => { setTrackReference(reference); setScreen('track'); };

  // Deep link: the "a driver accepted" SMS points the rider's own phone at
  // `…/?track=RZ-XXXXX`. Opening that URL should land directly on live
  // tracking for that ride — not the booking home screen. This is what
  // bridges "booked on the shared tablet" to "tracked on my phone".
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('track');
    if (ref) {
      setTrackReference(ref);
      setScreen('track');
    }
  }, []);

  if (screen === 'attract') {
    return <Attract onBookHere={() => setScreen('route')} onMyRides={() => setScreen('rides')} />;
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
        onTrack={() => track(confirmedBooking?.reference)}
        onReset={reset}
      />
    );
  }
  if (screen === 'track') {
    return (
      <TrackRide
        reference={trackReference}
        initialBooking={confirmedBooking && confirmedBooking.reference === trackReference ? confirmedBooking : null}
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
