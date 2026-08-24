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
  // hl=en is only a hint; the header is what Google actually honours from a
  // Saudi-facing IP. Both are needed for the English-keyed selectors to match.
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

  console.log(`\n[stage1:${brand.key}] searching "${brand.name}" → ${brand.url}`);
  await page.goto(withEnglishLocale(brand.url), { waitUntil: "networkidle2", timeout: 60000 });
  await sleep(3000);
  await dismissConsent(page);

  try {
    await page.waitForSelector('div[role="feed"]', { timeout: 15000 });
  } catch {
    console.warn(`[stage1:${brand.key}] no results feed for "${brand.name}" — 0 results`);
    await page.close();
    return [];
  }

  console.log(`[stage1:${brand.key}] scrolling...`);
  await scrollAllResults(page);

  const branches = await extractBranchesFromPage(page);
  await page.close();
  console.log(`[stage1:${brand.key}] Google returned ${branches.length} results for "${brand.name}"`);

  const LOCATION_NOISE = new Set([
    "saudi", "arabia", "riyadh", "jeddah", "dubai", "uae", "kuwait",
    "bahrain", "qatar", "oman", "egypt", "jordan", "lebanon", "india",
    "pakistan", "london", "new", "york", "city", "state", "kingdom",
  ]);

  // Collect keywords from ALL aliases of this brand (via BRAND_KEYWORDS)
  const allKeywords = new Set();
  if (config.BRAND_KEYWORDS) {
    for (const bk of config.BRAND_KEYWORDS) {
      if (bk.brand === brand.key) {
        for (const w of bk.keyword.split(/\s+/)) {
          if (w.length > 2 && !LOCATION_NOISE.has(w)) allKeywords.add(w);
        }
      }
    }
  }
  // Also add words from this specific search name
  for (const w of brand.name.toLowerCase().split(/\s+/)) {
    if (w.length > 2 && !LOCATION_NOISE.has(w)) allKeywords.add(w);
  }
  const nameWords = Array.from(allKeywords);

  const filtered = branches
    .filter((b) => {
      const t = b.title.toLowerCase();
      return nameWords.length > 0 && nameWords.some((w) => t.includes(w));
    })
    .map((b) => ({ ...b, __searchBrand: brand.key }));

  if (filtered.length > 0) {
    console.log(`[stage1:${brand.key}] ${branches.length} raw → ${filtered.length} brand-match (keywords: ${nameWords.join(", ")})`);
    return filtered;
  }

  console.warn(`[stage1:${brand.key}] ${branches.length} raw → 0 strict match (keywords: ${nameWords.join(", ") || "(none)"}) — accepting ALL ${branches.length} as fallback`);
  return branches.map((b) => ({ ...b, __searchBrand: brand.key }));
}

async function discoverBranches(browser) {
  console.log("\n═══ STAGE 1: Discovering competitor branches ═══");

  // Group searches by brand to show per-alias stats
  const brandAliases = {};
  for (const c of config.COMPETITORS) {
    brandAliases[c.key] = brandAliases[c.key] || [];
    brandAliases[c.key].push(c.name);
  }
  for (const [brand, aliases] of Object.entries(brandAliases)) {
    console.log(`[stage1] ${brand}: ${aliases.length} search queries → ${aliases.join(", ")}`);
  }

  const all = [];
  let totalRaw = 0;
  for (const brand of config.COMPETITORS) {
    try {
      const found = await discoverBranchesForBrand(browser, brand);
      totalRaw += found.length;
      all.push(...found);
    } catch (err) { console.error(`[stage1:${brand.key}] FAILED: ${err.message}`); }
  }

  const seen = new Set();
  const deduped = [];
  let dupeCount = 0;
  for (const b of all) {
    const key = b.url.split("?")[0];
    if (!seen.has(key)) { seen.add(key); deduped.push(b); } else { dupeCount++; }
  }

  const byBrand = {};
  for (const b of deduped) byBrand[b.__searchBrand] = (byBrand[b.__searchBrand] || 0) + 1;
  console.log(`\n[stage1] ── Discovery Summary ──`);
  console.log(`[stage1] total searches: ${config.COMPETITORS.length} | raw results: ${totalRaw} | duplicates removed: ${dupeCount} | unique branches: ${deduped.length}`);
  for (const [k, v] of Object.entries(byBrand)) console.log(`          ${k}: ${v} branches`);
  return deduped;
}

// ─────────────── STAGE 2: per-branch details + reviews ───────────────

/**
 * Force Google Maps into English.
 *
 * Every selector below keys off English text — the star aria-label contains
 * "star", and review timestamps are matched on "ago". Branch URLs that come from
 * the Places API ("…/maps/place/?q=place_id:X") carry no hl parameter, so on a
 * Saudi-facing IP Google served Arabic: the star regex found no "star", the date
 * regex found no "ago", and every scraped review ended up with stars=null and
 * publishedAtDate=null. The analyzer drops undated reviews from the window, so
 * the branch silently scored zero reviews and no rating. Pinning the locale is
 * the root fix; the Arabic parsing below is the backstop for when Google ignores
 * the hint.
 */
function withEnglishLocale(rawUrl) {
  if (!rawUrl) return rawUrl;
  let out = String(rawUrl);
  // Deliberately string-level: round-tripping through URL/searchParams
  // percent-encodes the ":" in "?q=place_id:ChIJ…", which Maps rejects.
  const setParam = (url, key, value) => {
    const re = new RegExp(`([?&])${key}=[^&#]*`);
    if (re.test(url)) return url.replace(re, `$1${key}=${value}`);
    const [base, hash = ""] = url.split("#");
    return base + (base.includes("?") ? "&" : "?") + `${key}=${value}` + (hash ? "#" + hash : "");
  };
  out = setParam(out, "hl", "en");
  if (!/[?&]gl=/.test(out)) out = setParam(out, "gl", "us");
  return out;
}

/** Arabic-Indic and extended Arabic-Indic digits → ASCII. */
function normaliseDigits(str) {
  return String(str || "")
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

/** Arabic relative-time unit → the unit names used below. */
const AR_UNITS = [
  [/\u062B\u0627\u0646\u064A|\u062B\u0648\u0627\u0646/, "minute"],        // ثانية / ثوان → treat as minutes-ish
  [/\u062F\u0642\u064A\u0642/, "minute"],                                      // دقيقة
  [/\u0633\u0627\u0639/, "hour"],                                               // ساعة
  [/\u064A\u0648\u0645|\u0623\u064A\u0627\u0645/, "day"],                   // يوم / أيام
  [/\u0623\u0633\u0628\u0648\u0639|\u0627\u0633\u0627\u0628\u064A\u0639/, "week"], // أسبوع
  [/\u0634\u0647\u0631|\u0623\u0634\u0647\u0631/, "month"],                 // شهر / أشهر
  [/\u0633\u0646|\u0639\u0627\u0645/, "year"],                                // سنة / عام
];

function shiftBack(unit, n) {
  const d = new Date();
  if (unit === "minute") d.setMinutes(d.getMinutes() - n);
  else if (unit === "hour") d.setHours(d.getHours() - n);
  else if (unit === "day") d.setDate(d.getDate() - n);
  else if (unit === "week") d.setDate(d.getDate() - n * 7);
  else if (unit === "month") d.setMonth(d.getMonth() - n);
  else if (unit === "year") d.setFullYear(d.getFullYear() - n);
  return d.toISOString();
}

/**
 * Arabic dual nouns encode "2" in the word itself (شهرين = two months) with no
 * digit present. JS \b is ASCII-word based and never fires after an Arabic
 * letter, so a suffix test cannot be used — match the dual words explicitly.
 */
const AR_DUALS = [
  [/\u062F\u0642\u064A\u0642\u062A\u064A\u0646/, "minute"],                   // دقيقتين
  [/\u0633\u0627\u0639\u062A\u064A\u0646/, "hour"],                            // ساعتين
  [/\u064A\u0648\u0645\u064A\u0646/, "day"],                                    // يومين
  [/\u0627?\u0623?\u0633\u0628\u0648\u0639\u064A\u0646/, "week"],            // أسبوعين / اسبوعين
  [/\u0634\u0647\u0631\u064A\u0646/, "month"],                                  // شهرين
  [/\u0633\u0646\u062A\u064A\u0646|\u0639\u0627\u0645\u064A\u0646/, "year"],// سنتين / عامين
];

function relativeDateToIso(rel) {
  if (!rel) return null;
  const s = normaliseDigits(rel).toLowerCase().trim();

  // English: "3 months ago", "a year ago"
  const en = s.match(/(a|an|\d+)\s*(minute|hour|day|week|month|year)s?\s*ago/);
  if (en) {
    const n = en[1] === "a" || en[1] === "an" ? 1 : parseInt(en[1], 10);
    return shiftBack(en[2], n);
  }

  // Arabic: "قبل 3 أشهر" / "قبل شهر" / "قبل شهرين"
  if (/\u0642\u0628\u0644/.test(s)) {
    const num = s.match(/(\d+)/);
    if (num) {
      for (const [re, unit] of AR_UNITS) if (re.test(s)) return shiftBack(unit, parseInt(num[1], 10));
    }
    // No digit: dual form means 2, a bare noun means 1.
    for (const [re, unit] of AR_DUALS) if (re.test(s)) return shiftBack(unit, 2);
    for (const [re, unit] of AR_UNITS) if (re.test(s)) return shiftBack(unit, 1);
  }

  return null;
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
      // Arabic-Indic digits → ASCII, so numbers parse whatever locale rendered.
      const digits = (str) => String(str || "")
        .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
        .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));

      let stars = null;
      // "star" is the English label; "نجم" covers نجمة/نجوم when Google ignores hl.
      const starEl = card.querySelector('[role="img"][aria-label*="star" i], [aria-label*="star" i], [role="img"][aria-label*="\u0646\u062C\u0645"], [aria-label*="\u0646\u062C\u0645"]');
      if (starEl) {
        const m = digits(starEl.getAttribute("aria-label")).match(/(\d+(?:[.,]\d+)?)/);
        if (m) stars = parseFloat(m[1].replace(",", "."));
        if (stars != null && (stars < 1 || stars > 5)) stars = null;
      }

      let dateRel = null;
      const spans = Array.from(card.querySelectorAll("span"));
      for (const s of spans) {
        const t = (s.textContent || "").trim();
        // English "… ago" or Arabic "قبل …"
        if (t.length < 40 && (/\bago\b/i.test(t) || /\u0642\u0628\u0644/.test(t))) { dateRel = t; break; }
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
  // hl=en is only a hint; the header is what Google actually honours from a
  // Saudi-facing IP. Both are needed for the English-keyed selectors to match.
  await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

  const short = branch.title.slice(0, 40);
  console.log(`  [${idx + 1}/${total}] ${short} ...`);

  try {
    await page.goto(withEnglishLocale(branch.url), { waitUntil: "networkidle2", timeout: 60000 });
    await sleep(2500);
    await dismissConsent(page);

    // Capture the current URL after redirect (Google normalizes place URLs)
    const normalizedUrl = page.url();

    // Extract placeId (CID) and coordinates from the resolved URL
    const cidMatch = normalizedUrl.match(/!1s(0x[a-f0-9]+:0x[a-f0-9]+)/i);
    const coordMatch = normalizedUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const placeId = cidMatch ? cidMatch[1] : null;
    const lat = coordMatch ? parseFloat(coordMatch[1]) : null;
    const lng = coordMatch ? parseFloat(coordMatch[2]) : null;

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

    console.log(`    → ${reviews.length} reviews, addr: ${(details.address || branch.address || "").slice(0,40) || "(none)"}`);
    await page.close();

    // Merge with any authoritative metadata the branch already carries (e.g.
    // from the Places API discovery): prefer freshly-scraped values, but fall
    // back to the incoming ones so we never lose the ChIJ placeId / coords /
    // address / hours that Places already gave us.
    return {
      title:        branch.title,
      address:      details.address || branch.address || "",
      addressLink:  normalizedUrl || branch.addressLink || branch.url || "",
      hours:        details.hours || branch.hours || "",
      phone:        details.phone || branch.phone || "",
      website:      branch.website || "",
      url:          normalizedUrl || branch.url || "",
      rating:       details.rating != null ? details.rating : (branch.rating ?? null),
      reviewsCount: details.reviewsCount != null ? details.reviewsCount : (branch.reviewsCount ?? null),
      reviews,
      placeId:      placeId || branch.placeId || null,
      lat:          lat != null ? lat : (branch.lat ?? null),
      lng:          lng != null ? lng : (branch.lng ?? null),
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

  const results = Array.from(cachedByUrl.entries())
    .filter(([k]) => requestedUrls.has(k))
    .map(([, v]) => v);

  const totalReviews = results.reduce((s, b) => s + (b.reviews?.length || 0), 0);
  const withAddr = results.filter(b => b.address).length;
  const withHours = results.filter(b => b.hours).length;
  const byBrand = {};
  for (const b of results) byBrand[b.__searchBrand] = (byBrand[b.__searchBrand] || 0) + 1;
  console.log(`\n[stage2] ── Scrape Summary ──`);
  console.log(`[stage2] branches: ${results.length} | reviews: ${totalReviews} | with address: ${withAddr} | with hours: ${withHours}`);
  for (const [k, v] of Object.entries(byBrand)) console.log(`          ${k}: ${v} branches`);

  return results;
}

// ─────────────── public entry point ───────────────

async function scrapeCompetitors() {
  // Clear stale Stage 2 cache so a crash never returns data from a previous job run
  if (fs.existsSync(config.COMP_REVIEWS)) {
    fs.unlinkSync(config.COMP_REVIEWS);
    console.log('[scraper] cleared stale competitor_reviews cache');
  }

  let browser;
  try {
    browser = await launchBrowser();
  } catch (err) {
    console.error(`[scraper] failed to launch browser: ${err.message}`);
    return [];
  }

  let branches;
  try {
    console.log('[scraper] running fresh competitor discovery (cache disabled)');
    branches = await discoverBranches(browser);
    fs.writeFileSync(config.COMP_BRANCHES, JSON.stringify(branches, null, 2));
    if (!branches || branches.length === 0) {
      console.warn("[scraper] no competitor branches discovered — continuing with empty list");
      try { await browser.close(); } catch {}
      return [];
    }
  } catch (err) {
    console.error(`[scraper] discovery failed: ${err.message}`);
    try { await browser.close(); } catch {}
    return [];
  }

  // Stage 2 with retry — if browser crashes, relaunch and continue
  // (scrapeBranches saves progress per-branch, so a new browser picks up where it left off)
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const full = await scrapeBranches(browser, branches);
      try { await browser.close(); } catch {}
      return full;
    } catch (err) {
      console.error(`[scraper] Stage 2 attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      try { await browser.close(); } catch {}
      if (attempt < MAX_RETRIES) {
        console.log('[scraper] relaunching browser to continue Stage 2...');
        try { browser = await launchBrowser(); } catch (e) {
          console.error(`[scraper] browser relaunch failed: ${e.message}`);
          break;
        }
      }
    }
  }

  // All retries exhausted — return whatever we managed to scrape
  if (fs.existsSync(config.COMP_REVIEWS)) {
    try {
      const cached = JSON.parse(fs.readFileSync(config.COMP_REVIEWS, "utf8"));
      console.warn(`[scraper] returning ${cached.length} cached competitor branches after retries exhausted`);
      return cached;
    } catch {}
  }
  return [];
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
    console.error("scrapeBrand: brand needs { key, name, url } — got:", JSON.stringify(brand));
    return [];
  }
  let browser;
  try {
    browser = await launchBrowser();
  } catch (err) {
    console.error(`[scrapeBrand:${brand.key}] failed to launch browser: ${err.message}`);
    return [];
  }
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
      console.warn(`[scrapeBrand:${brand.key}] no branches discovered on Google Maps`);
      return [];
    }
    return await scrapeBranches(browser, branches);
  } catch (err) {
    console.error(`[scrapeBrand:${brand.key}] failed: ${err.message}`);
    return [];
  } finally {
    try { await browser.close(); } catch {}
  }
}

/**
 * Run ONLY Stage 2 (per-branch reviews + hours) on a pre-discovered branch
 * list. Used when discovery is done authoritatively via the Google Places API
 * (see places-fetcher.js) instead of the fragile Puppeteer feed scroll.
 *
 * `branches` items must carry at least { title, url, __searchBrand } and
 * ideally { placeId, address, lat, lng, hours, phone, rating, reviewsCount }
 * which are preserved when the page scrape doesn't surface them.
 */
async function scrapeProvidedBranches(branches) {
  if (!Array.isArray(branches) || branches.length === 0) {
    console.warn("[scraper] scrapeProvidedBranches: empty branch list");
    return [];
  }

  // Fresh Stage 2 cache so a prior run never bleeds in.
  if (fs.existsSync(config.COMP_REVIEWS)) {
    try { fs.unlinkSync(config.COMP_REVIEWS); } catch {}
  }
  // Normalize: ensure each branch has a navigable url (prefer clean place_id URL)
  const normalized = branches.map((b) => ({
    ...b,
    url: b.placeId
      ? `https://www.google.com/maps/place/?q=place_id:${b.placeId}`
      : (b.url || b.addressLink || ""),
  })).filter((b) => b.url);

  let browser;
  try { browser = await launchBrowser(); }
  catch (err) { console.error(`[scraper] failed to launch browser: ${err.message}`); return normalized; }

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const full = await scrapeBranches(browser, normalized);
      try { await browser.close(); } catch {}
      return full;
    } catch (err) {
      console.error(`[scraper] provided-branches Stage 2 attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      try { await browser.close(); } catch {}
      if (attempt < MAX_RETRIES) {
        try { browser = await launchBrowser(); }
        catch (e) { console.error(`[scraper] browser relaunch failed: ${e.message}`); break; }
      }
    }
  }

  if (fs.existsSync(config.COMP_REVIEWS)) {
    try { return JSON.parse(fs.readFileSync(config.COMP_REVIEWS, "utf8")); } catch {}
  }
  return normalized;
}

module.exports = { scrapeCompetitors, scrapeBrand, scrapeProvidedBranches };
