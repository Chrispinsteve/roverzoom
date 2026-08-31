#!/usr/bin/env node
//
// Generates one landing page per city we serve.
//
// The reason this is a generator and not eight hand-written files: near-
// identical pages with the city name swapped are thin duplicate content, which
// search engines discount and can penalise. So every page carries something
// only that page can say — real distances to each airport, the fare our own
// model produces for those trips, the neighbourhoods in that city, and what
// people there actually travel for.
//
// Distances use the same haversine-times-road-factor fallback that
// backend/services/fare.js uses when the routing API is unavailable, and the
// fares use the real pricing constants. So the numbers on the page are the
// numbers the booking flow will quote, give or take the routing engine.
//
//   node scripts/build-city-pages.mjs
// .mjs because the repo's package.json is "type": "module".
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'frontend', 'public');

// Fares come from the LIVE quote endpoint, not a local approximation.
//
// The first version computed them here with haversine x 1.3, the fallback
// backend/services/fare.js uses when routing is unavailable. Production has
// real routing enabled, so those numbers came out 10-17% HIGH — a page
// quoting more than the booking flow charges is worse than quoting nothing.
const API = process.env.QUOTE_API || 'https://www.roverzoom.com/api/estimate';

async function quote(from, to) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pickup: { lat: from.lat, lng: from.lng },
      dropoff: { lat: to.lat, lng: to.lng },
      // A mid-afternoon weekday, so pages show the STANDARD discount rather
      // than the deeper early-morning one. Quoting the best case as if it
      // were typical would be the same mistake in the other direction.
      when: '2026-09-02T18:00:00Z',
    }),
  });
  if (!res.ok) throw new Error(`quote failed: ${res.status}`);
  return res.json();
}

const AIRPORTS = [
  { code: 'PBI', name: 'Palm Beach International', lat: 26.6832, lng: -80.0956 },
  { code: 'FLL', name: 'Fort Lauderdale-Hollywood International', lat: 26.0742, lng: -80.1506 },
  { code: 'MIA', name: 'Miami International', lat: 25.7959, lng: -80.2870 },
];

// Everything below is specific to the place. If a city cannot be given its own
// neighbourhoods and its own reason for travelling, it should not get a page.
const CITIES = [
  {
    slug: 'west-palm-beach', local: 'Downtown pickups around Clematis Street and Rosemary Square are our most common evening request, and the Kravis Center schedule shows up clearly in our bookings on performance nights. PBI is close enough that the trip usually lands at our minimum fare, which for anything longer than a weekend away is less than the airport car park.', name: 'West Palm Beach', lat: 26.7153, lng: -80.0534,
    areas: ['Downtown', 'Northwood', 'El Cid', 'Flamingo Park', 'Southend', 'Village of North Palm Beach'],
    blurb: 'the county seat and the closest city to Palm Beach International',
    why: 'Downtown offices, the Kravis Center and Clematis Street draw evening trips, and PBI is close enough that a scheduled ride costs less than airport parking for anything longer than a weekend.',
  },
  {
    slug: 'boca-raton', local: 'Boca sits far enough south that Fort Lauderdale is the natural airport rather than Palm Beach International, and our fares reflect that: the FLL run is materially cheaper than the trip north to PBI. The office parks along Yamato Road and Glades Road generate early departures, and Mizner Park evenings are a steady source of rides home.', name: 'Boca Raton', lat: 26.3683, lng: -80.1289,
    areas: ['Downtown Boca', 'Mizner Park', 'Boca Del Mar', 'Broken Sound', 'East Boca'],
    blurb: 'the southern end of the county, closer to Fort Lauderdale than to Palm Beach',
    why: 'Most Boca flights leave from FLL rather than PBI, and the corporate parks off Yamato and Glades generate steady early-morning airport runs.',
  },
  {
    slug: 'delray-beach', local: 'Atlantic Avenue is the reason most people first book with us: a fare agreed in the afternoon does not change because it is now midnight and everybody wants a car at once. Daytime bookings skew towards medical appointments, and the drive to either airport is short enough that Delray riders often choose on flight price rather than airport distance.', name: 'Delray Beach', lat: 26.4615, lng: -80.0728,
    areas: ['Atlantic Avenue', 'Pineapple Grove', 'Lake Ida', 'Delray Shores'],
    blurb: 'between Boynton and Boca on the coast',
    why: 'Atlantic Avenue evenings are the classic case for booking the ride home in advance, and Delray Medical Center appointments make up a steady share of daytime trips.',
  },
  {
    slug: 'boynton-beach', local: 'Boynton sits close to the midpoint between the two main airports, so the choice usually comes down to which flight is cheaper rather than which airport is nearer. A large share of our Boynton bookings are recurring medical trips — treatment on a fixed weekly schedule, where arranging a car each time is the part people want to stop doing.', name: 'Boynton Beach', lat: 26.5318, lng: -80.0905,
    areas: ['Downtown Boynton', 'Renaissance Commons', 'Quantum Park', 'Leisureville'],
    blurb: 'mid-county, roughly equidistant from PBI and FLL',
    why: 'A large retirement population means recurring medical appointments — dialysis, physical therapy, specialist visits — where a ride booked in advance beats arranging one each time.',
  },
  {
    slug: 'wellington', local: 'Wellington is far enough west that on-demand cars are genuinely scarce, particularly early in the morning, which is the situation booking ahead exists for. The equestrian season brings visitors on fixed schedules who need airport runs booked weeks out, and the drive to either airport is long enough that a locked fare is worth more here than nearer the coast.', name: 'Wellington', lat: 26.6618, lng: -80.2683,
    areas: ['Wellington Village', 'Olympia', 'Binks Forest', 'Paddock Park'],
    blurb: 'inland and west, well outside easy reach of on-demand cars',
    why: 'Being further west means fewer drivers passing through, which is exactly where booking ahead matters most. The equestrian season also brings visitors who need airport runs on fixed dates.',
  },
  {
    slug: 'jupiter', local: 'From the north end of the county both Fort Lauderdale and Miami are long drives, so the difference between a locked fare and a surge-priced one is measured in tens of dollars rather than a few. PBI is the practical choice for most Jupiter departures, and Abacoa pickups are common enough that our drivers know the layout.', name: 'Jupiter', lat: 26.9342, lng: -80.0942,
    areas: ['Abacoa', 'Jupiter Inlet Colony', 'Tequesta', 'Jupiter Farms'],
    blurb: 'the northern end of the county',
    why: 'North county trips to FLL or Miami are long enough that a locked fare is worth having, and Jupiter Medical Center appointments are a regular reason to book.',
  },
  {
    slug: 'palm-beach-gardens', local: 'The Gardens is close enough to PBI that airport runs are short and cheap, which makes it one of the areas where booking ahead costs barely more than not bothering. PGA Boulevard generates a steady flow of appointment trips during the day, and the Gardens Mall area is a common evening pickup.', name: 'Palm Beach Gardens', lat: 26.8234, lng: -80.1387,
    areas: ['PGA National', 'Mirasol', 'Ballenisles', 'Downtown at the Gardens'],
    blurb: 'just north of West Palm Beach',
    why: 'Close to PBI for short airport runs, and the medical campus off PGA Boulevard generates a steady flow of appointment trips.',
  },
  {
    slug: 'lake-worth', local: 'Lake Worth Beach is close enough to Palm Beach International that the airport run usually lands at our minimum fare, making it among the cheapest airport trips in the county. Downtown pickups around Lake and Lucerne Avenues are common in the evenings, and the short hop north to West Palm Beach is a frequent daytime booking.', name: 'Lake Worth Beach', lat: 26.6168, lng: -80.0684,
    areas: ['Downtown Lake Worth', 'Bryant Park', 'College Park', 'Lake Worth Beach'],
    blurb: 'immediately south of West Palm Beach',
    why: 'Close enough to PBI that the minimum fare usually applies, which makes it one of the cheaper airport runs in the county.',
  },
];

const money = (n) => '$' + n.toFixed(2);

async function airportRows(city) {
  const out = [];
  for (const a of AIRPORTS) {
    const q = await quote(city, a);
    out.push({ ...a, miles: q.distanceMiles, minutes: q.durationMinutes, fare: q.fare, label: q.durationLabel });
  }
  return out;
}

async function page(city) {
  const rows = await airportRows(city);
  const nearest = rows.slice().sort((x, y) => x.miles - y.miles)[0];
  const title = `Scheduled Rides in ${city.name}, FL | Airport & Appointment Transport | RoverZoom`;
  const desc = `Book a ride in ${city.name} days in advance. Price locked when you book, driver assigned before pickup, no surge. ${nearest.name} is about ${nearest.miles} miles — roughly ${money(nearest.fare)}.`;

  const faq = [
    { q: `How much is a ride from ${city.name} to the airport?`,
      a: `${nearest.name} (${nearest.code}) is about ${nearest.miles} miles from ${city.name}, which comes to roughly ${money(nearest.fare)} at our standard rate. ${rows.filter(r => r.code !== nearest.code).map(r => `${r.name} (${r.code}) is about ${r.miles} miles, roughly ${money(r.fare)}`).join(', and ')}. Your exact fare is shown before you confirm and is locked from that moment.` },
    { q: `How far ahead can I book a ride in ${city.name}?`,
      a: `As far ahead as you like, and booking earlier does not change the price. Most riders book the night before or several days out. The fare depends on distance, not on how close to the pickup you book.` },
    { q: `Do prices go up at busy times in ${city.name}?`,
      a: `No. There is no surge pricing. The fare is set when you book and does not move with demand, traffic or weather.` },
    { q: `Which areas of ${city.name} do you cover?`,
      a: `All of them, including ${city.areas.slice(0, 4).join(', ')}. We serve anywhere within about 75 miles of West Palm Beach.` },
  ];

  const ld = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<meta name="description" content="${desc}" />
<link rel="canonical" href="https://www.roverzoom.com/${city.slug}" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:url" content="https://www.roverzoom.com/${city.slug}" />
<meta property="og:type" content="website" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/landing.css" />
<script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
</script>
</head>
<body>
<div class="wrap">
  <header class="site">
    <a href="/"><img src="/logo-wordmark.png" alt="RoverZoom" /></a>
    <nav>
      <a href="/airport-rides">Airport rides</a>
      <a href="/medical-appointment-rides">Medical rides</a>
      <a href="/">Book a ride</a>
    </nav>
  </header>

  <div class="hero">
    <h1>Scheduled rides in ${city.name}</h1>
    <p class="lede">
      Book a car in ${city.name} days ahead instead of hoping one is free when you need it.
      Your price is locked the moment you book, a driver is assigned before your pickup time,
      and there is no surge pricing — ever.
    </p>
    <a class="cta" href="/">Book a ride in ${city.name}</a>
    <span class="cta-note">Takes about a minute. No account needed.</span>
  </div>

  <h2>Airport runs from ${city.name}</h2>
  <p>
    ${city.name} is ${city.blurb}. ${city.why}
  </p>
  <div class="cards">
${rows.map((r) => `    <div class="card">
      <h3>${r.code} &mdash; ${money(r.fare)}</h3>
      <p>${r.name}. About ${r.miles} miles, roughly ${r.minutes} minutes' driving.</p>
    </div>`).join('\n')}
  </div>
  <p style="font-size:14.5px;color:var(--ink-3)">
    Fares above are estimates at our standard rate for planning purposes. Your exact price is
    calculated from the real road route and shown before you confirm — and it is locked from
    that point. Rides scheduled between 4am and 10am get a deeper discount than shown here.
  </p>

  <p>${city.local}</p>

  <h2>Areas we pick up in ${city.name}</h2>
  <p>${city.areas.join(', ')} — and everywhere in between. We cover anywhere within about 75 miles of West Palm Beach, so a trip that leaves ${city.name} entirely is still a normal booking.</p>

  <p>
    Booking works the same wherever you are: enter the pickup and destination, see the exact
    fare, and confirm. We cover <a href="/airport-rides">airport runs</a> and
    <a href="/medical-appointment-rides">medical appointments</a> from ${city.name}, along with
    commutes and evenings out.
  </p>

  <h2 class="faq">Common questions</h2>
${faq.map((f) => `  <h3>${f.q}</h3>\n  <p>${f.a}</p>`).join('\n')}

  <p style="margin-top:34px"><a class="cta" href="/">Book a ride in ${city.name}</a></p>

  <footer class="site">
    RoverZoom is a service of Bibior,&nbsp;Inc. &middot;
    <a href="/airport-rides">Airport rides</a> &middot;
    <a href="/medical-appointment-rides">Medical rides</a> &middot;
    <a href="/privacy">Privacy</a> &middot;
    <a href="/terms">Terms</a>
  </footer>
</div>
</body>
</html>
`;
}

const built = [];
for (const city of CITIES) {
  const html = await page(city);
  fs.writeFileSync(path.join(OUT, `${city.slug}.html`), html);
  const words = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  built.push({ slug: city.slug, words });
}

// Sitemap, regenerated so it can never drift from what actually exists.
const staticPages = [
  { loc: '/', priority: '1.0', freq: 'weekly' },
  { loc: '/airport-rides', priority: '0.9', freq: 'monthly' },
  { loc: '/medical-appointment-rides', priority: '0.9', freq: 'monthly' },
  ...CITIES.map((c) => ({ loc: `/${c.slug}`, priority: '0.8', freq: 'monthly' })),
  { loc: '/privacy', priority: '0.2', freq: 'yearly' },
  { loc: '/terms', priority: '0.2', freq: 'yearly' },
];
fs.writeFileSync(path.join(OUT, 'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticPages.map((p) => `  <url>
    <loc>https://www.roverzoom.com${p.loc}</loc>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`).join('\n')}
</urlset>
`);

console.log(`  built ${built.length} city pages:`);
for (const b of built) console.log(`    /${b.slug.padEnd(20)} ${b.words} words`);
console.log(`  sitemap regenerated: ${staticPages.length} URLs`);
