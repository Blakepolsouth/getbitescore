// /api/alerts — turn bite alerts on or off for a spot.
//   GET  → { publicKey }  (the app needs it to set up phone notifications)
//   POST { action: "subscribe", subscription, spot: {name,label,lat,lon}, threshold }
//   POST { action: "unsubscribe", subscription, spot: {lat,lon} }
// Alerts are stored in Netlify Blobs. Signing keys are created automatically on first use.
import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { vapidKeys, alertId } from "../lib/shared.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const validSub = s => s && typeof s.endpoint === "string" && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000 && s.keys && typeof s.keys.p256dh === "string" && typeof s.keys.auth === "string";
const validSpot = p => p && isFinite(p.lat) && isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
const clean = (v, n) => String(v || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);

export default async (req) => {
  const keys = await vapidKeys();
  if (req.method === "GET") return json({ publicKey: keys.publicKey });
  if (req.method !== "POST") return json({ error: "Use GET or POST" }, 405);

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: "Send JSON" }, 400); }
  const { action, subscription, spot } = body || {};
  if (!validSub(subscription) || !validSpot(spot)) return json({ error: "Missing subscription or spot" }, 400);

  const store = getStore({ name: "bite-alerts", consistency: "strong" });
  const id = alertId(subscription.endpoint, spot.lat, spot.lon);

  if (action === "unsubscribe") { await store.delete(id); return json({ ok: true }); }
  if (action !== "subscribe") return json({ error: "Unknown action" }, 400);

  const threshold = [7, 8, 9].includes(+body.threshold) ? +body.threshold : 8;
  const name = clean(spot.name, 60) || "Your spot";
  const record = {
    subscription: { endpoint: subscription.endpoint, keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth } },
    spot: { name, label: clean(spot.label, 80) || name, lat: +(+spot.lat).toFixed(4), lon: +(+spot.lon).toFixed(4) },
    threshold, created: Date.now(), notified: {}
  };
  const existing = await store.get(id, { type: "json" });
  if (existing && existing.notified) record.notified = existing.notified;
  await store.setJSON(id, record);

  // Confirmation notification, which also proves the phone can receive alerts.
  webpush.setVapidDetails("https://getbitescore.com", keys.publicKey, keys.privateKey);
  try {
    await webpush.sendNotification(record.subscription, JSON.stringify({
      title: `Bite alerts on for ${name}`,
      body: `We'll let you know when ${name} is forecast to hit ${threshold}/10 or better.`,
      tag: "bite-alert-" + id, url: "/"
    }), { TTL: 3600 });
  } catch (e) {
    if (e && (e.statusCode === 404 || e.statusCode === 410)) { await store.delete(id); return json({ error: "This device's notification subscription has expired. Try again." }, 410); }
  }
  return json({ ok: true, threshold });
};

export const config = { path: "/api/alerts" };
