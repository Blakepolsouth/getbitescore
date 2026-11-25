/* Bite Score tackle box: species, estimated water temperature, seasonal pattern, water clarity, and what to throw.
   Water temperature is estimated from the last few weeks of air temperature (water lags air by about a week).
   It's a guide, not a thermometer: shallow coves warm faster, deep reservoirs and springs slower. */

export const SPECIES = {
  bass:    { name: "Bass", icon: "🐟", salt: false },
  crappie: { name: "Crappie", icon: "🐠", salt: false },
  catfish: { name: "Catfish", icon: "🐡", salt: false },
  bream:   { name: "Bream", icon: "🐟", salt: false },
  redfish: { name: "Redfish", icon: "🎣", salt: true },
  trout:   { name: "Speckled trout", icon: "🎣", salt: true }
};

export function historyURL(p) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${p.lat}&longitude=${p.lon}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&past_days=35&forecast_days=7&timezone=auto&temperature_unit=fahrenheit&precipitation_unit=inch`;
}

/* daily = Open-Meteo daily block. Returns per-day water temps and rain, keyed by date. */
export function waterModel(daily, salt) {
  const k = salt ? 0.2 : 0.14, min = salt ? 45 : 38;
  const days = daily.time.map((t, i) => ({ key: t, air: (daily.temperature_2m_max[i] + daily.temperature_2m_min[i]) / 2, rain: daily.precipitation_sum[i] || 0 }));
  let w = days.slice(0, 7).reduce((a, d) => a + d.air, 0) / Math.min(7, days.length);
  days.forEach(d => { w += (d.air - w) * k; d.water = Math.max(min, Math.min(salt ? 90 : 92, w)); });
  return days;
}
export function waterOn(days, key) {
  const i = days.findIndex(d => d.key === key); if (i < 0) return null;
  const now = days[i].water, ago = days[Math.max(0, i - 10)].water;
  const rain3 = days.slice(Math.max(0, i - 3), i + 1).reduce((a, d) => a + d.rain, 0);
  const rain7 = days.slice(Math.max(0, i - 7), i + 1).reduce((a, d) => a + d.rain, 0);
  const clar = rain3 >= 1 || rain7 >= 2 ? "muddy" : rain3 >= .5 || rain7 >= 1.2 ? "stained" : "clear";
  return { temp: Math.round(now), trend: now - ago, rain3, rain7, clar };
}

/* Seasonal pattern by species, water temp and whether it's warming (spring) or cooling (fall) */
export function season(sp, wt, trend, month) {
  const warming = trend > 1 || (Math.abs(trend) <= 1 && month >= 1 && month <= 6), S = (name, text) => ({ name, text });
  if (sp === "bass") {
    if (wt < 48) return S("Winter", "Bass are deep and sluggish. Fish steep banks, channel swings and bluff walls, and slow way down.");
    if (wt < 58) return warming ? S("Pre-spawn", "Bass are moving toward spawning areas and staging on secondary points and the first drop near flats.") : S("Late fall", "Bass are following bait toward deeper creek channels. Fish the first drop-offs.");
    if (wt < 68) return warming ? S("Spawn", "Bass are on beds in shallow, protected pockets. Look for clear spots in 1–4 feet of water.") : S("Fall", "Bass are chasing shad into the backs of creeks. Find the bait, find the fish.");
    if (wt < 78) return warming ? S("Post-spawn", "Bass are recovering near the spawning areas. Early topwater, then shade, docks and grass edges.") : S("Early fall", "Cooling water fires bass up. They roam shallow chasing shad.");
    return S("Summer", "Bass go deep to ledges, humps and brush in the heat. The shallow bite is at first light.");
  }
  if (sp === "crappie") {
    if (wt < 50) return S("Winter", "Crappie school up deep on brush piles and channel bends. Fish slow, straight down.");
    if (wt < 60) return warming ? S("Pre-spawn", "Crappie are staging near creek channels close to spawning flats.") : S("Late fall", "Crappie are moving out to deeper brush near channels.");
    if (wt < 70) return warming ? S("Spawn", "Crappie are shallow on brush, docks and stumps. Best bite of the year.") : S("Fall", "Crappie follow shad into creeks and stack up on shallow brush.");
    return S("Summer", "Crappie hold on deep brush and bridge pilings. Night fishing under lights is hot.");
  }
  if (sp === "catfish") {
    if (wt < 50) return S("Winter", "Blues bite well in the cold. Fish deep holes and channel edges with fresh cut bait.");
    if (wt < 70) return warming ? S("Spring feed", "Cats are feeding hard before the spawn, often shallow on flats and creek mouths.") : S("Fall feed", "Cats are fattening up for winter. Follow the shad.");
    if (wt < 80) return warming ? S("Spawn", "Cats are spawning in holes and rocks. The bite slows for a few weeks.") : S("Fall feed", "Cats are fattening up for winter. Follow the shad.");
    return S("Summer", "The best catfishing is at night in summer. Fish channel edges and humps.");
  }
  if (sp === "bream") {
    if (wt < 60) return S("Cold water", "Bream are deeper and slow. Small baits, fished slowly near cover.");
    if (wt < 80 && warming && month >= 4 && month <= 7) return S("Bedding", "Bream bed in shallow sandy spots, especially around the full moon. Look for the honeycomb of beds.");
    return S(wt >= 80 ? "Summer" : "Fall", "Bream hold in shade: docks, overhanging trees and grass edges.");
  }
  if (sp === "redfish") {
    if (wt < 60) return S("Winter", "Reds bunch up on shallow mud flats that warm up on sunny afternoons. Slow presentations.");
    if (wt < 80) return warming ? S("Spring", "Reds are spreading out on the flats. Look for tailing fish on the low incoming tide.") : S("Fall run", "Big schools of reds and bull reds at the passes and jetties. Best time of year.");
    return S("Summer", "Reds feed early and late on the flats, then slide to deeper, cooler edges.");
  }
  if (sp === "trout") {
    if (wt < 58) return S("Winter", "Trout stack up in deep holes, channels and creeks. Slow and low.");
    if (wt < 82) return warming ? S("Spring", "Trout are moving onto grass flats. Popping cork season.") : S("Fall", "Trout are fattening up in the creeks and on the flats. Great topwater bite.");
    return S("Summer", "Trout feed at dawn, dusk and at night under dock lights. Deeper grass edges midday.");
  }
  return S("", "");
}

/* What to throw. ctx = { wt, warming, phase, clar, light: "low"|"bright", wind (mph), pFall, pRise } */
export function baits(sp, ctx) {
  const out = [], add = (name, why, q) => { if (!out.some(x => x.name === name)) out.push({ name, why, q: q || name }); };
  const muddy = ctx.clar === "muddy", stained = ctx.clar === "stained", low = ctx.light === "low", windy = ctx.wind >= 8, calm = ctx.wind < 5, ph = ctx.phase;
  if (sp === "bass") {
    if (muddy) { add("Spinnerbait, Colorado blade", "Thumps hard so bass can feel it in dirty water.", "colorado blade spinnerbait"); add("Black & blue jig", "A dark silhouette shows best in muddy water.", "black blue bass jig"); }
    if (ph === "Winter") { add("Suspending jerkbait", "Long pauses trigger cold, lazy bass."); add("Blade bait", "Vertical and slow over deep schools."); add("Football jig", "Drag it slowly on the bottom."); }
    if (ph === "Pre-spawn" || ph === "Late fall") { add("Lipless crankbait", ph === "Late fall" ? "Covers water fast to find bass schooled on bait." : "Rip it through grass and over flats as fish move up."); add("Jerkbait", "Deadly on staging bass in cool water."); add("Chatterbait", "Covers water fast."); }
    if (ph === "Spawn") { add("Senko (wacky rig)", "Falls slow and natural near beds."); add("Soft plastic lizard", "Bass hate lizards near their beds."); add("Swim jig", "Fish it around shallow cover."); }
    if (ph === "Post-spawn") { add("Walking topwater", "Early and late, post-spawn bass smash topwater."); add("Swimbait", "Bass are feeding up on bream and shad."); add("Shaky head worm", "Slow and easy for recovering fish."); }
    if (ph === "Fall" || ph === "Early fall") { add("Walking topwater", "Bass blow up on shad near the surface in fall."); add("Squarebill crankbait", "Bang it off shallow cover in the creeks."); add("Spinnerbait", "Looks like a fleeing shad."); }
    if (ph === "Summer") { add(low ? "Hollow-body frog" : "Deep-diving crankbait", low ? "Low light keeps bass shallow in the grass." : "Reach bass on ledges and humps."); add("Texas-rigged worm", "Work deep brush and ledges slowly."); add("Topwater at first light", "The shallow bite is short. Be there early.", "topwater popper"); }
    if (!muddy && windy) add("Spinnerbait", "Wind on the water: moving baits shine.");
    if (!muddy && calm && !low && ctx.clar === "clear") add("Drop shot or Ned rig", "Bright, calm and clear: finesse gets bit.", "ned rig");
  }
  if (sp === "crappie") {
    if (muddy) add("Chartreuse tube jig", "Bright colors show up in dirty water.", "chartreuse crappie tube jig");
    if (ph === "Winter") { add("Live minnow, straight down", "Slow and right in their face over deep brush.", "crappie minnow rig"); add("Hair jig", "Subtle, slow fall for cold fish.", "crappie hair jig"); }
    if (ph === "Spawn" || ph === "Pre-spawn") { add("Jig under a bobber", "Hold it still over shallow brush.", "crappie jig bobber"); add("Live minnow under a cork", "Can't beat it at spawn time.", "crappie minnow cork"); }
    if (ph === "Summer") { add("Live minnow at night under lights", "Crappie gather under bridge and dock lights.", "crappie minnow"); add("Small crankbait (trolling)", "Cover open water to find suspended schools.", "crappie crankbait"); }
    add("Curly tail grub (1/16 oz)", "The all-around crappie bait.", "crappie curly tail grub"); add(muddy || stained ? "Tube jig, bright colors" : "Tube jig, natural colors", "Crappie can't resist a slow-falling tube.", "crappie tube jig");
  }
  if (sp === "catfish") {
    if (muddy || stained) add("Cut bait at runoff and creek mouths", "Cats love muddy, rising water. Food washes right to them.", "catfish cut bait rig");
    add("Fresh cut shad or skipjack", "The top bait for blue catfish.", "catfish cut bait"); add("Chicken liver or punch bait", "Channel cats follow scent.", "catfish punch bait"); add("Nightcrawlers", "Works for everything, especially in spring.", "nightcrawlers catfish");
  }
  if (sp === "bream") {
    add("Crickets", "The classic bream bait, especially on beds.", "live crickets fishing"); add("Red worms", "Easy, cheap and they always work.", "red worms fishing");
    add(muddy ? "Worm under a bobber" : "Beetle spin", muddy ? "Let the scent do the work in dirty water." : "Small, flashy and cast-able.", muddy ? "bream bobber rig" : "beetle spin");
  }
  if (sp === "redfish") {
    if (muddy) add("Scented soft plastic (Gulp)", "Scent helps reds find it in dirty water.", "gulp shrimp");
    add(ph === "Fall run" ? "Cut mullet on the bottom" : "Gold spoon", ph === "Fall run" ? "Bull reds at the passes can't pass up cut mullet." : "Flashes and wobbles. Reds can't resist it.", ph === "Fall run" ? "redfish cut bait rig" : "gold weedless spoon");
    add("Paddle tail on a jighead", "Looks like a mullet or menhaden.", "paddle tail jighead redfish"); add("Live shrimp under a cork", "When all else fails.", "popping cork shrimp rig");
    if (low && !windy) add("Topwater at dawn", "Reds and trout blow up on topwater in low light.", "walk the dog topwater saltwater");
  }
  if (sp === "trout") {
    if (ph === "Winter") add("Suspending twitchbait", "Hangs in front of cold, slow trout.", "suspending twitchbait trout");
    add("Popping cork with live shrimp", "The classic speckled trout rig.", "popping cork"); add("Soft plastic paddle tail", "Bounce it along grass edges.", "paddle tail speckled trout");
    if (low) add("Topwater (walk the dog)", "Big trout bite topwater at dawn and dusk.", "walk the dog topwater saltwater");
    if (muddy) add("Move toward the passes", "Fresh runoff muddies the bays. Trout slide to cleaner, saltier water.", "speckled trout lures");
  }
  return out.slice(0, 3);
}

export function colorTip(sp, clar, low) {
  if (SPECIES[sp]?.salt) return clar === "muddy" ? "Colors: dark (root beer, black) or bright chartreuse, with scent." : clar === "stained" ? "Colors: chartreuse, gold, new penny." : "Colors: natural (white, silver, clear with flake).";
  if (sp === "catfish") return "Fresher and smellier is better.";
  return clar === "muddy" ? "Colors: black and blue, or bright chartreuse. Loud and dark." : clar === "stained" ? `Colors: chartreuse and white, or red${low ? ". Darker in low light" : ""}.` : `Colors: natural (green pumpkin, shad, white)${low ? ", a shade darker in low light" : ""}.`;
}

export const shopURL = q => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`; // add an affiliate tag here once approved
