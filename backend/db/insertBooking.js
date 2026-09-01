// Single entry point for creating a booking row.
//
// Exists for one reason: some columns arrive with a migration, and code always
// deploys either before or after a migration, never exactly with it. An INSERT
// naming a column that does not exist yet is rejected outright — which would
// mean EVERY BOOKING FAILING for the length of that window. A lost booking is
// lost revenue and a rider who thinks the service is broken.
//
// So: try the full row, and if the database says it does not know some columns,
// drop that group and insert again. The ride is always more important than the
// metadata attached to it.
//
// Written as a LIST of optional groups rather than one special case, because
// there are now two (age attestation, airport details) and there will be more.
// Each group is disabled independently and permanently once found missing, so
// we pay for one failed insert per group per process, not one per booking.
const supabase = require('./supabase');

const OPTIONAL_GROUPS = [
  {
    name: 'terms',
    columns: ['terms_accepted_at', 'terms_version'],
    migration: 'backend/db/migration-terms.sql',
    consequence: 'booking without the age attestation',
    present: true,
  },
  {
    name: 'airport',
    columns: ['airport_role', 'airport_code', 'airport_zone', 'airport_airline', 'airport_flight'],
    migration: 'backend/db/migration-airport.sql',
    consequence: 'the driver will not see the terminal or airline and will have to ask at the kerb',
    present: true,
  },
];

const missingColumn = (error) =>
  error && (error.code === 'PGRST204' || error.code === '42703');

function strip(row, groups) {
  const out = { ...row };
  for (const g of groups) for (const c of g.columns) delete out[c];
  return out;
}

// Which groups this row is actually trying to write. A booking with no airport
// details must not be blamed on a missing airport column.
function groupsInUse(row) {
  return OPTIONAL_GROUPS.filter((g) => g.columns.some((c) => row[c] != null));
}

async function insertBooking(row) {
  const disabled = () => OPTIONAL_GROUPS.filter((g) => !g.present);

  for (let attempt = 0; attempt < OPTIONAL_GROUPS.length + 1; attempt++) {
    const payload = strip(row, disabled());
    const { data, error } = await supabase.from('bookings').insert(payload).select().single();
    if (!error) {
      return { data, error: null, termsRecorded: Boolean(payload.terms_version) };
    }
    if (!missingColumn(error)) return { data: null, error, termsRecorded: false };

    // Something in this row is not in the schema. Disable the groups this row
    // was using and try again; if none are left to disable, the problem is a
    // column we do not manage and the error must surface.
    const candidates = groupsInUse(payload).filter((g) => g.present);
    if (!candidates.length) return { data: null, error, termsRecorded: false };
    for (const g of candidates) {
      g.present = false;
      console.warn(
        `[bookings] the ${g.name} columns are missing — ${g.consequence}. ` +
        `Run ${g.migration} to start recording it.`
      );
    }
  }
  return { data: null, error: new Error('insertBooking: exhausted fallbacks'), termsRecorded: false };
}

module.exports = { insertBooking };
