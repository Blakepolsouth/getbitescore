/* Bite Score engine — pure scoring logic shared by the app, the embed widget and the alert server.
   No DOM access here, so it runs in browsers and in Node (Netlify Functions). */

/* ───────── Sun & moon (after Agafonkin's SunCalc, BSD) ───────── */
const rad = Math.PI / 180, dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397;
const toDays = ms => ms / dayMs - 0.5 + J1970 - J2000;
const ra = (l, b) => Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
const dec = (l, b) => Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
const alt = (H, phi, d) => Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H));
const sid = (d, lw) => rad * (280.16 + 360.9856235 * d) - lw;
function sunCoords(d) { const M = rad * (357.5291 + 0.98560028 * d); const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)); const L = M + C + rad * 102.9372 + Math.PI; return { dec: dec(L, 0), ra: ra(L, 0) }; }
function moonCoords(d) { const L = rad * (218.316 + 13.176396 * d), M = rad * (134.963 + 13.064993 * d), F = rad * (93.272 + 13.229350 * d); const l = L + rad * 6.289 * Math.sin(M), b = rad * 5.128 * Math.sin(F), dist = 385001 - 20905 * Math.cos(M); return { ra: ra(l, b), dec: dec(l, b), dist }; }
function sunAlt(ms, lat, lon) { const d = toDays(ms), c = sunCoords(d); return alt(sid(d, rad * -lon) - c.ra, rad * lat, c.dec) / rad; }
function moonAlt(ms, lat, lon) { const d = toDays(ms), c = moonCoords(d); return alt(sid(d, rad * -lon) - c.ra, rad * lat, c.dec) / rad; }
export function moonPhase(ms) {
  const d = toDays(ms), s = sunCoords(d), m = moonCoords(d), sd = 149598000;
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra));
  const inc = Math.atan2(sd * Math.sin(phi), m.dist - sd * Math.cos(phi));
  const ang = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra));
  return { fraction: (1 + Math.cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (ang < 0 ? -1 : 1) / Math.PI };
}
export function phaseName(p) {
  if (p < .035 || p > .965) return "New moon"; if (p < .215) return "Waxing crescent"; if (p < .285) return "First quarter";
  if (p < .465) return "Waxing gibbous"; if (p < .535) return "Full moon"; if (p < .715) return "Waning gibbous";
  if (p < .785) return "Last quarter"; return "Waning crescent";
}

/* Solunar + sun events for one local day, sampled every 5 minutes */
export function dayEvents(startMs, lat, lon, hours) {
  const step = 5 * 60000, n = (hours || 24) * 12, ev = { majors: [], minors: [], sunrise: null, sunset: null };
  let pm = null, ps = null, max = { a: -99, t: 0, i: 0 }, min = { a: 99, t: 0, i: 0 };
  for (let i = 0; i <= n; i++) {
    const t = startMs + i * step, m = moonAlt(t, lat, lon), s = sunAlt(t, lat, lon);
    if (m > max.a) max = { a: m, t, i }; if (m < min.a) min = { a: m, t, i };
    if (pm !== null && (pm < 0) !== (m < 0)) { const f = pm / (pm - m); ev.minors.push({ t: t - step + f * step, kind: m > 0 ? "Moonrise" : "Moonset" }); }
    if (ps !== null) { const h = -0.833; if (ps < h && s >= h) ev.sunrise = t - step + ((h - ps) / (s - ps)) * step; if (ps >= h && s < h) ev.sunset = t - step + ((ps - h) / (ps - s)) * step; }
    pm = m; ps = s;
  }
  if (max.i > 0 && max.i < n) ev.majors.push({ t: max.t, kind: "Moon overhead" });
  if (min.i > 0 && min.i < n) ev.majors.push({ t: min.t, kind: "Moon underfoot" });
  ev.majors.sort((a, b) => a.t - b.t); return ev;
}

/* ───────── Time zones ───────── */
const FMT = {};
export function parts(ms, tz) {
  let f = FMT[tz];
  if (!f) {
    try { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
    catch (err) { f = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
    FMT[tz] = f;
  }
  const o = {}; f.formatToParts(new Date(ms)).forEach(x => o[x.type] = x.value);
  return { key: `${o.year}-${o.month}-${o.day}`, hr: (+o.hour) % 24, min: +o.minute };
}
export function fmtT(ms, tz, short) {
  const pt = parts(ms, tz); let h = pt.hr, m = pt.min; const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return short ? (m ? `${h}:${String(m).padStart(2, "0")}` : `${h}`) + (short === "ap" ? ap[0].toLowerCase() : "") : `${h}:${String(m).padStart(2, "0")} ${ap}`;
}
export function fmtRange(a, b, tz) {
  const d1 = parts(a, tz), d2 = parts(b, tz), ap1 = d1.hr >= 12, ap2 = d2.hr >= 12;
  const part = d => { const h = d.hr % 12 || 12, m = d.min; return m ? `${h}:${String(m).padStart(2, "0")}` : `${h}`; };
  return ap1 === ap2 ? `${part(d1)}–${part(d2)} ${ap2 ? "PM" : "AM"}` : `${part(d1)} ${ap1 ? "PM" : "AM"}–${part(d2)} ${ap2 ? "PM" : "AM"}`;
}
export const DN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const keyDate = k => new Date(k + "T12:00:00Z");
export const compass = d => d == null ? "" : ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(d / 45) % 8];
export const inHg = hpa => (hpa * 0.02953).toFixed(2);

/* ───────── Scoring ───────── */
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function avg(a) { a = a.filter(v => v != null && !isNaN(v)); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function circAvg(a) { a = a.filter(v => v != null); if (!a.length) return null; let s = 0, c = 0; a.forEach(d => { s += Math.sin(d * rad); c += Math.cos(d * rad); }); return (Math.atan2(s, c) / rad + 360) % 360; }
function pScore(dp3) { if (dp3 <= -3) return .55; if (dp3 <= -0.7) return 1; if (dp3 < 0.7) return .62; if (dp3 <= 2) return .38; return .2; }
function wScore(w) { if (w < 3) return .55; if (w <= 12) return 1; if (w <= 18) return .65; if (w <= 25) return .35; return .1; }
function cScore(c) { return .55 + .45 * Math.min(c, 85) / 85; }
function rScore(pr, code) { if (code >= 95) return 0; if (pr > 0.15) return .3; if (pr > 0.005) return .9; return .72; }
function sScore(t, ev) {
  const v = [];
  ev.majors.forEach(m => { const d = Math.abs(t - m.t) / 60000; if (d <= 60) v.push(1 - .4 * d / 60); });
  ev.minors.forEach(m => { const d = Math.abs(t - m.t) / 60000; if (d <= 40) v.push(.75 - .3 * d / 40); });
  [ev.sunrise, ev.sunset].forEach(x => { if (x == null) return; const d = Math.abs(t - x) / 60000; if (d <= 60) v.push(.85 - .35 * d / 60); });
  let s = v.length ? Math.max(...v) : .15; if (v.filter(x => x > .5).length >= 2) s = Math.min(1, s + .15); return s;
}
/* Tide: moving water fishes best, slack water worst, incoming gets a small edge */
export function tideAt(t, tides) {
  if (!tides || tides.length < 2) return null;
  let i = tides.findIndex(x => x.t > t); if (i <= 0) return null;
  const a = tides[i - 1], b = tides[i]; const frac = (t - a.t) / (b.t - a.t);
  const rate = Math.sin(Math.PI * frac), incoming = a.type === "L";
  return { f: clamp(.3 + .7 * rate + (incoming ? .05 : 0), 0, 1), incoming, rate };
}
const phaseScore = p => Math.abs(Math.cos(2 * Math.PI * p));
function tempScore(diff) { diff = Math.abs(diff); if (diff < 5) return 1; if (diff <= 12) return .6; return .3; }
export const TIERS = { good: "var(--good)", fair: "var(--fair)", tough: "var(--tough)", bad: "var(--bad)" };
export function tierOf(s) {
  if (s >= 7) return { k: "good", c: TIERS.good, name: s >= 9 ? "Game on" : "Good bite" };
  if (s >= 5) return { k: "fair", c: TIERS.fair, name: "Fair bite" };
  if (s >= 3) return { k: "tough", c: TIERS.tough, name: "Tough bite" };
  return { k: "bad", c: TIERS.bad, name: "Stay home" };
}
export const grade = v => v >= .85 ? "A" : v >= .7 ? "B" : v >= .5 ? "C" : v >= .3 ? "D" : "F";
export const gradeTier = v => v >= .7 ? TIERS.good : v >= .5 ? TIERS.fair : v >= .3 ? TIERS.tough : TIERS.bad;

/* Build the 7-day model. h = Open-Meteo hourly block (unix seconds), tz = IANA zone, tides = [{t,type,v}] or null */
export function buildModel(h, tz, place, tides, now) {
  now = now || Date.now();
  const H = h.time.map((t, i) => {
    const ms = t * 1000, pt = parts(ms, tz);
    return {
      key: pt.key, hr: pt.hr, ms,
      p: h.pressure_msl[i], w: h.wind_speed_10m[i], wd: h.wind_direction_10m ? h.wind_direction_10m[i] : null, g: h.wind_gusts_10m ? h.wind_gusts_10m[i] : null,
      c: h.cloud_cover[i], pr: h.precipitation[i] || 0, code: h.weather_code[i] || 0, tmp: h.temperature_2m[i],
      pp: h.precipitation_probability ? h.precipitation_probability[i] : null
    };
  });
  H.forEach((x, i) => { const prev = H[Math.max(0, i - 3)]; x.dp3 = (x.p != null && prev.p != null) ? x.p - prev.p : 0; });
  const hasTides = !!(tides && tides.length > 2);
  const todayKey = parts(now, tz).key;
  const keys = [...new Set(H.map(x => x.key))];
  const prevMax = k => { const i = keys.indexOf(k) - 1; if (i < 0) return null; return Math.max(...H.filter(x => x.key === keys[i]).map(x => x.tmp)); };
  const days = keys.filter(k => k >= todayKey).slice(0, 7).map(k => {
    const hrs = H.filter(x => x.key === k); const start = hrs[0].ms - hrs[0].hr * 3600e3;
    const ev = dayEvents(start, place.lat, place.lon, Math.max(24, hrs.length)); const mp = moonPhase(start + 12 * 3600e3);
    hrs.forEach(x => {
      const mid = x.ms + 30 * 60000, td = hasTides ? tideAt(mid, tides) : null;
      x.f = { p: pScore(x.dp3), w: wScore(x.w), c: cScore(x.c), r: rScore(x.pr, x.code), s: sScore(mid, ev), t: td ? td.f : null };
      x.incoming = td ? td.incoming : null;
      x.score = td
        ? 10 * (.24 * x.f.p + .15 * x.f.w + .06 * x.f.c + .10 * x.f.r + .27 * x.f.s + .18 * x.f.t)
        : 10 * (.28 * x.f.p + .18 * x.f.w + .08 * x.f.c + .12 * x.f.r + .34 * x.f.s);
    });
    const fish = hrs.filter(x => x.hr >= 4 && x.hr <= 21);
    const win = bestWindow(fish), mean = avg(fish.map(x => x.score));
    const tmax = Math.max(...hrs.map(x => x.tmp)), pm = prevMax(k);
    const ps = phaseScore(mp.phase), ts = pm == null ? .8 : tempScore(tmax - pm);
    const raw = .6 * win.avg + .25 * mean + .15 * 10 * (.5 * ps + .5 * ts);
    let score = Math.round(clamp((raw - 2.5) * 1.35, 1, 10));
    const storms = fish.filter(x => x.code >= 95);
    if (storms.length) score = Math.min(score, 4);
    const day = fish.filter(x => x.hr >= 6 && x.hr <= 19);
    const dayTides = hasTides ? tides.filter(x => x.t >= start && x.t < start + hrs.length * 3600e3) : [];
    const summary = {
      p: avg(fish.map(x => x.f.p)), w: avg(day.map(x => x.f.w)), c: avg(day.map(x => x.f.c)), r: avg(fish.map(x => x.f.r)),
      t: hasTides ? avg(fish.map(x => x.f.t)) : null,
      wind: avg(day.map(x => x.w)), gust: Math.max(...day.map(x => x.g || 0)), wdir: circAvg(day.map(x => x.wd)), cloud: avg(day.map(x => x.c)),
      rainIn: hrs.reduce((a, x) => a + x.pr, 0), rainPct: hrs.some(x => x.pp != null) ? Math.max(...hrs.map(x => x.pp || 0)) : null,
      pNoon: (hrs.find(x => x.hr === 12) || hrs[0]).p,
      pTrend: (hrs.find(x => x.hr === 18) || hrs[hrs.length - 1]).p - (hrs.find(x => x.hr === 6) || hrs[0]).p,
      tmax, tmin: Math.min(...hrs.map(x => x.tmp)), tdiff: pm == null ? 0 : tmax - pm,
      phase: mp.phase, illum: mp.fraction, ps, ts, storms: storms.length, tides: dayTides
    };
    return { key: k, start, hrs, fish, ev, win, score, summary, isToday: k === todayKey };
  });
  return { days, tz, hasTides };
}
export function bestWindow(hrs, fromMs) {
  let best = { avg: -1, i: 0 };
  for (let i = 0; i < hrs.length - 1; i++) {
    if (fromMs && hrs[i + 1].ms + 3600e3 <= fromMs) continue;
    const a = (hrs[i].score + hrs[i + 1].score) / 2; if (a > best.avg) best = { avg: a, i };
  }
  if (best.avg < 0) return { avg: 0, start: null, end: null };
  return { avg: best.avg, start: hrs[best.i].ms, end: hrs[best.i].ms + 2 * 3600e3 };
}
/* Snap a window to the solunar/sun event inside it, so "6:10–8:10" reads like a real bite window */
export function snapWindow(w, ev) {
  if (w.start == null) return w;
  const evs = [...ev.majors, ...ev.minors, ...[ev.sunrise, ev.sunset].filter(Boolean).map(t => ({ t }))];
  const inside = evs.filter(x => x.t >= w.start - 20 * 60000 && x.t <= w.end + 20 * 60000); if (!inside.length) return w;
  const c = inside[0].t; return { ...w, start: c - 60 * 60000, end: c + 60 * 60000 };
}
/* The window to show for a day: today's next window once the best one has passed */
export function primeFor(D, now) {
  now = now || Date.now();
  let w = snapWindow(D.win, D.ev), passed = null;
  if (D.isToday && w.end && w.end < now) {
    const nx = bestWindow(D.fish, now);
    if (nx.start && nx.end > now) { passed = w; w = snapWindow(nx, D.ev); } else { passed = w; w = { start: null, end: null }; }
  }
  return { w, passed };
}

/* Plain-English reason */
export function reason(s) {
  if (s.storms) return "Thunderstorms are in the forecast. Fish may feed hard ahead of the front, but lightning on open water is not worth it. Watch the radar and pick another window.";
  const out = [], pt = s.pTrend;
  if (pt <= -1.2) out.push("pressure is dropping ahead of a front, which usually gets fish feeding");
  else if (pt >= 2) out.push("pressure is climbing after a front, so fish tend to go tight-lipped");
  else if (pt >= 0.8) out.push("pressure is creeping up, which can slow the bite");
  else out.push("pressure is holding steady, so expect a normal bite");
  const wr = Math.round(s.wind);
  if (s.wind > 18) out.push(`wind around ${wr} mph will make boat control tough`);
  else if (s.wind >= 4) out.push(`${/^(8|11|18)$/.test(String(wr)) ? "an" : "a"} ${wr} mph breeze will put a chop on the water`);
  else out.push("the water should be near glass calm");
  if (s.t != null && s.t >= .62) out.push("the tide keeps water moving through the best windows");
  if (s.cloud >= 65) out.push("cloud cover should keep fish shallower and less spooky");
  else if (s.cloud <= 20) out.push("bright sun will push fish deeper midday");
  if (s.ps > .85) out.push(`the ${phaseName(s.phase).toLowerCase()} adds a feeding boost`);
  if (Math.abs(s.tdiff) > 12) out.push(`a ${Math.abs(Math.round(s.tdiff))}° temperature swing from yesterday may throw fish off`);
  let txt = out[0].charAt(0).toUpperCase() + out[0].slice(1); const rest = out.slice(1);
  if (rest.length === 1) txt += ", and " + rest[0]; else if (rest.length > 1) txt += ", " + rest.slice(0, -1).join(", ") + ", and " + rest[rest.length - 1];
  return txt + ".";
}

/* ───────── Data sources ───────── */
export function forecastURL(p) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&hourly=temperature_2m,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation,precipitation_probability,weather_code&timezone=auto&timeformat=unixtime&past_days=1&forecast_days=7&wind_speed_unit=mph&temperature_unit=fahrenheit&precipitation_unit=inch`;
}
async function getJSON(url, ms) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), ms || 9000);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(url.split("?")[0] + " " + r.status); return await r.json(); }
  finally { clearTimeout(to); }
}
export async function fetchForecast(p) { return getJSON(forecastURL(p), 9000); }

/* NOAA tide predictions (US coasts). Station list is ~3,000 entries; callers cache the compact form. */
export async function fetchStationList() {
  const j = await getJSON("https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions", 15000);
  return (j.stations || []).map(s => [String(s.id), s.name, +(+s.lat).toFixed(4), +(+(s.lng ?? s.lon)).toFixed(4)]).filter(s => !isNaN(s[2]) && !isNaN(s[3]));
}
export function inTideRegion(p) { return p.lat > 13 && p.lat < 72 && (p.lon < -64 || p.lon > 140); }
export function nearestStation(list, lat, lon, maxKm) {
  let best = null, bd = Infinity;
  for (const s of list) {
    const dLat = (s[2] - lat) * rad, dLon = (s[3] - lon) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * rad) * Math.cos(s[2] * rad) * Math.sin(dLon / 2) ** 2;
    const km = 12742 * Math.asin(Math.sqrt(a)); if (km < bd) { bd = km; best = s; }
  }
  return best && bd <= (maxKm || 30) ? { id: best[0], name: best[1], lat: best[2], lon: best[3], km: bd } : null;
}
export async function fetchTides(stationId, fromMs) {
  const d = new Date((fromMs || Date.now()) - 864e5);
  const begin = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=bitescore&begin_date=${begin}&range=240&datum=MLLW&station=${encodeURIComponent(stationId)}&time_zone=gmt&units=english&interval=hilo&format=json`;
  const j = await getJSON(url, 9000);
  return (j.predictions || []).map(p => ({ t: Date.parse(p.t.replace(" ", "T") + ":00Z"), type: p.type === "H" ? "H" : "L", v: +p.v })).filter(x => !isNaN(x.t)).sort((a, b) => a.t - b.t);
}

/* Share/deep-link URL for a spot and day */
export const SITE = "https://getbitescore.com";
export function spotURL(place, D, tz, path) {
  const q = new URLSearchParams({ at: `${place.lat},${place.lon}`, n: place.name, l: place.label });
  if (D) {
    if (!D.isToday) q.set("d", D.key);
    const { w } = primeFor(D);
    q.set("s", String(D.score));
    q.set("w", D.isToday ? "today" : DL[keyDate(D.key).getUTCDay()]);
    if (w.start) q.set("pt", fmtRange(w.start, w.end, tz));
  }
  return SITE + (path || "/") + "?" + q.toString();
}
