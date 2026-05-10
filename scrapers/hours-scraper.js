/**
 * hoursScraper.js
 *
 * Anoosh API gives us title/address/phone/reviews/placeId — but you said the
 * hours we need should be scraped from Google Maps.
 *
 * For each Anoosh branch that has a placeId, this opens Google Maps using
 *   https://www.google.com/maps/place/?q=place_id:PLACE_ID
 * extracts the business hours table, and writes them back into the branch record.
 *
 * Runs after anooshFetcher.js, before the competitor scraper.
 * Cached per branch — re-running skips branches whose hours are already filled.
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const config = require("./config");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/**
 * On a place page, business hours live in a table that's only rendered
 * after you expand the hours section. We try a few strategies in order of
 * reliability so we survive Google's DOM changes.
 */
async function extractHours(page) {
  return page.evaluate(() => {
    // Strategy 1: explicit hours table
    const table = document.querySelector('table.eK4R0e, [aria-label*="Hours" i] table');
    if (table) {
      const rows = Array.from(table.querySelectorAll("tr"));
      const parts = [];
      for (const r of rows) {
        const cells = Array.from(r.querySelectorAll("td, th"))
          .map((c) => (c.textContent || "").trim())
          .filter(Boolean);
        if (cells.length >= 2) {
          // Normalize: "Monday\t9 AM–11 PM" → "Mon: 9 AM–11 PM"
          const day = cells[0].slice(0, 3);
          const hrs = cells[1].replace(/\s+/g, " ");
          parts.push(`${day}: ${hrs}`);
        }
      }
      if (parts.length) return parts.join(" | ");
    }

    // Strategy 2: summary aria-label on the hours button (shows today's hours,
    // sometimes the whole week collapsed). e.g. "Hours: Closes 11 PM ⋅ Opens 9 AM Mon"
    const hoursBtn = document.querySelector('[data-item-id^="oh"], [aria-label*="Hours" i]');
    if (hoursBtn) {
      const aria = hoursBtn.getAttribute("aria-label") || "";
      if (aria) return aria.replace(/^(Hours|Open hours):\s*/i, "").trim();
    }

    return "";
  });
}

async function scrapeHoursForBranch(page, branch) {
  // We need a URL to visit. Prefer placeId → canonical URL.
  const url = branch.placeId
    ? `https://www.google.com/maps/place/?q=place_id:${branch.placeId}`
    : branch.url;
  if (!url) return "";

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2500);
    await dismissConsent(page);

    // Try to click the hours row so the full table expands
    await page.evaluate(() => {
      const btn = document.querySelector('[data-item-id^="oh"]');
      if (btn) btn.click();
    });
    await sleep(1500);

    return await extractHours(page);
  } catch {
    return "";
  }
}

async function scrapeHoursForAnoosh(anooshBranches) {
  // Nothing to do if every branch already has hours
  const needs = anooshBranches.filter((b) => !b.hours);
  if (needs.length === 0) {
    console.log("[hours] all Anoosh branches already have hours — skipping");
    return anooshBranches;
  }

  console.log(`\n═══ ANOOSH HOURS: scraping ${needs.length} branches from Google Maps ═══\n`);

  const browser = await puppeteer.launch({
    headless: config.PUPPETEER_OPTIONS.headless,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled", "--lang=en-US,en"],
    defaultViewport: { width: 1366, height: 900 },
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    );

    for (let i = 0; i < anooshBranches.length; i++) {
      const b = anooshBranches[i];
      if (b.hours) continue; // already cached

      const short = (b.title || "").slice(0, 40);
      process.stdout.write(`  [${i + 1}/${anooshBranches.length}] ${short} ... `);

      b.hours = await scrapeHoursForBranch(page, b);
      console.log(b.hours ? "✓" : "(not found)");

      // Write progress to disk after every branch → crash-safe
      fs.writeFileSync(config.ANOOSH_CACHE, JSON.stringify(anooshBranches, null, 2));

      await sleep(config.PUPPETEER_OPTIONS.betweenBranchesMs);
    }
  } finally {
    await browser.close();
  }

  const filled = anooshBranches.filter((b) => b.hours).length;
  console.log(`\n[hours] done — ${filled}/${anooshBranches.length} Anoosh branches now have hours\n`);
  return anooshBranches;
}

module.exports = { scrapeHoursForAnoosh };
