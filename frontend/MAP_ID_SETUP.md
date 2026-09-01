# Enabling 3D buildings (`VITE_GOOGLE_MAPS_MAP_ID`)

The driver map runs raster + `NAV_STYLES` by default. Setting this variable
switches it to a **vector** map, which is the only way Google renders 3D
buildings, tilt, and a heading-up camera.

The value cannot be written by hand or generated outside your project. It is
created in Google Cloud Console and is unique to project `bibior`.

## 1. Create the Map ID

Console → **Google Maps Platform → Map Management** ("Gestion des cartes"):

    https://console.cloud.google.com/google/maps-apis/studio/maps?project=bibior

- **Create Map ID**
- Name: `roverzoom-driver-nav`
- Map type: **JavaScript**
- Rendering: **Vector** — this is the setting that matters. A raster Map ID
  silently ignores `tilt` and gives you no 3D at all.
- Tick **Tilt** and **Rotation**. Without them the API accepts `setTilt()` and
  `setHeading()` and does nothing.

The resulting value is a 16-character hex string, e.g. `8f2b41c9d0e7a35b`.
That string is what goes in the env var. `DEMO_MAP_ID` does NOT work — it is
raster, verified: it reports `renderingType: RASTER` and holds tilt at 0.

## 2. Re-apply the styling — do not skip this

**A Map ID disables the `styles` array in code.** Vector maps are styled in the
console, so without this step the driver map comes back as stock Google Maps:
bright white roads, points of interest, and the parcel numbers that made the
screen read as a real-estate map.

`frontend/map-style.cloud.json` is the exact style the app uses now, in the
format the console imports.

Console → **Map Styles** → Create style → **Import JSON** → paste that file →
save → **associate the style with the Map ID** created above.

## 3. Set the variable

Vercel → project → Settings → Environment Variables:

    VITE_GOOGLE_MAPS_MAP_ID = <the 16-char value>

Then **redeploy**. Vite inlines `VITE_*` at build time, so an existing
deployment will not pick it up.

## 4. What changes

- 3D buildings at close zoom.
- Map rotates to heading-up while following, which puts the vehicle in the
  lower third for every direction of travel — on a north-up map that only held
  when driving north.
- Tilt flattens to 0 on arrival, because a plan view is better for picking out
  which of several doors to stop at.
- Overview stays flat and north-up: `fitBounds` computes a geographic box and
  does not account for a rotated viewport.

## To roll back

Clear the variable and redeploy. The app returns to raster + `NAV_STYLES` with
no code change.

## Unverified

The vector path has not been exercised — it cannot be without a real vector
Map ID. Battery draw is also worth watching: vector maps render through WebGL,
which costs more on a phone already running GPS and a bright screen for a whole
shift.
