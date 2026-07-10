import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { api } from '../lib/api';

// Address field with live search. Key behavior: even if geocoding returns
// nothing (Nominatim down/rate-limited), the user can still TYPE an address
// and proceed — we store the raw text with no coords, and the fare model
// falls back gracefully. The flow must never dead-end here.
export default function AddressInput({ label, iconName, placeholder, value, onSelect }) {
  const [query, setQuery] = useState(value?.address || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const debounce = useRef(null);
  // Set right before a programmatic setQuery (initial pre-filled value, or a
  // dropdown pick) so the effect below can skip re-searching. Comparing
  // query to value.address doesn't work for this: pick() shows the short
  // r.label in the field while storing the full r.address, so they never
  // match and every pick silently re-triggered a search whose result
  // (address-only, no lat/lng) clobbered the coordinates just selected.
  const skipNextSearch = useRef(!!value?.address);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    setFailed(false);
    if (skipNextSearch.current) {
      skipNextSearch.current = false;
      setResults([]);
      setLoading(false);
      return;
    }
    if (query.trim().length < 3) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        const r = await api.geocode(query);
        setResults(r);
        setOpen(true);
        setFailed(r.length === 0);
      } catch {
        setResults([]);
        setFailed(true);
      } finally {
        setLoading(false);
      }
      // As the user types, keep the parent in sync with a text-only value so
      // Continue enables even without picking a dropdown result.
      onSelect({ address: query.trim() });
    }, 450);
    return () => debounce.current && clearTimeout(debounce.current);
  }, [query]); // eslint-disable-line

  const pick = (r) => {
    skipNextSearch.current = true;
    onSelect({ address: r.address, lat: r.lat, lng: r.lng });
    setQuery(r.label);
    setOpen(false);
    setResults([]);
    setFailed(false);
  };

  return (
    <div className="field">
      <label className="label">{label}</label>
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <Icon name={iconName} size={20} color="var(--ink-4)" />
        </span>
        <input
          className="input"
          style={{ paddingLeft: 46 }}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
        />
        {loading && (
          <span style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--ink-4)' }}>…</span>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="results">
          {results.map((r, i) => (
            <button key={`${r.lat}-${i}`} className="result-row" onClick={() => pick(r)}>
              <Icon name="pin" size={18} color="var(--ink-4)" />
              <span style={{ minWidth: 0 }}>
                <span className="result-title" style={{ display: 'block' }}>{r.label}</span>
                <span className="result-sub" style={{ display: 'block' }}>{r.sublabel}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {failed && query.trim().length >= 3 && !loading && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
          No matches found — you can type the full address and continue.
        </p>
      )}
    </div>
  );
}
