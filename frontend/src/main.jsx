import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';

// NOTE: GoogleMapsProvider is deliberately NOT mounted here.
//
// Wrapping at the root would be the conventional placement (it is what
// Bibior does), but importing the provider here pulls
// @react-google-maps/api into the main bundle — measured at +178 kB
// raw / +42 kB gzipped on every page load, including the landing page
// and the whole booking wizard, none of which render a map.
//
// The provider is mounted inside DriverApp and TrackRide instead, and
// both are lazy-loaded from App.jsx, so the maps library ships as a
// separate chunk fetched only when a map is actually about to appear.
// useJsApiLoader dedupes the script injection globally by id, so having
// the provider in two places loads Google's script exactly once.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
