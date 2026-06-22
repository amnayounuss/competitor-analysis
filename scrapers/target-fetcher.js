/**
 * target-fetcher.js
 *
 * Fetches the TARGET brand's data officially from Google APIs (Business
 * Profile API) using the refresh token attached to this job. The target
 * brand name comes from `config.targetName` and is stamped onto each
 * returned place as `__searchBrand` so the analyzer can group them.
 *
 * API scopes required on the refresh token:
 *   https://www.googleapis.com/auth/business.manage
 *
 * What this produces (per branch):
 *   {
 *     title, address, placeId, url, addressLink, phone,
 *     hours: ""   ← filled later by hours-scraper.js
 *     reviews: [ { stars, publishedAtDate, text }, ... ],
 *     __searchBrand: <config.targetName>,
 *   }
 */

const https  = require("https");
const config = require("./config");

// ─────────────── tiny HTTP helpers (no external deps) ───────────────

function postForm(url, form) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: "POST",
      headers: {
        "Content-Type":   "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function getJson(url, accessToken) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ─────────────── OAuth (same as user's script) ───────────────

async function getAccessToken() {
  const cfg = config.TARGET_API;
  // The OAuth credentials are admin-shared, but the refresh token is the
  // per-job token supplied by the client for THEIR Google Business account.
  if (!cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    throw new Error(
      "Missing Google OAuth env vars. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN."
    );
  }
  const res = await postForm("https://oauth2.googleapis.com/token", {
    client_id:     cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
    grant_type:    "refresh_token",
  });
  if (res.status !== 200 || !res.body.access_token) {
    throw new Error("OAuth failed: " + JSON.stringify(res.body));
  }
  return res.body.access_token;
}

// ─────────────── accounts + locations (same logic as the Python script) ───────────────

async function listAccounts(token) {
  const res = await getJson(
    "https://mybusinessaccountmanagement.googleapis.com/v1/accounts",
    token
  );
  if (res.status !== 200) throw new Error("listAccounts failed: " + JSON.stringify(res.body));
  return res.body.accounts || [];
}

async function listLocationsForAccount(token, accountName) {
  const out = [];
  let pageToken = null;
  do {
    const params = new URLSearchParams({
      readMask: config.TARGET_API.readMask,
      pageSize: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);

    const url = `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?${params}`;
    const res = await getJson(url, token);
    if (res.status !== 200) {
      console.warn(`  list locations for ${accountName} failed: ${res.status} ${JSON.stringify(res.body).slice(0,200)}`);
      break;
    }
    out.push(...(res.body.locations || []));
    pageToken = res.body.nextPageToken || null;
  } while (pageToken);
  return out;
}

// ─────────────── reviews (v4 API) ───────────────

async function listReviewsForLocation(token, accountName, locationName) {
  const locId = locationName.split("/").pop();
  const accId = accountName.split("/").pop();
  const all = [];
  let pageToken = null;
  let warned = false;

  do {
    const params = new URLSearchParams({ pageSize: "50" });
    if (pageToken) params.set("pageToken", pageToken);

    const url = `https://mybusiness.googleapis.com/v4/accounts/${accId}/locations/${locId}/reviews?${params}`;
    const res = await getJson(url, token);

    if (res.status !== 200) {
      if (!warned) {
        console.warn(`    reviews API returned ${res.status} for location ${locId} — continuing without reviews`);
        warned = true;
      }
      break;
    }
    all.push(...(res.body.reviews || []));
    pageToken = res.body.nextPageToken || null;
  } while (pageToken);

  return all;
}

// ─────────────── country name → ISO code map ───────────────

const COUNTRY_TO_CODE = {
  'saudi arabia': 'SA', 'united arab emirates': 'AE', 'uae': 'AE',
  'bahrain': 'BH', 'kuwait': 'KW', 'qatar': 'QA', 'oman': 'OM',
  'egypt': 'EG', 'jordan': 'JO', 'lebanon': 'LB', 'iraq': 'IQ',
  'turkey': 'TR', 'pakistan': 'PK', 'india': 'IN', 'morocco': 'MA',
  'tunisia': 'TN', 'syria': 'SY', 'yemen': 'YE', 'libya': 'LY',
  'sudan': 'SD', 'palestine': 'PS', 'iran': 'IR',
};

// ─────────────── shape converters ───────────────

function formatAddress(sf) {
  if (!sf) return "";
  const parts = [];
  if (sf.addressLines && sf.addressLines.length) parts.push(sf.addressLines.join(", "));
  if (sf.locality)           parts.push(sf.locality);
  if (sf.administrativeArea) parts.push(sf.administrativeArea);
  if (sf.postalCode)         parts.push(sf.postalCode);
  if (sf.regionCode)         parts.push(sf.regionCode);
  return parts.filter(Boolean).join(", ");
}

function mapsUrlFromPlaceId(placeId) {
  if (!placeId) return "";
  return `https://www.google.com/maps/place/?q=place_id:${placeId}`;
}

// Business Profile API regularHours → compact "Mon: 09:00–22:00 | Tue: …" string.
// periods[].openTime/closeTime are TimeOfDay objects {hours, minutes} (or "HH:MM").
const DAY_ABBR = {
  MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu",
  FRIDAY: "Fri", SATURDAY: "Sat", SUNDAY: "Sun",
};
const DAY_ORDER = ["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"];

function fmtTime(t) {
  if (t == null) return "";
  if (typeof t === "string") return t;
  const h = String(t.hours ?? 0).padStart(2, "0");
  const m = String(t.minutes ?? 0).padStart(2, "0");
  return `${h}:${m}`;
}

function formatRegularHours(regularHours) {
  const periods = regularHours?.periods;
  if (!Array.isArray(periods) || periods.length === 0) return "";
  const byDay = {};
  for (const p of periods) {
    const day = p.openDay || p.closeDay;
    if (!day) continue;
    const open = fmtTime(p.openTime);
    const close = fmtTime(p.closeTime);
    const span = open || close ? `${open || "00:00"}–${close || "24:00"}` : "Open 24 hours";
    (byDay[day] = byDay[day] || []).push(span);
  }
  return DAY_ORDER
    .filter((d) => byDay[d])
    .map((d) => `${DAY_ABBR[d]}: ${byDay[d].join(", ")}`)
    .join(" | ");
}

function convertReview(r) {
  // v4 returns starRating as an enum string: "ONE".."FIVE"
  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  const stars = map[r.starRating] || null;
  return {
    stars,
    rating:          stars,
    publishedAtDate: r.createTime || r.updateTime || null,
    text:            (r.comment || "").trim(),
  };
}

// ─────────────── public entry point ───────────────

async function fetchTarget() {
  const brand = config.targetName || "Target";
  console.log(`\n═══ ${brand.toUpperCase()}: Fetching via Google Business Profile API ═══\n`);

  const token = await getAccessToken();
  console.log("  ✓ got access token");

  const accounts = await listAccounts(token);
  console.log(`  ✓ ${accounts.length} account(s) found`);

  const merged = [];
  let totalSkippedDup = 0, totalSkippedClosed = 0;

  for (const acc of accounts) {
    const locs = await listLocationsForAccount(token, acc.name);
    console.log(`  ✓ account ${acc.name}: ${locs.length} locations`);
    for (let i = 0; i < locs.length; i++) {
      const loc = locs[i];

      // Skip duplicate locations flagged by Google
      if (loc.metadata?.duplicateLocation) {
        totalSkippedDup++;
        console.log(`    ✗ skipped duplicate: "${loc.title}" (flagged by Google)`);
        continue;
      }

      const openStatus = loc.openInfo?.status;
      if (openStatus === 'CLOSED_PERMANENTLY') {
        totalSkippedClosed++;
        console.log(`    ✗ skipped closed: "${loc.title}" (${openStatus})`);
        continue;
      }

      const title   = loc.title || "";
      const address = formatAddress(loc.storefrontAddress);
      const placeId = loc.metadata?.placeId || "";
      const mapsUrl = loc.metadata?.mapsUri || mapsUrlFromPlaceId(placeId);
      const phone   = loc.phoneNumbers?.primaryPhone || "";

      if (config.searchLocation) {
        const searchLoc = config.searchLocation.toLowerCase().trim();
        const addrLower = address.toLowerCase();
        const titleLower = title.toLowerCase();
        const regionCode = (loc.storefrontAddress?.regionCode || '').toUpperCase();
        const expectedCode = COUNTRY_TO_CODE[searchLoc];
        const countryMatch = expectedCode && regionCode === expectedCode;
        if (!addrLower.includes(searchLoc) && !titleLower.includes(searchLoc) && !countryMatch) {
          continue;
        }
      }

      // Reviews — fetched from the GMB v4 API (free, full history for the
      // brand we OWN). Downstream filters them to the job's date window.
      // (Competitor reviews come from Apify; Google has no public reviews API
      // for places you don't own.)
      let reviews = [];
      try {
        const raw = await listReviewsForLocation(token, acc.name, loc.name);
        reviews = raw.map(convertReview);
      } catch {}

      // Hours come straight from the GMB regularHours field (no scraping).
      const hours = formatRegularHours(loc.regularHours);

      merged.push({
        title,
        address,
        addressLink: mapsUrl,
        hours,
        phone,
        placeId,
        url:         mapsUrl,
        rating:      null,        // place-level avg filled by Places API enrichment
        reviewsCount: reviews.length || null,
        reviews,
        __searchBrand: brand,
      });

      if ((i + 1) % 10 === 0) {
        console.log(`    progress: ${i + 1}/${locs.length} locations processed`);
      }
    }
  }

  // Dedup by placeId — the same physical branch can be listed under more than
  // one GMB account (the client owns several), which Google does NOT flag as
  // metadata.duplicateLocation. Counting it twice would inflate the branch
  // count, so keep the first occurrence of each placeId.
  const dedupById = [];
  const seenPid = new Set();
  let crossAcctDup = 0;
  for (const b of merged) {
    if (b.placeId) {
      if (seenPid.has(b.placeId)) { crossAcctDup++; continue; }
      seenPid.add(b.placeId);
    }
    dedupById.push(b);
  }

  const withPlaceId  = dedupById.filter((b) => b.placeId).length;
  const withHours    = dedupById.filter((b) => b.hours).length;
  console.log(`\n  ✓ ${brand}: ${dedupById.length} unique branches | ${withPlaceId} have placeId | ${withHours} have hours (from GMB)`);
  if (totalSkippedDup > 0 || totalSkippedClosed > 0 || crossAcctDup > 0) {
    console.log(`    skipped: ${totalSkippedDup} Google-flagged duplicates, ${totalSkippedClosed} permanently closed, ${crossAcctDup} cross-account duplicates (same placeId)`);
  }
  console.log("  (ratings & review counts will be fetched from the Places API next)\n");

  return dedupById;
}

module.exports = { fetchTarget };
