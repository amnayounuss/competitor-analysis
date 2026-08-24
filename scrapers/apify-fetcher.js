/**
 * apify-fetcher.js
 *
 * Third-party data via the Apify "Google Maps Scraper" actor
 * (compass/crawler-google-places). Used for COMPETITOR reviews + star
 * distribution + popular times (Google's own APIs don't expose full reviews
 * or the rating histogram for places you don't own), and for everyone's
 * popular times (the Puppeteer hover scraper produced broken per-day data —
 * every branch wrongly peaked on Sunday).
 *
 * One actor run takes a batch of place_ids and returns, per place:
 *   - reviews[]            { stars, publishedAtDate, text }   (date-windowed)
 *   - reviewsDistribution  { oneStar..fiveStar }
 *   - popularTimesHistogram{ Su/Mo/../Sa: [{hour, occupancyPercent}] }
 *   - totalScore, reviewsCount
 *
 * Output is normalised into the shape the analyzer already expects (the
 * analyzer was originally written for Apify place records).
 */

const https = require("https");
const config = require("./config");
const { summarizeGrid } = require("./popular-times");

const ACTOR = "compass~crawler-google-places";
const DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const ABBR_TO_DAY = { Su: "SUNDAY", Mo: "MONDAY", Tu: "TUESDAY", We: "WEDNESDAY", Th: "THURSDAY", Fr: "FRIDAY", Sa: "SATURDAY" };

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
          catch { resolve({ status: res.statusCode, body: d }); }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

/** Apify popularTimesHistogram → our 7×24 grid → summarizeGrid output. */
function convertPopularTimes(hist) {
  if (!hist || typeof hist !== "object") return { available: false, grid: {}, summary: "" };
  const grid = DAYS.map(() => new Array(24).fill(null));
  let any = false;
  for (const [abbr, slots] of Object.entries(hist)) {
    const day = ABBR_TO_DAY[abbr];
    if (!day || !Array.isArray(slots)) continue;
    const di = DAYS.indexOf(day);
    for (const s of slots) {
      const h = Number(s.hour);
      const v = Number(s.occupancyPercent);
      if (h >= 0 && h < 24 && Number.isFinite(v)) { grid[di][h] = v; if (v > 0) any = true; }
    }
  }
  if (!any) return { available: false, grid: {}, summary: "" };
  return summarizeGrid(grid) || { available: false, grid: {}, summary: "" };
}

function convertReviews(reviews) {
  if (!Array.isArray(reviews)) return [];
  return reviews.map((r) => ({
    stars:           r.stars ?? r.rating ?? null,
    rating:          r.stars ?? r.rating ?? null,
    publishedAtDate: r.publishedAtDate || r.publishAt || null,
    text:            (r.text || r.textTranslated || "").trim(),
  })).filter((r) => r.stars != null || r.publishedAtDate);
}

/**
 * Fetch place data for a batch of place_ids via Apify.
 *
 * @param {string[]} placeIds
 * @param {object} opts { maxReviews=0, reviewsStartDate, language='en' }
 * @returns {Promise<Map<string, {reviews, reviewsDistribution, popularTimes, rating, reviewsCount, title}>>}
 */
async function fetchViaApify(placeIds, opts = {}) {
  const token = config.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN not configured");
  const ids = Array.from(new Set((placeIds || []).filter(Boolean)));
  if (ids.length === 0) return new Map();

  const maxReviews = opts.maxReviews ?? 0;
  const input = {
    placeIds: ids,
    language: opts.language || "en",
    maxReviews,
    reviewsSort: "newest",
    scrapeReviewsPersonalData: false,
    maxImages: 0,
    skipClosedPlaces: true,
  };
  if (maxReviews > 0 && opts.reviewsStartDate) input.reviewsStartDate = opts.reviewsStartDate;

  console.log(`[apify] running actor for ${ids.length} places (maxReviews=${maxReviews}${input.reviewsStartDate ? `, since ${input.reviewsStartDate}` : ""})`);

  // run-sync-get-dataset-items blocks until the run finishes and returns items.
  const url = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${token}`;
  const res = await postJson(url, input);
  if (res.status !== 200 && res.status !== 201) {
    const detail = typeof res.body === "object" ? JSON.stringify(res.body) : String(res.body || "");
    const err = new Error(`Apify run failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
    // Distinguish "this account is out of credit / over its limit" from a
    // transient failure. The caller falls back to Puppeteer scraping for the
    // former and simply warns for the latter, so the two must not look alike.
    const lower = detail.toLowerCase();
    if (
      res.status === 402 ||
      (res.status === 403 && /usage|limit|credit|quota|billing|subscription/.test(lower)) ||
      /monthly-usage-hard-limit|usage-limit-exceeded|insufficient|out of credit/.test(lower)
    ) {
      err.quotaExhausted = true;
    }
    if (res.status === 401) err.badToken = true;
    throw err;
  }
  const items = Array.isArray(res.body) ? res.body : [];
  console.log(`[apify] received ${items.length} place records`);

  const out = new Map();
  for (const p of items) {
    const pid = p.placeId || p.inputPlaceId;
    if (!pid) continue;
    out.set(pid, {
      title:               p.title || "",
      rating:              typeof p.totalScore === "number" ? p.totalScore : null,
      reviewsCount:        p.reviewsCount ?? null,
      reviews:             convertReviews(p.reviews),
      reviewsDistribution: p.reviewsDistribution || null,
      popularTimes:        convertPopularTimes(p.popularTimesHistogram),
    });
  }
  return out;
}

/**
 * Attach Apify data (reviews + popularTimes [+ rating/count]) onto an array of
 * branch objects keyed by placeId. Mutates and returns the branches.
 *
 * @param {object[]} branches  each needs .placeId
 * @param {object} opts        { maxReviews, reviewsStartDate, fillRating }
 */
async function enrichBranchesViaApify(branches, opts = {}) {
  const withPid = branches.filter((b) => b.placeId);
  if (withPid.length === 0) return branches;
  const data = await fetchViaApify(withPid.map((b) => b.placeId), opts);

  let gotReviews = 0, gotPT = 0;
  for (const b of branches) {
    const d = b.placeId && data.get(b.placeId);
    if (!d) continue;
    if (opts.maxReviews > 0) { b.reviews = d.reviews; if (d.reviews.length) gotReviews++; }
    b.popularTimes = d.popularTimes;
    if (d.popularTimes?.available) gotPT++;
    b.reviewsDistribution = d.reviewsDistribution;
    if (opts.fillRating) {
      if (b.rating == null && d.rating != null) b.rating = d.rating;
      if (b.reviewsCount == null && d.reviewsCount != null) b.reviewsCount = d.reviewsCount;
    }
  }
  console.log(`[apify] enriched ${withPid.length} branches — ${gotReviews} with reviews, ${gotPT} with popular times`);
  return branches;
}

module.exports = { fetchViaApify, enrichBranchesViaApify, convertPopularTimes, convertReviews };
