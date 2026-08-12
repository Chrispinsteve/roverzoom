import { useCallback, useEffect, useMemo, useState } from 'react';
import DriverShell from './DriverShell';
import { useDriverAuth } from './useDriverAuth';
import { useDriverLocation, useWakeLock } from './useDriverLocation';
import { driverApi } from '../lib/driverApi';
import { GoogleMapsProvider } from '../lib/GoogleMapsProvider';
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

// ============================================================
// Booking row -> the `ride` shape the existing screens consume
// ============================================================
// RideDetails, NewRideRequest and TripComplete were written against a
// hand-built mock object with nested pickup/dropoff and a driver-side
// fare breakdown. Adapting here rather than rewriting five screens keeps
// this change focused on maps and tracking; the screens can be migrated
// to the raw booking shape separately.
//
// DRIVER_SHARE is the 60% cut shown on offer cards. It lives here as a
// constant with a name so it is greppable — it is a business term, and
// when it changes it must change in exactly one place.
const DRIVER_SHARE = 0.6;

function bookingToRide(booking) {
  if (!booking) return null;
  const fare = Number(booking.fare) || 0;
  const driverCut = Math.round(fare * DRIVER_SHARE * 100) / 100;

  return {
    id: booking.id,
    passenger: {
      name: booking.rider_name || 'Passenger',
      // Riders have no accounts and therefore no rating history yet.
      // Showing a fabricated 4.9 would be worse than showing nothing —
      // drivers make real decisions on this number.
      rating: '—',
      phone: booking.rider_phone,
    },
    pickup: {
      address: booking.pickup_address,
      detail: '',
      distanceAway: '',
    },
    dropoff: {
      address: booking.dropoff_address,
      detail: '',
    },
    distanceMiles: booking.distance_miles != null ? Number(booking.distance_miles) : null,
    durationMin: booking.duration_minutes,
    fare: driverCut,
    baseFare: driverCut,
    timeFare: 0,
    riderTotal: fare,
    ridePreference: 'Scheduled Ride',
    paymentMethod: booking.payment_method === 'cash' ? 'Cash' : 'Card',
  };
}

// The booking's own status is the single source of truth for which
// screen shows. Deriving the stage from it — rather than keeping a
// parallel local `stage` variable — means the server and the UI cannot
// disagree, which is exactly what would otherwise happen after a
// refresh, a crash, or ops cancelling a trip from the admin side.
function stageForBooking(booking) {
  if (!booking) return null;
  switch (booking.status) {
    case 'driver_assigned': return 'details';
    case 'driver_en_route': return 'navigate';
    case 'arrived':         return 'pickup';
    case 'in_progress':     return 'onTrip';
    default:                return null;
  }
}

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

function DriverAppInner({ onExit }) {
  const { loading, session, driver } = useDriverAuth();
  const [authStage, setAuthStage] = useState('login');
  const [signedUpEmail, setSignedUpEmail] = useState('');

  const [activeBooking, setActiveBooking] = useState(null);
  const [completedBooking, setCompletedBooking] = useState(null);
  const [screen, setScreen] = useState('dashboard'); // dashboard | schedule | complete
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [payoutDate] = useState(nextPayoutLabel);

  const tripStage = stageForBooking(activeBooking);

  // Capture GPS only once the driver actually starts heading to the
  // pickup (driver_en_route onward), not the moment they claim the trip.
  // Claiming is not hitting the road — a driver can accept a ride days
  // ahead, and streaming their location from claim time would put their
  // phone on the map while they're at home. This also lines up exactly
  // with the rider tracking gate (see routes/track.js), which withholds
  // the driver's position until this same status.
  const trackingActive = !!activeBooking && ['driver_en_route', 'arrived', 'in_progress']
    .includes(activeBooking.status);

  const { position, error: locationError, permission } = useDriverLocation({
    bookingId: activeBooking?.id || null,
    active: trackingActive,
  });

  useWakeLock(trackingActive);

  // Recover in-flight state on load. Without this, a driver whose phone
  // died mid-trip reopens the app on the dashboard with a passenger in
  // the car and no way to end the ride.
  useEffect(() => {
    if (!driver || driver.status !== 'active') return;
    let cancelled = false;
    driverApi.getActiveTrip()
      .then((trip) => { if (!cancelled) setActiveBooking(trip || null); })
      .catch(() => { /* dashboard still works without it */ });
    return () => { cancelled = true; };
  }, [driver]);

  // Push a status change to the server and adopt whatever it returns.
  // Trusting the response rather than optimistically setting local state
  // means a rejected transition (the trip was cancelled, another tab
  // already advanced it) leaves the UI showing the truth.
  const advance = useCallback(async (status, reason) => {
    if (!activeBooking || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const updated = await driverApi.setStatus(activeBooking.id, status, reason);
      if (status === 'completed') {
        setCompletedBooking(updated);
        setActiveBooking(null);
        setScreen('complete');
      } else {
        setActiveBooking(updated);
      }
    } catch (err) {
      setActionError(err.message);
      // A conflict means our copy is stale — re-read rather than leaving
      // the driver looking at a screen that no longer reflects reality.
      if (err.code === 'conflict' || err.code === 'invalid_transition') {
        driverApi.getActiveTrip().then((t) => setActiveBooking(t || null)).catch(() => {});
      }
    } finally {
      setBusy(false);
    }
  }, [activeBooking, busy]);

  const toggleOnline = useCallback(async () => {
    const next = !online;
    setOnline(next); // optimistic — a failed toggle is reverted below
    try {
      await driverApi.setOnline(next);
    } catch {
      setOnline(!next);
    }
  }, [online]);

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

  const ride = bookingToRide(activeBooking);

  // Surface a denied location permission as a blocking problem rather
  // than a warning. A trip with no GPS is invisible to the rider and to
  // dispatch, and the driver has no way to know that unless told.
  const locationBlocked = trackingActive && permission === 'denied';
  const locationNotice = locationBlocked
    ? 'Location is blocked. Enable it in your browser settings — riders can’t see you without it.'
    : (locationError || null);

  // --- Active trip screens, driven by booking status ---
  if (tripStage === 'details') {
    return (
      <RideDetails
        ride={ride}
        onBack={() => setActiveBooking(null)}
        onStartNavigation={() => advance('driver_en_route')}
        busy={busy}
        error={actionError}
      />
    );
  }

  if (tripStage === 'navigate') {
    return (
      <NavigateToPickup
        booking={activeBooking}
        passenger={ride.passenger}
        driverPosition={position}
        locationError={locationNotice}
        onArrived={() => advance('arrived')}
        busy={busy}
      />
    );
  }

  if (tripStage === 'pickup') {
    return (
      <PassengerPickup
        ride={ride}
        onStartTrip={() => advance('in_progress')}
        busy={busy}
      />
    );
  }

  if (tripStage === 'onTrip') {
    return (
      <OnTrip
        booking={activeBooking}
        passenger={ride.passenger}
        driverPosition={position}
        locationError={locationNotice}
        onEndTrip={() => advance('completed')}
        busy={busy}
      />
    );
  }

  // --- Non-trip screens ---
  if (screen === 'complete' && completedBooking) {
    return (
      <TripComplete
        ride={bookingToRide(completedBooking)}
        onBackToDashboard={() => { setCompletedBooking(null); setScreen('dashboard'); }}
      />
    );
  }

  if (screen === 'schedule') {
    return (
      <Schedule
        onBack={() => setScreen('dashboard')}
        onClaimed={(booking) => { setActiveBooking(booking); setScreen('dashboard'); }}
      />
    );
  }

  if (screen === 'request' && activeBooking) {
    return (
      <NewRideRequest
        ride={ride}
        booking={activeBooking}
        onDecline={() => { setActiveBooking(null); setScreen('dashboard'); }}
        onAccept={() => setScreen('dashboard')}
      />
    );
  }

  return (
    <Dashboard
      driver={driver}
      online={online}
      earningsToday={0}
      ridesCompleted={driver.rides_completed || 0}
      payoutDate={payoutDate}
      onToggleOnline={toggleOnline}
      onExit={onExit}
      onLogout={logout}
      onOpenSchedule={() => setScreen('schedule')}
    />
  );
}

// The maps provider is mounted here rather than at the app root so that
// @react-google-maps/api stays out of the main bundle. See main.jsx.
export default function DriverApp(props) {
  return (
    <GoogleMapsProvider>
      <DriverAppInner {...props} />
    </GoogleMapsProvider>
  );
}
