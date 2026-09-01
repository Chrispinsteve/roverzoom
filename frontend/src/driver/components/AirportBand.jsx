// ============================================================
// AirportBand — the terminal, without the conversation
// ============================================================
// This exists so a driver never has to ask "which terminal?" through a window.
// That question fails precisely where it costs most: a driver who is deaf, a
// driver and rider with no language in common, a rider off an overnight flight
// — and it fails at a kerb where there is nowhere to stop and sort it out.
//
// So it is built to be understood WITHOUT READING ENGLISH:
//
//   the glyph      a plane climbing or descending — departure or arrival,
//                  the same symbol used on airport signage worldwide
//   the zone       "3" or "B" set larger than anything else on the card,
//                  because a numeral and a letter are language-independent
//   the airline    a brand name, which is the same word in every language and
//                  is how the kerbside signage is actually organised
//
// The English words are there for the drivers who want them, never as the only
// way to get the message. Nothing here needs to be heard or discussed.
//
// Always visible, never inside the collapsible sheet: it is the one fact that
// changes where the vehicle physically goes.

const DEPARTURE = '#0A84FF';
const ARRIVAL = '#3EE0A0';

// Pull the digit or letter out of "Terminal 3" / "Concourse B" so it can be set
// large on its own. Falls back to the whole string for anything unexpected —
// showing an odd label is fine, showing nothing is not.
function zoneParts(zone, code) {
  if (!zone) return { label: null, mark: null };
  const m = /^(terminal|concourse|gate)\s+(.+)$/i.exec(zone.trim());
  if (m) return { label: m[1].toUpperCase(), mark: m[2].toUpperCase() };
  return { label: code || null, mark: zone.toUpperCase() };
}

export default function AirportBand({ booking }) {
  const role = booking?.airport_role;
  if (!role) return null;

  const departing = role === 'departure';
  const accent = departing ? DEPARTURE : ARRIVAL;
  const { label, mark } = zoneParts(booking.airport_zone, booking.airport_code);

  return (
    <div className="drv-air" style={{ borderColor: accent }}>
      <span className="drv-air-glyph" style={{ color: accent }} aria-hidden="true">
        {departing ? (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.5 19h19v2h-19zM21 12.4c.2-.8-.3-1.6-1.1-1.8l-5-1.3-3.2-6-1.6-.4v5.6L5.4 7.2 5 4.7l-1.2-.3-.9 3.6c-.1.5.2 1 .7 1.2l14.9 4c.8.2 1.6-.3 1.8-1.1z" />
          </svg>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.5 19h19v2h-19zM3.3 10.9c-.5.2-.8.7-.7 1.2l.9 3.6 1.2-.3.4-2.5 4.7-1.3v5.6l1.6-.4 3.2-6 5-1.3c.8-.2 1.3-1 1.1-1.8-.2-.8-1-1.3-1.8-1.1l-14.9 4z" />
          </svg>
        )}
      </span>

      <div className="drv-air-main">
        <div className="drv-air-role" style={{ color: accent }}>
          {departing ? 'DEPARTURES' : 'ARRIVALS'}
          {booking.airport_code ? ` · ${booking.airport_code}` : ''}
        </div>
        <div className="drv-air-zone">
          {mark ? (
            <>
              {label && <span className="drv-air-zone-k">{label}</span>}
              {/* The largest thing on the card. A numeral or a letter needs no
                  translation and no hearing. */}
              <span className="drv-air-zone-v">{mark}</span>
            </>
          ) : (
            <span className="drv-air-zone-k">Terminal not given</span>
          )}
        </div>
        {(booking.airport_airline || booking.airport_flight) && (
          <div className="drv-air-sub">
            {booking.airport_airline}
            {booking.airport_airline && booking.airport_flight ? ' · ' : ''}
            {booking.airport_flight}
          </div>
        )}
      </div>
    </div>
  );
}
