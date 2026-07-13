import { useEffect, useState } from 'react';
import DriverShell from './DriverShell';
import { useDriverAuth } from './useDriverAuth';
import { supabase } from '../lib/supabaseClient';
import Login from './screens/Login';
import Signup from './screens/Signup';
import CheckEmail from './screens/CheckEmail';
import PendingVerification from './screens/PendingVerification';
import Suspended from './screens/Suspended';
import Dashboard from './screens/Dashboard';
import NewRideRequest from './screens/NewRideRequest';
import RideDetails from './screens/RideDetails';
import NavigateToPickup from './screens/NavigateToPickup';
import PassengerPickup from './screens/PassengerPickup';
import OnTrip from './screens/OnTrip';
import TripComplete from './screens/TripComplete';
import Schedule from './screens/Schedule';

function nextPayoutLabel() {
  const d = new Date();
  d.setDate(d.getDate() + 10);
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

// Static mock ride — the lifecycle screens (request -> ... -> complete)
// aren't wired to real dispatch/claim data yet; only the auth gate and the
// Dashboard/Schedule screens use real data so far.
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

function AuthLoading() {
  return (
    <DriverShell>
      <div className="body">
        <p className="muted center" style={{ marginTop: 60 }}>Loading…</p>
      </div>
    </DriverShell>
  );
}

function NoDriverProfile({ onLogout }) {
  return (
    <DriverShell>
      <div className="body">
        <p className="error-text center" style={{ marginTop: 60 }}>
          We couldn’t find a driver profile for this account. Contact support if this keeps happening.
        </p>
        <button className="btn btn-ghost" onClick={onLogout} style={{ marginTop: 16 }}>Log Out</button>
      </div>
    </DriverShell>
  );
}

export default function DriverApp({ onExit }) {
  const { loading, session, driver } = useDriverAuth();
  const [authStage, setAuthStage] = useState('login'); // 'login' | 'signup' | 'checkEmail'
  const [signedUpEmail, setSignedUpEmail] = useState('');

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

  const logout = () => supabase.auth.signOut();

  if (loading) return <AuthLoading />;

  if (!session) {
    if (authStage === 'signup') {
      return (
        <Signup
          onSwitchToLogin={() => setAuthStage('login')}
          onSignedUp={(email) => { setSignedUpEmail(email); setAuthStage('checkEmail'); }}
        />
      );
    }
    if (authStage === 'checkEmail') {
      return <CheckEmail email={signedUpEmail} onSwitchToLogin={() => setAuthStage('login')} />;
    }
    return <Login onSwitchToSignup={() => setAuthStage('signup')} />;
  }

  if (!driver) return <NoDriverProfile onLogout={logout} />;
  if (driver.status === 'pending_verification') return <PendingVerification onLogout={logout} />;
  if (driver.status === 'suspended') return <Suspended onLogout={logout} />;

  if (stage === 'dashboard') {
    return (
      <Dashboard
        driver={driver}
        online={online}
        earningsToday={earningsToday}
        ridesCompleted={ridesCompleted}
        payoutDate={payoutDate}
        onToggleOnline={() => setOnline((v) => !v)}
        onExit={onExit}
        onLogout={logout}
        onOpenSchedule={() => setStage('schedule')}
      />
    );
  }

  if (stage === 'schedule') {
    return <Schedule onBack={() => setStage('dashboard')} />;
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
