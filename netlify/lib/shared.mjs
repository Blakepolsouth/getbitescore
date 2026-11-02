// Shared by the alert functions.
import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { createHash } from "node:crypto";

// Push signing keys, created once and kept in Netlify Blobs (no setup needed).
export async function vapidKeys() {
  const cfg = getStore({ name: "bite-config", consistency: "strong" });
  let keys = await cfg.get("vapid", { type: "json" });
  if (!keys || !keys.publicKey || !keys.privateKey) {
    const fresh = webpush.generateVAPIDKeys();
    await cfg.setJSON("vapid", fresh);
    keys = (await cfg.get("vapid", { type: "json" })) || fresh; // re-read so two first visitors agree
  }
  return keys;
}

export const alertId = (endpoint, lat, lon) =>
  createHash("sha256").update(endpoint).digest("hex").slice(0, 24) + "_" + (+lat).toFixed(3) + "_" + (+lon).toFixed(3);
