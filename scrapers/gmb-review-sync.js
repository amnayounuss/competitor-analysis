/**
 * gmb-review-sync.js
 *
 * Pulls a client's entire review corpus from the Business Profile API — every
 * account, every open location, every review, with the owner's reply.
 *
 * Separate from the analysis pipeline on purpose. That pipeline fetches reviews
 * as a side effect of a competitor analysis, for one target brand, into one job.
 * Keeping the review corpus current should not require any of that, and a client
 * account can hold several unrelated brands — this one holds White Cafe,
 * BRGR, CodeCo and Munch Burger.
 *
 * Idempotent: reviews upsert on Google's own reviewId, so running it repeatedly
 * refreshes replies and ratings instead of duplicating rows.
 */

const https = require("https");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STAR = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

function postForm(host, path, form) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(form).toString();
    const req = https.request({ hostname: host, path, method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) } },
      (res) => { let d = ""; res.on("data", c => d += c);
        res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
                              catch { resolve({ status: res.statusCode, body: d }); } }); });
    req.on("error", reject); req.write(body); req.end();
  });
}

function authedGet(host, path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: host, path, method: "GET",
      headers: { Authorization: `Bearer ${token}` } },
      (res) => { let d = ""; res.on("data", c => d += c);
        res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
                              catch { resolve({ status: res.statusCode, body: d }); } }); });
    req.on("error", reject); req.end();
  });
}

async function getAccessToken({ clientId, clientSecret, refreshToken }) {
  const res = await postForm("oauth2.googleapis.com", "/token", {
    client_id: clientId, client_secret: clientSecret,
    refresh_token: refreshToken, grant_type: "refresh_token",
  });
  if (res.status !== 200 || !res.body.access_token) {
    const e = new Error("Google rejected the refresh token: " + JSON.stringify(res.body).slice(0, 200));
    e.badToken = true;
    throw e;
  }
  return res.body.access_token;
}

/**
 * Normalise a Google store name into a brand key.
 *
 * Google returns bilingual signs ("مقهى وايت | White Cafe") and decorated
 * variants ("BRGR Cloud", "مطعم كود"). Grouping on the raw string would split
 * one brand across several rows, so the Latin half is preferred where present
 * and category words are dropped.
 */
function brandKeyFromStoreName(name) {
  let s = String(name || "").trim();
  if (!s) return null;

  // Google store names follow "<brand> | <branch>", so the brand is the first
  // segment. A Latin segment is preferred when there is one because it
  // normalises spelling ("مقهى وايت | White Cafe" -> "White"); when every
  // segment is Arabic, the first one is the brand. Without that fallback a
  // chain named "محمصة قهوة شفل | العليا" produced a separate brand per branch,
  // and the brand filter listed eighteen brands that were one.
  // Both separators appear in the same account: "brand | branch" and
  // "brand - branch".
  if (/[|\u2013\u2014]| - /.test(s)) {
    const parts = s.split(/\s*[|\u2013\u2014]\s*|\s+-\s+/).map(x => x.trim()).filter(Boolean);
    const latin = parts.find(p => /[A-Za-z]/.test(p));
    s = latin || parts[0] || s;
  }

  s = s
    .replace(/[ً-ْـ]/g, "")
    // Spelling variants of the same name, so one brand does not split in two:
    // this account writes both "شفل" and "شڤل".
    .replace(/[ڤڦ]/g, "ف")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\b(cafe|caf[eé]|coffee|restaurant|resturant|bakery|roastery|roasters?|cloud|co\.?|company|est\.?|branch)\b/gi, " ")
    .replace(/(محمصة|محمصه|مقهى|مقهي|مطعم|حلويات|مخبز|فرع|كافيه|كافه|شركة|شركه|قهوة|قهوه)/g, " ")
    .replace(/\s+/g, " ")
    // "محمصة و قهوة شفل" leaves a bare "و" ("and") once both nouns are
    // stripped, which split one brand into two. Drop stray conjunctions and
    // any punctuation left at the edges.
    .replace(/(^|\s)[وw](\s|$)/gi, " ")
    .replace(/^[\s\-–—|،,.]+|[\s\-–—|،,.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return s || String(name).trim();
}

/**
 * Collapse spelling and script variants of one brand into a single label.
 *
 * brandKeyFromStoreName reads one name at a time, so it cannot know that
 * "وايت كافيه | الخبر" and "مقهى وايت | White Cafe" are the same chain — it
 * produced "وايت" for one and "White" for the other, and the brand filter
 * listed both. The evidence for merging is already in the data: a name that
 * carries both spellings ("شركة كود | CodeCo") proves they belong together.
 *
 * Two rules, no hardcoded brand names:
 *   1. every key derivable from the same store name is the same brand;
 *   2. a key whose words are all contained in another key is the same brand
 *      ("Anoosh" inside "Anoosh انوش").
 *
 * The label kept for a group is a Latin one where it exists — it is the
 * spelling that survives being read by anyone — and otherwise the shortest.
 *
 * @param {string[]} storeNames
 * @returns {Map<string,string>} raw key -> canonical label
 */
function canonicaliseBrands(storeNames) {
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const add = (x) => { if (!parent.has(x)) parent.set(x, x); return x; };
  const union = (a, b) => { a = find(add(a)); b = find(add(b)); if (a !== b) parent.set(a, b); };

  const seen = new Set();
  const counts = new Map();

  for (const name of storeNames) {
    const chosen = brandKeyFromStoreName(name);
    if (!chosen) continue;
    add(chosen);
    counts.set(chosen, (counts.get(chosen) || 0) + 1);
    seen.add(chosen);

    // Rule 1: every segment of this name names the same brand.
    const segments = String(name).split(/\s*[|\u2013\u2014]\s*|\s+-\s+/).map(x => x.trim()).filter(Boolean);
    for (const seg of segments) {
      const k = brandKeyFromStoreName(seg);
      if (k) { seen.add(k); union(k, chosen); }
    }
  }

  // Rule 2: subset of words means the same brand.
  const words = (k) => new Set(k.toLowerCase().split(/\s+/).filter(Boolean));
  const keys = [...seen];
  for (const a of keys) {
    for (const b of keys) {
      if (a === b) continue;
      const wa = words(a), wb = words(b);
      if (wa.size === 0 || wa.size >= wb.size) continue;
      let subset = true;
      for (const w of wa) if (!wb.has(w)) { subset = false; break; }
      if (subset) union(b, a);
    }
  }

  const groups = new Map();
  for (const k of keys) {
    const root = find(k);
    (groups.get(root) || groups.set(root, []).get(root)).push(k);
  }

  const label = new Map();
  for (const members of groups.values()) {
    const latin = members.filter(m => /^[\x20-\x7E]+$/.test(m));
    const pick = (latin.length ? latin : members)
      .sort((x, y) => x.length - y.length || (counts.get(y) || 0) - (counts.get(x) || 0))[0];
    for (const m of members) label.set(m, pick);
  }
  return label;
}

function formatAddress(sf) {
  if (!sf) return "";
  const p = [];
  if (sf.addressLines?.length) p.push(sf.addressLines.join(", "));
  if (sf.locality) p.push(sf.locality);
  if (sf.administrativeArea) p.push(sf.administrativeArea);
  if (sf.postalCode) p.push(sf.postalCode);
  if (sf.regionCode) p.push(sf.regionCode);
  return p.filter(Boolean).join(", ");
}

/** Every open location the token can see, across every account. */
async function listLocations(oauth, onProgress = () => {}) {
  const token = await getAccessToken(oauth);

  const accRes = await authedGet("mybusinessaccountmanagement.googleapis.com", "/v1/accounts", token);
  if (accRes.status !== 200) throw new Error("Could not list accounts: " + JSON.stringify(accRes.body).slice(0, 200));
  const accounts = accRes.body.accounts || [];

  const readMask = "name,title,categories,storefrontAddress,latlng,metadata,openInfo,phoneNumbers,websiteUri,regularHours";
  const out = [];

  for (const acc of accounts) {
    const accountId = acc.name.split("/").pop();
    let pageToken = null;
    do {
      const params = new URLSearchParams({ readMask, pageSize: "100" });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await authedGet("mybusinessbusinessinformation.googleapis.com",
        `/v1/${acc.name}/locations?${params}`, token);
      if (res.status !== 200) {
        onProgress(`account ${accountId}: locations → ${res.status}`);
        break;
      }
      for (const loc of res.body.locations || []) {
        if (loc.openInfo?.status === "CLOSED_PERMANENTLY") continue;
        if (loc.metadata?.duplicateLocation) continue;
        out.push({
          accountId,
          accountName: acc.accountName || accountId,
          locationId: (loc.name || "").split("/").pop(),
          storeName: loc.title || "",
          brandKey: brandKeyFromStoreName(loc.title),
          placeId: loc.metadata?.placeId || null,
          address: formatAddress(loc.storefrontAddress),
          city: loc.storefrontAddress?.locality || null,
          lat: loc.latlng?.latitude ?? null,
          lng: loc.latlng?.longitude ?? null,
          phone: loc.phoneNumbers?.primaryPhone || null,
          website: loc.websiteUri || null,
          categoryId: (loc.categories?.primaryCategory?.name || "").replace("categories/", "") || null,
          categoryLabel: loc.categories?.primaryCategory?.displayName || null,
          mapsUri: loc.metadata?.mapsUri || null,
        });
      }
      pageToken = res.body.nextPageToken || null;
    } while (pageToken);
  }

  // The same physical branch can sit under two accounts; Google does not flag it.
  const seen = new Set();
  const unique = out.filter(l => {
    if (!l.placeId) return true;
    if (seen.has(l.placeId)) return false;
    seen.add(l.placeId);
    return true;
  });

  onProgress(`${unique.length} open location(s) across ${accounts.length} account(s)`);
  return { token, locations: unique };
}

/**
 * Reviews for one location, newest first.
 *
 * `opts.since` turns a full crawl into an incremental one. Google has no
 * server-side date filter, but it does return reviews ordered by updateTime
 * descending — so paging stops at the first review Google has not touched since
 * that timestamp. A location with 500 reviews and two new ones costs one page
 * instead of ten.
 *
 * The cutoff is compared against updateTime rather than createTime on purpose:
 * a reply posted today to a review from last year bumps updateTime, so that
 * reply is picked up too instead of being invisible forever.
 */
async function fetchAllReviews(token, accountId, locationId, onProgress = () => {}, opts = {}) {
  const since = opts.since ? Date.parse(opts.since) : null;
  const all = [];
  let pageToken = null;
  let total = null;
  let pages = 0;
  let stoppedEarly = false;

  do {
    const params = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc" });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await authedGet("mybusiness.googleapis.com",
      `/v4/accounts/${accountId}/locations/${locationId}/reviews?${params}`, token);

    if (res.status === 429 || res.status >= 500) {
      await sleep(1500);
      continue;                                  // one retry per page, then move on
    }
    if (res.status !== 200) {
      onProgress(`  location ${locationId}: reviews → ${res.status}`);
      break;
    }

    if (total === null) total = res.body.totalReviewCount ?? null;
    for (const r of res.body.reviews || []) {
      const stamp = Date.parse(r.updateTime || r.createTime || "") || 0;
      if (since && stamp <= since) {
        // Ordered newest-first, so everything past this point is older too.
        stoppedEarly = true;
        break;
      }
      all.push({
        gmbReviewId: r.reviewId || (r.name || "").split("/").pop() || null,
        rating: STAR[r.starRating] || null,
        text: (r.comment || "").trim() || null,
        reviewerName: r.reviewer?.displayName || null,
        publishedAt: r.createTime || r.updateTime || null,
        replyText: r.reviewReply ? (r.reviewReply.comment || "").trim() || null : null,
        repliedAt: r.reviewReply ? (r.reviewReply.updateTime || null) : null,
      });
    }
    if (stoppedEarly) break;

    pageToken = res.body.nextPageToken || null;
    pages++;
    if (pageToken) await sleep(120);
  } while (pageToken && pages < 200);

  // The caller needs to know this was a partial read, or it will compare the
  // handful of new reviews against Google's lifetime total and report a
  // shortfall that is not one.
  return { reviews: all, reportedTotal: total, incremental: !!since, stoppedEarly };
}

module.exports = { listLocations, fetchAllReviews, brandKeyFromStoreName, canonicaliseBrands, getAccessToken };
