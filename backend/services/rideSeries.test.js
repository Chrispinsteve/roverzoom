// Recurring-ride date logic. Run: node backend/services/rideSeries.test.js
//
// This is the part of the commuter product that is worth testing hardest. A
// fare that is a dollar out is an annoyance; a ride generated on the wrong day,
// or an hour late after a DST change, means someone did not get to work.
const assert = require('node:assert');
const S = require('./rideSeries');

let n = 0;
const ok = (name) => { n++; console.log('  ✓', name); };

const series = (over = {}) => ({
  status: 'active',
  days_of_week: [1, 2, 3, 4, 5], // weekdays
  pickup_time: '07:30',
  timezone: 'America/New_York',
  starts_on: '2026-09-01',
  ends_on: null,
  ...over,
});

// --- weekdays -------------------------------------------------------------
{
  const d = S.datesForSeries(series(), '2026-09-07', '2026-09-13'); // Mon..Sun
  assert.deepEqual(d, ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11']);
  ok('a weekday series produces Monday to Friday and skips the weekend');

  const we = S.datesForSeries(series({ days_of_week: [0, 6] }), '2026-09-07', '2026-09-13');
  assert.deepEqual(we, ['2026-09-12', '2026-09-13']);
  ok('a weekend series produces only Saturday and Sunday');
}

// --- bounds ---------------------------------------------------------------
{
  const late = S.datesForSeries(series({ starts_on: '2026-09-09' }), '2026-09-07', '2026-09-11');
  assert.deepEqual(late, ['2026-09-09', '2026-09-10', '2026-09-11']);
  ok('nothing is generated before the series starts');

  const ends = S.datesForSeries(series({ ends_on: '2026-09-09' }), '2026-09-07', '2026-09-11');
  assert.deepEqual(ends, ['2026-09-07', '2026-09-08', '2026-09-09']);
  ok('nothing is generated after the series ends');

  // A ride dated yesterday cannot be driven; it would only confuse dispatch.
  const past = S.datesForSeries(series(), '2026-09-09', '2026-09-11');
  assert.ok(past.every((d) => d >= '2026-09-09'));
  ok('never generates into the past');
}

// --- a series that should produce nothing ---------------------------------
{
  for (const st of ['paused', 'ended']) {
    assert.deepEqual(S.datesForSeries(series({ status: st }), '2026-09-07', '2026-09-30'), [],
      `${st} series generates nothing`);
  }
  assert.deepEqual(S.datesForSeries(series({ days_of_week: [] }), '2026-09-07', '2026-09-30'), []);
  assert.deepEqual(S.datesForSeries(null, '2026-09-07', '2026-09-30'), []);
  ok('paused, ended, dayless and missing series generate nothing');

  // ends_on before starts_on is nonsense the database also rejects, but the
  // generator must not spin on it either.
  assert.deepEqual(S.datesForSeries(series({ ends_on: '2026-08-01' }), '2026-09-07', '2026-09-30'), []);
  ok('an end date before the start produces nothing rather than looping');
}

// --- DST: the one that means being late for work --------------------------
{
  // US DST ends 2026-11-01. A 07:30 commute must stay 07:30 on both sides.
  const before = S.localInstant('2026-10-30', '07:30', 'America/New_York');
  const after = S.localInstant('2026-11-02', '07:30', 'America/New_York');
  const shown = (d) => new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
  }).format(d);
  assert.equal(shown(before), shown(after), 'local pickup time must not move across DST');
  // And the UTC instants MUST differ by an hour — that is the offset changing.
  assert.notEqual(before.toISOString().slice(11, 16), after.toISOString().slice(11, 16));
  ok('07:30 stays 07:30 across the November change, with the UTC instant shifting');

  const springBefore = S.localInstant('2026-03-06', '07:30', 'America/New_York');
  const springAfter = S.localInstant('2026-03-10', '07:30', 'America/New_York');
  assert.equal(shown(springBefore), shown(springAfter));
  ok('and across the March change');
}

// --- idempotency ----------------------------------------------------------
{
  const all = S.datesForSeries(series(), '2026-09-07', '2026-09-11');
  const missing = S.missingDates(series(), ['2026-09-08', '2026-09-10'], '2026-09-07', '2026-09-11');
  assert.deepEqual(missing, ['2026-09-07', '2026-09-09', '2026-09-11']);
  assert.ok(missing.length < all.length);
  ok('dates that already have a booking are not generated again');

  // A skipped day is a CANCELLED booking, which still occupies its date — so it
  // must not come back on the next run.
  const afterSkip = S.missingDates(series(), all, '2026-09-07', '2026-09-11');
  assert.deepEqual(afterSkip, [], 'a fully-materialised week regenerates nothing');
  ok('a cancelled ride keeps its slot, so a skipped day stays skipped');
}

// --- calendar arithmetic --------------------------------------------------
{
  assert.equal(S.addDays('2026-08-31', 1), '2026-09-01');
  assert.equal(S.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(S.addDays('2028-02-28', 1), '2028-02-29', 'leap year');
  assert.equal(S.weekdayOf('2026-09-06'), 0, 'Sunday is 0');
  assert.equal(S.weekdayOf('2026-09-12'), 6, 'Saturday is 6');
  ok('month, year and leap-day rollovers are correct');
}

// --- irregular working weeks ---------------------------------------------
// Not everyone works five straight days. Monday on, Tuesday off, back Wednesday
// to Friday is an ordinary pattern and needs no special handling — it is just a
// different set of weekdays.
{
  const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pattern = (days) => S.datesForSeries(series({ days_of_week: days }), '2026-09-07', '2026-09-13')
    .map((d) => NAMES[S.weekdayOf(d)]).join(' ');

  assert.equal(pattern([1, 3, 4, 5]), 'Mon Wed Thu Fri', 'Monday on, Tuesday off, back Wednesday');
  assert.equal(pattern([1, 3, 5]), 'Mon Wed Fri');
  assert.equal(pattern([2, 4]), 'Tue Thu');
  assert.equal(pattern([0, 6]), 'Sat Sun');
  assert.equal(pattern([6]), 'Sat', 'a single day a week is a valid series');
  ok('irregular working weeks need no special case — they are just weekday sets');
}

// --- skipping a single day ------------------------------------------------
// A skip is a cancelled booking. What matters is WHO cancelled: a rider must be
// able to undo their own day off, and must never be able to undo a
// cancellation made by dispatch or a driver.
{
  const now = new Date('2026-09-07T12:00:00Z');
  const ride = (over = {}) => ({
    series_id: 's1', status: 'confirmed',
    scheduled_at: '2026-09-08T11:30:00Z', ...over,
  });
  const skipped = ride({ status: 'canceled', canceled_by: 'rider', cancel_reason: S.SKIP_REASON });

  assert.equal(S.canSkip(ride(), now).ok, true);
  assert.equal(S.canSkip(skipped, now).reason, 'already_skipped');
  assert.equal(S.canSkip(ride({ series_id: null }), now).reason, 'not_a_recurring_ride');
  ok('a future recurring ride can be skipped; a one-off or an already-skipped day cannot');

  // Once a driver is acting on it, a web link is the wrong way to call it off.
  for (const st of ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress', 'completed']) {
    assert.equal(S.canSkip(ride({ status: st }), now).reason, 'ride_already_started', st);
  }
  const soon = ride({ scheduled_at: new Date(now.getTime() + 30 * 60000).toISOString() });
  assert.equal(S.canSkip(soon, now).reason, 'too_close_to_pickup');
  ok('a ride already under way, or minutes from pickup, cannot be skipped from a link');

  // The property that makes un-skipping safe to offer at all.
  assert.equal(S.canUnskip(skipped, now).ok, true);
  for (const [by, reason] of [['system', 'No driver available'], ['driver', 'sick'], ['rider', 'changed my mind']]) {
    const other = ride({ status: 'canceled', canceled_by: by, cancel_reason: reason });
    assert.equal(S.canUnskip(other, now).reason, 'canceled_by_someone_else',
      `${by}/${reason} must not be revivable by the rider`);
  }
  assert.equal(S.canUnskip(ride(), now).reason, 'not_skipped');
  ok('only the rider\'s own skip can be undone, never a dispatch or driver cancellation');
}

console.log(`\n  rideSeries: ${n}/9 groups passed\n`);
