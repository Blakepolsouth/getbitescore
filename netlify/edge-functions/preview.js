// Personalized link previews. Group-text apps and social sites read the page's meta tags without
// running JavaScript, so this rewrites them on the server for shared links like
//   /?at=34.2,-83.95&n=Lake+Lanier&l=Lake+Lanier,+GA&s=8&w=Saturday&pt=6–8+AM
// The score in the link is the one the sender saw; opening the link shows the live forecast.

const TIER = s => s >= 9 ? "Game on" : s >= 7 ? "Good bite" : s >= 5 ? "Fair bite" : s >= 3 ? "Tough bite" : "Stay home";
const clean = (v, max) => String(v || "").replace(/[\u0000-\u001f<>"`]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const attr = v => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function setMeta(html, prop, value) {
  const isOg = prop.startsWith("og:");
  const re = isOg
    ? new RegExp(`<meta property="${prop}" content="[^"]*">`)
    : new RegExp(`<meta name="${prop}" content="[^"]*">`);
  const tag = isOg ? `<meta property="${prop}" content="${attr(value)}">` : `<meta name="${prop}" content="${attr(value)}">`;
  return re.test(html) ? html.replace(re, tag) : html.replace("</head>", `${tag}\n</head>`);
}

export default async (request, context) => {
  const url = new URL(request.url);
  const q = url.searchParams;
  if (!q.has("n") && !q.has("s")) return; // nothing to personalize; serve the page as-is

  const res = await context.next();
  const type = res.headers.get("content-type") || "";
  if (!type.includes("text/html")) return res;

  const name = clean(q.get("n"), 60) || "this spot";
  const label = clean(q.get("l"), 80) || name;
  const s = parseInt(q.get("s"), 10);
  const score = s >= 1 && s <= 10 ? s : null;
  const when = clean(q.get("w"), 12);
  const whenTxt = when ? (when.toLowerCase() === "today" ? "today" : when) : "";
  const prime = clean(q.get("pt"), 24);

  const title = score
    ? `${label}: ${score}/10 ${whenTxt}`.trim() + " | Bite Score"
    : `${label} fishing forecast | Bite Score`;
  const desc = score
    ? `${TIER(score)}${prime ? `. Prime time ${prime}` : ""}. Tap for the live bite forecast, best fishing times and 7-day outlook.`
    : `Should you go fishing at ${name}? Live 1–10 bite score, best time to fish and the 7-day outlook.`;
  const image = `${url.origin}/og/${score ? `score-${score}` : "default"}.png`.replace("/og/default.png", "/og.png");

  let html = await res.text();
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${attr(title)}</title>`);
  html = setMeta(html, "og:title", title);
  html = setMeta(html, "og:description", desc);
  html = setMeta(html, "og:image", image);
  html = setMeta(html, "og:url", url.href);
  html = setMeta(html, "twitter:title", title);
  html = setMeta(html, "twitter:description", desc);
  html = setMeta(html, "twitter:image", image);
  html = setMeta(html, "description", desc);

  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.set("cache-control", "public, max-age=0, must-revalidate");
  return new Response(html, { status: res.status, headers });
};

export const config = {
  path: "/*",
  excludedPath: ["/*.js", "/*.css", "/*.png", "/*.json", "/*.webmanifest", "/*.xml", "/*.txt", "/*.ico", "/api/*", "/og/*", "/embed.html"]
};
