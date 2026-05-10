/**
 * analyzer.js
 * Pure data processing — takes raw Apify place records and computes:
 *   - per-branch metrics (last N months)
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
 * Classify a place into one of the three brands based on title.
 * Case-insensitive substring match; falls back to "Bostani" per spec.
 */
function assignBrand(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("anoosh")) return "Anoosh";
  if (t.includes("patchi")) return "Patchi";
  return "Bostani";
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
 * Given one place record, compute its last-N-months metrics.
 */
function computeBranchMetrics(place, cutoffDate) {
  const reviews = Array.isArray(place.reviews) ? place.reviews : [];
  const now = new Date();

  // Bucket each recent review into "Month 1" (most recent 30 days),
  // "Month 2" (30-60 days ago), "Month 3" (60-90 days ago).
  // Month 1 is the most recent, Month 3 is the oldest in window.
  const monthBuckets = [[], [], []]; // index 0 → Month 1 (newest), 2 → Month 3

  const recent = [];
  const recentWithDate = []; // reviews paired with parsed Date — used for per-review export
  for (const r of reviews) {
    const d = parseReviewDate(r);
    if (!d) continue;
    if (d < cutoffDate) continue;

    recent.push(r);
    recentWithDate.push({ review: r, date: d });

    const daysAgo = (now - d) / (1000 * 60 * 60 * 24);
    if      (daysAgo <= 30) monthBuckets[0].push(r);
    else if (daysAgo <= 60) monthBuckets[1].push(r);
    else                    monthBuckets[2].push(r);
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
  const avgRating = countWithRating > 0 ? Number((sumRating / countWithRating).toFixed(2)) : null;

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
    .map(({ review, date }) => ({
      date:        date.toISOString().slice(0, 10), // YYYY-MM-DD
      monthBucket: ((now - date) / (1000 * 60 * 60 * 24) <= 30) ? "Month 1 (0-30 days)"
                 : ((now - date) / (1000 * 60 * 60 * 24) <= 60) ? "Month 2 (30-60 days)"
                 : "Month 3 (60-90 days)",
      rating:      Number(review.stars ?? review.rating) || null,
      text:        (review.text || review.textTranslated || "").trim(),
    }));

  return {
    brand:            assignBrand(place.title),
    branchName:       place.title || "Unknown",
    city:             extractCity(place),
    address:          place.address || "",
    addressLink:      place.addressLink || place.url || "",
    hours:            place.hours || "",
    phone:            place.phone || "",
    popularTimes:     place.popularTimes || null,
    avgRating3m:      avgRating,
    totalReviews3m:   recent.length,
    stars5:           stars[5],
    stars4:           stars[4],
    stars3:           stars[3],
    stars2:           stars[2],
    stars1:           stars[1],
    // Per-month breakdown
    month1Count:      monthStats[0].count,  // 0-30 days ago (newest)
    month1Avg:        monthStats[0].avg,
    month2Count:      monthStats[1].count,  // 30-60 days ago
    month2Avg:        monthStats[1].avg,
    month3Count:      monthStats[2].count,  // 60-90 days ago (oldest)
    month3Avg:        monthStats[2].avg,
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
    byBrand[b].totalReviews  += row.totalReviews3m;
    byBrand[b].branches.push(row);

    if (row.avgRating3m !== null && row.totalReviews3m > 0) {
      byBrand[b].ratingSum    += row.avgRating3m * row.totalReviews3m;
      byBrand[b].ratingWeight += row.totalReviews3m;
    }
  }

  return Object.values(byBrand).map((b) => ({
    brand:          b.brand,
    avgRating3m:    b.ratingWeight > 0
                       ? Number((b.ratingSum / b.ratingWeight).toFixed(2))
                       : null,
    totalReviews3m: b.totalReviews,
    totalBranches:  b.totalBranches,
    branches:       b.branches, // kept for the report, dropped from Excel
  }));
}

/**
 * Main entry point.
 */
function analyze(rawPlaces) {
  const now = new Date();
  const cutoff = subMonths(now, config.LOOKBACK_MONTHS);

  const branchRows = (rawPlaces || []).map((p) => computeBranchMetrics(p, cutoff));
  const brandRows  = computeBrandSummary(branchRows);

  // Rankings (bonus)
  const ranked = [...branchRows]
    .filter((r) => r.totalReviews3m > 0 && r.avgRating3m !== null)
    .sort((a, b) => b.avgRating3m - a.avgRating3m || b.totalReviews3m - a.totalReviews3m);

  return {
    cutoffDate:  cutoff,
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
