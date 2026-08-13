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
    !/^(fl|florida)$/i.test(p)
  );
  return (kept.length ? kept : parts).join(', ');
}
