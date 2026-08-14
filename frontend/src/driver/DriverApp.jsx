import { useCallback, useEffect, useState } from 'react';
import DriverShell from './DriverShell';
import { useDriverAuth } from './useDriverAuth';
import { useDriverLocation, useWakeLock } from './useDriverLocation';
import { GoogleMapsProvider } from '../lib/GoogleMapsProvider';
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

// Which trip-lifecycle screen an ACTIVE (already-started) trip maps to. A driver
// re-opening the app mid-trip resumes at exactly the right screen. Note:
// `driver_assigned` (claimed but NOT yet started) is deliberately NOT here —
// claiming a scheduled ride doesn't put the driver "on the road", it just adds
// the trip to their Upcoming list. Only starting navigation makes a trip active.
const STAGE_BY_STATUS = {
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

  // Land on Profile when returning from Stripe payout onboarding (…/?driver=payouts).
  const [tab, setTab] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('driver') === 'payouts' ? 'profile' : 'home';
    } catch {
      return 'home';
    }
  });
  // Local override so a freshly-claimed/updated booking reflects instantly
  // without waiting on a refetch; useDriverAuth's driver row (rating,
  // profile fields) still comes from the live auth hook.
  const [driverOverride, setDriverOverride] = useState(null);
  const driver = driverOverride || authDriver;

  const [activeBooking, setActiveBooking] = useState(undefined); // undefined = not checked yet, null = none
  const [viewingBooking, setViewingBooking] = useState(null); // a claimed trip opened for details (has a Back button)
  const [justCompleted, setJustCompleted] = useState(null);
  // Shared across lifecycle actions so any failed transition (arrived / start /
  // complete) shows a reason instead of a dead button.
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  // Capture and upload GPS while a trip is actually underway (en route ->
  // arrived -> in progress). This is what makes the rider's live map move.
  // Not before: claiming/scheduling a ride must not stream the driver's
  // location. useDriverLocation batches uploads and no-ops when `active` is
  // false, so it's safe to call unconditionally here (before any early return).
  const trackingActive = !!activeBooking && ACTIVE_STATUSES.includes(activeBooking.status);
  const { position: driverPosition } = useDriverLocation({
    bookingId: activeBooking?.id || null,
    active: trackingActive,
  });
  useWakeLock(trackingActive);

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

  // A newly-advanced ACTIVE booking — update local state and let the render
  // below pick the right lifecycle screen from its status.
  const onBookingUpdate = (booking) => setActiveBooking(booking);

  // Claiming just parks the trip in Upcoming — send the driver to their
  // Schedule to see it, do NOT drop them into navigation.
  const goToSchedule = () => { setViewingBooking(null); setTab('schedule'); };

  // Deliberate "hit the road now" for a chosen upcoming trip: mark it en route,
  // which promotes it to the active, full-screen trip.
  const startNavigation = async (booking) => {
    if (busy) return;
    setBusy(true); setActionError('');
    try {
      const updated = await driverApi.setBookingStatus(booking.id, 'en_route');
      setViewingBooking(null);
      setActiveBooking(updated);
    } catch (e) {
      setActionError(e.message || 'Could not start the trip. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  // Every lifecycle transition (arrived / start / complete) goes through here.
  // It MUST surface failures: a transition like "complete" hits a server-side
  // RPC, and if that errors the button used to just do nothing, leaving the
  // driver tapping a dead control with no idea why. Now it shows the reason.
  const advance = async (event) => {
    if (busy) return;
    setBusy(true); setActionError('');
    try {
      const updated = await driverApi.setBookingStatus(activeBooking.id, event);
      if (event === 'complete') {
        setJustCompleted(updated);
        setActiveBooking(null);
      } else {
        onBookingUpdate(updated);
      }
    } catch (e) {
      setActionError(e.message || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
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

  // --- Active (started) trip: full-screen focus mode, no tab bar -----------
  if (activeBooking) {
    const stage = STAGE_BY_STATUS[activeBooking.status];
    let screen = null;
    if (stage === 'navigate') {
      screen = <NavigateToPickup booking={activeBooking} driverPosition={driverPosition} onArrived={() => advance('arrived')} busy={busy} error={actionError} />;
    } else if (stage === 'pickup') {
      screen = <PassengerPickup booking={activeBooking} driverPosition={driverPosition} onStartTrip={() => advance('start')} busy={busy} error={actionError} />;
    } else if (stage === 'onTrip') {
      screen = <OnTrip booking={activeBooking} driverPosition={driverPosition} onEndTrip={() => advance('complete')} busy={busy} error={actionError} />;
    }
    if (screen) return <GoogleMapsProvider>{screen}</GoogleMapsProvider>;
  }

  // --- Viewing a claimed (not-yet-started) trip's details — has a Back button.
  // Opening details is NOT claiming or starting: the driver can browse a
  // scheduled trip and return; only "Start Navigation" begins the drive.
  if (viewingBooking) {
    return (
      <RideDetails
        booking={viewingBooking}
        onBack={() => setViewingBooking(null)}
        onStartNavigation={() => startNavigation(viewingBooking)}
        onUnclaim={async () => {
          await driverApi.releaseBooking(viewingBooking.id);
          setViewingBooking(null);
          await refreshActiveBooking();
          setTab('schedule');
        }}
      />
    );
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
        onClaimed={goToSchedule}
        {...tabProps}
      />
    );
  }
  if (tab === 'schedule') {
    return <Schedule driver={driver} onOpenTrip={setViewingBooking} {...tabProps} />;
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
