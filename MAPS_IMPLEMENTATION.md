# Maps & Live Tracking — Implementation Notes

Real Google Maps rendering, live driver tracking for riders, and the data
layer an admin dashboard will need.

---

## 1. The credentials question, answered first

The plan was "take the same Google credentials Bibior uses and put them in
RoverZoom's env." That does not work as-is, for two independent reasons.

### You need two keys, not one

| | Browser key | Server key |
|---|---|---|
| Env var | `VITE_GOOGLE_MAPS_API_KEY` (frontend) | `GOOGLE_MAPS_API_KEY` (backend) |
| Used for | Rendering map tiles | Routing, ETAs, autocomplete, geocoding |
| Restriction | HTTP referrer | IP address (or unrestricted) |
| Secret? | No — ships in the JS bundle | **Yes** — never reaches a client |

A referrer-restricted key **cannot** be used server-side. Server-to-server
requests send no `Referer` header, so Google returns `REQUEST_DENIED`. The
reverse is equally true. One key genuinely cannot carry both restriction
types — this is a Google Cloud constraint, not a preference.

### Bibior's key won't work on roverzoom.com until you add the domain

Browser keys are locked to a referrer allowlist. Bibior's key almost
certainly lists `bibior.com`. Either add the RoverZoom domains to that
key, or issue a new one:

```
https://roverzoom.com/*
https://*.roverzoom.com/*
http://localhost:5200/*
```

### APIs to enable

Bibior only needs Maps JavaScript + Places + Geocoding. RoverZoom needs
more, because it routes:

- **Maps JavaScript API** — browser key
- **Routes API** — server key, primary routing
- **Places API (New)** — server key, autocomplete + place details
- **Geocoding API** — server key
- **Directions API** — optional server-key fallback if Routes isn't enabled

Enable **Places API (New)**, not "Places API": the latter is Legacy and can no
longer be enabled on new Cloud projects. The code calls
`places.googleapis.com/v1` for exactly this reason.

Step-by-step console walkthrough: **GOOGLE_MAPS_SETUP.md**

Set a **billing quota cap** on both keys before going live. A public
browser key with no cap is an open invoice.

---

## 2. Setup

```bash
# 1. Migration (additive — safe on a database with real bookings)
psql $DATABASE_URL -f backend/db/migrations/002_live_tracking.sql

# 2. Dependencies
npm install && npm install --prefix backend

# 3. Fill in the new env vars (see frontend/.env and backend/.env)
```

Minimum to get maps rendering: `VITE_GOOGLE_MAPS_API_KEY`.
Everything else degrades gracefully without configuration.

---

## 3. What was built

### Database (`002_live_tracking.sql`)

Additive only. `schema.sql` opens with `DROP TABLE IF EXISTS bookings
CASCADE`, so it is destructive on re-run; this migration deliberately does
not touch it and is safe against live data.

- **`bookings.track_token`** — 128-bit tracking secret, Postgres-generated
- **`bookings.route_*`** — cached route geometry, computed once per booking
- **`bookings.eta_*`** — live ETA with a refresh timestamp
- **`driver_locations`** — append-only GPS breadcrumb trail
- **`drivers.current_heading / speed / accuracy`**
- **`prune_driver_locations(days)`** — retention, unscheduled by design

### Why `track_token` and not the `RZ-XXXXX` reference

The reference is 5 characters from a 32-symbol alphabet — about 33.5
million combinations. That's correct as a booking ID: short enough to read
aloud in a car. It is not enough entropy for a public URL that anyone with
the link can open. A script walks that space.

The tracking link is the rider's only credential, so it gets its own
128-bit secret. This also separates the concepts cleanly — `reference`
identifies a booking, `track_token` authorizes watching it — which means
revoking tracking later is a token rotation, not an identity change.

### Backend

| File | Purpose |
|---|---|
| `services/googleMaps.js` | Routes API → Directions API → fail; Places with session tokens; geocoding |
| `services/fare.js` | Real-route pricing behind a flag, straight-line fallback |
| `services/geocode.js` | Google → Nominatim → Photon |
| `routes/track.js` | Public rider tracking |
| `routes/driver.js` | Location ingest, lifecycle state machine, crash recovery |
| `routes/admin.js` | Fleet view, trip replay |
| `middleware/requireAdmin.js` | Shared-key auth (interim) |

### Frontend

| File | Purpose |
|---|---|
| `lib/GoogleMapsProvider.jsx` | Loads the Maps JS API once |
| `lib/useAnimatedPosition.js` | Interpolation — the thing that makes it look live |
| `lib/useTracking.js` | Adaptive polling with backoff |
| `components/LiveMap.jsx` | The one real map component |
| `driver/useDriverLocation.js` | GPS capture, batching, offline queue |
| `steps/TrackRide.jsx` | Rider tracking page at `/track/<token>` |

---

## 4. Decisions worth knowing about

### Why riders poll instead of using Supabase Realtime

Realtime would be the obvious choice and it is the wrong one here.
`postgres_changes` authorizes through RLS, which evaluates `auth.uid()`.
**RoverZoom riders have no Supabase Auth session** — bookings are anonymous.
There is no uid to write a policy against.

The only way to make Realtime work for an anonymous rider would be an RLS
policy permissive enough to let someone with no identity read a driver's
position — and any policy that loose lets *anyone* stream *every* driver's
position. Not a trade worth making to avoid a polling loop.

So: 5-second polling against a service-role endpoint, authorized on
possession of the token, combined with client-side interpolation. To the
person watching, it is indistinguishable from a socket. If this ever needs
to scale past polling, the upgrade path is Realtime **Broadcast** on a
per-booking channel with a server-signed token — not `postgres_changes`.

### Driver position is gated on trip status

This is the easiest thing to get wrong and the most damaging.

Bookings are made days ahead. A naive implementation streams an assigned
driver's live GPS from the moment they claim the ride — which means a
stranger watching a driver at home, overnight, via a link that was texted
to them.

Position is therefore `null` unless the booking is in `driver_en_route`,
`arrived`, or `in_progress`, and the link expires two hours after the trip
ends. Verified by test.

### The tracking response never uses `SELECT *`

Explicit column list. Rider name, phone and email are withheld — a
forwarded link must not become a contact-harvesting tool. The driver's
surname, phone and ID are withheld too; the response carries
`"Marcus D."`, the vehicle description, and the plate (which is painted on
the car and is how a passenger finds it at a busy kerb).

### Interpolation is not decoration

Bind a marker directly to 5-second polling and the car sits still, jumps
50 metres, freezes again. Users don't read that as "data updates every 5s"
— they read it as broken, or as the driver having stopped.

`useAnimatedPosition` animates toward each new fix over the expected
interval. Two details that are easy to get wrong and are handled:

- **Heading takes the short way round.** Naive lerp from 350° to 10° spins
  the car 340° backwards. Unit-tested.
- **Large jumps snap rather than animate.** A fix that moves the car 2 km
  is signal recovery, not driving. Sliding smoothly across it looks absurd.

Honours `prefers-reduced-motion`.

### Location upload is batched, not per-fix

This runs on a phone, in a car, for hours, in a tab the OS can suspend.
Per-fix POSTing fails exactly where it matters. So: sample every 5s, upload
every 20s, cap the buffer, re-queue failed batches at the front to preserve
order, and flush on `visibilitychange` / `pagehide` — because a
backgrounded tab may never get another interval tick.

A screen wake lock is held during trips: a sleeping phone stops timers and,
on some platforms, the geolocation watch with them.

### Fare accuracy — read this before enabling routing

Your current model prices on `duration × $50/hr` where duration is
haversine distance at a flat 28 mph. Measured:

| Trip | Quoted now | Realistic | |
|---|---|---|---|
| WPB → Miami Intl | 181 min / **$150.83** | ~70 min / ~$58 | **2.6× over** |
| Greenacres → PBI | 12 min / $12 | ~15 min / ~$14 | slightly under |
| Miami Beach → Brickell | 12 min / **$12** | ~20 min / ~$17 | under |

A flat average is wrong in both directions: highway miles are covered far
faster than 28 mph, dense city miles far slower. The overcharge is the
urgent one — a $150 quote on a $58 ride doesn't lose margin, it loses the
booking, and it's worst on exactly the long airport runs a scheduled-ride
product is built to win.

`USE_GOOGLE_ROUTING=false` by default. Turning it on changes prices, so run
both estimators side by side on your real trip mix first, then decide
whether $50/hr still holds once duration is honest.

### Cost control

Uncontrolled, this API surface gets expensive fast:

- **Route geometry cached on the booking row.** Computed once at
  claim/creation; every later render — driver, rider, admin replay — reads
  the column. Not once per map render.
- **Places session tokens.** Without them Google bills every keystroke;
  with them, a whole typing session plus the final details lookup bills as
  one. One token per address, discarded after each pick.
- **ETA throttled to 60s per booking.** The naive version (one Directions
  call per GPS ping) is ~12 requests/minute/driver ≈ **$3.60 per driver per
  hour** — more than the platform's cut of most rides. The client counts
  down locally between refreshes.
- **Maps library lazy-loaded.** See below.

### Bundle size

Adding the maps library naively cost +178 kB on every page load, including
the landing page and booking wizard, which have no map. It's now
code-split:

```
before:  442 kB  (single bundle)
after:   195 kB  initial
         163 kB  LiveMap chunk      — only when a map renders
         256 kB  DriverApp chunk    — only in driver mode
```

**56% smaller initial load than before this change.** The maps provider is
mounted inside `DriverApp` and `TrackRide` rather than at the app root
specifically to keep it out of the main bundle.

---

## 5. Admin dashboard — what's ready

Read-only, on a separate domain, behind `x-admin-key`:

```
GET /api/admin/fleet                        online drivers + positions + active trip
GET /api/admin/trips/active                 every trip in motion
GET /api/admin/bookings/:id/trail           GPS replay (downsampled, ends preserved)
```

`LiveMap` already accepts a `trail` prop and renders it in a different
colour from the planned route, so planned-vs-actual comparison — the whole
point of the replay view — works out of the box.

When you build the dashboard:
1. Set `ADMIN_API_KEY` (`openssl rand -hex 32`)
2. Add its origin to `CORS_ORIGINS`
3. Replace the shared key with real per-admin auth

**The shared key is a stopgap and should be treated as one.** One secret
for everyone, no expiry, no audit trail, no per-endpoint scoping — on
endpoints that expose continuous location history for real people. It fails
closed (unset = disabled) but it is not a destination. The natural
replacement is Supabase Auth plus an `admins` table, mirroring how drivers
already authenticate.

---

## 6. Flagged, not silently changed

**`GET /api/bookings/:reference` returns `rider_phone` and `rider_email`**
to anyone presenting a valid reference — and a reference is enumerable
(~33.5M). This predates this work. Fixing it means either narrowing the
projection or requiring the phone number as a second factor, and both
change a contract the confirmation screen depends on, so I left it alone
rather than breaking something I can't test against your live app.

The new tracking flow deliberately does not route through it.

**`RouteMap`'s props changed.** The old `pathD` / `labels` / `carPos` /
`squarePos` / `fabs` props are gone; it now takes `booking` +
`driverPosition`. `NavigateToPickup` and `OnTrip` are updated. Any other
caller needs updating.

**Driver lifecycle screens now run on real data.** They previously used a
hardcoded mock `RIDE` object. `RideDetails`, `NewRideRequest` and
`TripComplete` still consume the old nested shape via an adapter
(`bookingToRide` in `DriverApp.jsx`) — that's deliberate scope control, and
they can be migrated to the raw booking shape separately.

Rider ratings show `—` rather than a fabricated 4.9. Riders have no
accounts and therefore no rating history; drivers make real decisions on
that number.

---

## 7. Verification

Everything below was executed, not assumed.

- **Migration** — applied to a real PostgreSQL 16 instance against the
  actual `schema.sql`; confirmed idempotent on re-run, token backfill
  works, prune function executes.
- **Integration** — **54/54 passing.** Full flow (booking → claim →
  lifecycle → GPS → rider view → admin) plus authorization boundaries:
  cross-driver claim, cross-driver status change, cross-driver ping
  attribution, illegal transitions, malformed and wrong tokens, admin key
  rejection, and the position-gating privacy boundary.
- **Signup trigger** — the test seeds drivers through the real
  `on_auth_user_created` trigger, confirming client-supplied
  `status: 'active'` is ignored (no self-activation).
- **Heading interpolation** — unit-tested across the 0°/360° wrap.
- **Build** — clean, with bundle sizes above.

Not verified, because it needs real credentials and real phones:
live Google API responses, GPS behaviour in a moving vehicle, and
cross-device battery impact.

---

## 8. Suggested next steps

1. Provision the two keys, set quota caps, run the migration.
2. Send the tracking link by SMS on booking confirmation — `trackUrl` is
   already returned by both booking endpoints. Right now the rider only
   gets it on the confirmation screen.
3. Compare fare estimators on real bookings before enabling routing.
4. Schedule `prune_driver_locations()` and make the retention window match
   what your privacy policy tells drivers.
5. Replace the admin shared key when the dashboard lands.
