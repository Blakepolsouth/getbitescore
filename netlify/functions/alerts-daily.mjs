// Runs every evening. For each saved alert, checks the next 3 days and sends one phone
// notification per day that reaches the person's number (never twice for the same day).
import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { vapidKeys } from "../lib/shared.mjs";
import {
  buildModel, primeFor, tierOf, fetchForecast, fetchStationList, nearestStation, fetchTides,
  inTideRegion, spotURL, fmtRange, DL, keyDate, SITE
} from "../../public/engine.js";

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = null; } }
  }));
  return out;
}

async function stations(cfg) {
  const c = await cfg.get("stations", { type: "json" });
  if (c && c.at > Date.now() - 30 * 864e5 && c.list && c.list.length) return c.list;
  try { const list = await fetchStationList(); await cfg.setJSON("stations", { at: Date.now(), list }); return list; }
  catch (e) { return c && c.list ? c.list : []; }
}

export default async () => {
  const started = Date.now();
  const store = getStore({ name: "bite-alerts", consistency: "strong" });
  const cfg = getStore({ name: "bite-config", consistency: "strong" });
  const keys = await vapidKeys();
  webpush.setVapidDetails("https://getbitescore.com", keys.publicKey, keys.privateKey);

  const { blobs } = await store.list();
  const records = (await mapLimit(blobs, 16, async b => ({ id: b.key, rec: await store.get(b.key, { type: "json" }) }))).filter(x => x && x.rec);

  // One forecast per spot, shared by everyone watching it.
  const spots = new Map();
  records.forEach(({ rec }) => { const k = rec.spot.lat.toFixed(2) + "," + rec.spot.lon.toFixed(2); if (!spots.has(k)) spots.set(k, rec.spot); });
  const stationList = [...spots.values()].some(inTideRegion) ? await stations(cfg) : [];
  const models = new Map();
  await mapLimit([...spots.entries()], 6, async ([k, spot]) => {
    const st = inTideRegion(spot) && stationList.length ? nearestStation(stationList, spot.lat, spot.lon, 30) : null;
    const [data, tides] = await Promise.all([fetchForecast(spot), st ? fetchTides(st.id).catch(() => null) : null]);
    models.set(k, buildModel(data.hourly, data.timezone || "UTC", spot, tides));
  });

  let sent = 0, removed = 0;
  await mapLimit(records, 8, async ({ id, rec }) => {
    const M = models.get(rec.spot.lat.toFixed(2) + "," + rec.spot.lon.toFixed(2)); if (!M) return;
    const todayKey = M.days[0].key;
    const notified = Object.fromEntries(Object.entries(rec.notified || {}).filter(([k]) => k >= todayKey));
    const hit = M.days.slice(1, 4).find(d => d.score >= rec.threshold && !notified[d.key]);
    if (!hit) { if (Object.keys(notified).length !== Object.keys(rec.notified || {}).length) await store.setJSON(id, { ...rec, notified }); return; }

    const day = DL[keyDate(hit.key).getUTCDay()], { w } = primeFor(hit);
    const payload = {
      title: `🎣 ${rec.spot.name}: ${hit.score}/10 ${day}`,
      body: `${tierOf(hit.score).name}.${w.start ? ` Prime time ${fmtRange(w.start, w.end, M.tz)}.` : ""} Tap for the full forecast.`,
      tag: "bite-" + id + "-" + hit.key,
      url: spotURL(rec.spot, hit, M.tz).replace(SITE, "")
    };
    try {
      await webpush.sendNotification(rec.subscription, JSON.stringify(payload), { TTL: 12 * 3600 });
      notified[hit.key] = hit.score; sent++;
      await store.setJSON(id, { ...rec, notified });
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) { await store.delete(id); removed++; }
    }
  });

  console.log(`Bite alerts: ${records.length} alerts, ${spots.size} spots, ${sent} sent, ${removed} expired removed, ${Date.now() - started} ms`);
};

// 22:00 UTC = 6 PM Eastern in summer, 5 PM in winter: in time to plan tomorrow.
export const config = { schedule: "0 22 * * *" };
