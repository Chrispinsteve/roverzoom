import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import { api, newSessionToken } from '../lib/api';

// Address input — the PIVOT of the app. If this fails, booking fails.
//
// Rules:
// 1. When user TYPES, debounce and search. Show dropdown.
// 2. When user PICKS from dropdown → store address + lat/lng, show green check,
//    close dropdown, DO NOT re-search (the old bug).
// 3. If geocoding fails entirely → user can still type a raw address and proceed.
// 4. When user modifies a previously-picked address → clear the "selected" state
//    so they know they need to pick again (or continue with typed text).
// 5. Google Places suggestions arrive WITHOUT coordinates, so picking one
//    now costs a second call to resolve them (api.resolvePlace). Both
//    calls carry the same session token so Google bills the whole
//    interaction once instead of once per keystroke — see lib/api.js.

export default function AddressInput({ label, iconName, placeholder, value, onSelect }) {
  const [query, setQuery] = useState(value?.address || '');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // "confirmed" means the user explicitly picked from the dropdown (has coords).
  // Distinguished from just typing text (no coords).
  const [confirmed, setConfirmed] = useState(!!(value?.lat));
  const debounce = useRef(null);
  const justPicked = useRef(false);
  const wrapperRef = useRef(null);
  // One token per address being entered. Regenerated after each pick,
  // because a session ends the moment Place Details is called — reusing
  // it past that point silently reverts to per-request billing.
  const sessionRef = useRef(newSessionToken());
  const [resolving, setResolving] = useState(false);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Search on type (debounced)
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);

    // If we just programmatically set the query from a pick, skip searching.
    if (justPicked.current) {
      justPicked.current = false;
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
        const r = await api.geocode(query, sessionRef.current);
        setResults(r);
        setOpen(r.length > 0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
      // Sync the parent with the typed text (no coords) so Continue enables
      // even without a dropdown pick.
      setConfirmed(false);
      onSelect({ address: query.trim() });
    }, 500);

    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query]); // eslint-disable-line

  // User picks a result from the dropdown — this is the critical path.
  const pick = async (r) => {
    justPicked.current = true;
    setQuery(r.label + (r.sublabel ? ', ' + r.sublabel : ''));
    setResults([]);
    setOpen(false);
    setConfirmed(true);
    setLoading(false);

    // Fallback providers return coordinates inline; Google does not.
    if (r.lat != null && r.lng != null) {
      onSelect({ address: r.address, lat: r.lat, lng: r.lng });
      sessionRef.current = newSessionToken();
      return;
    }

    // Commit the address text immediately, before the coordinate lookup
    // resolves. If the network is slow the rider can still continue —
    // the booking just falls back to the straight-line fare rather than
    // blocking on a request they cannot see.
    onSelect({ address: r.address });
    setResolving(true);
    try {
      const resolved = await api.resolvePlace(
        { placeId: r.placeId, address: r.address },
        sessionRef.current
      );
      if (resolved?.lat != null) {
        onSelect({ address: resolved.address || r.address, lat: resolved.lat, lng: resolved.lng });
      }
    } catch {
      // Non-fatal: keep the typed address, lose only the coordinates.
    } finally {
      setResolving(false);
      // The session is spent — start a fresh one for the next address.
      sessionRef.current = newSessionToken();
    }
  };

  return (
    <div className="field" ref={wrapperRef}>
      {label && <label className="label">{label}</label>}
      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', left: 15, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <Icon name={iconName || 'pin'} size={20} color={confirmed ? 'var(--positive)' : 'var(--ink-4)'} />
        </span>
        <input
          className="input"
          style={{
            paddingLeft: 46,
            paddingRight: confirmed ? 46 : 16,
            borderColor: confirmed ? 'var(--positive)' : undefined,
          }}
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (confirmed) setConfirmed(false);
          }}
          onFocus={() => {
            if (results.length > 0 && !confirmed) setOpen(true);
          }}
        />
        {/* Selection indicator */}
        {confirmed && (
          <span style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)' }}>
            <Icon name="check" size={18} color="var(--positive)" stroke={2.5} />
          </span>
        )}
        {resolving && (
          <span style={{ position: 'absolute', right: 40, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--ink-4)' }}>
            locating…
          </span>
        )}
        {loading && !confirmed && (
          <span style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--ink-4)' }}>…</span>
        )}
      </div>

      {/* Results dropdown */}
      {open && results.length > 0 && (
        <div className="results" style={{ animation: 'rz-scale-in 0.12s var(--ease) both' }}>
          {results.map((r, i) => (
            <button key={`${r.lat}-${r.lng}-${i}`} className="result-row" onClick={() => pick(r)}>
              <Icon name="pin" size={18} color="var(--ink-4)" />
              <span style={{ minWidth: 0 }}>
                <span className="result-title" style={{ display: 'block' }}>{r.label}</span>
                <span className="result-sub" style={{ display: 'block' }}>{r.sublabel}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
