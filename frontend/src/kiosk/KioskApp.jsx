import { useState } from 'react';
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
    setScreen('attract');
  };

  const track = (reference) => { setTrackReference(reference); setScreen('track'); };

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
