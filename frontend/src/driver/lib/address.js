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
  return (kept.length ? kept : parts).join(', ');
}
