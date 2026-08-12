# Google Maps Configuration — A to Z

Everything needed to get RoverZoom's maps, routing, address search and live
tracking working. Follow in order; each step depends on the one before.

**Time:** ~30 minutes. **Cost at RoverZoom's current volume:** likely $0/month.

---

## The one thing to understand before you start

**You need two API keys, not one.** This trips up nearly everyone.

| | Browser key | Server key |
|---|---|---|
| Env var | `VITE_GOOGLE_MAPS_API_KEY` | `GOOGLE_MAPS_API_KEY` |
| Lives in | `frontend/.env` | `backend/.env` |
| Restriction type | **Websites** (HTTP referrer) | **IP addresses** or none |
| Secret? | No — visible in the JS bundle | **Yes** — never reaches a browser |
| Used for | Rendering map tiles | Routing, ETAs, address search |

A referrer-restricted key **cannot** be used from your server: server-to-server
requests send no `Referer` header, so Google returns `REQUEST_DENIED`. The
reverse is also true. **One key cannot carry both restriction types** — this is
a Google Cloud constraint, not a preference.

And Bibior's existing key is almost certainly locked to `bibior.com`, so it
won't render on roverzoom.com until you add the domain (Step E).

---

## A. Pick your Cloud project

Open [console.cloud.google.com](https://console.cloud.google.com) and either
reuse Bibior's project or create a new one (project dropdown, top left →
**New Project** → name it `roverzoom`).

**Reuse Bibior's project if:** you want one bill and one place to manage keys.
**Create a separate one if:** you want RoverZoom's spend, quotas and incidents
isolated from Bibior's — a runaway loop in one app then can't take the other
down.

I'd lean separate. These are two different businesses, and shared quota means a
RoverZoom bug can break Bibior's map.

---

## B. Enable billing

**Billing** → **Link a billing account**.

This is mandatory even to use the free tier. Google will not serve Maps
requests on a project without a billing account attached — you'll get
`BillingNotEnabledMapError` and a grey map.

New accounts get a $300 free trial credit.

---

## C. Enable the four APIs

**APIs & Services** → **Library**, then search for and enable each:

| API | Key that uses it | What breaks without it |
|---|---|---|
| **Maps JavaScript API** | Browser | Every map is grey |
| **Routes API** | Server | No real routes, no live ETAs |
| **Places API (New)** | Server | Address autocomplete falls back to OpenStreetMap |
| **Geocoding API** | Server | AI booking flow can't resolve addresses |

### Two naming traps

**Enable "Places API (New)", not "Places API".** <cite index="11-1">Places API is now Legacy and can no longer be enabled</cite> on new projects. The
code I shipped calls `places.googleapis.com/v1` (the new endpoints)
specifically for this reason — if you enable the wrong one, or follow an
older tutorial, autocomplete will fail.

**Enable "Routes API", not "Directions API".** Directions API still works but
<cite index="8-1">Google has designated some older services as Legacy, including Places API (Legacy), Directions API, and Distance Matrix API</cite>.
The code tries Routes first and only falls back to Directions, so Routes is the
one that matters.

---

## D. Create the two keys

**APIs & Services** → **Credentials** → **Create credentials** → **API key**.
Do this twice. Rename them immediately (click the key → pencil icon) so you
never mix them up:

- `roverzoom-browser`
- `roverzoom-server`

---

## E. Restrict the browser key

Click `roverzoom-browser`.

**Application restrictions** → **Websites** → add:

```
https://roverzoom.com/*
https://*.roverzoom.com/*
https://*.vercel.app/*
http://localhost:5200/*
```

The `*.vercel.app` entry covers Vercel preview deployments — without it every
preview build shows a broken map. `localhost:5200` matches the dev server port
in `vite.config.js`.

**API restrictions** → **Restrict key** → select **Maps JavaScript API** only.

That last part matters. This key is public — anyone can read it out of your JS
bundle. Referrer restrictions stop casual reuse, but they're spoofable with a
forged `Referer` header. Limiting the key to one API caps what a thief can
actually spend on your account.

---

## F. Restrict the server key

Click `roverzoom-server`.

**API restrictions** → **Restrict key** → select **Routes API**, **Places API
(New)**, and **Geocoding API**.

**Application restrictions** → this depends on where the backend runs:

- **Vercel serverless (your current setup):** leave as **None**. Vercel's
  egress IPs aren't stable, so an IP allowlist will break unpredictably. The
  key's protection is that it stays in server-side env vars and never ships to
  a client.
- **A fixed server or static-IP deployment:** use **IP addresses** and list
  them. Strictly better — do this if you ever move off serverless.

**Never put this key in `frontend/.env` or any `VITE_`-prefixed variable.**
Vite inlines every `VITE_*` variable into the public bundle at build time.

---

## G. Set budget alerts and quota caps

Skipping this is how people get a surprise four-figure bill.

**Budget alert** — Billing → **Budgets & alerts** → **Create budget**. Set
something like $50/month with alerts at 50%, 90%, 100%. This *notifies*; it
does not stop spending.

**Quota caps (the actual protection)** — APIs & Services → each API → **Quotas
& System Limits** → set a daily request cap. Suggested starting points for
RoverZoom's stage:

| API | Daily cap |
|---|---|
| Maps JavaScript API | 1,000 |
| Routes API | 500 |
| Places API (New) | 1,000 |
| Geocoding API | 500 |

These are hard stops. Requests beyond them fail rather than bill. Raise them as
real traffic grows — better to hit a cap and adjust than to discover the
problem on an invoice.

---

## H. Put the keys in your environment

**Local** — `frontend/.env`:
```
VITE_GOOGLE_MAPS_API_KEY=AIza...browser
```

`backend/.env`:
```
GOOGLE_MAPS_API_KEY=AIza...server
GOOGLE_MAPS_REGION=us
SERVICE_AREA_LAT=26.7153
SERVICE_AREA_LNG=-80.0534
SERVICE_AREA_RADIUS_M=120000
USE_GOOGLE_ROUTING=false
PUBLIC_APP_URL=https://roverzoom.com
```

**Vercel** — Project → Settings → Environment Variables. Add both, for
Production / Preview / Development.

Vite inlines `VITE_*` at **build time**, not runtime, so **you must redeploy
after adding the browser key.** Setting it and restarting won't do anything.

---

## I. Run the migration

```bash
psql $DATABASE_URL -f backend/db/migrations/002_live_tracking.sql
```

Additive and idempotent — safe against a database with real bookings. (Note
that `schema.sql` is *not* — it opens with `DROP TABLE IF EXISTS bookings
CASCADE`. Don't re-run that one.)

---

## J. Verify each piece

**Browser key** — run `npm run dev`, book a ride, open the tracking link. A
grey map means the key failed; open DevTools console, where Google prints the
exact error:

| Console error | Cause |
|---|---|
| `RefererNotAllowedMapError` | Domain missing from Step E |
| `ApiNotActivatedMapError` | Maps JavaScript API not enabled |
| `BillingNotEnabledMapError` | No billing account linked |
| `InvalidKeyMapError` | Typo, or key deleted |

**Server key** — curl it directly:

```bash
# Routes API
curl -s -X POST 'https://routes.googleapis.com/directions/v2:computeRoutes' \
  -H 'Content-Type: application/json' \
  -H "X-Goog-Api-Key: $GOOGLE_MAPS_API_KEY" \
  -H 'X-Goog-FieldMask: routes.duration,routes.distanceMeters' \
  -d '{"origin":{"location":{"latLng":{"latitude":26.7153,"longitude":-80.0534}}},
       "destination":{"location":{"latLng":{"latitude":25.7959,"longitude":-80.2870}}},
       "travelMode":"DRIVE","routingPreference":"TRAFFIC_AWARE"}'

# Places API (New)
curl -s -X POST 'https://places.googleapis.com/v1/places:autocomplete' \
  -H 'Content-Type: application/json' \
  -H "X-Goog-Api-Key: $GOOGLE_MAPS_API_KEY" \
  -d '{"input":"4001 S Congress Ave","includedRegionCodes":["us"]}'
```

Routes should return roughly `4200s` and `~109000` meters for that pair. If you
get `REQUEST_DENIED`, you've almost certainly put the browser key in
`backend/.env`.

**Full check** — `GET /api/maps/status` reports both keys' configuration state.

---

## K. Decide on real-route pricing

Leave `USE_GOOGLE_ROUTING=false` until you've looked at the numbers.

Your current fare model prices `duration × $50/hr`, where duration is
straight-line distance at a flat 28 mph. That single assumption is wrong in
both directions:

| Trip | Quoted now | Realistic | |
|---|---|---|---|
| WPB → Miami Intl | 181 min / **$150.83** | ~70 min / ~$58 | **2.6× over** |
| Miami Beach → Brickell | 12 min / **$12** | ~20 min / ~$17 | under |

Highway miles are covered far faster than 28 mph; dense city miles far slower.
The overcharge is the urgent one — it lands hardest on exactly the long airport
runs a scheduled-ride product is built to win.

Turning routing on fixes the measurement but **changes what riders pay**. Run
both estimators against your real trip mix, then decide whether $50/hr still
holds once duration is honest.

---

## L. What this will actually cost

<cite index="3-1">Google replaced the old $200 monthly credit on March 1, 2025 with free usage thresholds for each Core Services SKU</cite>. <cite index="5-1">You now get 10K free calls per SKU per month for Essentials, 5K for Pro, and 1K for Enterprise</cite>.

Critically, <cite index="4-1">those caps are per-SKU, not pooled</cite> — so Maps JS, Routes, Places and Geocoding each get their own allowance.

Per booking, RoverZoom uses roughly:

| Call | When | SKU tier |
|---|---|---|
| ~1 autocomplete session × 2 addresses | Booking | Essentials |
| 1 route | Booking or claim (cached after) | Essentials |
| ~1 ETA refresh per minute of trip | Live tracking | Essentials |
| 1–2 map loads | Driver + rider screens | Essentials |

**At 100 bookings/month you are comfortably inside the free tier — $0.**
At ~500 bookings/month you'd start paying, in the low tens of dollars.

The implementation is already built to stay there: route geometry is cached on
the booking row (computed once, not per render), ETAs are throttled to 60s (the
naive per-ping version would run **~$3.60 per driver per hour** — more than
your cut of most rides), and Place Details uses a narrow field mask that keeps
it on the $5/1K Essentials SKU instead of the $17/1K Pro one.

One nuance on autocomplete billing that's easy to miss: <cite index="2-1">if a session terminates with Place Details on the Pro or Enterprise tier, every Autocomplete call in that session is free; if it terminates on Essentials, the first 12 Autocomplete calls are charged and the 13th onward are free</cite>. With a 500 ms debounce a typical address is only a few calls, so Essentials still comes out slightly cheaper — but it's worth re-checking if you ever loosen the debounce.

---

## Quick reference

```
Project        → billing linked
APIs enabled   → Maps JavaScript, Routes, Places (New), Geocoding
Browser key    → Websites restriction, Maps JavaScript only  → VITE_GOOGLE_MAPS_API_KEY
Server key     → API restriction only (Vercel), 3 APIs        → GOOGLE_MAPS_API_KEY
Quota caps     → set on all four
Migration      → 002_live_tracking.sql
Redeploy       → required for the browser key to take effect
```

## Most common failure, in one line

Grey map on production after it worked locally → the browser key's referrer
list is missing your domain, **or** you added the env var to Vercel without
redeploying.
