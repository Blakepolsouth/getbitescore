/* Bite Score app — UI layer. Scoring lives in engine.js. */
import {
  buildModel, bestWindow, snapWindow, primeFor, tierOf, grade, gradeTier, reason, phaseName,
  fetchForecast, fetchStationList, nearestStation, fetchTides, inTideRegion, spotURL, SITE,
  fmtT as fT, fmtRange as fR, parts, DN, DL, MN, keyDate, compass, inHg, clamp, avg
} from "./engine.js";

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem("bs_" + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("bs_" + k, JSON.stringify(v)); } catch (e) {} }
};
const PREVIEW = !/^https?:$/.test(location.protocol) || /claude|claudeusercontent|localhost/.test(location.hostname);
const PAGE_SPOT = window.BITE_SPOT || null;   // set on /lake/... pages

let MODEL = null, PLACE = null, SEL = 0, DEMO = false, STATION = null, PENDING_DAY = null;
const fmtT = (ms, short) => fT(ms, MODEL ? MODEL.tz : "UTC", short);
const fmtRange = (a, b) => fR(a, b, MODEL ? MODEL.tz : "UTC");

/* ───────── Render ───────── */
function render() {
  if (!MODEL) return;
  const D = MODEL.days[SEL], s = D.summary, t = tierOf(D.score);
  $("bug").classList.remove("loading"); $("bug").style.setProperty("--tier", t.c);
  $("bugPlace").textContent = PLACE.label;
  const dt = keyDate(D.key);
  $("dayName").textContent = (D.isToday ? "Today · " : "") + `${DL[dt.getUTCDay()]}, ${MN[dt.getUTCMonth()]} ${dt.getUTCDate()}`;
  $("score").innerHTML = `${D.score}<sup>/10</sup>`;
  $("verdict").innerHTML = `<span>${t.name}</span>`;
  const { w, passed } = primeFor(D);
  $("prime").textContent = w.start ? fmtRange(w.start, w.end) : "–";
  $("primeNote").textContent = passed ? (w.start ? `Earlier window ${fmtRange(passed.start, passed.end)} has passed.` : "Today's best window has passed. Check tomorrow.") : primeWhy(w, D);
  $("why").textContent = reason(s);
  const al = $("alert");
  if (s.storms) { al.hidden = false; al.textContent = "⚡ Storms forecast during fishing hours. Stay off the water when you hear thunder."; }
  else if (s.gust > 30) { al.hidden = false; al.textContent = `💨 Gusts up to ${Math.round(s.gust)} mph. Small boats use caution.`; }
  else al.hidden = true;
  renderWeek(); renderChart(D, w); renderTimes(D, w); renderStats(D); renderTicker(D, w); renderAlerts(); renderEmbed();
  $("starBtn").setAttribute("aria-pressed", isSaved() ? "true" : "false");
  $("live").classList.toggle("sample", DEMO); $("liveTxt").textContent = DEMO ? "SAMPLE" : "LIVE";
  $("tideLegend").hidden = !MODEL.hasTides;
}
function primeWhy(w, D) {
  if (!w.start) return "";
  const ev = D.ev;
  const all = [...ev.majors.map(x => ({ t: x.t, n: "major solunar period" })), ...ev.minors.map(x => ({ t: x.t, n: "minor solunar period" })),
    ...(ev.sunrise ? [{ t: ev.sunrise, n: "sunrise" }] : []), ...(ev.sunset ? [{ t: ev.sunset, n: "sunset" }] : [])];
  const hit = [...new Set(all.filter(x => x.t >= w.start - 5 * 60000 && x.t <= w.end + 5 * 60000).map(x => x.n))];
  if (MODEL.hasTides) { const mid = D.fish.find(x => x.ms <= (w.start + w.end) / 2 && x.ms + 3600e3 > (w.start + w.end) / 2); if (mid && mid.f.t >= .7) hit.push(mid.incoming ? "incoming tide" : "outgoing tide"); }
  return hit.length ? "Lines up with " + hit.join(" + ") : "Best conditions of the day";
}
function renderWeek() {
  const wk = $("week"); wk.innerHTML = "";
  const best = MODEL.days.reduce((a, d) => d.score > a.score ? d : a, MODEL.days[0]), bd = keyDate(best.key);
  $("bestDay").innerHTML = `Best: <span style="color:var(--gold)">${best.isToday ? "Today" : DN[bd.getUTCDay()]} ${best.score}/10</span>`;
  MODEL.days.forEach((d, i) => {
    const t = tierOf(d.score), dt = keyDate(d.key), b = document.createElement("button");
    b.className = "day"; b.type = "button"; b.style.setProperty("--tier", t.c); b.setAttribute("aria-pressed", i === SEL ? "true" : "false");
    b.setAttribute("aria-label", `${DL[dt.getUTCDay()]}: score ${d.score} out of 10, ${t.name}`);
    b.innerHTML = `<span class="dn"${d.isToday ? ' style="font-size:11px"' : ""}>${d.isToday ? "Today" : DN[dt.getUTCDay()]}</span><span class="ds">${d.score}</span><span class="bar"></span><span class="dd">${MN[dt.getUTCMonth()]} ${dt.getUTCDate()}</span>`;
    b.onclick = () => { SEL = i; render(); updateURL(); };
    wk.appendChild(b);
  });
}
function renderChart(D, w) {
  const hrs = D.fish, W = 380, top = 14, base = 104, left = 4, bw = (W - left * 2) / hrs.length; let g = "";
  [2.5, 5, 7.5, 10].forEach(v => { const y = base - (v / 10) * (base - top); g += `<line x1="0" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1" stroke-dasharray="${v === 10 ? "0" : "2 4"}"/>`; });
  if (w.start) {
    const a = clamp(left + ((w.start - hrs[0].ms) / 3600e3) * bw, 0, W), b = clamp(left + ((w.end - hrs[0].ms) / 3600e3) * bw, 0, W);
    if (b > a) g += `<rect x="${a}" y="${top - 8}" width="${b - a}" height="${base - top + 8}" fill="var(--gold)" fill-opacity=".14" stroke="var(--gold)" stroke-width="1.5" rx="2"/><text x="${(a + b) / 2}" y="${top - 1}" fill="var(--gold)" font-family="Barlow Condensed,Arial Narrow,sans-serif" font-weight="800" font-size="10" text-anchor="middle" letter-spacing="1">PRIME</text>`;
  }
  hrs.forEach((x, i) => {
    const v = clamp(x.score, 0, 10), hgt = Math.max(3, (v / 10) * (base - top)), t = tierOf(Math.round(v)), X = left + i * bw + 1.5;
    g += `<rect x="${X}" y="${base - hgt}" width="${bw - 3}" height="${hgt}" rx="1.5" fill="${t.c}" fill-opacity="${x.ms + 3600e3 < Date.now() && D.isToday ? .35 : 1}"><title>${fmtT(x.ms)} · ${v.toFixed(1)}</title></rect>`;
    if (x.code >= 95) g += `<text x="${X + (bw - 3) / 2}" y="${base - hgt - 3}" font-size="10" text-anchor="middle">⚡</text>`;
    if (x.hr % 3 === 0) g += `<text x="${X + (bw - 3) / 2}" y="${base + 16}" fill="var(--muted)" font-family="Barlow Condensed,Arial Narrow,sans-serif" font-weight="600" font-size="11" text-anchor="middle">${fmtT(x.ms, "ap")}</text>`;
  });
  if (D.isToday) { const nx = left + ((Date.now() - hrs[0].ms) / 3600e3) * bw; if (nx > 0 && nx < W) g += `<line x1="${nx}" x2="${nx}" y1="${top - 8}" y2="${base}" stroke="var(--red)" stroke-width="2"/><text x="${nx}" y="${base + 28}" fill="var(--red)" font-family="Barlow Condensed,Arial Narrow,sans-serif" font-weight="800" font-size="10" text-anchor="middle">NOW</text>`; }
  $("chart").innerHTML = g; $("clockLbl").textContent = "4 AM – 10 PM";
}
function renderTimes(D, w) {
  const ev = D.ev, c = [];
  if (ev.sunrise) c.push({ t: ev.sunrise, n: "Sunrise", cls: "" }); if (ev.sunset) c.push({ t: ev.sunset, n: "Sunset", cls: "" });
  ev.majors.forEach(m => c.push({ t: m.t, n: "Major", cls: "major" })); ev.minors.forEach(m => c.push({ t: m.t, n: "Minor", cls: "" }));
  (D.summary.tides || []).forEach(x => c.push({ t: x.t, n: x.type === "H" ? "High tide" : "Low tide", cls: "tide" }));
  c.sort((a, b) => a.t - b.t);
  if (w && w.start) c.unshift({ t: w.start, n: "Prime", cls: "prime", txt: fmtRange(w.start, w.end) });
  $("times").innerHTML = c.map(x => `<span class="chip ${x.cls}"><em>${x.n}</em>${x.txt || fmtT(x.t)}</span>`).join("");
}
function renderStats(D) {
  const s = D.summary, arrow = s.pTrend <= -0.8 ? "▼ Falling" : s.pTrend >= 0.8 ? "▲ Rising" : "▶ Steady";
  const solG = clamp(.35 + D.ev.majors.length * .2 + D.ev.minors.length * .08, 0, 1);
  const rows = [
    ["Pressure", `${inHg(s.pNoon)} inHg ${arrow}`, `${s.pTrend > 0 ? "+" : ""}${(s.pTrend * 0.02953).toFixed(2)} inHg from 6 AM to 6 PM`, s.p],
    ["Wind", `${compass(s.wdir)} ${Math.round(s.wind)} mph`, s.gust ? `Gusts to ${Math.round(s.gust)} mph` : "Daytime average", s.w],
    ["Sky", s.cloud >= 70 ? "Overcast" : s.cloud >= 35 ? "Partly cloudy" : "Mostly sunny", `${Math.round(s.cloud)}% average cloud cover`, s.c],
    ["Rain", s.storms ? "Thunderstorms" : s.rainIn > 0.25 ? "Wet day" : s.rainIn > 0.02 ? "Light showers" : "Dry", (s.rainPct != null ? `${Math.round(s.rainPct)}% chance · ` : "") + `${s.rainIn.toFixed(2)} in`, s.r]
  ];
  if (MODEL.hasTides && s.t != null) {
    const tl = (s.tides || []).map(x => `${x.type === "H" ? "High" : "Low"} ${fmtT(x.t)}`).join(" · ");
    rows.push(["Tide", tl || "See chips above", STATION ? `${STATION.name} (NOAA), ${Math.max(1, Math.round(STATION.km * 0.621))} mi away` : "NOAA predictions", s.t]);
  }
  rows.push(
    ["Temp", `${Math.round(s.tmax)}° / ${Math.round(s.tmin)}°`, Math.round(s.tdiff) ? `${s.tdiff > 0 ? "+" : ""}${Math.round(s.tdiff)}° vs. yesterday's high` : "About the same as yesterday", s.ts],
    ["Moon", phaseName(s.phase), `${Math.round(s.illum * 100)}% lit · new and full moons fish best`, .3 + .7 * s.ps],
    ["Solunar", `${D.ev.majors.length} major · ${D.ev.minors.length} minor`, D.ev.majors.length ? "Majors: " + D.ev.majors.map(m => fmtT(m.t)).join(", ") : "No major period today", solG]
  );
  $("stats").innerHTML = rows.map(r => `<div class="row"><div class="k">${r[0]}</div><div class="v"><b>${esc(r[1])}</b><small>${esc(r[2])}</small></div><div class="grade" style="--tier:${gradeTier(r[3])}">${grade(r[3])}</div></div>`).join("");
}
function renderTicker(D, w) {
  const s = D.summary;
  const items = [
    `${PLACE.name}: Bite Score ${D.score}/10`, w.start ? `Prime time ${fmtRange(w.start, w.end)}` : "",
    `Barometer ${inHg(s.pNoon)} ${s.pTrend <= -0.8 ? "falling" : s.pTrend >= 0.8 ? "rising" : "steady"}`, `Wind ${compass(s.wdir)} ${Math.round(s.wind)} mph`,
    ...(s.tides || []).slice(0, 2).map(x => `${x.type === "H" ? "High" : "Low"} tide ${fmtT(x.t)}`),
    phaseName(s.phase), D.ev.sunrise ? `Sunrise ${fmtT(D.ev.sunrise)}` : "", D.ev.sunset ? `Sunset ${fmtT(D.ev.sunset)}` : "",
    ...MODEL.days.filter((d, i) => i !== SEL).sort((a, b) => b.score - a.score).slice(0, 2).map(d => `Best this week: ${DL[keyDate(d.key).getUTCDay()]} ${d.score}/10`),
    DEMO ? "Sample data — live forecast loads when hosted" : "Forecast updates hourly"
  ].filter(Boolean);
  const html = items.map(i => `<span>${esc(i)}</span>`).join(""); $("track").innerHTML = html + html;
}

/* ───────── Data ───────── */
function sampleData() { /* deterministic, realistic week for the preview: a cold front arrives mid-week */
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", n = new Date(), y = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  const h = { time: [], temperature_2m: [], pressure_msl: [], wind_speed_10m: [], wind_direction_10m: [], wind_gusts_10m: [], cloud_cover: [], precipitation: [], precipitation_probability: [], weather_code: [] };
  let seed = 7; const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let k = 0; k < 8 * 24; k++) {
    const t = new Date(y.getTime() + k * 3600e3), hr = k % 24, day = Math.floor(k / 24); h.time.push(Math.round(t.getTime() / 1000));
    const front = k - 24 * 3.6, p = 1018 - 7 * Math.exp(-(front ** 2) / (2 * 30 ** 2)) + (front > 0 ? 4 * Math.min(1, front / 40) : 0) + Math.sin(k / 9) * .4;
    h.pressure_msl.push(+p.toFixed(1));
    const w = Math.max(1, 6 + 4 * Math.sin((hr - 9) / 24 * 2 * Math.PI) + (Math.abs(front) < 14 ? 9 : 0) + (day === 5 ? 5 : 0) + rnd() * 2);
    h.wind_speed_10m.push(+w.toFixed(1)); h.wind_gusts_10m.push(+(w * 1.5).toFixed(1)); h.wind_direction_10m.push(front < 0 ? 200 : 320);
    const c = clamp((front < 0 && front > -30 ? 85 : front < 10 && front >= 0 ? 95 : 25 + 30 * Math.sin(day)) + rnd() * 10, 0, 100); h.cloud_cover.push(Math.round(c));
    const storm = front > -3 && front < 3 && hr >= 12, pr = storm ? 0.3 : (front > -10 && front < 8 ? 0.04 : 0); h.precipitation.push(pr);
    h.precipitation_probability.push(storm ? 80 : pr ? 50 : Math.round(rnd() * 10)); h.weather_code.push(storm ? 95 : pr ? 61 : c > 70 ? 3 : 1);
    h.temperature_2m.push(+(60 + 10 * Math.sin((hr - 9) / 24 * 2 * Math.PI) - (front > 0 ? 8 * Math.min(1, front / 24) : 0) + day * .5).toFixed(1));
  }
  return { hourly: h, timezone: tz };
}
async function stationList() {
  const c = store.get("stations", null);
  if (c && c.at > Date.now() - 30 * 864e5 && c.list && c.list.length) return c.list;
  const list = await fetchStationList(); store.set("stations", { at: Date.now(), list }); return list;
}
async function tidesFor(p) {
  STATION = null;
  if (PREVIEW || !inTideRegion(p)) return null;
  try { const st = nearestStation(await stationList(), p.lat, p.lon, 30); if (!st) return null; const t = await fetchTides(st.id); STATION = st; return t; }
  catch (e) { return null; }
}
async function reverseName(lat, lon) {
  try {
    const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`); const j = await r.json();
    const n = j.locality || j.city || "Your spot";
    return { name: n, label: [n, j.principalSubdivisionCode ? j.principalSubdivisionCode.replace(/^US-/, "") : j.countryName].filter(Boolean).join(", ") };
  } catch (e) { return { name: "Your spot", label: "Your current location" }; }
}
async function load(p, opt) {
  opt = opt || {};
  const keepKey = opt.keepDay && MODEL && MODEL.days[SEL] ? MODEL.days[SEL].key : null;
  PLACE = p; renderSaved(); if (!opt.noRemember) store.set("last", p);
  $("bug").classList.add("loading"); $("bugPlace").textContent = p.label;
  if (!opt.keepDay) $("why").textContent = "Checking pressure, wind, sky, tides and the moon for your water.";
  let data; DEMO = false;
  const tideP = tidesFor(p);
  try { data = await fetchForecast(p); }
  catch (e) { if (PREVIEW) { data = sampleData(); DEMO = true; } else { if (!MODEL || !opt.keepDay) showError(); return; } }
  const tides = await tideP;
  MODEL = buildModel(data.hourly, data.timezone || "UTC", p, tides);
  const want = PENDING_DAY || keepKey; PENDING_DAY = null;
  const i = want ? MODEL.days.findIndex(d => d.key === want) : -1; SEL = i >= 0 ? i : 0;
  render(); updateURL();
}
function showError() {
  MODEL = null; const b = $("bug"); b.classList.remove("loading"); b.style.setProperty("--tier", "var(--muted)");
  $("score").innerHTML = "–<sup>/10</sup>"; $("verdict").innerHTML = "<span>No signal</span>"; $("prime").textContent = "–"; $("primeNote").textContent = "";
  $("why").innerHTML = 'Couldn\'t reach the forecast. Check your connection, then <button class="btn" id="retryBtn" type="button" style="padding:6px 12px;font-size:14px">Try again</button>';
  $("retryBtn").onclick = () => load(PLACE);
}

/* ───────── Links ───────── */
const onPageSpot = () => PAGE_SPOT && PLACE && PAGE_SPOT.lat === PLACE.lat && PAGE_SPOT.lon === PLACE.lon;
function shareURL() { const D = MODEL && MODEL.days[SEL]; return spotURL(PLACE, D, MODEL ? MODEL.tz : "UTC", onPageSpot() ? PAGE_SPOT.path : "/"); }
function updateURL() {
  if (PREVIEW || !PLACE) return;
  try {
    if (onPageSpot()) { const D = MODEL && MODEL.days[SEL]; history.replaceState(null, "", PAGE_SPOT.path + (D && !D.isToday ? "?d=" + D.key : "")); }
    else { const q = new URLSearchParams({ at: `${PLACE.lat},${PLACE.lon}`, n: PLACE.name, l: PLACE.label }); const D = MODEL && MODEL.days[SEL]; if (D && !D.isToday) q.set("d", D.key); history.replaceState(null, "", "/?" + q.toString()); }
  } catch (e) {}
}
function fromURL() {
  try {
    const q = new URLSearchParams(location.search);
    if (/^\d{4}-\d{2}-\d{2}$/.test(q.get("d") || "")) PENDING_DAY = q.get("d");
    const at = (q.get("at") || "").split(",").map(Number);
    if (at.length !== 2 || at.some(isNaN) || Math.abs(at[0]) > 90 || Math.abs(at[1]) > 180) return null;
    const n = (q.get("n") || "Shared spot").slice(0, 60), l = (q.get("l") || n).slice(0, 80);
    return { name: n, label: l, lat: at[0], lon: at[1] };
  } catch (e) { return null; }
}

/* ───────── Search, location, saved spots ───────── */
const SAMPLE_PLACE = { name: "Lake Okeechobee", label: "Lake Okeechobee, FL", lat: 26.95, lon: -80.8 };
const STATE = { "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY" };
const abbr = st => STATE[st] || st || "";
function waterKind(k, v) {
  if (k === "waterway") return ({ river: "River", riverbank: "River", stream: "Creek", canal: "Canal", dam: "Dam", weir: "Dam", rapids: "River" })[v] || null;
  if (k === "natural") return ({ water: "Lake", bay: "Bay", strait: "Sound", spring: "Spring", wetland: "Marsh", beach: "Beach", reef: "Reef" })[v] || null;
  if (k === "landuse") return v === "reservoir" || v === "basin" ? "Reservoir" : null;
  if (k === "leisure") return ({ marina: "Marina", slipway: "Boat ramp", fishing: "Fishing spot", park: "Park", nature_reserve: "Park" })[v] || null;
  if (k === "place") return v === "island" || v === "islet" ? "Island" : (v === "sea" || v === "ocean") ? "Coast" : null;
  if (k === "man_made") return v === "pier" || v === "breakwater" ? "Pier" : null;
  if (k === "water") return "Lake";
  return null;
}
const KIND_ICO = { River: "〰️", Creek: "〰️", Canal: "〰️", Dam: "🌊", Lake: "💧", Reservoir: "💧", Spring: "💧", Bay: "🌊", Sound: "🌊", Coast: "🌊", Reef: "🐠", Beach: "🏖️", Marsh: "🌾", Marina: "⚓", Pier: "⚓", "Boat ramp": "🚤", "Fishing spot": "🎣", Island: "🏝️", Park: "🌲", Town: "🏘️" };
let searchSeq = 0, searchTimer = null;
async function search(q) {
  const seq = ++searchSeq, res = $("results"); res.hidden = false; res.innerHTML = `<div class="note" style="padding:8px">Searching…</div>`;
  const bias = PLACE ? `&lat=${PLACE.lat}&lon=${PLACE.lon}` : "";
  const [ph, om] = await Promise.allSettled([
    fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=12&lang=en${bias}`).then(r => r.json()),
    fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`).then(r => r.json())
  ]);
  if (seq !== searchSeq) return;
  const out = [], seen = new Set();
  const add = x => { const k = x.name.toLowerCase() + "|" + x.lat.toFixed(1) + "|" + x.lon.toFixed(1); if (seen.has(k)) return; seen.add(k); out.push(x); };
  if (ph.status === "fulfilled" && ph.value && ph.value.features) ph.value.features.forEach(f => {
    const p = f.properties || {}, c = f.geometry && f.geometry.coordinates; if (!p.name || !c) return;
    const kind = waterKind(p.osm_key, p.osm_value), town = ["city", "town", "village", "hamlet", "locality", "suburb"].includes(p.osm_value) || p.type === "city";
    if (!kind && !town) return;
    const st = p.countrycode === "US" ? abbr(p.state) : (p.country || "");
    add({ name: p.name, kind: kind || "Town", water: !!kind, region: [kind ? (p.county || p.city) : null, st].filter(Boolean).join(", "), lat: +c[1].toFixed(4), lon: +c[0].toFixed(4), label: [p.name, st].filter(Boolean).join(", ") });
  });
  if (om.status === "fulfilled" && om.value && om.value.results) om.value.results.forEach(x => {
    const st = x.country_code === "US" ? abbr(x.admin1) : x.country;
    add({ name: x.name, kind: "Town", water: false, region: [x.admin2, st].filter(Boolean).join(", "), lat: +x.latitude.toFixed(4), lon: +x.longitude.toFixed(4), label: [x.name, st].filter(Boolean).join(", ") });
  });
  out.sort((a, b) => (b.water - a.water));
  if (!out.length) {
    res.innerHTML = (ph.status === "rejected" && om.status === "rejected") ? `<div class="note" style="padding:8px">Search needs an internet connection.</div>` : `<div class="note" style="padding:8px">No match for “${esc(q)}”. Try adding the state, like “Lake Guntersville AL”, or search the nearest town.</div>`;
    return;
  }
  res.innerHTML = "";
  out.slice(0, 10).forEach(x => {
    const b = document.createElement("button"); b.type = "button";
    b.innerHTML = `<span class="ico">${KIND_ICO[x.kind] || "📍"}</span><span class="txt"><span class="kind">${esc(x.kind)}</span><br><b>${esc(x.name)}</b> <small>${esc(x.region)}</small></span><span>›</span>`;
    b.onclick = () => { closeResults(); $("q").value = ""; load({ name: x.name, label: x.label, lat: x.lat, lon: x.lon }); };
    res.appendChild(b);
  });
}
function closeResults() { $("results").hidden = true; $("results").innerHTML = ""; }
function useGPS(fallback) {
  if (!navigator.geolocation) { fallback ? fallback() : toast("Location isn't available. Search instead."); return; }
  $("bugPlace").textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = +pos.coords.latitude.toFixed(5), lon = +pos.coords.longitude.toFixed(5), acc = Math.round(pos.coords.accuracy || 0), n = await reverseName(lat, lon);
    load({ name: "My spot near " + n.name, label: "My spot · near " + n.label, lat, lon });
    if (acc) toast(`Located within ${acc < 1000 ? Math.max(acc, 1) + " m" : (acc / 1000).toFixed(1) + " km"}`);
  }, () => {
    if (fallback) fallback(); else { if (PLACE) $("bugPlace").textContent = PLACE.label; toast("Location is off. Search for your water instead."); $("q").focus(); }
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
}
const savedList = () => store.get("saved", []);
const isSaved = () => PLACE && savedList().some(s => s.lat === PLACE.lat && s.lon === PLACE.lon);
function renderSaved() {
  const s = savedList(); $("savedWrap").hidden = !s.length; const el = $("saved"); el.innerHTML = "";
  s.forEach(p => { const b = document.createElement("button"); b.type = "button"; b.textContent = p.name; b.title = p.label; b.onclick = () => load(p); el.appendChild(b); });
}
$("locBtn").onclick = () => useGPS();
$("searchForm").addEventListener("submit", e => { e.preventDefault(); clearTimeout(searchTimer); const q = $("q").value.trim(); if (q.length > 1) { $("q").blur(); search(q); } });
$("q").addEventListener("input", () => { clearTimeout(searchTimer); const q = $("q").value.trim(); if (q.length < 3) { searchSeq++; closeResults(); return; } searchTimer = setTimeout(() => search(q), 400); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeResults(); });
$("starBtn").onclick = () => {
  if (!PLACE) return; let s = savedList();
  if (isSaved()) s = s.filter(x => !(x.lat === PLACE.lat && x.lon === PLACE.lon)); else s.unshift(PLACE);
  store.set("saved", s.slice(0, 12)); $("starBtn").setAttribute("aria-pressed", isSaved() ? "true" : "false"); toast(isSaved() ? "Spot saved" : "Spot removed"); renderSaved();
};

/* ───────── Share ───────── */
function shareText() {
  const D = MODEL.days[SEL], { w } = primeFor(D), when = D.isToday ? "today" : DL[keyDate(D.key).getUTCDay()];
  return `🎣 BITE SCORE ${D.score}/10 ${when} at ${PLACE.name}. ${tierOf(D.score).name}!${w.start ? ` Prime time ${fmtRange(w.start, w.end)}.` : ""} Who's in?\n${shareURL()}`;
}
function cardBlob() {
  return new Promise(res => {
    try {
      const D = MODEL.days[SEL], t = tierOf(D.score), dt = keyDate(D.key), { w } = primeFor(D);
      const c = document.createElement("canvas"); c.width = 1080; c.height = 1350; const x = c.getContext("2d");
      const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim(), col = css("--" + t.k);
      x.fillStyle = css("--field"); x.fillRect(0, 0, 1080, 1350); x.fillStyle = css("--panel"); x.fillRect(60, 170, 960, 1000);
      x.strokeStyle = css("--gold"); x.lineWidth = 8; x.beginPath(); x.moveTo(60, 300); x.lineTo(1020, 300); x.stroke();
      x.fillStyle = css("--chalk"); x.font = "900 92px 'Big Shoulders Display',Impact,sans-serif"; x.fillText("BITE", 60, 120); x.fillStyle = css("--gold"); x.fillText("SCORE", 268, 120);
      x.fillStyle = css("--red"); x.fillRect(840, 52, 180, 70); x.fillStyle = "#fff"; x.font = "800 44px 'Barlow Condensed',sans-serif"; x.fillText(DEMO ? "SAMPLE" : "LIVE", 870, 104);
      x.fillStyle = css("--chalk"); x.font = "800 56px 'Barlow Condensed',sans-serif"; x.fillText(PLACE.label.toUpperCase().slice(0, 30), 100, 262);
      x.fillStyle = col; x.font = "900 520px 'Big Shoulders Display',Impact,sans-serif"; x.fillText(String(D.score), 100, 780);
      x.fillStyle = css("--muted"); x.font = "800 90px 'Big Shoulders Display',sans-serif"; x.fillText("/10", D.score >= 10 ? 620 : 420, 500);
      x.fillStyle = col; x.save(); x.translate(100, 840); x.transform(1, 0, -.14, 1, 0, 0); x.fillRect(0, 0, 640, 120); x.restore();
      x.fillStyle = css("--field"); x.font = "900 92px 'Big Shoulders Display',sans-serif"; x.fillText(t.name.toUpperCase(), 130, 935);
      x.fillStyle = css("--muted"); x.font = "700 44px 'Barlow Condensed',sans-serif"; x.fillText(((D.isToday ? "TODAY · " : "") + DL[dt.getUTCDay()] + ", " + MN[dt.getUTCMonth()] + " " + dt.getUTCDate()).toUpperCase(), 100, 1040);
      x.fillStyle = css("--chalk"); x.font = "800 64px 'Big Shoulders Display',sans-serif"; x.fillText(w.start ? "PRIME TIME " + fmtRange(w.start, w.end) : "", 100, 1120);
      x.fillStyle = css("--chalk"); x.fillRect(0, 1230, 1080, 120); x.fillStyle = css("--red"); x.fillRect(0, 1230, 260, 120);
      x.fillStyle = "#fff"; x.font = "900 52px 'Big Shoulders Display',sans-serif"; x.fillText("WHO'S IN?", 28, 1308);
      x.fillStyle = css("--ink"); x.font = "700 44px 'Barlow Condensed',sans-serif"; x.fillText("Get yours at getbitescore.com", 300, 1306);
      c.toBlob(b => res(b), "image/png");
    } catch (e) { res(null); }
  });
}
$("shareBtn").onclick = async () => {
  if (!MODEL) return; const text = shareText();
  try {
    if (navigator.share) {
      const b = await cardBlob(), file = b ? new File([b], "bite-score.png", { type: "image/png" }) : null;
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ text, files: [file] }); return; }
      await navigator.share({ text }); return;
    }
  } catch (e) { if (e && e.name === "AbortError") return; }
  $("shareBox").hidden = false; $("shareText").value = text; $("shareText").select();
};
async function copyFrom(el, msg) { try { await navigator.clipboard.writeText(el.value); toast(msg); } catch (e) { el.focus(); el.select(); toast("Selected — press copy"); } }
$("copyBtn").onclick = () => copyFrom($("shareText"), "Copied — paste it in your group text");
function toast(m) { const t = document.createElement("div"); t.className = "toast"; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2400); }

/* ───────── Embed widget code ───────── */
function renderEmbed() {
  if (!PLACE) return;
  const q = new URLSearchParams({ at: `${PLACE.lat},${PLACE.lon}`, n: PLACE.name, l: PLACE.label });
  const src = `${SITE}/embed.html?${q.toString()}`;
  $("embedSpot").textContent = PLACE.name;
  $("embedCode").value = `<iframe src="${src.replace(/&/g, "&amp;")}" title="Bite Score fishing forecast for ${esc(PLACE.name)}" width="340" height="360" style="border:0;border-radius:10px;max-width:100%" loading="lazy"></iframe>`;
  $("embedPreview").href = PREVIEW ? "embed.html?" + q.toString() : "/embed.html?" + q.toString();
}
$("embedCopy").onclick = () => copyFrom($("embedCode"), "Embed code copied");

/* ───────── Bite alerts (web push) ───────── */
const alertsLocal = () => store.get("alerts", []);
const spotKey = p => `${(+p.lat).toFixed(3)},${(+p.lon).toFixed(3)}`;
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
function alertNote(msg) { const n = $("alertNote"); n.hidden = !msg; n.textContent = msg || ""; }
function renderAlerts() {
  if (!PLACE) return;
  $("alertSpot").textContent = PLACE.name;
  const list = alertsLocal(), mine = list.find(a => a.key === spotKey(PLACE));
  $("alertBtn").textContent = mine ? `✓ Alerts on at ${mine.threshold}+ · Update` : "🔔 Turn on alerts";
  if (mine) $("alertThr").value = String(mine.threshold);
  $("alertList").innerHTML = "";
  list.forEach(a => {
    const row = document.createElement("div"); row.innerHTML = `<span>🔔 ${esc(a.name)} · ${a.threshold}+</span>`;
    const off = document.createElement("button"); off.type = "button"; off.textContent = "Turn off"; off.onclick = () => alertOff(a); row.appendChild(off);
    $("alertList").appendChild(row);
  });
  if (PREVIEW) alertNote("Alerts work once Bite Score is live at getbitescore.com.");
  else if (isIOS && !standalone) alertNote("On iPhone, add Bite Score to your Home Screen first (Share, then Add to Home Screen), then open it from there to turn on alerts.");
  else if (!pushSupported()) alertNote("This browser can't show alerts. Try Chrome, Edge, Firefox, or Safari from your Home Screen.");
  else alertNote("");
}
function b64ToBytes(s) { const p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); }
async function pushSub() {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = await (await fetch("/api/alerts")).json();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  }
  return sub;
}
$("alertBtn").onclick = async () => {
  if (!PLACE || PREVIEW || !pushSupported() || (isIOS && !standalone)) { renderAlerts(); return; }
  const btn = $("alertBtn"); btn.disabled = true;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { alertNote("Notifications are blocked for this site. Allow them in your browser or phone settings, then try again."); return; }
    const sub = await pushSub(), threshold = +$("alertThr").value;
    const r = await fetch("/api/alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON(), spot: { name: PLACE.name, label: PLACE.label, lat: PLACE.lat, lon: PLACE.lon }, threshold }) });
    if (!r.ok) throw new Error("subscribe " + r.status);
    const list = alertsLocal().filter(a => a.key !== spotKey(PLACE)); list.unshift({ key: spotKey(PLACE), name: PLACE.name, lat: PLACE.lat, lon: PLACE.lon, threshold });
    store.set("alerts", list.slice(0, 10)); toast(`Alerts on for ${PLACE.name}`);
  } catch (e) { alertNote("Couldn't turn on alerts right now. Please try again in a minute."); }
  finally { btn.disabled = false; renderAlerts(); }
};
async function alertOff(a) {
  try {
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (sub) await fetch("/api/alerts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", subscription: sub.toJSON(), spot: { lat: a.lat, lon: a.lon } }) });
  } catch (e) {}
  store.set("alerts", alertsLocal().filter(x => x.key !== a.key)); toast(`Alerts off for ${a.name}`); renderAlerts();
}

/* ───────── Install ───────── */
let deferred = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; $("installBtn").hidden = false; $("iosTip").hidden = true; });
$("installBtn").onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; $("installBtn").hidden = true; };
if (!standalone) setTimeout(() => { if (!deferred) $("iosTip").hidden = false; }, 1500);
if ("serviceWorker" in navigator && !PREVIEW) navigator.serviceWorker.register(new URL("sw.js", import.meta.url), { scope: "/" }).catch(() => {});

/* ───────── Start ───────── */
const shared = fromURL(), last = store.get("last", null);
if (shared) load(shared);
else if (PAGE_SPOT) load({ name: PAGE_SPOT.name, label: PAGE_SPOT.label, lat: PAGE_SPOT.lat, lon: PAGE_SPOT.lon }, { noRemember: true });
else if (last) load(last);
else useGPS(() => load(SAMPLE_PLACE));
setInterval(() => { if (PLACE && !document.hidden) load(PLACE, { keepDay: true, noRemember: true }); }, 60 * 60 * 1000);
window.__bite = { buildModel, parts };
