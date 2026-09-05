// Recurring rides — turning a series template into real bookings.
//
// The generator materialises bookings a fixed horizon ahead rather than
// computing them on demand. Everything downstream (dispatch, driver schedules,
// tracking links, SMS, the admin console) then needs no knowledge that
// recurring rides exist at all: a generated ride is an ordinary booking that
// happens to carry a series_id.
//
// The date arithmetic below is deliberately done on plain YYYY-MM-DD strings.
// Doing it with Date objects means every step is subject to whatever zone the
// server happens to run in, and a booking that lands on the wrong DAY is far
// worse than one at the wrong minute.

const HORIZON_DAYS = 14;

// ---------------------------------------------------------------------------
// Local-date arithmetic. Pure, no Date-object timezone traps.
// ---------------------------------------------------------------------------
function ymd(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseYmd(s) {
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

// Weekday of a calendar date, 0=Sunday..6=Saturday. Built in UTC on purpose:
// the weekday of "2026-09-07" is a property of the date, not of any zone, and
// constructing it locally would make it depend on the server's own offset.
function weekdayOf(dateStr) {
  const { y, m, d } = parseYmd(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(dateStr, n) {
  const { y, m, d } = parseYmd(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// Today's LOCAL date in a given zone. The server runs in UTC, so at 20:00 in
// New York it is already tomorrow by the server's clock — generating from the
// server's date would quietly skip a day.
function todayIn(timezone, now = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  return p.slice(0, 10);
}

// The UTC instant of a local wall-clock time on a local date.
//
// This is the function that makes 07:30 stay 07:30 across DST. It measures the
// zone's offset ON THAT DATE rather than assuming a fixed one, so the March and
// November changeovers are handled by the data instead of by arithmetic.
function localInstant(dateStr, timeStr, timezone) {
  const { y, m, d } = parseYmd(dateStr);
  const [hh, mm] = String(timeStr).slice(0, 5).split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, timeZoneName: 'shortOffset',
  }).format(guess);
  const match = /GMT([+-]\d{1,2})(?::(\d{2}))?/.exec(label);
  const offH = match ? Number(match[1]) : 0;
  const offM = match && match[2] ? Number(match[2]) * Math.sign(offH || 1) : 0;
  return new Date(Date.UTC(y, m - 1, d, hh - offH, mm - offM));
}

// ---------------------------------------------------------------------------
// Which dates a series covers
// ---------------------------------------------------------------------------
// Returns the local dates in [from, through] that fall on the series' weekdays
// and inside its own start/end. Never generates into the past: a booking dated
// yesterday cannot be driven and would only confuse dispatch.
function datesForSeries(series, fromDate, throughDate) {
  if (!series || series.status !== 'active') return [];
  const days = new Set((series.days_of_week || []).map(Number));
  if (!days.size) return [];

  let cursor = fromDate > series.starts_on ? fromDate : series.starts_on;
  const last = series.ends_on && series.ends_on < throughDate ? series.ends_on : throughDate;

  const out = [];
  // Bounded rather than while(true): a malformed end date must not spin.
  for (let i = 0; i <= 400 && cursor <= last; i++) {
    if (days.has(weekdayOf(cursor))) out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

// What still needs creating: the covered dates minus the ones already
// materialised. The unique index on (series_id, series_date) is the real
// guarantee — this just avoids pointless inserts that would bounce off it.
function missingDates(series, existingDates, fromDate, throughDate) {
  const have = new Set(existingDates || []);
  return datesForSeries(series, fromDate, throughDate).filter((d) => !have.has(d));
}

// ---------------------------------------------------------------------------
// Skipping a single day
// ---------------------------------------------------------------------------
// An irregular WEEK is already handled by days_of_week — someone who works
// Monday, Wednesday, Thursday and Friday is [1,3,4,5] and needs nothing else.
// This is the other case: a normal week with one day off.
//
// A skip is a cancelled booking, not a new kind of record. The unique index on
// (series_id, series_date) means the cancelled row keeps its date, so the
// generator cannot resurrect it on the next run.

// How close to pickup a rider may still call off. Past this the driver is
// likely already routing to them, and cancelling from a web link is the wrong
// way to tell someone who is nearly outside your door — they should call.
const SKIP_CUTOFF_MINUTES = 60;

// A sentinel, not free text. Distinguishes "the rider is not working that day"
// from "the rider cancelled this ride for good" and from an ops cancellation,
// which is what makes un-skipping safe to offer: only a skip can be undone.
const SKIP_REASON = 'series_skip';

function minutesUntil(scheduledAt, now = new Date()) {
  return (new Date(scheduledAt).getTime() - now.getTime()) / 60000;
}

function canSkip(booking, now = new Date()) {
  if (!booking) return { ok: false, reason: 'not_found' };
  if (!booking.series_id) return { ok: false, reason: 'not_a_recurring_ride' };
  if (booking.status === 'canceled') return { ok: false, reason: 'already_skipped' };
  // Anything past 'confirmed' means a driver has begun acting on it.
  if (booking.status !== 'confirmed') return { ok: false, reason: 'ride_already_started' };
  if (minutesUntil(booking.scheduled_at, now) < SKIP_CUTOFF_MINUTES) {
    return { ok: false, reason: 'too_close_to_pickup' };
  }
  return { ok: true };
}

function canUnskip(booking, now = new Date()) {
  if (!booking) return { ok: false, reason: 'not_found' };
  if (booking.status !== 'canceled') return { ok: false, reason: 'not_skipped' };
  // Only the rider's own skip can be undone. A cancellation by dispatch or by a
  // driver was someone else's decision and must not be reversible from a link.
  if (booking.canceled_by !== 'rider' || booking.cancel_reason !== SKIP_REASON) {
    return { ok: false, reason: 'canceled_by_someone_else' };
  }
  if (minutesUntil(booking.scheduled_at, now) < SKIP_CUTOFF_MINUTES) {
    return { ok: false, reason: 'too_close_to_pickup' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Materialising the bookings
// ---------------------------------------------------------------------------
const supabase = require('../db/supabase');
const { estimate } = require('./fare');
const { makeReference } = require('./reference');

// Turn one series into the bookings it is missing.
//
// The fare is priced ONCE per run, not once per ride. Distance and duration are
// fixed for a series, and the pickup time is the same local time every day, so
// every generated ride carries the same fare — pricing each one separately
// would mean fourteen routing calls to reach fourteen identical answers, on an
// account whose Places quota is already a daily ceiling.
async function generateForSeries(series, { now = new Date(), horizonDays = HORIZON_DAYS } = {}) {
  if (!series || series.status !== 'active') return { created: 0, reason: 'not_active' };

  const today = todayIn(series.timezone, now);
  const through = addDays(today, horizonDays);

  const { data: existing, error: exErr } = await supabase
    .from('bookings')
    .select('series_date')
    .eq('series_id', series.id)
    .gte('series_date', today);
  if (exErr) return { created: 0, error: exErr.message };

  const todo = missingDates(series, (existing || []).map((r) => r.series_date), today, through);
  if (!todo.length) {
    await supabase.from('ride_series')
      .update({ generated_through: through, updated_at: new Date().toISOString() })
      .eq('id', series.id);
    return { created: 0, through };
  }

  const priced = await estimate(
    { address: series.pickup_address, lat: series.pickup_lat, lng: series.pickup_lng },
    { address: series.dropoff_address, lat: series.dropoff_lat, lng: series.dropoff_lng },
    localInstant(todo[0], series.pickup_time, series.timezone).toISOString(),
  );

  // estimate() flags a trip beyond the service area. Generating fourteen of
  // those would fill dispatch with rides no driver should accept, and the fare
  // attached to them is not a real quote. Better to generate nothing and say so.
  if (priced.tooFar) {
    return { created: 0, error: `outside service area (${priced.rawDistanceMiles} mi)` };
  }

  const rows = todo.map((date) => ({
    reference: makeReference(),
    series_id: series.id,
    series_date: date,
    scheduled_at: localInstant(date, series.pickup_time, series.timezone).toISOString(),
    pickup_address: series.pickup_address,
    pickup_lat: series.pickup_lat,
    pickup_lng: series.pickup_lng,
    dropoff_address: series.dropoff_address,
    dropoff_lat: series.dropoff_lat,
    dropoff_lng: series.dropoff_lng,
    distance_miles: priced.distanceMiles,
    duration_minutes: priced.durationMinutes,
    fare: priced.fare,
    payment_method: series.payment_method,
    rider_name: series.rider_name,
    rider_phone: series.rider_phone,
    rider_email: series.rider_email,
    // A generated ride inherits the series' driver, so a commuter gets the same
    // person rather than whoever wins a claim race. Null until Step 3 sets one.
    driver_id: series.preferred_driver_id || null,
    source: 'form',
  }));

  // Inserted one at a time on purpose. A batch insert is rejected WHOLE if any
  // single row collides with the (series_id, series_date) unique index — so one
  // date already created by an overlapping run would throw away thirteen good
  // ones. A duplicate here is the expected outcome of a retry, not an error.
  let created = 0;
  const failures = [];
  for (const row of rows) {
    const { error } = await supabase.from('bookings').insert(row);
    if (!error) { created++; continue; }
    if (error.code === '23505') continue; // already generated; nothing to do
    failures.push(`${row.series_date}: ${error.message}`);
  }

  await supabase.from('ride_series')
    .update({ generated_through: through, updated_at: new Date().toISOString() })
    .eq('id', series.id);

  return { created, through, failures };
}

// Every active series that has not been generated far enough ahead.
async function generateDueSeries({ now = new Date(), horizonDays = HORIZON_DAYS } = {}) {
  const { data, error } = await supabase
    .from('ride_series').select('*').eq('status', 'active');
  if (error) return { series: 0, created: 0, error: error.message };

  let created = 0;
  const problems = [];
  for (const s of data || []) {
    const r = await generateForSeries(s, { now, horizonDays });
    created += r.created || 0;
    if (r.error) problems.push(`${s.id}: ${r.error}`);
    if (r.failures?.length) problems.push(...r.failures.map((f) => `${s.id} ${f}`));
  }
  return { series: (data || []).length, created, problems };
}

module.exports = {
  HORIZON_DAYS,
  ymd, parseYmd, weekdayOf, addDays, todayIn, localInstant,
  datesForSeries, missingDates,
  generateForSeries, generateDueSeries,
  canSkip, canUnskip, SKIP_CUTOFF_MINUTES, SKIP_REASON,
};
