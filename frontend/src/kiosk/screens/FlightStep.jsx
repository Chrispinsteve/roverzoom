import { useEffect, useState } from 'react';
import FlowShell from '../components/FlowShell';

// ============================================================
// FlightStep — asked once, calmly, instead of at the kerb
// ============================================================
// Shown ONLY when one end of the trip is an airport we serve, which is a small
// fraction of rides. The server decides that, so this form and the row that
// gets written can never disagree about what counts as an airport.
//
// Everything here is optional and every field can be left blank. The point is
// to remove a conversation that fails for deaf drivers, for drivers and riders
// with no shared language, and for anyone at a kerb with cars queueing behind
// them — not to put a gate in front of a booking.
//
// The DIRECTION is never asked. If the airport is the drop-off the rider is
// flying out; if it is the pickup they have landed. Asking a question whose
// answer is already known is how forms get abandoned.
export default function FlightStep({ booking, airport, onChange, onNext, onBack, step = 2, totalSteps = 4 }) {
  const flight = booking.flight || {};
  const departing = airport?.role === 'departure';
  const [other, setOther] = useState(false);

  // If the route changes to a different airport while this step is open, a
  // terminal from the previous one must not survive into the booking.
  useEffect(() => {
    if (flight.code && airport?.code && flight.code !== airport.code) {
      onChange({ flight: { code: airport.code } });
      setOther(false);
    }
  }, [airport?.code]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (fields) => onChange({ flight: { ...flight, code: airport?.code, ...fields } });
  const answered = Boolean(flight.airline || flight.zone || flight.flight);

  const footer = (
    <div className="k-footer-bar">
      <div className="k-footer-inner">
        <button className="k-next-btn" onClick={onNext}>
          {answered ? 'Continue' : 'Skip for now'}
        </button>
      </div>
    </div>
  );

  return (
    <FlowShell
      title={departing ? 'Your flight out' : 'Your arriving flight'}
      step={step}
      totalSteps={totalSteps}
      onBack={onBack}
      footer={footer}
    >
      <span className="k-q">{departing ? 'Which airline?' : 'Which airline are you arriving on?'}</span>
      <span className="k-q-sub">
        {departing
          ? 'Your driver goes straight to the right departures door — no one has to ask at the kerb.'
          : 'Your driver knows which arrivals door to wait at before you land.'}
      </span>

      <div className="k-chips">
        {(airport?.airlines || []).map((a) => (
          <button
            key={a}
            type="button"
            className={`k-chip${flight.airline === a ? ' k-chip--on' : ''}`}
            onClick={() => { setOther(false); set({ airline: flight.airline === a ? null : a }); }}
          >
            {a}
          </button>
        ))}
        <button
          type="button"
          className={`k-chip${other ? ' k-chip--on' : ''}`}
          onClick={() => { setOther((v) => !v); set({ airline: null }); }}
        >
          Other
        </button>
      </div>
      {other && (
        <div className="field" style={{ marginTop: 12 }}>
          <input
            className="input"
            autoFocus
            placeholder="Airline name"
            value={flight.airline || ''}
            onChange={(e) => set({ airline: e.target.value })}
          />
        </div>
      )}

      {!!airport?.zones?.length && (
        <>
          <span className="k-field-label">
            {airport.zoneLabel === 'Concourse' ? 'Concourse' : 'Terminal'}{' '}
            <span className="k-hint-inline">optional</span>
          </span>
          <span className="k-q-sub">It is on your boarding pass. Leave it blank if you are not sure.</span>
          <div className="k-chips">
            {airport.zones.map((z) => (
              <button
                key={z}
                type="button"
                className={`k-chip k-chip--mark${flight.zone === z ? ' k-chip--on' : ''}`}
                onClick={() => set({ zone: flight.zone === z ? null : z })}
              >
                {/* Led by the digit or letter, because that is what the rider is
                    scanning their boarding pass for. */}
                {z.replace(/^(Terminal|Concourse)\s+/i, '')}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="field" style={{ marginTop: 18 }}>
        <label className="label">Flight number <span className="k-hint-inline">optional</span></label>
        <input
          className="input"
          placeholder="e.g. B6 1442"
          value={flight.flight || ''}
          onChange={(e) => set({ flight: e.target.value })}
        />
      </div>
    </FlowShell>
  );
}
