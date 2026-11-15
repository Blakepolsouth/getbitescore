// Trip-planning alerts, shared by Rut Score and Bite Score.
// days: forecast days [{key, score}], days[0] = today. rec: { threshold, lead, notified }.
//   Heads-up: the first time a day within `lead` days hits the threshold (gives time to plan a trip).
//   Still on: the day before, if that day still makes the cut.
//   Cooled off: if a day we flagged drops 2+ below the threshold, so nobody drives out on stale news.
// notified[dayKey] = { s: score when flagged, st: "heads" | "on" | "off" }. Old records stored a plain number (= already sent).
export const LEADS = [1, 2, 3, 4, 5, 6];
export const THRESHOLDS = [6, 7, 8, 9, 10];

export function planAlerts(days, rec) {
  const lead = LEADS.includes(+rec.lead) ? +rec.lead : 3, thr = +rec.threshold || 8;
  const todayKey = days[0].key, out = [];
  const notified = {};
  for (const [k, v] of Object.entries(rec.notified || {})) if (k >= todayKey) notified[k] = typeof v === "number" ? { s: v, st: "on" } : v;

  const fresh = [];
  days.slice(1, lead + 1).forEach((d, i) => {
    const ahead = i + 1, n = notified[d.key];
    if (!n || n.st === "off") { if (d.score >= thr) fresh.push({ d, ahead, back: !!n }); return; }
    if (n.st === "heads" && d.score <= thr - 2) { out.push({ type: "off", d, ahead, was: n.s }); notified[d.key] = { s: d.score, st: "off" }; return; }
    if (n.st === "heads" && ahead === 1 && d.score >= thr) { out.push({ type: "on", d, ahead, was: n.s }); notified[d.key] = { s: d.score, st: "on" }; }
  });
  if (fresh.length) {
    // Lead with the best new day (earliest on a tie); mention the others in the same alert.
    const best = fresh.slice().sort((a, b) => b.d.score - a.d.score || a.ahead - b.ahead)[0];
    out.push({ type: best.ahead === 1 ? "tomorrow" : "heads", d: best.d, ahead: best.ahead, back: best.back, also: fresh.filter(x => x !== best).map(x => x.d) });
    fresh.forEach(x => notified[x.d.key] = { s: x.d.score, st: x.ahead === 1 ? "on" : "heads" });
  }
  const order = { off: 0, on: 1, tomorrow: 2, heads: 3 };
  return { messages: out.sort((a, b) => order[a.type] - order[b.type]).slice(0, 2), notified, changed: JSON.stringify(notified) !== JSON.stringify(rec.notified || {}) };
}

// Wording. dayName(key) → "Saturday". extra(day) → " Prime 6:40–8:30 AM." etc.
export function wordAlert(m, { icon, place, dayName, tierName, extra = () => "", scoreText = d => `${d.score}/10` }) {
  const dn = dayName(m.d.key), when = m.ahead === 1 ? "tomorrow" : dn;
  const others = (m.also || []).length ? ` ${m.also.map(d => dayName(d.key).slice(0, 3)).join(" & ")} look${m.also.length === 1 ? "s" : ""} good too.` : "";
  if (m.type === "off") return { title: `⚠️ ${place}: ${dn} cooled off`, body: `Now ${scoreText(m.d)} (was ${m.was}/10). The weather shifted, so plan around it.` };
  if (m.type === "on") return { title: `✅ Still on: ${place} ${scoreText(m.d)} tomorrow`, body: `${tierName(m.d.score)}.${extra(m.d)} Tap for the full forecast.` };
  if (m.type === "tomorrow") return { title: `${icon} ${place}: ${scoreText(m.d)} tomorrow`, body: `${tierName(m.d.score)}.${extra(m.d)}${others} Tap for the full forecast.` };
  return { title: `${icon} ${place}: ${scoreText(m.d)} ${when} (${m.ahead} days out)`, body: `${m.back ? "Back on. " : "Heads-up to plan a trip. "}${tierName(m.d.score)}.${extra(m.d)}${others} Forecasts this far out can shift; we'll confirm the day before.` };
}
