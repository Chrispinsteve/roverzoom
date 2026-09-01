// ============================================================
// Base map — QUIET, so the route can be LOUD
// ============================================================
// The previous style was near-white land with near-white roads, which put the
// base map and the route in the same brightness band: the mint had to fight
// the road surface for attention, and the whole screen read as glare.
//
// The fix is not to darken the map — a dark map under a bright route is its own
// legibility problem in sunlight. It is to compress the base map into a narrow
// band of muted greys ABOVE which the route sits alone. Land, roads and
// buildings differ from each other by only a few percent of luminance; the
// route differs from all of them by a lot. Road hierarchy is preserved, but it
// is carried by small steps in value rather than by brightness contrast.
//
// LABELS: switched off wholesale, then road names switched back ON.
// The screenshot showed parcel numbers (5899, 5889, 5881, 5941, 5953) scattered
// across a residential block. Those are real-estate data. A driver navigating
// needs the road network and its names, and every other label is something for
// their eyes to reject. Turning labels off by default and re-admitting only
// what is useful is also why this survives Google adding new label classes.
export const NAV_STYLES = [
  // --- surfaces ---------------------------------------------------------
  // WARM, not cool. The palette was a grey-green, which reads as overcast and
  // sits close in hue to both the parks and the mint the app uses elsewhere.
  // Apple's ground is a warm off-white, and it works for two reasons worth
  // copying: warm neutrals look like paper rather than like a screen, and they
  // are the complement of the blue route, so the lane gains contrast from the
  // background instead of fighting it.
  { elementType: 'geometry', stylers: [{ color: '#F1EEE9' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#EFECE6' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#D9E6CF' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#AECFE3' }] },

  // Buildings, and the reason they were invisible twice over.
  //
  // First attempt set the FILL two points off the land, so footprints were
  // drawn and then erased by the palette. Second attempt darkened the fill
  // further and made it worse: landscape.man_made fills the whole developed
  // AREA, not the individual roofs, so darkening it dimmed the entire block
  // while the houses stayed invisible inside it.
  //
  // Buildings are drawn as outlined polygons whose interior matches the land.
  // So the lever that works is the STROKE, not the fill: a 1px outline dark
  // enough to read at a glance. It costs almost no visual weight — the shapes
  // appear, the ground stays quiet, and the route is untouched.
  { featureType: 'landscape.man_made', elementType: 'geometry.fill', stylers: [{ color: '#EAE7E1' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry.stroke', stylers: [{ color: '#A9A399' }] },

  // --- roads are CHANNELS, not stripes ----------------------------------
  // Inverted from what was here. Roads used to be painted DARKER than the
  // land, which is backwards from how every map a driver has ever read works,
  // and it made the network sit on top of the ground rather than being cut
  // into it.
  //
  // Now roads are white with a grey casing — the surface is the lightest thing
  // on the map and the casing gives it an edge. That is Apple's system, and it
  // is what makes a street legible at a glance without the road needing to be
  // dark. Hierarchy is carried by the casing weight and by the highway's warm
  // tint, not by making the tarmac progressively grubbier.
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#C2BAAE' }] },
  { featureType: 'road.arterial', elementType: 'geometry.fill', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road.arterial', elementType: 'geometry.stroke', stylers: [{ color: '#B9B0A3' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#FBEFD2' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#D9C99E' }] },

  // --- everything is silent until proven useful --------------------------
  { elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },

  // --- and then: road names, because that is what the banner names -------
  // The banner says "Deerfield Pl"; the driver has to be able to find
  // Deerfield Pl on the map. Everything else stays off.
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ visibility: 'on' }, { color: '#6E675E' }] },
  { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ visibility: 'on' }, { color: '#F1EEE9' }, { weight: 3 }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  // Local street names only from close in; at route zoom they are clutter.
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  // Highway shields ARE useful — "I-95 N" is how a driver confirms the ramp.
  { featureType: 'road.highway', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] },
];

// ---------------------------------------------------------------------------
// Vector rendering (3D buildings, tilt, heading-up)
// ---------------------------------------------------------------------------
// Google renders 3D buildings ONLY on vector maps, and a map is vector only if
// it is given a mapId that is configured as vector in Cloud Console. Verified:
// a raster map ignores `tilt` outright — Google's own DEMO_MAP_ID reports
// renderingType RASTER and tilt 0 no matter what is requested.
//
// The trade nobody mentions: WHEN A mapId IS SET, THE `styles` ARRAY ABOVE IS
// IGNORED. Vector maps are styled in the Cloud Console, not in code. So every
// decision in NAV_STYLES — the quiet greys, the road hierarchy, the label cull
// that removed the parcel numbers — has to be recreated there or the map comes
// back as stock Google Maps with all its clutter.
//
// Hence: opt-in. With no VITE_GOOGLE_MAPS_MAP_ID the app runs the raster style
// exactly as before. Set one, and the map becomes vector with 3D buildings and
// a heading-up camera. Nothing is guessed at runtime.
export function mapOptionsFor(mapId) {
  const base = {
    disableDefaultUI: true, clickableIcons: false, gestureHandling: 'greedy',
    keyboardShortcuts: false, backgroundColor: '#F1EEE9', minZoom: 4, maxZoom: 20,
  };
  // Passing BOTH mapId and styles logs a console warning and drops styles.
  return mapId ? { ...base, mapId } : { ...base, styles: NAV_STYLES };
}

// Tilt only once there is a route to look along, and only on a vector map.
// A tilted map with no route is just a harder-to-read map.
export const NAV_TILT_DEG = 45;

// ---------------------------------------------------------------------------
// Close-in detail: house numbers
// ---------------------------------------------------------------------------
// NAV_STYLES turns labels off wholesale, which removed the house numbers along
// with the clutter. That was right for one job and wrong for the other.
//
// At route-following zoom a screen full of parcel numbers is noise: the driver
// is reading the road network and the numbers are unreadable at speed anyway.
// At the kerb it inverts completely — the house number IS the task. "5941" on
// the correct roof is worth more than every other label on the map combined,
// and it is the one thing that lets a driver confirm the pin rather than trust
// it. Given that the pin was two houses out on a real booking, that
// confirmation matters.
//
// So the numbers are not a style decision, they are a ZOOM decision. Built by
// removing the blanket labels-off rule rather than by hand-listing feature
// types, so it cannot drift out of sync with NAV_STYLES.
export const DETAIL_STYLES = [
  ...NAV_STYLES.filter((r) => !(r.elementType === 'labels' && !r.featureType)),
  // The blanket rule was also what suppressed these, so re-state them.
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
];

// Google itself does not draw house numbers below about zoom 19, so a lower
// threshold only swapped stylesheets with nothing to show for it. Set just
// under, so the labels are enabled by the time the tiles carry them.
export const DETAIL_ZOOM = 18.5;

// Zoom OR phase. Zoom alone was too fragile: the overview that plays for the
// first few seconds of a trip sits below any sensible threshold, and a driver
// glancing at the map during it saw no numbers at all. Approaching a pickup is
// a statement about the TASK, not the scale, so it reveals them regardless.
export function stylesFor({ zoom, phase } = {}) {
  if (phase && phase !== 'cruise') return DETAIL_STYLES;
  return Number.isFinite(zoom) && zoom >= DETAIL_ZOOM ? DETAIL_STYLES : NAV_STYLES;
}

// Kept for callers that only know the zoom.
export function stylesForZoom(zoom) { return stylesFor({ zoom }); }
