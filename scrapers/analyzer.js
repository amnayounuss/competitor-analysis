/**
 * analyzer.js
 * Pure data processing — takes raw Apify place records and computes:
 *   - per-branch metrics (period-based)
 *   - per-brand aggregates
 *
 * Zero I/O. Safe to unit-test.
 */

const config = require("./config");

/**
 * Date subtraction that handles month rollover correctly.
 * e.g. subMonths(Jan 31, 1) → Dec 31.
 */
function subMonths(date, months) {
  const d = new Date(date.getTime());
  const targetMonth = d.getMonth() - months;
  d.setMonth(targetMonth);
  return d;
}

/**
 * Classify a place into one of the brands declared on the job.
 *
 * Priority:
 *   1. If the scraper tagged it (place.__searchBrand), trust that.
 *   2. Otherwise substring-match the title against config.BRAND_KEYWORDS.
 *   3. If nothing matches, return "Other" so the place is still kept but
 *      grouped separately instead of being silently mis-attributed.
 */
function assignBrand(place) {
  if (place && typeof place === "object" && place.__searchBrand) {
    return place.__searchBrand;
  }
  const title = (typeof place === "string" ? place : place && place.title) || "";
  const t = title.toLowerCase();
  const keywords = Array.isArray(config.BRAND_KEYWORDS) ? config.BRAND_KEYWORDS : [];
  for (const { keyword, brand } of keywords) {
    if (keyword && t.includes(keyword)) return brand;
  }
  return "Other";
}

/**
 * Best-effort extraction of a city from a free-text address.
 * Saudi addresses often end with "..., City 12345, Saudi Arabia".
 */
function extractCity(place) {
  if (place.city) return place.city;
  const addr = place.address || "";
  const parts = addr.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    // Usually the second-to-last chunk before the country — strip digits (postal codes).
    const candidate = parts[parts.length - 2].replace(/\d+/g, "").trim();
    if (candidate) return candidate;
  }
  return "Unknown";
}

/**
 * Parse a review's published date. Apify returns ISO strings in `publishedAtDate`,
 * but some actor versions return relative strings only — we guard against both.
 */
function parseReviewDate(review) {
  const raw = review.publishedAtDate || review.publishAt || review.publishedAt;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Given one place record, compute its window metrics.
 *
 * Window is [cutoffDate, endDate]. Review buckets divide the window into
 * three equal thirds (e.g. for a 90-day window → 30-day buckets).
 */
function computeBranchMetrics(place, cutoffDate, endDate) {
  const reviews = Array.isArray(place.reviews) ? place.reviews : [];
  const now = endDate || new Date();

  const windowMs = Math.max(now.getTime() - cutoffDate.getTime(), 1);
  const thirdMs  = windowMs / 3;
  // Month 1 = newest third (closest to `now`), Month 3 = oldest third.
  const monthBuckets = [[], [], []];

  const recent = [];
  const recentWithDate = [];
  for (const r of reviews) {
    const d = parseReviewDate(r);
    if (!d) continue;
    if (d < cutoffDate || d > now) continue;

    recent.push(r);
    recentWithDate.push({ review: r, date: d });

    const offsetMs = now.getTime() - d.getTime();
    if      (offsetMs <= thirdMs)     monthBuckets[0].push(r);
    else if (offsetMs <= 2 * thirdMs) monthBuckets[1].push(r);
    else                              monthBuckets[2].push(r);
  }

  // Overall stars + avg across the whole window
  const stars = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sumRating = 0;
  let countWithRating = 0;
  for (const r of recent) {
    const s = Number(r.stars ?? r.rating);
    if (s >= 1 && s <= 5 && Number.isFinite(s)) {
      const rounded = Math.round(s);
      stars[rounded]++;
      sumRating += s;
      countWithRating++;
    }
  }
  // Review count is the WINDOWED count (consistent with the star histogram and
  // period buckets, which are also windowed). For the average rating we fall
  // back to Google's place-level score only for DISPLAY when the window has no
  // reviews (it carries 0 weight in brand aggregates since totalReviews is 0).
  const placeRating = Number(place.rating);
  const avgRating = countWithRating > 0
    ? Number((sumRating / countWithRating).toFixed(2))
    : (placeRating >= 1 && placeRating <= 5 ? placeRating : null);
  const totalReviews = recent.length;

  // Per-month aggregates
  const monthStats = monthBuckets.map((bucket) => {
    let sum = 0, cnt = 0;
    for (const r of bucket) {
      const s = Number(r.stars ?? r.rating);
      if (s >= 1 && s <= 5 && Number.isFinite(s)) { sum += s; cnt++; }
    }
    return {
      count: bucket.length,
      avg:   cnt > 0 ? Number((sum / cnt).toFixed(2)) : null,
    };
  });

  // Build flat per-review export (for "All Reviews" sheet)
  const reviewsExport = recentWithDate
    .sort((a, b) => b.date - a.date) // newest first
    .map(({ review, date }) => {
      const offset = now.getTime() - date.getTime();
      const bucket = offset <= thirdMs       ? "Period 1 (newest third)"
                  : offset <= 2 * thirdMs    ? "Period 2 (middle third)"
                  :                            "Period 3 (oldest third)";
      return {
        date:        date.toISOString().slice(0, 10),
        monthBucket: bucket,
        rating:      Number(review.stars ?? review.rating) || null,
        text:        (review.text || review.textTranslated || "").trim(),
      };
    });

  return {
    brand:            assignBrand(place),
    branchName:       place.title || "Unknown",
    placeId:          place.placeId || place.place_id || null,
    city:             extractCity(place),
    address:          place.address || "",
    addressLink:      place.addressLink || place.url || "",
    hours:            place.hours || "",
    phone:            place.phone || "",
    popularTimes:     place.popularTimes || null,
    avgRatingPeriod:      avgRating,
    totalReviewsPeriod:   totalReviews,
    stars5:           stars[5],
    stars4:           stars[4],
    stars3:           stars[3],
    stars2:           stars[2],
    stars1:           stars[1],
    // Per-period breakdown
    period1Count:      monthStats[0].count,  // newest third
    period1Avg:        monthStats[0].avg,
    period2Count:      monthStats[1].count,  // middle third
    period2Avg:        monthStats[1].avg,
    period3Count:      monthStats[2].count,  // oldest third
    period3Avg:        monthStats[2].avg,
    // Flat review list for "All Reviews" sheet
    reviewsExport,
    // Keep a sample of review texts for sentiment section of the report
    sampleTexts:      recent
                        .map((r) => r.text || r.textTranslated || "")
                        .filter(Boolean)
                        .slice(0, 50),
  };
}

/**
 * Aggregate branch metrics into brand-level totals.
 */
function computeBrandSummary(branchRows) {
  const byBrand = {};
  for (const row of branchRows) {
    const b = row.brand;
    if (!byBrand[b]) {
      byBrand[b] = {
        brand:         b,
        totalBranches: 0,
        totalReviews:  0,
        ratingSum:     0,  // weighted by review count
        ratingWeight:  0,
        branches:      [],
      };
    }
    byBrand[b].totalBranches += 1;
    byBrand[b].totalReviews  += row.totalReviewsPeriod;
    byBrand[b].branches.push(row);

    if (row.avgRatingPeriod !== null && row.totalReviewsPeriod > 0) {
      byBrand[b].ratingSum    += row.avgRatingPeriod * row.totalReviewsPeriod;
      byBrand[b].ratingWeight += row.totalReviewsPeriod;
    }
  }

  return Object.values(byBrand).map((b) => ({
    brand:          b.brand,
    avgRatingPeriod:    b.ratingWeight > 0
                       ? Number((b.ratingSum / b.ratingWeight).toFixed(2))
                       : null,
    totalReviewsPeriod: b.totalReviews,
    totalBranches:  b.totalBranches,
    branches:       b.branches, // kept for the report, dropped from Excel
  }));
}

/**
 * Main entry point.
 *
 * Honors config.DATE_START / config.DATE_END when present, otherwise
 * falls back to LOOKBACK_MONTHS from "now".
 */
function analyze(rawPlaces) {
  const endDate   = config.DATE_END   ? new Date(config.DATE_END + 'T23:59:59.999Z') : new Date();
  const cutoff    = config.DATE_START ? new Date(config.DATE_START + 'T00:00:00.000Z')
                                      : subMonths(endDate, config.LOOKBACK_MONTHS);

  const branchRows = (rawPlaces || []).map((p) => computeBranchMetrics(p, cutoff, endDate));
  const brandRows  = computeBrandSummary(branchRows);

  const ranked = [...branchRows]
    .filter((r) => r.totalReviewsPeriod > 0 && r.avgRatingPeriod !== null)
    .sort((a, b) => b.avgRatingPeriod - a.avgRatingPeriod || b.totalReviewsPeriod - a.totalReviewsPeriod);

  return {
    cutoffDate:  cutoff,
    endDate,
    branchRows,
    brandRows,
    bestBranch:  ranked[0] || null,
    worstBranch: ranked[ranked.length - 1] || null,
  };
}

module.exports = {
  analyze,
  // exposed for testing
  _internal: { assignBrand, extractCity, parseReviewDate, computeBranchMetrics, subMonths },
};
