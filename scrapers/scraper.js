/**
 * scraper.js — Puppeteer scraper for COMPETITORS only.
 * The target brand uses the official Google Business Profile API
 * (see target-fetcher.js).
 *
 * Stage 1: open each competitor's search URL, scroll, collect branch URLs
 * Stage 2: for each branch: get address, hours, and recent reviews
 */

const puppeteer = require("puppeteer");
const fs = require("fs");
const config = require("./config");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─────────────── browser ───────────────
async function launchBrowser() {
  return puppeteer.launch({
    headless: config.PUPPETEER_OPTIONS.headless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--lang=en-US,en",
    ],
    defaultViewport: { width: 1366, height: 900 },
  });
}

async function dismissConsent(page) {
  try {
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button"));
      const target = buttons.find((b) => {
        const t = (b.textContent || "").trim().toLowerCase();
        return t === "accept all" || t === "reject all" || t === "i agree" || t.includes("accept");
      });
      if (target) { target.click(); return true; }
      return false;
    });
    if (clicked) await sleep(2000);
  } catch {}
}

// ─────────────── STAGE 1: discover branches ───────────────

async function scrollAllResults(page) {
  const maxScrolls = config.PUPPETEER_OPTIONS.maxScrollsStage1;
  for (let i = 0; i < maxScrolls; i++) {
    const { done, count } = await page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (!feed) return { done: true, count: 0 };
      feed.scrollTop = feed.scrollHeight;
      const endText = feed.innerText || "";
      const atEnd = /reached the end of the list|end of the list/i.test(endText);
      const links = feed.querySelectorAll('a[href*="/maps/place/"]');
      return { done: atEnd, count: links.length };
    });
    process.stdout.write(`\r    scrolled ${i + 1}/${maxScrolls}  —  ${count} branches loaded   `);
    if (done) { process.stdout.write("\n    reached end of list\n"); break; }
    await sleep(config.PUPPETEER_OPTIONS.scrollPauseMs);
    await config.__check();
  }
  process.stdout.write("\n");
}

async function extractBranchesFromPage(page) {
  return page.evaluate(() => {
    const feed = document.querySelector('div[role="feed"]');
    if (!feed) return [];
    const links = Array.from(feed.querySelectorAll('a[href*="/maps/place/"]'));
    const seen = new Set();
    const out = [];
    for (const a of links) {
      const url = a.href;
      if (seen.has(url)) continue;
      seen.add(url);
      const title = (a.getAttribute("aria-label") || "").trim();
      if (title) out.push({ title, url });
    }
    return out;
  });
}

async function discoverBranchesForBrand(browser, brand) {
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36");

  console.log(`\n[stage1:${brand.key}] opening ${brand.url}`);
  await page.goto(brand.url, { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(3000);
  await dismissConsent(page);

  // Google sometimes redirects a single-result search directly to /maps/place/...
  // — in that case there is no feed; we extract the lone place from the page itself.
  const landedUrl = page.url();
  if (/\/maps\/place\//.test(landedUrl)) {
    const title = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return (h1 && h1.textContent || '').trim();
    });
    await page.close();
    if (!title) {
      console.warn(`[stage1:${brand.key}] redirected to place page but no title — skipping`);
      return [];
    }
    const matched = title.toLowerCase().includes(brand.name.toLowerCase());
    console.log(`[stage1:${brand.key}] single-result redirect → "${title}" (${matched ? 'match' : 'no name match, keeping anyway'})`);
    return [{ title, url: landedUrl, __searchBrand: brand.key }];
  }

  try {
    await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
  } catch {
    console.warn(`[stage1:${brand.key}] no results feed — zero matches on Google Maps for "${brand.name}"`);
    await page.close();
    return [];
  }

  console.log(`[stage1:${brand.key}] scrolling...`);
  await scrollAllResults(page);

  const branches = await extractBranchesFromPage(page);
  await page.close();

  const filtered = branches
    .filter((b) => b.title.toLowerCase().includes(brand.name.toLowerCase()))
    .map((b) => ({ ...b, __searchBrand: brand.key }));

  console.log(`[stage1:${brand.key}] ${branches.length} raw → ${filtered.length} brand-match`);
  return filtered;
}

async function discoverBranches(browser) {
  console.log("\n═══ STAGE 1: Discovering competitor branches ═══");
  const all = [];
  for (const brand of config.COMPETITORS) {
    try { all.push(...(await discoverBranchesForBrand(browser, brand))); }
    catch (err) { console.error(`[stage1:${brand.key}] FAILED: ${err.message}`); }
  }
  const seen = new Set();
  const deduped = [];
  for (const b of all) {
    const key = b.url.split("?")[0];
    if (!seen.has(key)) { seen.add(key); deduped.push(b); }
  }
  const byBrand = {};
  for (const b of deduped) byBrand[b.__searchBrand] = (byBrand[b.__searchBrand] || 0) + 1;
  console.log(`\n[stage1] total unique competitor branches: ${deduped.length}`);
  for (const [k, v] of Object.entries(byBrand)) console.log(`          ${k}: ${v} branches`);
  return deduped;
}

// ─────────────── STAGE 2: per-branch details + reviews ───────────────

function relativeDateToIso(rel) {
  if (!rel) return null;
  const s = rel.toLowerCase().trim();
  const m = s.match(/(a|an|\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/);
  if (!m) return null;
  const n = m[1] === "a" || m[1] === "an" ? 1 : parseInt(m[1], 10);
  const unit = m[2];
  const d = new Date();
  if (unit === "minute") d.setMinutes(d.getMinutes() - n);
  else if (unit === "hour") d.setHours(d.getHours() - n);
  else if (unit === "day") d.setDate(d.getDate() - n);
  else if (unit === "week") d.setDate(d.getDate() - n * 7);
  else if (unit === "month") d.setMonth(d.getMonth() - n);
  else if (unit === "year") d.setFullYear(d.getFullYear() - n);
  return d.toISOString();
}

async function extractBranchDetails(page) {
  return page.evaluate(() => {
    // Address — the button with data-item-id="address" has aria-label "Address: ..."
    let address = "";
    const addrBtn = document.querySelector('button[data-item-id="address"]');
    if (addrBtn) {
      const aria = addrBtn.getAttribute("aria-label") || "";
      address = aria.replace(/^Address:\s*/i, "").trim();
    }

    // Place-level rating + review count.
    // Google Maps renders these in a few different layouts depending on the
    // place type. We probe several selectors and take the first usable hit.
    let rating = null;
    let reviewsCount = null;

    // 1) Try the standalone numeric rating span next to the stars row.
    const ratingCandidates = [
      'div.F7nice span[aria-hidden="true"]',
      'div.fontDisplayLarge',
      'div.gm2-display-2',
    ];
    for (const sel of ratingCandidates) {
      const el = document.querySelector(sel);
      const raw = el && (el.textContent || "").trim();
      if (raw && /^\d+(\.\d+)?$/.test(raw)) {
        const n = parseFloat(raw);
        if (n >= 1 && n <= 5) { rating = n; break; }
      }
    }

    // 2) Fallback: the aria-label on the stars role="img" element typically reads
    //    "4.5 stars" or "4,5 stars" (locale-dependent commas).
    if (rating === null) {
      const star = document.querySelector('[role="img"][aria-label*="star" i]');
      if (star) {
        const txt = (star.getAttribute("aria-label") || "").replace(",", ".");
        const m = txt.match(/(\d+(?:\.\d+)?)/);
        if (m) {
          const n = parseFloat(m[1]);
          if (n >= 1 && n <= 5) rating = n;
        }
      }
    }

    // Review count — usually a button "1,234 reviews" or aria-label of same.
    const countCandidates = Array.from(document.querySelectorAll('button, span'))
      .map((el) => (el.getAttribute("aria-label") || el.textContent || "").trim())
      .filter((t) => /\d[\d,]*\s*reviews?/i.test(t));
    for (const t of countCandidates) {
      const m = t.match(/([\d,]+)\s*reviews?/i);
      if (m) {
        const n = parseInt(m[1].replace(/,/g, ""), 10);
        if (Number.isFinite(n)) { reviewsCount = n; break; }
      }
    }

    // Hours — button with data-item-id starting with "oh" (open hours)
    // or look for a table with role="rowgroup"
    let hours = "";
    const hoursTable = document.querySelector('[aria-label*="Hours" i] table, table.eK4R0e');
    if (hoursTable) {
      const rows = Array.from(hoursTable.querySelectorAll("tr"));
      const parts = [];
      for (const r of rows) {
        const cells = Array.from(r.querySelectorAll("td, th"))
          .map((c) => (c.textContent || "").trim())
          .filter(Boolean);
        if (cells.length >= 2) parts.push(`${cells[0].slice(0,3)}: ${cells[1]}`);
      }
      hours = parts.join(" | ");
    } else {
      // Fallback: aria-label on the hours button itself (shows today's hours)
      const hoursBtn = document.querySelector('[data-item-id^="oh"]');
      if (hoursBtn) {
        const aria = hoursBtn.getAttribute("aria-label") || "";
        hours = aria.replace(/^(Hours|Open hours):\s*/i, "").trim();
      }
    }

    // Phone — button with data-item-id starting with "phone"
    let phone = "";
    const phoneBtn = document.querySelector('[data-item-id^="phone"]');
    if (phoneBtn) {
      const aria = phoneBtn.getAttribute("aria-label") || "";
      phone = aria.replace(/^Phone:\s*/i, "").trim();
    }

    return { address, hours, phone, rating, reviewsCount };
  });
}

async function sortReviewsByNewest(page) {
  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const sortBtn = btns.find((b) => {
        const t = (b.getAttribute("aria-label") || b.textContent || "").toLowerCase();
        return t.includes("sort");
      });
      if (sortBtn) sortBtn.click();
    });
    await sleep(1500);
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menuitem"]'));
      const newest = items.find((el) => {
        const t = (el.textContent || "").trim().toLowerCase();
        return t === "newest" || t === "most recent";
      });
      if (newest) newest.click();
    });
    await sleep(2000);
  } catch {}
}

async function scrollReviewsPanel(page, maxReviews) {
  const maxScrolls = config.PUPPETEER_OPTIONS.maxScrollsStage2;
  for (let i = 0; i < maxScrolls; i++) {
    const count = await page.evaluate(() => {
      const cards = document.querySelectorAll('[data-review-id]');
      if (cards.length === 0) return 0;
      let scroller = cards[0].parentElement;
      while (scroller && scroller !== document.body) {
        const cs = getComputedStyle(scroller);
        if ((cs.overflowY === "auto" || cs.overflowY === "scroll") &&
            scroller.scrollHeight > scroller.clientHeight) break;
        scroller = scroller.parentElement;
      }
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      return cards.length;
    });
    if (count >= maxReviews) break;
    await sleep(config.PUPPETEER_OPTIONS.scrollPauseMs);
  }
}

async function extractReviews(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-review-id]'));
    return cards.map((card) => {
      let stars = null;
      const starEl = card.querySelector('[role="img"][aria-label*="star" i], [aria-label*="star" i]');
      if (starEl) {
        const m = (starEl.getAttribute("aria-label") || "").match(/(\d+(?:\.\d+)?)/);
        if (m) stars = parseFloat(m[1]);
      }
      let dateRel = null;
      const spans = Array.from(card.querySelectorAll("span"));
      for (const s of spans) {
        const t = (s.textContent || "").trim();
        if (/\bago\b/i.test(t) && t.length < 40) { dateRel = t; break; }
      }
      let text = "";
      const textEl = card.querySelector('[data-expandable-section], .wiI7pd, .MyEned');
      if (textEl) text = (textEl.textContent || "").trim();
      return { stars, dateRel, text };
    });
  });
}

async function scrapeBranchFull(browser, branch, idx, total) {
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36");

  const short = branch.title.slice(0, 40);
  console.log(`  [${idx + 1}/${total}] ${short} ...`);

  try {
    await page.goto(branch.url, { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2500);
    await dismissConsent(page);

    // Capture the current URL after redirect (Google normalizes place URLs)
    const normalizedUrl = page.url();

    // 1) details (address + hours + phone)
    const details = await extractBranchDetails(page);

    // 2) reviews — click Reviews tab
    await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('button, [role="tab"]'));
      const rev = tabs.find((el) => {
        const t = (el.getAttribute("aria-label") || el.textContent || "").toLowerCase();
        return /^reviews?\b/.test(t.trim()) || t.includes("reviews for");
      });
      if (rev) rev.click();
    });
    await sleep(2500);
    await sortReviewsByNewest(page);
    await scrollReviewsPanel(page, config.REVIEWS_OPTIONS.maxReviews);

    const raw = await extractReviews(page);
    const reviews = raw.map((r) => ({
      stars:           r.stars,
      rating:          r.stars,
      publishedAtDate: relativeDateToIso(r.dateRel),
      text:            r.text,
    }));

    console.log(`    → ${reviews.length} reviews, addr: ${details.address.slice(0,40) || "(none)"}`);
    await page.close();

    return {
      title:        branch.title,
      address:      details.address,
      addressLink:  normalizedUrl,
      hours:        details.hours,
      phone:        details.phone,
      url:          normalizedUrl,
      rating:       details.rating,        // place-level overall rating (1-5, may be null)
      reviewsCount: details.reviewsCount,  // Google's reported review count
      reviews,
      __searchBrand: branch.__searchBrand,
    };
  } catch (err) {
    console.warn(`    ! failed: ${err.message}`);
    await page.close();
    return {
      ...branch,
      address: "", addressLink: branch.url, hours: "", phone: "",
      reviews: [],
    };
  }
}

async function scrapeBranches(browser, branches) {
  console.log(`\n═══ STAGE 2: Scraping ${branches.length} branches ═══\n`);

  // Load existing progress if present → resume support (crash-safe across stages
  // and across separate scrapeBrand / scrapeCompetitors invocations within
  // one job).
  let allCached = [];
  if (fs.existsSync(config.COMP_REVIEWS)) {
    try { allCached = JSON.parse(fs.readFileSync(config.COMP_REVIEWS, "utf8")); } catch {}
  }
  const cachedByUrl = new Map(allCached.map((r) => [r.url.split("?")[0], r]));
  const requestedUrls = new Set(branches.map((b) => b.url.split("?")[0]));

  for (let i = 0; i < branches.length; i++) {
    const b = branches[i];
    const key = b.url.split("?")[0];
    if (cachedByUrl.has(key)) {
      console.log(`  [${i + 1}/${branches.length}] ${b.title.slice(0,40)} — cached, skip`);
      continue;
    }

    const full = await scrapeBranchFull(browser, b, i, branches.length);
    cachedByUrl.set(key, full);

    // Write after every branch — crash-safe
    fs.writeFileSync(
      config.COMP_REVIEWS,
      JSON.stringify(Array.from(cachedByUrl.values()), null, 2),
    );
    await config.__check();
    await sleep(config.PUPPETEER_OPTIONS.betweenBranchesMs);
  }

  // Return ONLY the branches that were requested in this call.
  // This keeps target-fallback and competitor calls from cross-contaminating
  // each other's result sets even though they share the on-disk cache.
  return Array.from(cachedByUrl.entries())
    .filter(([k]) => requestedUrls.has(k))
    .map(([, v]) => v);
}

// ─────────────── public entry point ───────────────

async function scrapeCompetitors() {
  const browser = await launchBrowser();
  try {
    let branches;
    if (fs.existsSync(config.COMP_BRANCHES)) {
      console.log(`[scraper] stage 1 cache at ${config.COMP_BRANCHES} — reusing`);
      branches = JSON.parse(fs.readFileSync(config.COMP_BRANCHES, "utf8"));
    } else {
      branches = await discoverBranches(browser);
      fs.writeFileSync(config.COMP_BRANCHES, JSON.stringify(branches, null, 2));
    }
    if (branches.length === 0) {
      console.warn("[scraper] no competitor branches discovered — continuing with target-only analysis");
      return [];
    }

    const full = await scrapeBranches(browser, branches);
    return full;
  } finally {
    await browser.close();
  }
}

/**
 * Scrape a single brand (typically the target brand) from public Google Maps.
 * Used by the job runner as a fallback when the Business Profile API path
 * returns no data (no refresh token, expired token, or user doesn't own the
 * brand on Google Business). `brand` is { key, name, url } — same shape as
 * COMPETITORS entries. Results are tagged with `__searchBrand: brand.key`.
 */
async function scrapeBrand(brand) {
  if (!brand || !brand.key || !brand.url) {
    throw new Error("scrapeBrand: brand needs { key, name, url }");
  }
  const browser = await launchBrowser();
  try {
    const discovered = await discoverBranchesForBrand(browser, brand);
    // Dedupe by URL
    const seen = new Set();
    const branches = [];
    for (const b of discovered) {
      const k = b.url.split("?")[0];
      if (!seen.has(k)) { seen.add(k); branches.push(b); }
    }
    if (branches.length === 0) {
      console.warn(`[scrapeBrand:${brand.key}] no branches discovered`);
      return [];
    }
    return await scrapeBranches(browser, branches);
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeCompetitors, scrapeBrand };
