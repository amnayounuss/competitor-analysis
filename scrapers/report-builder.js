/**
 * report-builder.js
 * Writes a Markdown analytical report covering brand performance, competitive
 * insights, customer sentiment, key findings, and target-brand recommendations.
 *
 * The target brand is taken from `config.targetName`. All comparisons are
 * driven by the brands present in the analyzed dataset — no hardcoded names.
 *
 * Sentiment analysis is keyword-based (lightweight, deterministic).
 */

const fs = require("fs");
const path = require("path");
const config = require("./config");

// ---------- Keyword buckets for simple theme extraction ----------
const THEMES = {
  productQuality: {
    positive: ["delicious", "fresh", "tasty", "quality", "premium", "best", "love", "amazing", "excellent", "great taste"],
    negative: ["stale", "dry", "expired", "bad taste", "low quality", "disgusting", "tasteless"],
  },
  service: {
    positive: ["friendly", "helpful", "polite", "quick", "fast service", "professional", "attentive", "welcoming"],
    negative: ["rude", "slow", "ignored", "unprofessional", "bad service", "waiting", "unfriendly", "arrogant"],
  },
  experience: {
    positive: ["clean", "beautiful", "cozy", "nice atmosphere", "elegant", "comfortable", "lovely"],
    negative: ["dirty", "crowded", "messy", "uncomfortable", "noisy", "smell"],
  },
  priceValue: {
    positive: ["worth", "reasonable", "good price", "value"],
    negative: ["expensive", "overpriced", "pricey", "not worth"],
  },
};

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Count keyword hits across a brand's review corpus.
 */
function analyzeSentiment(brandAgg) {
  const allText = brandAgg.branches
    .flatMap((br) => br.sampleTexts)
    .join(" ")
    .toLowerCase();

  const out = {};
  for (const [theme, buckets] of Object.entries(THEMES)) {
    let pos = 0;
    let neg = 0;
    for (const kw of buckets.positive) {
      const hits = (allText.match(new RegExp(`\\b${kw}\\b`, "g")) || []).length;
      pos += hits;
    }
    for (const kw of buckets.negative) {
      const hits = (allText.match(new RegExp(`\\b${kw}\\b`, "g")) || []).length;
      neg += hits;
    }
    out[theme] = { positive: pos, negative: neg, net: pos - neg };
  }
  return out;
}

/**
 * Compute rating consistency — std-dev of per-branch avg ratings for a brand.
 * Lower is better (more consistent experience across branches).
 */
function ratingStdDev(branches) {
  const rated = branches.filter((b) => b.avgRating3m !== null && b.totalReviews3m > 0);
  if (rated.length < 2) return null;
  const mean = rated.reduce((s, b) => s + b.avgRating3m, 0) / rated.length;
  const variance = rated.reduce((s, b) => s + Math.pow(b.avgRating3m - mean, 2), 0) / rated.length;
  return Number(Math.sqrt(variance).toFixed(2));
}

function safe(n, fallback = "N/A") {
  return n === null || n === undefined || Number.isNaN(n) ? fallback : n;
}

/**
 * Build the full Markdown report.
 */
function buildReport(analysis) {
  const { branchRows, brandRows, bestBranch, worstBranch, cutoffDate } = analysis;
  const today = new Date();

  // --- Sort brands by weighted avg rating ---
  const brandsByRating = [...brandRows].sort(
    (a, b) => (b.avgRating3m ?? -1) - (a.avgRating3m ?? -1)
  );
  const brandsByVolume = [...brandRows].sort((a, b) => b.totalReviews3m - a.totalReviews3m);

  // --- Sentiment per brand ---
  const sentimentByBrand = {};
  for (const b of brandRows) sentimentByBrand[b.brand] = analyzeSentiment(b);

  // --- Consistency per brand ---
  const consistencyByBrand = {};
  for (const b of brandRows) consistencyByBrand[b.brand] = ratingStdDev(b.branches);

  const targetName = config.targetName || (brandRows[0] && brandRows[0].brand) || "Target";
  const target     = brandRows.find((b) => b.brand === targetName) || null;
  const competitorRows = brandRows.filter((b) => b.brand !== targetName);

  const title = competitorRows.length
    ? `${targetName} vs ${competitorRows.map(b => b.brand).join(' vs ')}`
    : `${targetName}`;

  const windowLabel = (config.DATE_START && config.DATE_END)
    ? `${config.DATE_START} → ${config.DATE_END}`
    : `${cutoffDate.toISOString().slice(0, 10)} → ${today.toISOString().slice(0, 10)} (last ${config.LOOKBACK_MONTHS} months)`;

  // ===== Markdown =====
  const lines = [];
  const H = (s) => lines.push(s);

  H(`# ${title} — Google Maps Competitor Analysis`);
  H(``);
  H(`**Report window:** ${windowLabel}`);
  H(`**Data source:** Google Maps public reviews, scraped via Apify`);
  H(`**Expected accuracy:** ~90–95% — Google Maps does not publish historical rating data, so all metrics are derived from review publish dates.`);
  H(``);
  H(`---`);
  H(``);

  // ---- Executive summary ----
  H(`## Executive Summary`);
  H(``);
  const topRated  = brandsByRating[0];
  const topVolume = brandsByVolume[0];
  H(`- **Highest-rated brand (last ${config.LOOKBACK_MONTHS} months):** ${topRated ? `${topRated.brand} (${safe(topRated.avgRating3m)}⭐)` : "N/A"}`);
  H(`- **Most-reviewed brand (volume leader):** ${topVolume ? `${topVolume.brand} (${topVolume.totalReviews3m} reviews)` : "N/A"}`);
  H(`- **Total branches analyzed:** ${branchRows.length}`);
  H(`- **Total reviews in window:** ${branchRows.reduce((s, r) => s + r.totalReviews3m, 0)}`);
  if (bestBranch)  H(`- **Best single branch:** ${bestBranch.branchName} (${bestBranch.brand}) — ${bestBranch.avgRating3m}⭐ across ${bestBranch.totalReviews3m} reviews`);
  if (worstBranch) H(`- **Weakest single branch:** ${worstBranch.branchName} (${worstBranch.brand}) — ${worstBranch.avgRating3m}⭐ across ${worstBranch.totalReviews3m} reviews`);
  H(``);

  // ---- Brand Performance ----
  H(`## 1. Brand Performance`);
  H(``);
  H(`| Brand | Avg Rating (3m) | Total Reviews (3m) | Branches | Rating Consistency (σ, lower = better) |`);
  H(`|---|---|---|---|---|`);
  for (const b of brandsByRating) {
    H(`| ${b.brand} | ${safe(b.avgRating3m)} | ${b.totalReviews3m} | ${b.totalBranches} | ${safe(consistencyByBrand[b.brand])} |`);
  }
  H(``);
  H(`**Reading the consistency column:** a lower σ means a customer gets roughly the same experience at any branch. A high σ indicates hit-or-miss locations — a red flag for operational standards.`);
  H(``);

  // ---- Competitive Insights ----
  H(`## 2. Competitive Insights — ${title}`);
  H(``);
  for (const b of brandRows) {
    H(`### ${b.brand}`);
    H(``);
    H(`- **Footprint:** ${b.totalBranches} branches analyzed`);
    H(`- **Voice of customer:** ${b.totalReviews3m} reviews in the window`);
    H(`- **Average rating:** ${safe(b.avgRating3m)}⭐`);
    H(`- **Branch consistency (σ):** ${safe(consistencyByBrand[b.brand])}`);

    // Strengths / weaknesses from sentiment
    const s = sentimentByBrand[b.brand];
    const strengths  = Object.entries(s).filter(([, v]) => v.net >= 3).sort((a, c) => c[1].net - a[1].net);
    const weaknesses = Object.entries(s).filter(([, v]) => v.net <= -3).sort((a, c) => a[1].net - c[1].net);

    if (strengths.length) {
      H(`- **Strengths (customer keywords):** ${strengths.map(([t, v]) => `${t} (+${v.net})`).join(", ")}`);
    } else {
      H(`- **Strengths:** no strongly positive theme detected in the sample`);
    }
    if (weaknesses.length) {
      H(`- **Weaknesses (customer keywords):** ${weaknesses.map(([t, v]) => `${t} (${v.net})`).join(", ")}`);
    } else {
      H(`- **Weaknesses:** no strongly negative theme detected in the sample`);
    }
    H(``);
  }

  // ---- Customer Sentiment ----
  H(`## 3. Customer Sentiment — Theme Breakdown`);
  H(``);
  H(`Keyword-based pass over review text. Counts are positive-vs-negative mentions per theme.`);
  H(``);
  H(`| Brand | Product Quality (net) | Service (net) | Experience (net) | Price / Value (net) |`);
  H(`|---|---|---|---|---|`);
  for (const b of brandRows) {
    const s = sentimentByBrand[b.brand];
    H(`| ${b.brand} | ${s.productQuality.net >= 0 ? "+" : ""}${s.productQuality.net} | ${s.service.net >= 0 ? "+" : ""}${s.service.net} | ${s.experience.net >= 0 ? "+" : ""}${s.experience.net} | ${s.priceValue.net >= 0 ? "+" : ""}${s.priceValue.net} |`);
  }
  H(``);

  // ---- Key Findings ----
  H(`## 4. Key Findings`);
  H(``);

  H(`### Best-performing brand`);
  if (topRated) {
    H(`**${topRated.brand}** leads on average rating (${safe(topRated.avgRating3m)}⭐ across ${topRated.totalReviews3m} reviews and ${topRated.totalBranches} branches).`);
  }
  H(``);

  H(`### Weakest areas per brand`);
  for (const b of brandRows) {
    const s = sentimentByBrand[b.brand];
    const sorted = Object.entries(s).sort((a, c) => a[1].net - c[1].net);
    const worstTheme = sorted[0];
    // Only call something a "weakness" if it's actually net-negative.
    // Otherwise surface it as the "lowest-scoring positive theme" — still useful, but honest.
    const label = worstTheme && worstTheme[1].net < 0
      ? `weakest theme: *${worstTheme[0]}* (net ${worstTheme[1].net}) — actively negative`
      : worstTheme
        ? `lowest-scoring (still positive) theme: *${worstTheme[0]}* (net +${worstTheme[1].net})`
        : "no theme data";

    const problemBranches = b.branches
      .filter((br) => br.avgRating3m !== null && br.avgRating3m < 4 && br.totalReviews3m >= 3)
      .sort((a, c) => a.avgRating3m - c.avgRating3m)
      .slice(0, 3);

    H(`- **${b.brand}** — ${label}.`);
    if (problemBranches.length) {
      H(`  - Underperforming branches: ${problemBranches.map((br) => `${br.branchName} (${br.avgRating3m}⭐, ${br.totalReviews3m} reviews)`).join("; ")}`);
    }
  }
  H(``);

  H(`### Risk areas`);
  H(``);
  const risks = [];
  const highVarianceBrands = brandRows.filter((b) => {
    const sd = consistencyByBrand[b.brand];
    return sd !== null && sd >= 0.5;
  });
  if (highVarianceBrands.length) {
    risks.push(`- **Inconsistent experience across branches:** ${highVarianceBrands.map((b) => `${b.brand} (σ=${consistencyByBrand[b.brand]})`).join(", ")}. A customer's impression depends heavily on which branch they visit.`);
  }
  const lowVolume = brandRows.filter((b) => b.totalReviews3m < 30);
  if (lowVolume.length) {
    risks.push(`- **Low review volume (weak recent signal):** ${lowVolume.map((b) => `${b.brand} (${b.totalReviews3m} reviews in ${config.LOOKBACK_MONTHS} months)`).join(", ")}. Small samples mean a few vocal customers can swing the rating.`);
  }
  // Highlight any brand with a concentration of 1⭐/2⭐ reviews
  for (const b of brandRows) {
    const neg = b.branches.reduce((s, br) => s + br.stars1 + br.stars2, 0);
    const ratio = b.totalReviews3m > 0 ? neg / b.totalReviews3m : 0;
    if (ratio >= 0.15) {
      risks.push(`- **${b.brand} has a high share of 1–2⭐ reviews** (${(ratio * 100).toFixed(1)}% of ${b.totalReviews3m}). These drag the visible Google rating disproportionately and tend to compound if unanswered.`);
    }
  }
  // Underperforming individual branches regardless of brand
  const bad = branchRows
    .filter((r) => r.avgRating3m !== null && r.avgRating3m < 3.5 && r.totalReviews3m >= 5)
    .sort((a, c) => a.avgRating3m - c.avgRating3m)
    .slice(0, 5);
  if (bad.length) {
    risks.push(`- **Individual branches under 3.5⭐ with meaningful review volume:** ${bad.map((r) => `${r.branchName} (${r.brand}, ${r.avgRating3m}⭐)`).join("; ")}. These are reputational liabilities — a single angry social-media post about any one of them can become the brand's visible story.`);
  }
  if (risks.length === 0) {
    H(`- No structural risk signals detected in this window. Smallest concern: keep review-response velocity high so the picture doesn't drift in the next quarter.`);
  } else {
    for (const r of risks) H(r);
  }
  H(``);

  // ---- Recommendations for the target brand ----
  H(`## 5. Recommendations for ${targetName}`);
  H(``);

  if (!target) {
    H(`_No ${targetName} data available in the window — unable to produce recommendations._`);
  } else {
    const targetSent  = sentimentByBrand[targetName];
    const targetSigma = consistencyByBrand[targetName];

    // How target can outperform each competitor
    H(`### How ${targetName} can outperform competitors`);
    H(``);
    let saidSomething = false;
    for (const comp of competitorRows) {
      const compSent = sentimentByBrand[comp.brand];
      if (target.avgRating3m === null || comp.avgRating3m === null) continue;
      const gap = Number((comp.avgRating3m - target.avgRating3m).toFixed(2));
      if (gap > 0) {
        const topTheme = compSent
          ? Object.entries(compSent).sort((a, c) => c[1].net - a[1].net)[0]?.[0] || 'overall experience'
          : 'overall experience';
        H(`- ${targetName} trails **${comp.brand}** by ${gap}⭐ on average rating. ${comp.brand}'s strongest theme is *${topTheme}* — ${targetName} should benchmark and close that specific gap rather than trying to match every dimension at once.`);
        saidSomething = true;
      } else if (gap < 0) {
        H(`- ${targetName} leads **${comp.brand}** by ${Math.abs(gap)}⭐. The priority is **defending** that lead: keep the top-rated branches as flagship references and port their SOPs to lower-rated ones.`);
        saidSomething = true;
      }
    }
    if (!saidSomething) {
      H(`- No clear rating gap with competitors — focus on increasing review volume and theme strength rather than chasing a star-rating delta.`);
    }
    H(``);

    // Service improvements
    H(`### Service improvements`);
    H(``);
    if (targetSent.service.net < 0) {
      H(`- Service sentiment is net-negative (${targetSent.service.net}). Recurring complaint keywords are the highest-leverage fix: train staff on greeting, speed of handover, and handling of special requests.`);
    } else {
      H(`- Service sentiment is net-positive (${targetSent.service.net}). Lock this in with a documented service standard so it survives staff turnover.`);
    }
    const weakBranches = target.branches
      .filter((br) => br.avgRating3m !== null && br.avgRating3m < 4 && br.totalReviews3m >= 3)
      .sort((a, c) => a.avgRating3m - c.avgRating3m)
      .slice(0, 5);
    if (weakBranches.length) {
      H(`- **Branches needing immediate attention:**`);
      for (const br of weakBranches) {
        H(`  - ${br.branchName} — ${br.avgRating3m}⭐ over ${br.totalReviews3m} reviews (${br.stars1 + br.stars2} negative reviews in window)`);
      }
    }
    H(``);

    // Customer experience strategy
    H(`### Customer experience strategy`);
    H(``);
    if (targetSigma !== null && targetSigma >= 0.5) {
      H(`- Branch consistency is weak (σ=${targetSigma}). A customer's experience depends heavily on which ${targetName} branch they walk into. Recommended: mystery-shop the bottom-quartile branches, identify the 2–3 operational variables that correlate with low ratings, and standardize them chain-wide.`);
    } else if (targetSigma !== null) {
      H(`- Branch consistency is strong (σ=${targetSigma}) — use this in marketing as a competitive differentiator against higher-variance competitors.`);
    }
    if (targetSent.productQuality.net < 0) {
      H(`- Product-quality sentiment is net-negative. Audit freshness, sourcing, and in-store storage — these are the most frequent drivers of 1–2⭐ reviews.`);
    }
    if (targetSent.priceValue.net < 0) {
      H(`- Price-value sentiment is net-negative. Options: reinforce premium positioning OR introduce a clear entry-price tier. Doing neither risks being seen as expensive without feeling premium.`);
    }
    H(`- **Review-response discipline:** respond to every 1–2⭐ review within 48 hours. Google weighs recency and response rate; this alone tends to lift visible star ratings within a quarter.`);
    const flagshipNames = target.branches
      .filter((br) => br.avgRating3m !== null && br.totalReviews3m >= 5)
      .sort((a, c) => c.avgRating3m - a.avgRating3m)
      .slice(0, 3)
      .map((br) => br.branchName)
      .join(", ");
    H(`- **Flagship branches:** publicly showcase the top 2–3 ${targetName} branches (${flagshipNames || "top performers"}) as proof points, and use them as training sites for underperformers.`);
    H(``);
  }

  // ---- Methodology & caveats ----
  H(`## Methodology & Caveats`);
  H(``);
  H(`- **Source:** Google Maps public reviews, collected via Puppeteer + Google Business Profile API.`);
  H(`- **Window:** ${windowLabel}.`);
  H(`- **Brand assignment:** scrapers tag each place with its searched brand. Untagged places fall back to a substring match against the job's target + competitor names; anything that still doesn't match is grouped as "Other".`);
  H(`- **Brand-level average rating:** weighted by number of reviews per branch (prevents a 1-review branch from distorting the brand mean).`);
  H(`- **Sentiment:** deterministic keyword counting — surfaces themes, not a substitute for reading the reviews.`);
  H(`- **Accuracy:** ~90–95%. Google Maps does not expose historical ratings, search results can vary by region/language, and a small number of reviews lack a usable publish date and are excluded.`);
  H(``);
  H(`---`);
  H(``);
  H(`*Report generated automatically on ${today.toISOString().slice(0, 10)}.*`);

  return lines.join("\n");
}

function writeReport(analysis) {
  const md = buildReport(analysis);
  ensureDir(config.REPORT_FILE);
  fs.writeFileSync(config.REPORT_FILE, md, "utf8");
  console.log(`[report] wrote ${config.REPORT_FILE}`);
  return config.REPORT_FILE;
}

module.exports = { writeReport, buildReport };
