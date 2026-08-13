// Generalizes a full street address down to just its city/area, for showing
// drivers a brief dropoff before they've claimed a ride (see requireCompleteProfile
// gating in routes/driver.js). Pure string manipulation on the existing
// comma-separated address text — no new geocoding/reverse-lookup infra.
function briefAddress(fullAddress) {
  if (!fullAddress) return fullAddress;
  const parts = fullAddress.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return fullAddress; // no comma structure to safely redact

  // Drop the street-level first segment, then drop trailing zip/country noise.
  const rest = parts.slice(1).filter((p) => !/^\d+$/.test(p) && p.toLowerCase() !== 'united states');
  const brief = rest.slice(0, 2).join(', ');
  return brief || fullAddress;
}

module.exports = { briefAddress };
