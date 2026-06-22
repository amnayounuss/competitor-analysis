/**
 * places-fetcher.js
 *
 * Competitor branch discovery via the official Google Places API (legacy
 * Text Search + Place Details). This REPLACES the fragile Puppeteer
 * "discovery" stage for competitors with an authoritative, place_id-keyed
 * source of truth.
 *
 * Why this exists:
 *   The Puppeteer feed-scroll discovery over-counts (generic-word false
 *   positives, no stable id → weak dedup) and under-counts (relevance-capped
 *   feeds). The Places API returns a stable `place_id` (ChIJ…) per location,
 *   so dedup is exact, and per-city querying gives full national coverage.
 *   It is also self-updating: a new/moved/closed branch is reflected live on
 *   the next run (closed branches are dropped via business_status).
 *
 * What it produces (per branch) — same shape the Puppeteer Stage 2 expects,
 * so the rest of the pipeline (reviews scrape, popular times, analyzer) is
 * unchanged:
 *   {
 *     title, address, addressLink, url,
 *     placeId,            // ChIJ… → enables clean popular-times navigation
 *     lat, lng,
 *     phone, website, hours,
 *     rating, reviewsCount,
 *     reviews: [],        // filled later by the Puppeteer review scraper
 *     __searchBrand: <brand.key>,
 *   }
 */

const https = require("https");
const config = require("./config");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Default Saudi-Arabia city list used to fan out per-city searches so we get
// full national coverage (a single national query is relevance-capped at ~20).
const SA_CITIES = [
  "Riyadh", "Jeddah", "Makkah", "Madinah", "Dammam", "Al Khobar", "Dhahran",
  "Tabuk", "Abha", "Taif", "Hail", "Najran", "Yanbu", "Al Jubail", "Buraydah",
  "Khamis Mushait", "Al Hofuf", "Al Mubarraz", "Al Kharj", "Jazan", "Al Bahah",
  "Hafar Al Batin", "Saihat", "Muhayil", "Arar", "Al Duwadimi", "Qatif",
  "Unaizah", "Sakaka",
];

// Country name → ISO code, for the per-result country filter.
const COUNTRY_TO_CODE = {
  "saudi arabia": "SA", "united arab emirates": "AE", "uae": "AE",
  "bahrain": "BH", "kuwait": "KW", "qatar": "QA", "oman": "OM",
  "egypt": "EG", "jordan": "JO", "lebanon": "LB", "iraq": "IQ",
  "turkey": "TR", "pakistan": "PK", "india": "IN",
};

function getJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: "GET" },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve({ status: "PARSE_ERROR", raw: data }); }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

// ─────────────── Text Search (paginated, up to 60 results) ───────────────

async function textSearch(key, query, regionCode) {
  const out = [];
  let token = null;
  let page = 0;
  do {
    const url = token
      ? `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${token}&key=${key}`
      : `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}` +
        (regionCode ? `&region=${regionCode.toLowerCase()}` : "") + `&key=${key}`;

    let res;
    // next_page_token needs a moment to become valid → retry on INVALID_REQUEST
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await getJson(url);
      if (res.status === "INVALID_REQUEST" && token) { await sleep(2000); continue; }
      break;
    }
    if (res.status === "OVER_QUERY_LIMIT") {
      console.warn(`[places] OVER_QUERY_LIMIT on "${query}" — backing off`);
      await sleep(3000);
    }
    if (res.status !== "OK" && res.status !== "ZERO_RESULTS") {
      if (page === 0) console.warn(`[places] "${query}" → ${res.status} ${res.error_message || ""}`);
      break;
    }
    out.push(...(res.results || []));
    token = res.next_page_token || null;
    page++;
    if (token) await sleep(2500);
  } while (token && page < 3);
  return out;
}

// ─────────────── Place Details (country + hours + phone + website) ───────────────

async function placeDetails(key, placeId) {
  const fields = [
    "address_component", "formatted_phone_number", "international_phone_number",
    "website", "opening_hours", "business_status", "url", "geometry", "name",
    "formatted_address", "rating", "user_ratings_total",
  ].join(",");
  const url =
    `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}` +
    `&fields=${fields}&key=${key}`;
  const res = await getJson(url);
  return res.status === "OK" ? res.result : null;
}

function countryCodeOf(details) {
  const comps = details?.address_components || [];
  const c = comps.find((x) => (x.types || []).includes("country"));
  return c ? (c.short_name || "").toUpperCase() : null;
}

// opening_hours.weekday_text → "Mon: 7AM-12AM | Tue: ..." compact string
function formatHours(details) {
  const wt = details?.opening_hours?.weekday_text;
  if (!Array.isArray(wt) || wt.length === 0) return "";
  return wt
    .map((line) => {
      // "Monday: 7:00 AM – 12:00 AM" → "Mon: 7:00 AM – 12:00 AM"
      const m = line.match(/^(\w{3})\w*:\s*(.+)$/);
      return m ? `${m[1]}: ${m[2]}` : line;
    })
    .join(" | ");
}

// ─────────────── alias matching ───────────────

/** Build brand → { aliases:[lowercased] } from config.COMPETITORS entries. */
function brandAliasMap() {
  const map = new Map();
  for (const c of config.COMPETITORS) {
    if (!map.has(c.key)) map.set(c.key, new Set());
    map.get(c.key).add((c.name || "").toLowerCase());
    map.get(c.key).add((c.key || "").toLowerCase());
  }
  return map;
}

/** A result's name must contain at least one alias token of the brand. */
function nameMatchesBrand(name, aliasSet) {
  const t = (name || "").toLowerCase();
  for (const a of aliasSet) {
    if (a && t.includes(a)) return true;
  }
  return false;
}

// ─────────────── public entry point ───────────────

/**
 * Discover all competitor branches via the Places API.
 * Reads from the active config: PLACES_API_KEY, COMPETITORS (key/name),
 * searchLocation, and optional PLACES_CITIES override.
 */
async function fetchCompetitorsViaPlaces() {
  const key = config.PLACES_API_KEY;
  if (!key) throw new Error("Google Places API key not configured");

  const loc = (config.searchLocation || "").toLowerCase().trim();
  const expectedCC = COUNTRY_TO_CODE[loc] || null;
  const regionCode = expectedCC || "";
  const cities =
    (Array.isArray(config.PLACES_CITIES) && config.PLACES_CITIES.length)
      ? config.PLACES_CITIES
      : (expectedCC === "SA" ? SA_CITIES : [config.searchLocation || ""]);

  const aliasMap = brandAliasMap();

  // Group search query-bases by brand (one query per alias name).
  const brandQueries = new Map(); // brand → Set(queryBase)
  for (const c of config.COMPETITORS) {
    if (!brandQueries.has(c.key)) brandQueries.set(c.key, new Set());
    brandQueries.get(c.key).add(c.name);
  }

  console.log(`\n═══ PLACES API: discovering competitors (${cities.length} cities) ═══`);

  const byPlaceId = new Map(); // place_id → branch object

  for (const [brand, queryBases] of brandQueries.entries()) {
    const aliasSet = aliasMap.get(brand) || new Set([brand.toLowerCase()]);
    const brandIds = new Set();

    for (const city of cities) {
      for (const qb of queryBases) {
        await config.__check();
        const q = city ? `${qb} ${city}` : qb;
        const results = await textSearch(key, q, regionCode);
        for (const p of results) {
          if (!p.place_id) continue;
          if (!nameMatchesBrand(p.name, aliasSet)) continue;
          if (byPlaceId.has(p.place_id)) continue;
          // Drop permanently-closed up front when Text Search reports it.
          if (p.business_status && p.business_status !== "OPERATIONAL") continue;
          byPlaceId.set(p.place_id, {
            placeId: p.place_id,
            title: p.name || "",
            address: p.formatted_address || "",
            lat: p.geometry?.location?.lat ?? null,
            lng: p.geometry?.location?.lng ?? null,
            rating: typeof p.rating === "number" ? p.rating : null,
            reviewsCount: p.user_ratings_total ?? null,
            __searchBrand: brand,
          });
          brandIds.add(p.place_id);
        }
      }
    }
    console.log(`[places:${brand}] ${brandIds.size} candidate place_ids (pre country/closed filter)`);
  }

  // ── Enrich + filter via Place Details (country, closed, hours, phone, website) ──
  const all = Array.from(byPlaceId.values());
  const kept = [];
  let droppedCountry = 0, droppedClosed = 0;

  for (let i = 0; i < all.length; i++) {
    await config.__check();
    const b = all[i];
    const d = await placeDetails(key, b.placeId);
    if (d) {
      const cc = countryCodeOf(d);
      if (expectedCC && cc && cc !== expectedCC) { droppedCountry++; continue; }
      if (d.business_status && d.business_status !== "OPERATIONAL") { droppedClosed++; continue; }
      b.title        = d.name || b.title;
      b.address      = d.formatted_address || b.address;
      b.phone        = d.formatted_phone_number || d.international_phone_number || "";
      b.website      = d.website || "";
      b.hours        = formatHours(d);
      b.rating       = typeof d.rating === "number" ? d.rating : b.rating;
      b.reviewsCount = d.user_ratings_total ?? b.reviewsCount;
      b.lat          = d.geometry?.location?.lat ?? b.lat;
      b.lng          = d.geometry?.location?.lng ?? b.lng;
      b.url          = d.url || `https://www.google.com/maps/place/?q=place_id:${b.placeId}`;
      b.addressLink  = b.url;
    } else {
      b.url = `https://www.google.com/maps/place/?q=place_id:${b.placeId}`;
      b.addressLink = b.url;
      b.hours = ""; b.phone = ""; b.website = "";
    }
    b.reviews = [];
    kept.push(b);
    if ((i + 1) % 20 === 0) console.log(`[places] details ${i + 1}/${all.length} processed`);
  }

  const byBrand = {};
  for (const b of kept) byBrand[b.__searchBrand] = (byBrand[b.__searchBrand] || 0) + 1;
  console.log(`\n[places] ── Discovery Summary ──`);
  console.log(`[places] unique place_ids: ${all.length} | dropped (wrong country): ${droppedCountry} | dropped (closed): ${droppedClosed} | kept: ${kept.length}`);
  for (const [k, v] of Object.entries(byBrand)) console.log(`          ${k}: ${v} branches`);

  return kept;
}

/**
 * Fill Google's average rating + total review count (and a Maps link) on
 * branches that already have a placeId — used for the target brand whose
 * branches come from the GMB API (which doesn't expose a place-level rating).
 * Concurrency-limited. Mutates and returns the same array.
 */
async function enrichRatingsViaPlaces(branches) {
  const key = config.PLACES_API_KEY;
  if (!key) { console.warn("[places] no API key — skipping rating enrichment"); return branches; }

  const targets = branches.filter((b) => b.placeId && (b.rating == null || b.reviewsCount == null));
  if (targets.length === 0) return branches;

  console.log(`\n═══ PLACES API: enriching ratings for ${targets.length} branches ═══`);
  const POOL = 8;
  let idx = 0, done = 0;

  async function worker() {
    while (idx < targets.length) {
      const b = targets[idx++];
      await config.__check();
      try {
        const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${b.placeId}` +
          `&fields=rating,user_ratings_total,url&key=${key}`;
        const res = await getJson(url);
        if (res.status === "OK" && res.result) {
          if (b.rating == null && typeof res.result.rating === "number") b.rating = res.result.rating;
          if (b.reviewsCount == null && res.result.user_ratings_total != null) b.reviewsCount = res.result.user_ratings_total;
          if (!b.url && res.result.url) { b.url = res.result.url; b.addressLink = res.result.url; }
        }
      } catch (err) {
        console.warn(`[places] rating enrich failed for ${b.title}: ${err.message}`);
      }
      done++;
      if (done % 20 === 0) console.log(`[places] ratings ${done}/${targets.length}`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(POOL, targets.length) }, worker));
  const withRating = branches.filter((b) => b.rating != null).length;
  console.log(`[places] rating enrichment done — ${withRating}/${branches.length} have a Google rating`);
  return branches;
}

module.exports = { fetchCompetitorsViaPlaces, enrichRatingsViaPlaces, SA_CITIES };
