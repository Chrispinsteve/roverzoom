import { useCallback, useEffect, useState } from 'react';
import DriverShell from './DriverShell';
import { useDriverAuth } from './useDriverAuth';
import { supabase } from '../lib/supabaseClient';
import { driverApi } from '../lib/driverApi';
import Login from './screens/Login';
import Signup from './screens/Signup';
import CheckEmail from './screens/CheckEmail';
import PendingVerification from './screens/PendingVerification';
import Suspended from './screens/Suspended';
import Home from './screens/Home';
import Requests from './screens/Requests';
import Schedule from './screens/Schedule';
import Earnings from './screens/Earnings';
import Profile from './screens/Profile';
import RideDetails from './screens/RideDetails';
import NavigateToPickup from './screens/NavigateToPickup';
import PassengerPickup from './screens/PassengerPickup';
import OnTrip from './screens/OnTrip';
import TripComplete from './screens/TripComplete';

// Which trip-lifecycle screen a booking's real status maps to. A driver
// re-opening the app mid-trip resumes at exactly the right screen instead
// of losing their place.
const STAGE_BY_STATUS = {
  driver_assigned: 'details',
  driver_en_route: 'navigate',
  arrived: 'pickup',
  in_progress: 'onTrip',
};
const ACTIVE_STATUSES = Object.keys(STAGE_BY_STATUS);

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
  const { loading, session, driver: authDriver } = useDriverAuth();
  const [authStage, setAuthStage] = useState('login'); // 'login' | 'signup' | 'checkEmail'
  const [signedUpEmail, setSignedUpEmail] = useState('');

  const [tab, setTab] = useState('home');
  // Local override so a freshly-claimed/updated booking reflects instantly
  // without waiting on a refetch; useDriverAuth's driver row (rating,
  // profile fields) still comes from the live auth hook.
  const [driverOverride, setDriverOverride] = useState(null);
  const driver = driverOverride || authDriver;

  const [activeBooking, setActiveBooking] = useState(undefined); // undefined = not checked yet, null = none
  const [justCompleted, setJustCompleted] = useState(null);

  const refreshActiveBooking = useCallback(async () => {
    try {
      const schedule = await driverApi.getSchedule();
      const active = (schedule || []).find((b) => ACTIVE_STATUSES.includes(b.status));
      setActiveBooking(active || null);
    } catch {
      setActiveBooking(null);
    }
  }, []);

  useEffect(() => {
    if (driver && driver.status === 'active') refreshActiveBooking();
  }, [driver, refreshActiveBooking]);

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

  // Still resolving whether there's an in-progress trip to resume into.
  if (activeBooking === undefined) return <AuthLoading />;

  // A just-claimed or newly-advanced booking — update local state and let
  // the render below pick the right lifecycle screen from its status.
  const onBookingUpdate = (booking) => setActiveBooking(booking);

  const advance = async (event) => {
    const updated = await driverApi.setBookingStatus(activeBooking.id, event);
    if (event === 'complete') {
      setJustCompleted(updated);
      setActiveBooking(null);
    } else {
      onBookingUpdate(updated);
    }
  };

  // --- Trip Complete is shown once, then falls back to the tab shell -------
  if (justCompleted) {
    return (
      <TripComplete
        booking={justCompleted}
        onBackToDashboard={() => { setJustCompleted(null); setTab('home'); }}
      />
    );
  }

  // --- Active trip: full-screen focus mode, no tab bar ----------------------
  if (activeBooking) {
    const stage = STAGE_BY_STATUS[activeBooking.status];
    if (stage === 'details') {
      return (
        <RideDetails
          booking={activeBooking}
          onStartNavigation={() => advance('en_route')}
        />
      );
    }
    if (stage === 'navigate') {
      return <NavigateToPickup booking={activeBooking} onArrived={() => advance('arrived')} />;
    }
    if (stage === 'pickup') {
      return <PassengerPickup booking={activeBooking} onStartTrip={() => advance('start')} />;
    }
    if (stage === 'onTrip') {
      return <OnTrip booking={activeBooking} onEndTrip={() => advance('complete')} />;
    }
  }

  // --- Idle: tab shell --------------------------------------------------------
  const tabProps = { activeTab: tab, onChangeTab: setTab };

  if (tab === 'home') {
    return (
      <Home
        driver={driver}
        onExit={onExit}
        onLogout={logout}
        onOpenTab={setTab}
        {...tabProps}
      />
    );
  }
  if (tab === 'requests') {
    return (
      <Requests
        driver={driver}
        onClaimed={onBookingUpdate}
        {...tabProps}
      />
    );
  }
  if (tab === 'schedule') {
    return <Schedule driver={driver} onClaimed={onBookingUpdate} {...tabProps} />;
  }
  if (tab === 'earnings') {
    return <Earnings {...tabProps} />;
  }
  if (tab === 'profile') {
    return (
      <Profile
        driver={driver}
        onDriverUpdate={setDriverOverride}
        onLogout={logout}
        {...tabProps}
      />
    );
  }

  return null;
}
