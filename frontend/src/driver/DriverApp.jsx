import { useCallback, useEffect, useRef, useState } from 'react';
import DriverShell from './DriverShell';
import { shortAddress } from './lib/address';
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

// Shown over whatever screen the driver is on the moment a rider cancels a
// ride they'd claimed. A blocking little modal so it can't be missed.
function CancelPopup({ booking, onDismiss }) {
  const where = booking?.pickup_address ? ` (${shortAddress(booking.pickup_address)})` : '';
  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, padding: 24,
        background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        className="rise"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 340, width: '100%', textAlign: 'center', padding: '24px 22px',
          background: 'var(--card)', border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-pop)',
        }}
      >
        <div style={{
          width: 52, height: 52, borderRadius: '50%', margin: '0 auto 14px',
          background: 'rgba(239,68,68,0.12)', color: 'var(--danger)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, fontWeight: 700,
        }}>✕</div>
        <h2 style={{ fontSize: 19, fontWeight: 700, color: 'var(--ink)', margin: '0 0 6px' }}>Ride canceled</h2>
        <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.5, margin: '0 0 18px' }}>
          The rider canceled this ride{where}. It’s been removed from your schedule.
        </p>
        <button className="btn" onClick={onDismiss} style={{ marginTop: 0 }}>Got it</button>
      </div>
    </div>
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
  // A ride the rider just canceled — drives the blocking popup. seenCanceledRef
  // remembers cancellations already accounted for so we only pop up for NEW ones.
  const [canceledNotice, setCanceledNotice] = useState(null);
  const seenCanceledRef = useRef(null);

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

  // Watch for the rider canceling a ride this driver had claimed/started. Polls
  // the driver's own schedule; the first pass just records existing
  // cancellations, so we only pop up for ones that happen while they're using
  // the app. Also boots them out of an active/viewed trip that got canceled.
  useEffect(() => {
    if (!driver || driver.status !== 'active') return undefined;
    let stopped = false;

    const check = async () => {
      try {
        const schedule = await driverApi.getSchedule();
        if (stopped) return;
        const canceled = (schedule || []).filter((b) => b.status === 'canceled');
        const ids = new Set(canceled.map((b) => b.id));

        if (seenCanceledRef.current === null) {
          seenCanceledRef.current = ids; // first pass: baseline, no popup
          return;
        }
        const fresh = canceled.filter((b) => !seenCanceledRef.current.has(b.id));
        seenCanceledRef.current = ids;
        if (fresh.length > 0) {
          const b = fresh[0];
          setActiveBooking((prev) => (prev && prev.id === b.id ? null : prev));
          setViewingBooking((prev) => (prev && prev.id === b.id ? null : prev));
          setCanceledNotice(b);
        }
      } catch { /* transient — try again next tick */ }
    };

    check();
    const t = setInterval(check, 15000);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [driver]);

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

  const tabProps = { activeTab: tab, onChangeTab: setTab };
  let content = null;

  if (justCompleted) {
    // Trip Complete is shown once, then falls back to the tab shell.
    content = (
      <TripComplete
        booking={justCompleted}
        onBackToDashboard={() => { setJustCompleted(null); setTab('home'); }}
      />
    );
  } else if (activeBooking && STAGE_BY_STATUS[activeBooking.status]) {
    // Active (started) trip: full-screen focus mode, no tab bar.
    const stage = STAGE_BY_STATUS[activeBooking.status];
    let screen = null;
    if (stage === 'navigate') {
      screen = <NavigateToPickup booking={activeBooking} driverPosition={driverPosition} onArrived={() => advance('arrived')} busy={busy} error={actionError} />;
    } else if (stage === 'pickup') {
      screen = <PassengerPickup booking={activeBooking} driverPosition={driverPosition} onStartTrip={() => advance('start')} busy={busy} error={actionError} />;
    } else if (stage === 'onTrip') {
      screen = <OnTrip booking={activeBooking} driverPosition={driverPosition} onEndTrip={() => advance('complete')} busy={busy} error={actionError} />;
    }
    content = <GoogleMapsProvider>{screen}</GoogleMapsProvider>;
  } else if (viewingBooking) {
    // Viewing a claimed (not-yet-started) trip — has a Back button. Opening
    // details is NOT claiming or starting; only "Start Navigation" begins it.
    content = (
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
  } else if (tab === 'home') {
    content = <Home driver={driver} onExit={onExit} onLogout={logout} onOpenTab={setTab} {...tabProps} />;
  } else if (tab === 'requests') {
    content = <Requests driver={driver} onClaimed={goToSchedule} {...tabProps} />;
  } else if (tab === 'schedule') {
    content = <Schedule driver={driver} onOpenTrip={setViewingBooking} {...tabProps} />;
  } else if (tab === 'earnings') {
    content = <Earnings {...tabProps} />;
  } else if (tab === 'profile') {
    content = <Profile driver={driver} onDriverUpdate={setDriverOverride} onLogout={logout} {...tabProps} />;
  }

  return (
    <>
      {content}
      {canceledNotice && (
        <CancelPopup booking={canceledNotice} onDismiss={() => setCanceledNotice(null)} />
      )}
    </>
  );
}
