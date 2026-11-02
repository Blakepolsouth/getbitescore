# Bite Score — getbitescore.com

Should you go fishing today? One score from 1 to 10, the best time to fish, and the 7-day outlook.

## What's in here

| Folder / file | What it does |
|---|---|
| `public/` | The website: app, scoring engine, embed widget, icons and preview images |
| `public/engine.js` | The scoring recipe, shared by the app, the widget and the alert server |
| `data/lakes.json` | The lakes that get their own forecast page. Add a line to add a lake |
| `scripts/build-lakes.mjs` | Builds the lake pages, `/lakes/`, `sitemap.xml` and `robots.txt` on every deploy |
| `netlify/edge-functions/preview.js` | Personalized link previews for shared links |
| `netlify/functions/alerts.mjs` | Turns bite alerts on and off (`/api/alerts`) |
| `netlify/functions/alerts-daily.mjs` | Checks every alert each evening and sends notifications |
| `netlify.toml`, `package.json` | Netlify settings. Nothing to change |

## Deploying

This site needs Netlify's server features (link previews and alerts), so it deploys from GitHub,
not by drag-and-drop. Every change pushed to GitHub goes live automatically in about a minute.

No keys or settings are needed. Alert signing keys are created automatically the first time someone turns on alerts.

## Data sources

- Weather: Open-Meteo (free for non-commercial use; get their commercial plan before adding ads or charging)
- Tides: NOAA CO-OPS tide predictions
- Place search: Photon (OpenStreetMap) and Open-Meteo geocoding
- Town names for "Near me": BigDataCloud reverse geocoding
