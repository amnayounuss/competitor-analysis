/**
 * competitor-discovery.js
 *
 * Finds who a client competes with, from nothing but their Business Profile
 * refresh token.
 *
 *   1. List the client's own locations (title, primary category, coordinates)
 *   2. Search the area around each one for other food businesses
 *   3. Group the results by brand and rank them
 *
 * The ranking is the whole point. Proximity alone produces a list of whatever
 * happens to be next door; what identifies a competitor is sitting near MANY of
 * the client's locations. A brand beside 12 of 29 branches is competing for the
 * same customers. A brand beside one is a neighbour.
 *
 * Category is a ranking signal, not a filter. BRGR is a `restaurant`; Dopamine —
 * which its owner names as the competitor — is a `cafe`/`bakery`. They share only
 * the generic `food` type, so a same-category search would miss it entirely.
 * Discovery therefore casts wide and lets co-location and review volume sort it
 * out, tagging each candidate with whether it matched the client's own category
 * so the client can weigh that themselves.
 */

const https = require("https");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Types worth searching. Narrower than "everything", wider than one category. */
const FOOD_TYPES = ["restaurant", "cafe", "bakery", "meal_takeaway"];

/** Generic Places types that say nothing about what a business actually is. */
const GENERIC_TYPES = new Set([
  "establishment", "point_of_interest", "food", "store", "premise",
]);

function getJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: "GET" },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try { resolve(JSON.parse(d)); }
          catch { resolve({ status: "PARSE_ERROR", raw: d.slice(0, 200) }); }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function postForm(url, form) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname, method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode, body: d }); }
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function authedGet(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: "GET",
        headers: { Authorization: `Bearer ${token}` } },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode, body: d }); }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Normalise a business name into a grouping key.
 *
 * Google returns the same brand many ways — "Dopamine", "Dopeamine",
 * "دوبامين | Dopamine", "مقهى دوبامين". Without normalising, one brand becomes
 * five candidates and co-location counting falls apart.
 */
function brandKey(name) {
  let s = String(name || "").toLowerCase();

  // Bilingual signs are usually "Arabic | English" — keep the Latin half when
  // there is one, since that groups more reliably across spellings.
  if (s.includes("|")) {
    const parts = s.split("|").map((x) => x.trim()).filter(Boolean);
    const latin = parts.find((p) => /[a-z]/.test(p));
    if (latin) s = latin;
  }

  s = s
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    // Category words that decorate a brand rather than identify it.
    .replace(/\b(cafe|caf[eé]|coffee|restaurant|resturant|bakery|sweets?|chocolate|branch|co\.?|company|est\.?)\b/g, " ")
    .replace(/(مقهى|مطعم|حلويات|مخبز|فرع|كافه)/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return s;
}

/**
 * A looser key that survives spelling drift.
 *
 * Google carries the same brand under several romanisations — "Dopamine",
 * "Dopeamine", "dopeamine" — and an exact key files each as a separate
 * competitor, which then splits that brand's branch count and sinks its
 * co-location score. Dropping the vowels leaves a consonant skeleton that is
 * stable across those variants ("dpmn" for all three) while still separating
 * genuinely different names.
 *
 * Only applied to Latin names of four or more consonants: below that, skeletons
 * start colliding between unrelated brands. Arabic-only names keep their exact
 * key, since there is nothing reliable to fold them onto.
 */
function loosePart(word) {
  if (/[\u0600-\u06FF]/.test(word)) return null;
  const skel = word.replace(/[aeiou\s'’.-]/g, "");
  return skel.length >= 4 ? skel : null;
}

function looseKey(tightKey) {
  const skel = loosePart(tightKey);
  return skel ? `~${skel}` : tightKey;
}

/** Exchange the client's refresh token for an access token. */
async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await postForm("https://oauth2.googleapis.com/token", {
    client_id: clientId, client_secret: clientSecret,
    refresh_token: refreshToken, grant_type: "refresh_token",
  });
  if (res.status !== 200 || !res.body.access_token) {
    const err = new Error("Google rejected the refresh token: " + JSON.stringify(res.body).slice(0, 200));
    err.badToken = true;
    throw err;
  }
  return res.body.access_token;
}

/**
 * The client's own locations, with the two fields discovery needs that the
 * normal job pipeline does not ask for: the primary category and coordinates.
 *
 * Category display names come back in the account's own locale — the same
 * category arrives as "Restaurant" for one location and "مطعم" for another. The
 * list endpoint rejects a languageCode parameter ("Cannot bind query parameter"),
 * so there is no way to force English here. All comparison therefore keys off
 * the gcid, which is stable and language-neutral; the localised label is carried
 * along only for display.
 */
async function fetchOwnLocations({ clientId, clientSecret, refreshToken }, onProgress = () => {}) {
  const token = await getAccessToken({ clientId, clientSecret, refreshToken });

  const accRes = await authedGet("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", token);
  if (accRes.status !== 200) throw new Error("Could not list Business Profile accounts: " + JSON.stringify(accRes.body).slice(0, 200));
  const accounts = accRes.body.accounts || [];

  const readMask = "name,title,categories,storefrontAddress,latlng,metadata,openInfo";
  const out = [];

  for (const acc of accounts) {
    let pageToken = null;
    do {
      const params = new URLSearchParams({ readMask, pageSize: "100" });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await authedGet(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${acc.name}/locations?${params}`, token);
      if (res.status !== 200) {
        console.warn(`[discovery] locations for ${acc.name} → ${res.status}`);
        break;
      }
      for (const loc of res.body.locations || []) {
        if (loc.openInfo?.status === "CLOSED_PERMANENTLY") continue;
        if (loc.metadata?.duplicateLocation) continue;
        out.push({
          title: loc.title || "",
          placeId: loc.metadata?.placeId || null,
          lat: loc.latlng?.latitude ?? null,
          lng: loc.latlng?.longitude ?? null,
          categoryId: (loc.categories?.primaryCategory?.name || "").replace("categories/", ""),
          categoryLabel: loc.categories?.primaryCategory?.displayName || "",
          city: loc.storefrontAddress?.locality || "",
        });
      }
      pageToken = res.body.nextPageToken || null;
    } while (pageToken);
  }

  // Dedup: the same branch can sit under more than one account.
  const seen = new Set();
  const unique = out.filter((l) => {
    if (!l.placeId) return true;
    if (seen.has(l.placeId)) return false;
    seen.add(l.placeId);
    return true;
  });

  onProgress(`${unique.length} own locations found across ${accounts.length} account(s)`);
  return unique;
}

/**
 * Fill in coordinates for locations Google did not return latlng for.
 * Roughly a third came back without it in practice, and a location with no
 * coordinates cannot anchor a nearby search.
 */
async function fillCoordinates(locations, apiKey, onProgress = () => {}) {
  const missing = locations.filter((l) => (l.lat == null || l.lng == null) && l.placeId);
  if (missing.length === 0) return locations;

  for (const l of missing) {
    const r = await getJson(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${l.placeId}` +
      `&fields=geometry,types,name&key=${apiKey}`);
    if (r.status === "OK" && r.result?.geometry?.location) {
      l.lat = r.result.geometry.location.lat;
      l.lng = r.result.geometry.location.lng;
      l.placesTypes = (r.result.types || []).filter((t) => !GENERIC_TYPES.has(t));
    }
    await sleep(60);
  }
  onProgress(`coordinates filled for ${missing.length} location(s)`);
  return locations;
}

/** Metres between two coordinates. Used only to report how close the nearest hit is. */
function distanceM(aLat, aLng, bLat, bLng) {
  const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

/**
 * Discover candidate competitor brands.
 *
 * @param {object} opts
 *   oauth        { clientId, clientSecret, refreshToken }
 *   apiKey       Google Places key
 *   radiusM      search radius per location (default 5000)
 *   maxPerLocation  cap on results kept per location (default 20)
 *   minCoLocation   a brand must appear near this many own locations (default 2)
 *   minReviews      review floor; below this it is a corner shop, not a chain
 *   onProgress   progress callback
 */
async function discoverCompetitors(opts) {
  const {
    oauth, apiKey,
    radiusM = 5000, maxPerLocation = 20, minReviews = 50,
    onProgress = () => {},
  } = opts;
  // Reassigned below when it exceeds the number of anchors.
  let minCoLocation = opts.minCoLocation ?? 2;

  if (!apiKey) throw new Error("Google Places API key is not configured");

  const own = await fetchOwnLocations(oauth, onProgress);
  if (own.length === 0) throw new Error("No locations found on this Business Profile account");
  await fillCoordinates(own, apiKey, onProgress);

  const anchors = own.filter((l) => l.lat != null && l.lng != null);
  if (anchors.length === 0) throw new Error("None of the locations have coordinates, so no area can be searched");

  const ownPlaceIds = new Set(own.map((l) => l.placeId).filter(Boolean));
  const ownKeys = new Set();
  for (const l of own) {
    const k = brandKey(l.title);
    if (!k) continue;
    ownKeys.add(k);
    ownKeys.add(looseKey(k));
  }

  // The client's own category, for tagging matches.
  const ownCategories = new Set(own.map((l) => l.categoryId).filter(Boolean));
  const ownPlacesTypes = new Set(
    own.flatMap((l) => l.placesTypes || []).filter((t) => !GENERIC_TYPES.has(t)));

  /**
   * A threshold above the number of your own locations can never be met.
   *
   * One client had "minimum overlap" set to 50 with 29 branches, so every
   * candidate was discarded and the module reported nothing found — which reads
   * as "you have no competitors" rather than "that setting is impossible".
   */
  if (minCoLocation > anchors.length) {
    onProgress(`minimum overlap ${minCoLocation} is above your ${anchors.length} location(s) — using ${anchors.length}`);
    minCoLocation = anchors.length;
  }

  onProgress(`searching ${anchors.length} area(s) at ${radiusM}m across ${FOOD_TYPES.length} business types`);

  /** brandKey → aggregate */
  const brands = new Map();
  let calls = 0;

  for (const anchor of anchors) {
    // Which of the client's locations this brand was seen near — a Set so the
    // same brand appearing twice near one branch still counts once.
    for (const type of FOOD_TYPES) {
      /**
       * Nearby Search returns at most twenty places per page, ordered by
       * prominence, and the rest sit behind next_page_token. Reading only the
       * first page meant maxPerLocation was fiction — a brand with five Riyadh
       * branches and thousands of reviews never appeared, because it was not in
       * the twenty most prominent cafés near any anchor.
       */
      const pageResults = [];
      let pageToken = null;
      for (let page = 0; page < 3 && pageResults.length < maxPerLocation; page++) {
        const url = pageToken
          ? `https://maps.googleapis.com/maps/api/place/nearbysearch/json?pagetoken=${pageToken}&key=${apiKey}`
          : `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
            `?location=${anchor.lat},${anchor.lng}&radius=${radiusM}&type=${type}&key=${apiKey}`;
        const res = await getJson(url);
        calls++;

        if (res.status === "OVER_QUERY_LIMIT") {
          onProgress("Places quota reached — stopping early with what was found");
          return finalise(brands, { minCoLocation, minReviews, anchors, calls, onProgress });
        }
        if (res.status === "INVALID_REQUEST" && pageToken) {
          // Google needs a moment before a fresh page token becomes valid.
          await sleep(1600);
          page--;
          continue;
        }
        if (res.status !== "OK" && res.status !== "ZERO_RESULTS") {
          console.warn(`[discovery] nearby ${type} → ${res.status} ${res.error_message || ""}`);
          break;
        }

        pageResults.push(...(res.results || []));
        pageToken = res.next_page_token || null;
        if (!pageToken) break;
        await sleep(1600);
      }

      for (const p of pageResults.slice(0, maxPerLocation)) {
        if (!p.place_id || ownPlaceIds.has(p.place_id)) continue;
        if (p.business_status && p.business_status !== "OPERATIONAL") continue;

        const reviews = p.user_ratings_total ?? 0;
        if (reviews < minReviews) continue;          // corner shop, not a rival

        const tight = brandKey(p.name);
        if (!tight || tight.length < 2) continue;
        if (ownKeys.has(tight) || ownKeys.has(looseKey(tight))) continue;   // the client's own brand
        const key = looseKey(tight);

        let b = brands.get(key);
        if (!b) {
          b = {
            brandKey: key, names: new Map(), placeIds: new Set(),
            nearOwn: new Set(), cities: new Set(), types: new Set(),
            ratingSum: 0, ratingWeight: 0, totalReviews: 0,
            nearestM: Infinity,
          };
          brands.set(key, b);
        }
        b.names.set(p.name, (b.names.get(p.name) || 0) + 1);
        b.placeIds.add(p.place_id);
        b.nearOwn.add(anchor.placeId || `${anchor.lat},${anchor.lng}`);
        if (p.vicinity) b.cities.add(String(p.vicinity).split(",").pop().trim());
        for (const t of p.types || []) if (!GENERIC_TYPES.has(t)) b.types.add(t);
        if (typeof p.rating === "number") { b.ratingSum += p.rating * reviews; b.ratingWeight += reviews; }
        b.totalReviews += reviews;
        if (p.geometry?.location) {
          const d = distanceM(anchor.lat, anchor.lng, p.geometry.location.lat, p.geometry.location.lng);
          if (d < b.nearestM) b.nearestM = d;
        }
      }
      await sleep(80);
    }
    if (anchors.indexOf(anchor) % 5 === 4) {
      onProgress(`${anchors.indexOf(anchor) + 1}/${anchors.length} areas searched, ${brands.size} brands seen`);
    }
  }

  return finalise(brands, { minCoLocation, minReviews, anchors, calls, onProgress, ownCategories, ownPlacesTypes });
}

function finalise(brands, ctx) {
  const { minCoLocation, anchors, calls, onProgress, ownPlacesTypes = new Set() } = ctx;

  const out = [];
  for (const b of brands.values()) {
    const coLoc = b.nearOwn.size;
    if (coLoc < minCoLocation) continue;

    // Display name: the spelling Google used most often — but prefer one that is
    // properly capitalised. Frequency alone picked "dopeamine" over "Dopeamine",
    // and that lowercase form is what the client would then see in the
    // new-analysis picker.
    const bestName = Array.from(b.names.entries())
      .sort((x, y) => {
        const cap = (n) => (/^[a-z]/.test(n) ? 0 : 1);      // starts lowercase → deprioritise
        return (cap(y[0]) - cap(x[0])) || (y[1] - x[1]);
      })[0][0];
    const types = Array.from(b.types);

    out.push({
      // Store the readable form, not the internal skeleton.
      brand_key: brandKey(bestName) || b.brandKey.replace(/^~/, ""),
      brand_name: bestName,
      aliases: Array.from(b.names.keys()).slice(0, 8),
      co_location_count: coLoc,
      branch_count: b.placeIds.size,
      avg_rating: b.ratingWeight > 0 ? Number((b.ratingSum / b.ratingWeight).toFixed(2)) : null,
      total_reviews: b.totalReviews,
      sample_place_ids: Array.from(b.placeIds).slice(0, 5),
      cities: Array.from(b.cities).slice(0, 8),
      primary_type: types[0] || null,
      // Shares a real (non-generic) Places type with the client's own locations.
      same_category: types.some((t) => ownPlacesTypes.has(t)),
      nearest_distance_m: Number.isFinite(b.nearestM) ? b.nearestM : null,
    });
  }

  // Co-location first — that is what makes a competitor. Review volume breaks ties.
  out.sort((a, z) =>
    z.co_location_count - a.co_location_count ||
    z.total_reviews - a.total_reviews);

  onProgress(`${out.length} candidate brands from ${brands.size} seen, ${calls} Places calls over ${anchors.length} areas`);
  return { candidates: out, ownLocationCount: anchors.length, placesCalls: calls };
}

module.exports = { discoverCompetitors, fetchOwnLocations, brandKey, FOOD_TYPES };
