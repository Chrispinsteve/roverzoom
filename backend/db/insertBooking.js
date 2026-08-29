// Single entry point for creating a booking row.
//
// Exists for one reason: the terms columns (terms_accepted_at, terms_version)
// arrive with backend/db/migration-terms.sql, and code always deploys either
// before or after a migration, never exactly with it. An INSERT naming a
// column that does not exist yet is rejected outright — which would mean
// EVERY BOOKING FAILING for the length of that window. A lost booking is lost
// revenue and a rider who thinks the service is broken.
//
// So: try the full row, and if the database says it does not know those
// columns, insert the booking without them and carry on. The ride is always
// more important than the attestation record attached to it.
const supabase = require('./supabase');

const TERMS_COLUMNS = ['terms_accepted_at', 'terms_version'];

// Flips to false permanently the first time the columns are found missing, so
// we pay for one failed insert per process rather than one per booking.
let hasTermsColumns = true;

const missingColumn = (error) =>
  error && (error.code === 'PGRST204' || error.code === '42703');

function withoutTerms(row) {
  const stripped = { ...row };
  for (const col of TERMS_COLUMNS) delete stripped[col];
  return stripped;
}

async function insertBooking(row) {
  if (hasTermsColumns) {
    const { data, error } = await supabase.from('bookings').insert(row).select().single();
    if (!error) return { data, error: null, termsRecorded: Boolean(row.terms_version) };

    if (!missingColumn(error)) return { data: null, error, termsRecorded: false };

    hasTermsColumns = false;
    console.warn(
      '[bookings] the terms columns are missing — booking without the age attestation. ' +
      'Run backend/db/migration-terms.sql to start recording it.'
    );
  }

  const { data, error } = await supabase
    .from('bookings').insert(withoutTerms(row)).select().single();
  return { data, error, termsRecorded: false };
}

module.exports = { insertBooking };
