// Generates one forecast page per popular water in data/lakes.json, plus /lakes/, sitemap.xml and robots.txt.
// Runs on Netlify at deploy time (no packages needed). To add a lake, add a line to data/lakes.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public");
const SITE = "https://getbitescore.com";
const lakes = JSON.parse(fs.readFileSync(path.join(root, "data", "lakes.json"), "utf8"));
const template = fs.readFileSync(path.join(pub, "index.html"), "utf8");

const STATES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = l => (l.name + "-" + l.state).toLowerCase().replace(/'/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const list = arr => arr.length < 2 ? arr.join("") : arr.slice(0, -1).join(", ") + (arr.length > 2 ? "," : "") + " and " + arr[arr.length - 1];
const today = new Date().toISOString().slice(0, 10);

function setMeta(html, attr, key, value) {
  const re = new RegExp(`<meta ${attr}="${key}" content="[^"]*">`);
  const tag = `<meta ${attr}="${key}" content="${esc(value)}">`;
  return re.test(html) ? html.replace(re, tag) : html.replace("</head>", tag + "\n</head>");
}

lakes.forEach(l => { l.slug = slug(l); l.path = `/lake/${l.slug}/`; l.stateName = STATES[l.state] || l.state; l.label = `${l.name}, ${l.state}`; });

for (const l of lakes) {
  const title = `${l.name} Fishing Forecast: Best Time to Fish Today | Bite Score`;
  const desc = `Live 1–10 bite score for ${l.name}, ${l.stateName}: the best time to fish today, a 7-day fishing forecast, solunar times${l.salt ? ", tides" : ""} and conditions.`;
  const nearby = lakes.filter(x => x !== l && x.state === l.state).slice(0, 8);
  const more = nearby.length < 4 ? lakes.filter(x => x !== l && x.state !== l.state).sort((a, b) => Math.hypot(a.lat - l.lat, a.lon - l.lon) - Math.hypot(b.lat - l.lat, b.lon - l.lon)).slice(0, 6 - nearby.length) : [];
  const links = [...nearby, ...more].map(x => `<a href="${x.path}">${esc(x.name)}</a>`).join("");
  const seo = `
    <h1>${esc(l.name)} fishing forecast</h1>
    <p>Bite Score rates fishing at ${esc(l.name)} in ${esc(l.stateName)} from 1 to 10 for today and each of the next 6 days. The score weighs the barometric pressure trend, wind, cloud cover, rain${l.salt ? ", the tide from the nearest NOAA station" : ""}, sunrise and sunset, solunar periods and the moon phase, and it updates every hour as the forecast changes.</p>
    <h2>Best time to fish ${esc(l.name)} today</h2>
    <p>The prime time window at the top of this page is the best two-hour stretch of the day, usually lined up with a major solunar period, sunrise or sunset${l.salt ? ", or a moving tide" : ""}. Tap any day in the weekly schedule to plan a trip, or turn on bite alerts to get a phone notification when ${esc(l.name)} is forecast to hit 8 or better.</p>
    <h2>What's biting</h2>
    <p>Anglers at ${esc(l.name)} commonly target ${esc(list(l.species))}. Check current ${esc(l.stateName)} fishing regulations for seasons, size limits and bag limits before you go.</p>
    ${links ? `<h2>Nearby fishing forecasts</h2><div class="linkgrid">${links}</div>` : ""}
    <p><a href="/lakes/">See every lake and river forecast</a></p>`;
  const spot = { name: l.name, label: l.label, lat: l.lat, lon: l.lon, path: l.path };
  let html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace("<!--SEO-->", seo)
    .replace("window.BITE_SPOT=null;/*SPOT*/", `window.BITE_SPOT=${JSON.stringify(spot).replace(/</g, "\\u003c")};`);
  html = setMeta(html, "name", "description", desc);
  html = setMeta(html, "property", "og:title", `${l.name} Fishing Forecast | Bite Score`);
  html = setMeta(html, "property", "og:description", desc);
  html = setMeta(html, "property", "og:url", SITE + l.path);
  html = html.replace('<link rel="manifest"', `<link rel="canonical" href="${SITE + l.path}">\n<link rel="manifest"`).replace(/<link rel="canonical" href="https:\/\/getbitescore\.com\/">\n/, "");
  html = html.replace("</head>", `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", name: title, description: desc, url: SITE + l.path, about: { "@type": "BodyOfWater", name: l.name, geo: { "@type": "GeoCoordinates", latitude: l.lat, longitude: l.lon } } }).replace(/</g, "\\u003c")}</script>\n</head>`);
  const dir = path.join(pub, "lake", l.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
}

// /lakes/ index, grouped by state
const byState = {};
lakes.forEach(l => (byState[l.stateName] = byState[l.stateName] || []).push(l));
const groups = Object.keys(byState).sort().map(s => `<h2>${esc(s)}</h2><div class="linkgrid">${byState[s].sort((a, b) => a.name.localeCompare(b.name)).map(l => `<a href="${l.path}">${esc(l.name)}</a>`).join("")}</div>`).join("\n");
const indexHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Fishing Forecasts by Lake and River | Bite Score</title>
<meta name="description" content="Live fishing forecasts and the best time to fish today for ${lakes.length} popular lakes, rivers, bays and coasts across the US.">
<link rel="canonical" href="${SITE}/lakes/">
<meta name="theme-color" content="#0a1630">
<link rel="icon" href="/icon-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800;900&family=Barlow+Condensed:wght@500;600;700;800&family=Barlow:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/app.css">
</head>
<body style="padding-block:0 32px">
<div class="wrap">
  <header class="top"><a class="brand" href="/" style="color:inherit;text-decoration:none"><b>Bite<span>Score</span></b></a><a class="locbtn" href="/" style="color:inherit;text-decoration:none">📍 <span>Near me</span></a></header>
  <section class="seo">
    <h1>Fishing forecasts by lake and river</h1>
    <p>Pick your water for today's Bite Score, the best time to fish and the 7-day outlook. Don't see yours? <a href="/">Search any lake, river or bay</a>.</p>
    ${groups}
  </section>
</div>
</body>
</html>
`;
fs.mkdirSync(path.join(pub, "lakes"), { recursive: true });
fs.writeFileSync(path.join(pub, "lakes", "index.html"), indexHtml);

// sitemap + robots
const urls = ["/", "/lakes/", ...lakes.map(l => l.path)].map(u => `  <url><loc>${SITE + u}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq></url>`).join("\n");
fs.writeFileSync(path.join(pub, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
fs.writeFileSync(path.join(pub, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /embed.html\n\nSitemap: ${SITE}/sitemap.xml\n`);
console.log(`Built ${lakes.length} lake pages, /lakes/, sitemap.xml and robots.txt`);
