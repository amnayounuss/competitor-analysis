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

  for (const acc of accounts) {
    const locs = await listLocationsForAccount(token, acc.name);
    console.log(`  ✓ account ${acc.name}: ${locs.length} locations`);

    for (let i = 0; i < locs.length; i++) {
      const loc = locs[i];

      const title   = loc.title || "";
      const address = formatAddress(loc.storefrontAddress);
      const placeId = loc.metadata?.placeId || "";
      const mapsUrl = loc.metadata?.mapsUri || mapsUrlFromPlaceId(placeId);
      const phone   = loc.phoneNumbers?.primaryPhone || "";

      // Scoping filter: If a specific search location is configured (e.g. "Riyadh"),
      // skip GMB branches located in other cities/regions.
      if (config.searchLocation) {
        const searchLoc = config.searchLocation.toLowerCase();
        const addrLower = address.toLowerCase();
        const titleLower = title.toLowerCase();
        if (!addrLower.includes(searchLoc) && !titleLower.includes(searchLoc)) {
          continue; // Skip branch outside target region
        }
      }

      // Reviews — tries the v4 API; silently empty if scope/permission missing
      let reviews = [];
      try {
        const raw = await listReviewsForLocation(token, acc.name, loc.name);
        reviews = raw.map(convertReview);
      } catch {}

      // Compute aggregate rating from the fetched reviews. The Business
      // Profile API doesn't expose a place-level average, so we derive it.
      let rating = null;
      let reviewsCount = reviews.length;
      if (reviews.length) {
        const valid = reviews.filter(r => Number(r.stars) >= 1 && Number(r.stars) <= 5);
        if (valid.length) {
          rating = Number((valid.reduce((s, r) => s + Number(r.stars), 0) / valid.length).toFixed(2));
        }
      }

      merged.push({
        title,
        address,
        addressLink: mapsUrl,
        hours:       "",          // filled later by hoursScraper.js via Puppeteer
        phone,
        placeId,
        url:         mapsUrl,
        rating,
        reviewsCount,
        reviews,
        __searchBrand: brand,
      });

      if ((i + 1) % 10 === 0) {
        console.log(`    progress: ${i + 1}/${locs.length} locations processed`);
      }
    }
  }

  const totalReviews = merged.reduce((s, b) => s + b.reviews.length, 0);
  const withPlaceId  = merged.filter((b) => b.placeId).length;
  console.log(`\n  ✓ ${brand}: ${merged.length} branches | ${totalReviews} reviews | ${withPlaceId} have placeId`);
  console.log("  (business hours will be scraped from Google Maps in a later step)\n");

  return merged;
}

module.exports = { fetchTarget };
