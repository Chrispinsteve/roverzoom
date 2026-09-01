// Trim the verbose tail off a geocoded address (county, state, ZIP, country)
// so a driver sees a clean street + city. The full form — e.g. "DMV, Goolsby
// Boulevard, Deerfield Beach, Broward County, Florida, 33442, United States" —
// wraps to four lines and eats the whole phone screen. The driver navigates by
// the map link anyway; this is just the readable label.
export function shortAddress(addr) {
  if (!addr) return '';
  const parts = String(addr).split(',').map((s) => s.trim()).filter(Boolean);
  const kept = parts.filter((p) =>
    !/^(united states|usa|u\.?s\.?a?\.?)$/i.test(p) &&
    !/\bcounty\b/i.test(p) &&
    !/^\d{5}(-\d{4})?$/.test(p) &&
    // Google returns the state and ZIP as a SINGLE comma part — "FL 33487" —
    // so tests for them separately both miss and the whole tail survives. That
    // is what pushed "6001 Broken Sound Parkway Northwest, Boca Raton, FL
    // 33487" past two lines and truncated the street number off the end, which
    // is the part a driver needs on arrival. Matches either form, and any
    // state, since the service area is no longer only Florida.
    !/^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/i.test(p) &&
    !/^(florida)(\s+\d{5}(-\d{4})?)?$/i.test(p)
  );
  const out = kept.length ? kept : parts;

  // OSM's display_name puts the house number in its OWN comma part:
  //   "5941, Deerfield Place, Palm Beach County, Florida, 33463, United States"
  // Joined naively that renders as "5941, Deerfield Place" — a comma no
  // canonical address has, and the form the driver saw on screen. Rejoin the
  // number to the street it belongs to. Google's Places format already has
  // them together, so this is a no-op there.
  if (out.length > 1 && /^\d+[a-z]?$/i.test(out[0])) {
    out.splice(0, 2, `${out[0]} ${out[1]}`);
  }
  return out.join(', ');
}

// The street line on its own, for a two-line display where the city is
// secondary. Returns the whole thing when there is nothing to split off.
export function addressLines(addr) {
  const full = shortAddress(addr);
  if (!full) return { street: '', locality: '' };
  const parts = full.split(',').map((s) => s.trim()).filter(Boolean);
  return { street: parts[0] || full, locality: parts.slice(1).join(', ') };
}
