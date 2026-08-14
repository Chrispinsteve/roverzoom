// ============================================================
// GOOGLE MAPS PROVIDER — loads the Maps JS API exactly once
// ============================================================
// Same pattern as Bibior's GoogleMapsProvider.tsx, ported to JSX and
// adjusted for what a ride app actually needs in the browser.
//
// Library list differs from Bibior's on purpose:
//
//   Bibior loads ['places', 'geocoding'] because its hosts type
//   addresses directly into a Google Places widget in the browser.
//
//   RoverZoom loads ['geometry'] only. Address search here runs
//   server-side (services/geocode.js) so the flow keeps its Nominatim
//   fallback and so autocomplete session tokens can be managed in one
//   place — a browser widget that silently re-bills per keystroke is
//   exactly the kind of cost leak that only shows up on the invoice.
//   What the browser genuinely cannot do without is `geometry`, which
//   provides encoding.decodePath() for turning the stored encoded
//   polyline back into map coordinates.
//
// Loading fewer libraries is also just faster: each one is a separate
// chunk fetched before the map can render.
// ============================================================

import { useJsApiLoader } from '@react-google-maps/api';
import { createContext, useContext } from 'react';

// Declared at module scope, never inline in the component. useJsApiLoader
// compares this array by reference on every render; an inline literal
// creates a new array each time, which makes the loader think the
// configuration changed and warns about (or attempts) a reload of an API
// that can only ever be loaded once per page.
const LIBRARIES = ['geometry'];

const GoogleMapsContext = createContext({
  isLoaded: false,
  loadError: undefined,
  hasApiKey: false,
});

export function GoogleMapsProvider({ children }) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
  const hasApiKey = apiKey.length > 10; // basic sanity check

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'roverzoom-google-maps',
    googleMapsApiKey: apiKey,
    libraries: LIBRARIES,
    preventGoogleFontsLoading: !hasApiKey,
  });

  return (
    <GoogleMapsContext.Provider value={{ isLoaded: hasApiKey && isLoaded, loadError, hasApiKey }}>
      {children}
    </GoogleMapsContext.Provider>
  );
}

export function useGoogleMaps() {
  return useContext(GoogleMapsContext);
}
