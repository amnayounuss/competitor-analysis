/**
 * excelBuilder.js
 * Produces the deliverable workbook with 6 sheets:
 *   1. Branch Wise Data       — per-branch rollup (MAIN SHEET)
 *   2. Brand Comparison       — brand-level aggregates
 *   3. Rankings               — every branch sorted best → worst
 *   4. All Reviews            — every individual review with date/rating/text
 *   5. Popular Times Detail   — per-branch × day × hour busyness grid
 *   6. Dashboard              — one-page text summary
 */

const XLSX = require("xlsx");
const fs   = require("fs");
const path = require("path");
const config = require("./config");

function ensureDir(p) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Apply hyperlinks to a whole column in a worksheet. */
function addColumnHyperlinks(ws, colIndex, rows, field) {
  for (let i = 0; i < rows.length; i++) {
    const cellRef = XLSX.utils.encode_cell({ c: colIndex, r: i + 1 }); // +1 for header
    const url = rows[i][field];
    if (url && ws[cellRef]) {
      ws[cellRef].l = { Target: url, Tooltip: "Open" };
    }
  }
}

// ─────────────── SHEET 1: Branch Wise Data ───────────────

function buildBranchSheet(branchRows) {
  const headers = [
    "Brand", "Branch Name", "Address", "Google Maps Link",
    "Business Hours", "Phone",
    "Peak Time", "Busy Hours Summary",
    "Avg Rating (Last 3 Months)", "Total Reviews (Last 3 Months)",
    "Month 1 Reviews (0-30d)",  "Month 1 Avg Rating",
    "Month 2 Reviews (30-60d)", "Month 2 Avg Rating",
    "Month 3 Reviews (60-90d)", "Month 3 Avg Rating",
    "5⭐ Count", "4⭐ Count", "3⭐ Count", "2⭐ Count", "1⭐ Count",
  ];

  const data = branchRows.map((r) => {
    const pt = r.popularTimes || {};
    const peakLabel = pt.available
      ? `${pt.peakDay} ${pt.peakHour}${pt.peakBusyness != null ? ` (${pt.peakBusyness}%)` : ""}`
      : "N/A";
    return {
      "Brand":                         r.brand,
      "Branch Name":                   r.branchName,
      "Address":                       r.address || r.city || "",
      "Google Maps Link":              r.addressLink || "",
      "Business Hours":                r.hours || "",
      "Phone":                         r.phone || "",
      "Peak Time":                     peakLabel,
      "Busy Hours Summary":            pt.summary || "",
      "Avg Rating (Last 3 Months)":    r.avgRating3m !== null ? r.avgRating3m : "N/A",
      "Total Reviews (Last 3 Months)": r.totalReviews3m,
      "Month 1 Reviews (0-30d)":       r.month1Count,
      "Month 1 Avg Rating":            r.month1Avg !== null ? r.month1Avg : "N/A",
      "Month 2 Reviews (30-60d)":      r.month2Count,
      "Month 2 Avg Rating":            r.month2Avg !== null ? r.month2Avg : "N/A",
      "Month 3 Reviews (60-90d)":      r.month3Count,
      "Month 3 Avg Rating":            r.month3Avg !== null ? r.month3Avg : "N/A",
      "5⭐ Count":                      r.stars5,
      "4⭐ Count":                      r.stars4,
      "3⭐ Count":                      r.stars3,
      "2⭐ Count":                      r.stars2,
      "1⭐ Count":                      r.stars1,
    };
  });

  const ws = XLSX.utils.json_to_sheet(data, { header: headers });

  // Make the Google Maps Link column clickable
  addColumnHyperlinks(ws, headers.indexOf("Google Maps Link"), data, "Google Maps Link");

  // Column widths
  ws["!cols"] = [
    { wch: 10 },  // Brand
    { wch: 30 },  // Branch Name
    { wch: 45 },  // Address
    { wch: 28 },  // Maps Link
    { wch: 40 },  // Hours
    { wch: 18 },  // Phone
    { wch: 28 },  // Peak Time
    { wch: 40 },  // Busy Hours Summary
    { wch: 14 },  // Avg Rating
    { wch: 14 },  // Total Reviews
    { wch: 16 }, { wch: 14 },  // Month 1
    { wch: 16 }, { wch: 14 },  // Month 2
    { wch: 16 }, { wch: 14 },  // Month 3
    { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 9 },  // stars
  ];

  // Freeze top row
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  return ws;
}

// ─────────────── SHEET 2: Brand Comparison ───────────────

function buildBrandSheet(brandRows) {
  const headers = [
    "Brand",
    "Average Rating (3 months)",
    "Total Reviews (3 months)",
    "Total Branches",
  ];

  const data = brandRows.map((b) => ({
    "Brand":                     b.brand,
    "Average Rating (3 months)": b.avgRating3m !== null ? b.avgRating3m : "N/A",
    "Total Reviews (3 months)":  b.totalReviews3m,
    "Total Branches":            b.totalBranches,
  }));

  const ws = XLSX.utils.json_to_sheet(data, { header: headers });
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(12, h.length + 4) }));
  return ws;
}

// ─────────────── SHEET 3: Rankings ───────────────

function buildRankingsSheet(branchRows) {
  const ranked = [...branchRows]
    .filter((r) => r.totalReviews3m > 0 && r.avgRating3m !== null)
    .sort((a, b) => b.avgRating3m - a.avgRating3m || b.totalReviews3m - a.totalReviews3m)
    .map((r, i) => ({
      "Rank":        i + 1,
      "Brand":       r.brand,
      "Branch":      r.branchName,
      "Address":     r.address || r.city || "",
      "Avg Rating":  r.avgRating3m,
      "Reviews":     r.totalReviews3m,
    }));

  const headers = ["Rank", "Brand", "Branch", "Address", "Avg Rating", "Reviews"];
  const ws = XLSX.utils.json_to_sheet(ranked, { header: headers });
  ws["!cols"] = [{ wch: 6 }, { wch: 10 }, { wch: 30 }, { wch: 45 }, { wch: 12 }, { wch: 10 }];
  return ws;
}

// ─────────────── SHEET 4: All Reviews (every single review) ───────────────

function buildAllReviewsSheet(branchRows) {
  const rows = [];
  for (const b of branchRows) {
    for (const r of b.reviewsExport || []) {
      rows.push({
        "Brand":      b.brand,
        "Branch":     b.branchName,
        "Date":       r.date,                // YYYY-MM-DD
        "Month":      r.monthBucket,         // Month 1/2/3 label
        "Rating":     r.rating != null ? r.rating : "",
        "Review Text": r.text,
      });
    }
  }
  // Sort: brand, then branch, then date desc
  rows.sort((a, b) =>
    (a.Brand.localeCompare(b.Brand)) ||
    (a.Branch.localeCompare(b.Branch)) ||
    (b.Date.localeCompare(a.Date))
  );

  const headers = ["Brand", "Branch", "Date", "Month", "Rating", "Review Text"];
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  ws["!cols"] = [
    { wch: 10 }, { wch: 30 }, { wch: 12 }, { wch: 22 }, { wch: 8 }, { wch: 80 },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  return ws;
}

// ─────────────── SHEET 5: Popular Times Detail ───────────────

const DAYS = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
const DAY_DISPLAY = { SUNDAY:"Sunday", MONDAY:"Monday", TUESDAY:"Tuesday",
                      WEDNESDAY:"Wednesday", THURSDAY:"Thursday", FRIDAY:"Friday", SATURDAY:"Saturday" };

function hourLabel(h) {
  if (h === 0) return "12 AM";
  if (h < 12)  return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

function buildPopularTimesSheet(branchRows) {
  // Wide format: one row per (Branch × Day), columns = 24 hours
  const rows = [];
  for (const b of branchRows) {
    const pt = b.popularTimes;
    if (!pt || !pt.available || !pt.grid) continue;
    for (const day of DAYS) {
      const hourly = pt.grid[day];
      if (!Array.isArray(hourly) || hourly.length === 0) continue;

      const row = {
        "Brand":  b.brand,
        "Branch": b.branchName,
        "Day":    DAY_DISPLAY[day],
      };
      for (let h = 0; h < 24; h++) {
        row[hourLabel(h)] = hourly[h] != null ? hourly[h] : "";
      }
      rows.push(row);
    }
  }

  if (rows.length === 0) {
    // Make a 1-row informational sheet instead of an empty one
    const ws = XLSX.utils.aoa_to_sheet([
      ["No popular times data was available for any branch."],
      ["This can happen if:"],
      ["  - Google Maps didn't show popular times for these places"],
      ["  - The branches are new / have low traffic"],
      ["  - Google changed their data format (re-run scraper to retry)"],
    ]);
    ws["!cols"] = [{ wch: 80 }];
    return ws;
  }

  const headers = ["Brand", "Branch", "Day", ...Array.from({ length: 24 }, (_, h) => hourLabel(h))];
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
  ws["!cols"] = [
    { wch: 10 }, { wch: 30 }, { wch: 10 },
    ...Array(24).fill({ wch: 7 }),
  ];
  ws["!freeze"] = { xSplit: 3, ySplit: 1 }; // freeze Brand/Branch/Day
  return ws;
}

// ─────────────── SHEET 6: Dashboard ───────────────

function buildDashboardSheet(brandRows, branchRows, bestBranch, worstBranch) {
  const totalBranches = branchRows.length;
  const totalReviews  = branchRows.reduce((s, r) => s + r.totalReviews3m, 0);
  const totalPTCovered = branchRows.filter((r) => r.popularTimes && r.popularTimes.available).length;

  const target = config.targetName || "Target";
  const windowLabel = (config.DATE_START && config.DATE_END)
    ? `Analysis window: ${config.DATE_START} → ${config.DATE_END}`
    : `Analysis window: last ${config.LOOKBACK_MONTHS} months`;
  const rows = [
    [`${target} Competitor Analysis — Dashboard`],
    [windowLabel],
    [`Generated: ${new Date().toISOString().slice(0, 10)}`],
    [],
    ["Metric", "Value"],
    ["Total branches analyzed",      totalBranches],
    ["Total reviews in window",      totalReviews],
    ["Branches with popular times",  `${totalPTCovered} / ${totalBranches}`],
    [],
    ["Brand",   "Avg Rating", "Total Reviews", "Branches"],
    ...brandRows.map((b) => [
      b.brand,
      b.avgRating3m !== null ? b.avgRating3m : "N/A",
      b.totalReviews3m,
      b.totalBranches,
    ]),
    [],
    ["Best branch",
      bestBranch ? `${bestBranch.branchName} (${bestBranch.brand}, ${bestBranch.avgRating3m}⭐, ${bestBranch.totalReviews3m} reviews)` : "N/A"],
    ["Worst branch",
      worstBranch ? `${worstBranch.branchName} (${worstBranch.brand}, ${worstBranch.avgRating3m}⭐, ${worstBranch.totalReviews3m} reviews)` : "N/A"],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [{ wch: 32 }, { wch: 22 }, { wch: 18 }, { wch: 14 }];
  return ws;
}

// ─────────────── main ───────────────

function writeWorkbook(analysis) {
  const { branchRows, brandRows, bestBranch, worstBranch } = analysis;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildBranchSheet(branchRows),        "Branch Wise Data");
  XLSX.utils.book_append_sheet(wb, buildBrandSheet(brandRows),          "Brand Comparison");
  XLSX.utils.book_append_sheet(wb, buildRankingsSheet(branchRows),      "Rankings");
  XLSX.utils.book_append_sheet(wb, buildAllReviewsSheet(branchRows),    "All Reviews");
  XLSX.utils.book_append_sheet(wb, buildPopularTimesSheet(branchRows),  "Popular Times Detail");
  XLSX.utils.book_append_sheet(wb, buildDashboardSheet(brandRows, branchRows, bestBranch, worstBranch), "Dashboard");

  ensureDir(config.EXCEL_FILE);
  XLSX.writeFile(wb, config.EXCEL_FILE);
  console.log(`[excel] wrote ${config.EXCEL_FILE}`);
  return config.EXCEL_FILE;
}

module.exports = { writeWorkbook };
