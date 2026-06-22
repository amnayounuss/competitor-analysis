/**
 * popularTimesScraper.js
 *
 * Extracts Google Maps "Popular times" data (the bar chart showing how busy
 * a place is by hour and day of week).
 *
 * Strategy (two passes):
 *   1) FAST: parse page HTML for the APP_INITIALIZATION_STATE JS variable,
 *      which contains popular times as a nested array. ~70% success rate.
 *      Takes 2-5 seconds per branch.
 *   2) SLOW fallback: hover over each bar in the popular-times UI and read
 *      the tooltip text ("75% busy at 8 PM"). ~85% success rate but takes
 *      30-60 seconds per branch. Only runs if fast method fails.
 *
 * Output structure per branch:
 *   popularTimes: {
 *     available: true|false,
 *     peakDay: "Saturday",
 *     peakHour: "8 PM",
 *     peakBusyness: 95,
 *     grid: {             // full 7×24 grid, values 0-100 (null if unknown)
 *       MONDAY:    [null, null, ..., 20, 35, 50, ...],
 *       TUESDAY:   [...],
 *       ...
 *     },
 *     summary: "Mon: 11AM-2PM | Sat: 6PM-10PM"
 *   }
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const config = require("./config");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DAYS = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
const DAY_SHORT = { SUNDAY:"Sun", MONDAY:"Mon", TUESDAY:"Tue", WEDNESDAY:"Wed", THURSDAY:"Thu", FRIDAY:"Fri", SATURDAY:"Sat" };

// ─────────────── helpers ───────────────

async function dismissConsent(page) {
  try {
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const t = btns.find((b) => {
        const x = (b.textContent || "").trim().toLowerCase();
        return x === "accept all" || x === "i agree" || x.includes("accept");
      });
      if (t) { t.click(); return true; }
      return false;
    });
    if (clicked) await sleep(1500);
  } catch {}
}

function hourLabel(h) {
  // 0 → 12 AM, 13 → 1 PM, etc.
  if (h === 0) return "12 AM";
  if (h < 12)  return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

// ─────────────── STRATEGY 1: FAST HTML parse ───────────────

/**
 * Popular times data lives inside a huge JSON blob that Google embeds as
 * `window.APP_INITIALIZATION_STATE = [[[...]]]`. The structure is nested
 * arrays, undocumented, and Google tweaks the field positions.
 *
 * Rather than hunt for specific indices (which break), we do a RECURSIVE
 * search: find any 7-element array whose items are each 24-element arrays
 * of numbers 0-100. That's the signature of the popular-times grid.
 */
async function extractViaHtmlParse(page) {
  return page.evaluate(() => {
    // Grab the initialization state from window — sometimes it's on window directly,
    // sometimes only inside the rendered HTML. Try both.
    let rawSource = "";
    try {
      if (window.APP_INITIALIZATION_STATE) {
        rawSource = JSON.stringify(window.APP_INITIALIZATION_STATE);
      } else {
        rawSource = document.documentElement.innerHTML;
      }
    } catch { rawSource = document.documentElement.innerHTML; }

    // Walk any parseable nested structure and hunt for the popular-times grid.
    // It's a 7-element array (days of week) where each element is a 24-element
    // array of numbers 0-100. We parse JSON-looking substrings defensively.

    function looksLikePopularTimesGrid(v) {
      if (!Array.isArray(v) || v.length !== 7) return false;
      for (const day of v) {
        if (!Array.isArray(day)) return false;
        if (day.length !== 24 && day.length !== 0) return false;
        for (const n of day) {
          if (typeof n !== "number" || n < 0 || n > 100) return false;
        }
      }
      // Must have at least some non-zero data (otherwise it's any 7x24 grid of zeros)
      return v.some((day) => day.some((n) => n > 0));
    }

    // Deep search: walk the tree
    function findGrid(node, depth) {
      if (depth > 40) return null;
      if (looksLikePopularTimesGrid(node)) return node;
      if (Array.isArray(node)) {
        for (const item of node) {
          const r = findGrid(item, depth + 1);
          if (r) return r;
        }
      }
      return null;
    }

    // Try window.APP_INITIALIZATION_STATE first
    let grid = null;
    try {
      if (window.APP_INITIALIZATION_STATE) {
        grid = findGrid(window.APP_INITIALIZATION_STATE, 0);
      }
    } catch {}

    if (!grid) {
      // Last resort: scan raw HTML for patterns like [[0,0,...24 nums]] × 7
      // This is slow but works when window object isn't populated.
      const pattern = /\[\s*\[\s*\d+(?:\s*,\s*\d+){23}\s*\](?:\s*,\s*\[\s*\d+(?:\s*,\s*\d+){23}\s*\]){6}\s*\]/g;
      const matches = rawSource.match(pattern) || [];
      for (const m of matches) {
        try {
          const parsed = JSON.parse(m);
          if (looksLikePopularTimesGrid(parsed)) { grid = parsed; break; }
        } catch {}
      }
    }

    return grid; // 7×24 array of 0-100, or null
  });
}

// ─────────────── STRATEGY 2: SLOW visual hover ───────────────

/**
 * In the popular-times UI, each hour is rendered as a bar (div) with an
 * aria-label like "0% busy at 9 AM" or "Currently 50% busy, usually 75%".
 *
 * We iterate through the day tabs ("Mondays", "Tuesdays", ..., "Sundays")
 * and for each day collect all bar aria-labels.
 */
async function extractViaHover(page) {
  try {
    // Try to scroll the popular-times section into view first
    await page.evaluate(() => {
      // Find any element whose text mentions "Popular times" or aria-label includes it
      const all = Array.from(document.querySelectorAll("*"));
      const el = all.find((e) => {
        const t = (e.textContent || "").trim();
        return /^Popular times$/i.test(t) && t.length < 30;
      });
      if (el) el.scrollIntoView({ block: "center" });
    });
    await sleep(1500);

    // For each day tab (Monday → Sunday), click it and read bars
    const grid = {};
    for (const day of DAYS) {
      // Click the day tab if it exists
      await page.evaluate((dayName) => {
        const dayMap = {
          'SUNDAY': ['sunday', 'sundays', 'الأحد', 'الاحد'],
          'MONDAY': ['monday', 'mondays', 'الاثنين', 'الإثنين'],
          'TUESDAY': ['tuesday', 'tuesdays', 'الثلاثاء'],
          'WEDNESDAY': ['wednesday', 'wednesdays', 'الأربعاء', 'الاربعاء'],
          'THURSDAY': ['thursday', 'thursdays', 'الخميس'],
          'FRIDAY': ['friday', 'fridays', 'الجمعة'],
          'SATURDAY': ['saturday', 'saturdays', 'السبت']
        };
        const targets = dayMap[dayName] || [];
        
        // 1) Find the "Popular times" section header
        const all = Array.from(document.querySelectorAll("*"));
        const ptHeader = all.find((e) => {
          const t = (e.textContent || "").trim();
          return /^Popular times$/i.test(t) && t.length < 30;
        });

        // 2) Find buttons/tabs inside the popular times container, or fall back to document
        const container = ptHeader ? ptHeader.closest('div[class*="section"]') || ptHeader.parentElement : document;
        const buttons = Array.from(container.querySelectorAll('button, [role="tab"]'));
        
        // Strategy A: Find by text content matching English or Arabic terms
        let tab = buttons.find((b) => {
          const t = (b.textContent || "").trim().toLowerCase();
          return targets.some(target => t === target.toLowerCase() || t.includes(target.toLowerCase()));
        });
        
        // Strategy B: Fallback to role="tab" elements by matching index inside the container
        if (!tab) {
          const tabs = Array.from(container.querySelectorAll('[role="tab"]'));
          if (tabs.length === 7) {
            const daysOrder = ["SUNDAY","MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY"];
            const idx = daysOrder.indexOf(dayName);
            if (idx !== -1 && tabs[idx]) tab = tabs[idx];
          }
        }

        // Strategy C: Global search fallback
        if (!tab) {
          const globalButtons = Array.from(document.querySelectorAll('button, [role="tab"]'));
          tab = globalButtons.find((b) => {
            const t = (b.textContent || "").trim().toLowerCase();
            return targets.some(target => t === target.toLowerCase() || t.includes(target.toLowerCase()));
          });
        }
        
        if (tab) {
          tab.focus();
          tab.scrollIntoView({ block: "center" });

          // Dispatch mouse events to ensure state changes register
          const rect = tab.getBoundingClientRect();
          const clientX = rect.left + rect.width / 2;
          const clientY = rect.top + rect.height / 2;

          tab.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX, clientY }));
          tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX, clientY }));
          tab.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX, clientY }));
          tab.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX, clientY }));
          
          tab.click();
          
          tab.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }, day);
      await sleep(1200);

      // Read all bars with busyness info
      const hours = await page.evaluate(() => {
        const result = new Array(24).fill(null);
        // Bars have aria-labels like "0% busy at 5 AM", "50% busy at 8 PM", "Currently 45% busy, usually 60% busy at 5 PM", "Currently 45% busy, usually 60% busy"
        const bars = Array.from(document.querySelectorAll('[aria-label*="busy" i]'));
        for (const b of bars) {
          const label = b.getAttribute("aria-label") || "";
          
          let pct = null;
          let h = null;

          // 1) Match standard and "usually X% busy at Y PM" or "X% busy at Y PM"
          const m1 = label.match(/(?:usually\s+)?(\d+)%\s*busy\s*at\s*(\d+)\s*(AM|PM)/i);
          if (m1) {
            pct = parseInt(m1[1], 10);
            h = parseInt(m1[2], 10);
            const ampm = m1[3].toUpperCase();
            if (ampm === "AM" && h === 12) h = 0;
            else if (ampm === "PM" && h !== 12) h += 12;
          } 
          // 2) Match live "Currently X% busy, usually Y% busy at Z PM" (if usually is inside)
          else {
            const m2 = label.match(/Currently\s+\d+%\s*busy,\s*usually\s+(\d+)%\s*busy\s*at\s*(\d+)\s*(AM|PM)/i);
            if (m2) {
              pct = parseInt(m2[1], 10);
              h = parseInt(m2[2], 10);
              const ampm = m2[3].toUpperCase();
              if (ampm === "AM" && h === 12) h = 0;
              else if (ampm === "PM" && h !== 12) h += 12;
            }
            // 3) Match live "Currently X% busy, usually Y% busy" (without "at Z PM" - current hour)
            else {
              const m3 = label.match(/Currently\s+(\d+)%\s*busy(?:,\s*usually\s+(\d+)%\s*busy)?/i);
              if (m3) {
                // Use usual busyness if available, otherwise current live level
                pct = m3[2] ? parseInt(m3[2], 10) : parseInt(m3[1], 10);
                h = new Date().getHours();
              }
            }
          }

          if (pct !== null && h !== null && h >= 0 && h < 24) {
            result[h] = pct;
          }
        }
        return result;
      });

      grid[day] = hours;
    }

    // Convert to 7-element array in DAYS order
    const arr = DAYS.map((d) => grid[d] || new Array(24).fill(null));

    // If we got nothing useful, return null so caller knows to give up
    const anyData = arr.some((day) => day.some((v) => v !== null && v > 0));
    return anyData ? arr : null;
  } catch {
    return null;
  }
}

// ─────────────── summarize & analyze ───────────────

/**
 * Convert raw 7×24 grid into useful summary fields.
 */
function summarizeGrid(grid) {
  if (!grid || grid.length !== 7) return null;

  let peakDay = null, peakHour = null, peakBusy = -1;
  const daysSummary = [];

  for (let d = 0; d < 7; d++) {
    const day = grid[d] || [];
    if (day.length === 0) continue;

    // Find peak within this day
    let dayPeak = -1, dayPeakHour = -1;
    for (let h = 0; h < 24; h++) {
      const v = day[h];
      if (v == null) continue;
      if (v > dayPeak) { dayPeak = v; dayPeakHour = h; }
      if (v > peakBusy) { peakBusy = v; peakDay = DAYS[d]; peakHour = h; }
    }

    // Summarize the day's busy window: hours where busyness >= 60% of day's peak
    if (dayPeak >= 30) {
      const threshold = Math.max(30, dayPeak * 0.6);
      const busyHours = [];
      for (let h = 0; h < 24; h++) {
        if (day[h] != null && day[h] >= threshold) busyHours.push(h);
      }
      if (busyHours.length > 0) {
        const first = busyHours[0];
        const last  = busyHours[busyHours.length - 1];
        daysSummary.push(`${DAY_SHORT[DAYS[d]]}: ${hourLabel(first)}-${hourLabel(last + 1)}`);
      }
    }
  }

  const gridObj = {};
  DAYS.forEach((d, i) => { gridObj[d] = grid[i]; });

  return {
    available:    peakDay !== null,
    peakDay:      peakDay ? peakDay.charAt(0) + peakDay.slice(1).toLowerCase() : "",
    peakHour:     peakHour >= 0 ? hourLabel(peakHour) : "",
    peakBusyness: peakBusy >= 0 ? peakBusy : null,
    grid:         gridObj,
    summary:      daysSummary.join(" | "),
  };
}

// ─────────────── per-branch orchestrator ───────────────

async function scrapePopularTimesForBranch(page, branch, enableHoverFallback) {
  let url = branch.placeId
    ? `https://www.google.com/maps/place/?q=place_id:${branch.placeId}`
    : branch.url;
  if (!url) return { available: false, grid: {}, summary: "" };

  if (url.includes("?")) {
    url += "&hl=en";
  } else {
    url += "?hl=en";
  }

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2500);
    await dismissConsent(page);

    // Strategy 1 — fast HTML parse
    let grid = await extractViaHtmlParse(page);

    // Strategy 2 — slow hover, only if enabled and fast method failed
    if (!grid && enableHoverFallback) {
      grid = await extractViaHover(page);
    }

    if (!grid) return { available: false, grid: {}, summary: "" };
    return summarizeGrid(grid) || { available: false, grid: {}, summary: "" };
  } catch {
    return { available: false, grid: {}, summary: "" };
  }
}

// ─────────────── public entry point ───────────────

/**
 * Add popularTimes data to each branch in-place.
 * Caches progress after every branch (crash-safe).
 */
async function scrapePopularTimes(allBranches, cacheFilePath) {
  // Skip branches that already have popular times data
  const needs = allBranches.filter((b) => !b.popularTimes || b.popularTimes.available === undefined);
  if (needs.length === 0) {
    console.log("[popular-times] all branches already have popular times data — skipping");
    return allBranches;
  }

  console.log(`\n═══ POPULAR TIMES: scraping ${needs.length} branches ═══`);
  console.log(`    Strategy 1: fast HTML parse   (~5 sec/branch, ~70% success)`);
  console.log(`    Strategy 2: hover fallback    (~45 sec/branch, boosts to ~85%)\n`);

  const browser = await puppeteer.launch({
    headless: config.PUPPETEER_OPTIONS.headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled", "--lang=en-US,en"],
    defaultViewport: { width: 1366, height: 900 },
  });

  let stats = { fast: 0, slow: 0, failed: 0 };
  const BRANCH_TIMEOUT_MS = 60000; // hard ceiling per branch so one hang can't stall the job
  const POOL = Math.max(1, config.POPULAR_TIMES_OPTIONS.concurrency || 6);

  // Process one branch on a dedicated page. Never throws (returns on failure).
  async function processBranch(page, b, label) {
    const hasProperPlaceId = b.placeId && b.placeId.startsWith('ChIJ');
    const navUrl = hasProperPlaceId ? `https://www.google.com/maps/place/?q=place_id:${b.placeId}` : b.url;
    if (!navUrl) {
      b.popularTimes = { available: false, grid: {}, summary: "" };
      stats.failed++; console.log(`  ${label} ✗ (missing URL)`); return;
    }
    try {
      await page.goto(navUrl, { waitUntil: "networkidle2", timeout: 45000 });
      await sleep(2000);
      await dismissConsent(page);

      let grid = await extractViaHtmlParse(page);
      let method = "fast";
      if (!grid && config.POPULAR_TIMES_OPTIONS.enableHoverFallback) {
        grid = await extractViaHover(page);
        method = "slow";
      }
      if (grid) {
        b.popularTimes = summarizeGrid(grid) || { available: false, grid: {}, summary: "" };
        if (b.popularTimes.available) {
          stats[method]++;
          console.log(`  ${label} ✓ [${method}] peak: ${b.popularTimes.peakDay} ${b.popularTimes.peakHour} (${b.popularTimes.peakBusyness}%)`);
        } else { stats.failed++; console.log(`  ${label} ✗ (no data)`); }
      } else {
        b.popularTimes = { available: false, grid: {}, summary: "" };
        stats.failed++; console.log(`  ${label} ✗ (not available)`);
      }
    } catch (err) {
      b.popularTimes = { available: false, grid: {}, summary: "" };
      stats.failed++; console.log(`  ${label} ✗ (${(err.message || 'error').slice(0, 40)})`);
    }
  }

  // Worklist = branches still needing popular times, in order.
  const work = [];
  for (let i = 0; i < allBranches.length; i++) {
    const b = allBranches[i];
    if (b.popularTimes && b.popularTimes.available !== undefined) continue;
    work.push({ b, i });
  }

  let cursor = 0;
  let completed = 0;
  // A pool of workers, each owning its own page, pulling from the shared cursor.
  async function worker(slot) {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36");
    try {
      while (true) {
        await config.__check();                 // cancellation between branches
        const idx = cursor++;
        if (idx >= work.length) break;
        const { b, i } = work[idx];
        const label = `[${i + 1}/${allBranches.length}]`;
        // Hard timeout guard so a hung navigation can't stall the whole job.
        await Promise.race([
          processBranch(page, b, label),
          new Promise((res) => setTimeout(() => {
            if (!b.popularTimes) { b.popularTimes = { available: false, grid: {}, summary: "" }; stats.failed++; console.log(`  ${label} ✗ (timeout)`); }
            res();
          }, BRANCH_TIMEOUT_MS)),
        ]);
        completed++;
        // Crash-safe: write progress periodically (every ~5 branches).
        if (cacheFilePath && completed % 5 === 0) {
          try { fs.writeFileSync(cacheFilePath, JSON.stringify(allBranches, null, 2)); } catch {}
        }
      }
    } finally {
      try { await page.close(); } catch {}
    }
  }

  try {
    console.log(`[popular-times] running ${work.length} branches with ${POOL} parallel workers`);
    await Promise.all(Array.from({ length: Math.min(POOL, work.length || 1) }, (_, s) => worker(s)));
    if (cacheFilePath) { try { fs.writeFileSync(cacheFilePath, JSON.stringify(allBranches, null, 2)); } catch {} }
  } finally {
    try { await browser.close(); } catch {}
  }

  console.log(`\n[popular-times] done. fast: ${stats.fast}, slow: ${stats.slow}, failed: ${stats.failed}\n`);
  return allBranches;
}

module.exports = { scrapePopularTimes, summarizeGrid };
