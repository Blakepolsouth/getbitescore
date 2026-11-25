// /api/watertemp?lat=..&lon=.. — the nearest live water temperature reading, if there's a gauge close by.
//   Inland: USGS monitoring stations (lakes, reservoirs, rivers). Coast: NOAA tide stations.
// Results are cached for an hour per area so we stay well under the free API limits.
// Optional env var USGS_API_KEY (free from https://api.waterdata.usgs.gov/signup) raises the USGS rate limit.
import { getStore } from "@netlify/blobs";

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "public, max-age=900" } });
const miles = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 3958.8 * 2 * Math.asin(Math.sqrt(x)); };
const MAX_MI = 20, MAX_AGE = 6 * 3600e3;
async function getJSON(url, headers, ms = 8000) {
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { headers, signal: ctl.signal }); if (!r.ok) throw new Error(url.split("?")[0] + " " + r.status); return await r.json(); }
  finally { clearTimeout(to); }
}
const WORDS = { US: "upstream of", DS: "downstream of", FY: "Ferry", BLW: "below", ABV: "above", R: "River", NR: "near", LK: "Lake", CR: "Creek", CK: "Creek", RES: "Reservoir", AB: "above", BL: "below", AT: "at", TRIB: "Tributary", FK: "Fork", BR: "Branch", MI: "mi", "N": "North", "S": "South", "E": "East", "W": "West" };
const pretty = s => String(s || "").split(/\s+/).map((w, i) => /^[A-Z]{2}$/.test(w) && i > 0 && !WORDS[w] ? w : WORDS[w] || (w.length <= 2 && /\d/.test(w) ? w : w.charAt(0) + w.slice(1).toLowerCase())).join(" ").replace(/\s+,/g, ",");

async function usgs(lat, lon) {
  const dLat = MAX_MI / 69, dLon = MAX_MI / (69 * Math.cos(lat * Math.PI / 180)), key = process.env.USGS_API_KEY;
  const h = key ? { "X-Api-Key": key } : {};
  const base = "https://api.waterdata.usgs.gov/ogcapi/v1/collections";
  const j = await getJSON(`${base}/latest-continuous/items?f=json&parameter_code=00010&limit=200&bbox=${(lon - dLon).toFixed(3)},${(lat - dLat).toFixed(3)},${(lon + dLon).toFixed(3)},${(lat + dLat).toFixed(3)}`, h);
  const now = Date.now(), seen = new Set();
  const c = (j.features || []).map(f => {
    const p = f.properties || {}, g = f.geometry && f.geometry.coordinates, v = parseFloat(p.value), t = Date.parse(p.time);
    if (!g || !isFinite(v) || !isFinite(t) || now - t > MAX_AGE || seen.has(p.monitoring_location_id)) return null;
    seen.add(p.monitoring_location_id);
    const f2 = /degC/i.test(p.unit_of_measure || "degC") ? v * 9 / 5 + 32 : v;
    if (f2 < 32 || f2 > 100) return null;
    return { id: p.monitoring_location_id, temp: f2, time: t, miles: miles(lat, lon, g[1], g[0]) };
  }).filter(x => x && x.miles <= MAX_MI).sort((a, b) => a.miles - b.miles).slice(0, 6);
  if (!c.length) return null;
  await Promise.all(c.map(async x => { try { const m = await getJSON(`${base}/monitoring-locations/items/${encodeURIComponent(x.id)}?f=json`, h, 5000); x.name = pretty(m.properties?.monitoring_location_name); x.type = /lake|reservoir|impoundment/i.test(m.properties?.site_type || "") ? "lake" : "stream"; } catch { x.type = "stream"; } }));
  // Skip gauges right below a dam (cold water released from the bottom of the lake) and far-off river gauges.
  // A lake gauge is a better match for lake fishing than a river gauge a little closer.
  const ok = c.filter(x => !(x.type === "stream" && (/\bdam\b/i.test(x.name || "") || x.miles > 10)));
  ok.forEach(x => x.rank = x.miles * (x.type === "lake" ? .6 : 1));
  const best = ok.sort((a, b) => a.rank - b.rank)[0]; if (!best) return null;
  return { temp: Math.round(best.temp), time: best.time, miles: Math.round(best.miles * 10) / 10, name: best.name || "USGS gauge", type: best.type, source: "USGS" };
}
async function noaa(lat, lon, store) {
  let list = await store.get("noaa-stations", { type: "json" });
  if (!list || Date.now() - list.at > 7 * 864e5) {
    const j = await getJSON("https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=watertemp");
    list = { at: Date.now(), s: (j.stations || []).map(s => ({ id: s.id, name: s.name, lat: +s.lat, lon: +(s.lng ?? s.lon) })).filter(s => isFinite(s.lat) && isFinite(s.lon)) };
    await store.setJSON("noaa-stations", list);
  }
  const near = list.s.map(s => ({ ...s, miles: miles(lat, lon, s.lat, s.lon) })).filter(s => s.miles <= 25).sort((a, b) => a.miles - b.miles)[0];
  if (!near) return null;
  const j = await getJSON(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=water_temperature&station=${near.id}&date=latest&units=english&time_zone=gmt&format=json&application=bitescore`);
  const d = j.data && j.data[0], v = d ? parseFloat(d.v) : NaN, t = d ? Date.parse(d.t.replace(" ", "T") + ":00Z") : NaN;
  if (!isFinite(v) || !isFinite(t) || Date.now() - t > MAX_AGE) return null;
  return { temp: Math.round(v), time: t, miles: Math.round(near.miles * 10) / 10, name: near.name, type: "coast", source: "NOAA" };
}

export default async (req) => {
  const u = new URL(req.url), lat = +u.searchParams.get("lat"), lon = +u.searchParams.get("lon");
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return json({ error: "lat and lon required" }, 400);
  const store = getStore({ name: "watertemp" }), key = `v2:${lat.toFixed(2)},${lon.toFixed(2)}`;
  try { const c = await store.get(key, { type: "json" }); if (c && Date.now() - c.at < 3600e3) return json(c.r); } catch {}
  const [a, b] = await Promise.all([usgs(lat, lon).catch(() => null), noaa(lat, lon, store).catch(() => null)]);
  const pick = [a, b].filter(Boolean).sort((x, y) => x.miles * (x.type === "stream" ? 1 : .6) - y.miles * (y.type === "stream" ? 1 : .6))[0];
  const r = pick || { none: true };
  try { await store.setJSON(key, { at: Date.now(), r }); } catch {}
  return json(r);
};
export const config = { path: "/api/watertemp" };
