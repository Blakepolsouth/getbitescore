// Runs every evening. For each saved alert, checks the next 3 days and sends one phone
// notification per day that reaches the person's number (never twice for the same day).
import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { vapidKeys } from "../lib/shared.mjs";
import { planAlerts, wordAlert } from "../lib/plan.mjs";
import {
  buildModel, primeFor, tierOf, fetchForecast, fetchStationList, nearestStation, fetchTides,
  inTideRegion, spotURL, fmtRange, fmtT, triggers, DL, keyDate, SITE
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
    const plan = planAlerts(M.days, rec);
    // Bite triggers (pressure dropping before a front, cloudy day, light rain…) for tomorrow, or a big one the day after.
    const todayKey = M.days[0].key, trig = Object.fromEntries(Object.entries(rec.trig || {}).filter(([k]) => k >= todayKey));
    let tg = null;
    if (rec.triggers !== false) for (const [i, D] of [[1, M.days[1]], [2, M.days[2]]]) {
      if (!D || trig[D.key]) continue;
      const best = triggers(D.summary, ms => fmtT(ms, M.tz)).find(x => x.power >= (i === 1 ? 2 : 3) && (i === 1 ? x.id !== "stable" && x.id !== "moon" : true));
      if (best) { tg = { D, i, x: best }; break; }
    }
    if (!plan.messages.length && !tg) { if (plan.changed || Object.keys(trig).length !== Object.keys(rec.trig || {}).length) await store.setJSON(id, { ...rec, notified: plan.notified, trig }); return; }
    try {
      for (const m of plan.messages) {
        const words = wordAlert(m, {
          icon: "🎣", place: rec.spot.name, dayName: k => DL[keyDate(k).getUTCDay()], tierName: s => tierOf(s).name,
          extra: d => { const { w } = primeFor(d); return w.start ? ` Prime time ${fmtRange(w.start, w.end, M.tz)}.` : ""; }
        });
        if (tg && m.d.key === tg.D.key && m.type !== "off") { words.body = `${tg.x.icon} ${tg.x.title}: ${tg.x.why} ` + words.body; trig[tg.D.key] = tg.x.id; tg = null; }
        await webpush.sendNotification(rec.subscription, JSON.stringify({ ...words, tag: `bite-${id}-${m.d.key}-${m.type}`, url: spotURL(rec.spot, m.d, M.tz).replace(SITE, "") }), { TTL: 12 * 3600 });
        sent++;
      }
      if (tg) {
        const { w } = primeFor(tg.D);
        await webpush.sendNotification(rec.subscription, JSON.stringify({
          title: `${tg.x.icon} ${tg.i === 1 ? "Tomorrow" : DL[keyDate(tg.D.key).getUTCDay()]} at ${rec.spot.name}: ${(tg.x.title.charAt(0).toLowerCase() + tg.x.title.slice(1)).replace("than yesterday", tg.i === 1 ? "than today" : "than the day before")}`,
          body: `${tg.x.why} ${tg.x.tip}${w.start ? ` Prime time ${fmtRange(w.start, w.end, M.tz)}.` : ""}`,
          tag: `trig-${id}-${tg.D.key}`, url: spotURL(rec.spot, tg.D, M.tz).replace(SITE, "")
        }), { TTL: 12 * 3600 });
        trig[tg.D.key] = tg.x.id; sent++;
      }
      await store.setJSON(id, { ...rec, notified: plan.notified, trig });
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) { await store.delete(id); removed++; }
    }
  });

  console.log(`Bite alerts: ${records.length} alerts, ${spots.size} spots, ${sent} sent, ${removed} expired removed, ${Date.now() - started} ms`);
};

// 22:00 UTC = 6 PM Eastern in summer, 5 PM in winter: in time to plan tomorrow.
export const config = { schedule: "0 22 * * *" };
