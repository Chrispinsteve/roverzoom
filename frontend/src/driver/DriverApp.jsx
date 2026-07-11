import { useEffect, useState } from 'react';
import Dashboard from './screens/Dashboard';
import NewRideRequest from './screens/NewRideRequest';
import RideDetails from './screens/RideDetails';
import NavigateToPickup from './screens/NavigateToPickup';
import PassengerPickup from './screens/PassengerPickup';
import OnTrip from './screens/OnTrip';
import TripComplete from './screens/TripComplete';

const DRIVER = { name: 'Michael Anderson', rating: 4.98 };

function nextPayoutLabel() {
  const d = new Date();
  d.setDate(d.getDate() + 10);
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

// Static mock ride — this is a UI-only build, no backend/auth wired up yet.
const RIDE = {
  passenger: { name: 'James Carter', rating: 4.95 },
  pickup: { address: '123 Main St, Miami, FL', detail: 'Apt 4B, Main Entrance', distanceAway: '0.4 mi away' },
  dropoff: { address: 'Miami International Airport (MIA)', detail: '2100 NW 42nd Ave, Miami, FL' },
  distanceMiles: 18.4,
  durationMin: 25,
  baseFare: 30.00,
  timeFare: 5.40,
  fare: 35.40,
  ridePreference: 'Standard Ride',
  paymentMethod: 'Card',
};

export default function DriverApp({ onExit }) {
  const [stage, setStage] = useState('dashboard');
  const [online, setOnline] = useState(false);
  const [earningsToday, setEarningsToday] = useState(215.40);
  const [ridesCompleted, setRidesCompleted] = useState(5);
  const [payoutDate] = useState(nextPayoutLabel);

  // Simulate an incoming ride ping shortly after the driver goes online.
  useEffect(() => {
    if (online && stage === 'dashboard') {
      const t = setTimeout(() => setStage('request'), 1800);
      return () => clearTimeout(t);
    }
  }, [online, stage]);

  const completeTrip = () => {
    setEarningsToday((v) => +(v + RIDE.fare).toFixed(2));
    setRidesCompleted((v) => v + 1);
    setStage('complete');
  };

  if (stage === 'dashboard') {
    return (
      <Dashboard
        driver={DRIVER}
        online={online}
        earningsToday={earningsToday}
        ridesCompleted={ridesCompleted}
        payoutDate={payoutDate}
        onToggleOnline={() => setOnline((v) => !v)}
        onExit={onExit}
      />
    );
  }

  if (stage === 'request') {
    return (
      <NewRideRequest
        ride={RIDE}
        onDecline={() => setStage('dashboard')}
        onAccept={() => setStage('details')}
      />
    );
  }

  if (stage === 'details') {
    return (
      <RideDetails
        ride={RIDE}
        onBack={() => setStage('request')}
        onStartNavigation={() => setStage('navigate')}
      />
    );
  }

  if (stage === 'navigate') {
    return <NavigateToPickup ride={RIDE} onArrived={() => setStage('pickup')} />;
  }

  if (stage === 'pickup') {
    return <PassengerPickup ride={RIDE} onStartTrip={() => setStage('onTrip')} />;
  }

  if (stage === 'onTrip') {
    return <OnTrip ride={RIDE} onEndTrip={completeTrip} />;
  }

  if (stage === 'complete') {
    return <TripComplete ride={RIDE} onBackToDashboard={() => setStage('dashboard')} />;
  }

  return null;
}
