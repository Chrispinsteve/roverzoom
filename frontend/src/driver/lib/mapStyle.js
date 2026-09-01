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
  { elementType: 'geometry', stylers: [{ color: '#E8EBE8' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#E4E9E4' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#E6E9E6' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#DFE7DF' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#D5E3E0' }] },

  // --- road hierarchy, by value rather than by brightness ---------------
  // Each tier is a few percent darker than the one below it. Enough to read
  // the network at a glance; not enough to compete with mint.
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#D4D8D5' }] },
  { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#D4D8D5' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#C1C7C4' }] },
  { featureType: 'road.highway', elementType: 'geometry.fill', stylers: [{ color: '#AEB6B2' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#9EA7A3' }] },
  { featureType: 'road.highway.controlled_access', elementType: 'geometry.fill', stylers: [{ color: '#A6AFAB' }] },

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
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ visibility: 'on' }, { color: '#6C746F' }] },
  { featureType: 'road', elementType: 'labels.text.stroke', stylers: [{ visibility: 'on' }, { color: '#E8EBE8' }, { weight: 3 }] },
  { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  // Local street names only from close in; at route zoom they are clutter.
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  // Highway shields ARE useful — "I-95 N" is how a driver confirms the ramp.
  { featureType: 'road.highway', elementType: 'labels.icon', stylers: [{ visibility: 'on' }] },
];
