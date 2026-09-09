/**
 * gbp-performance.js
 *
 * Google Business Profile Performance API — daily metric time series for the
 * locations the client's account manages.
 *
 *   GET https://businessprofileperformance.googleapis.com/v1/
 *       locations/{LOCATION_ID}:getDailyMetricsTimeSeries
 *         ?dailyMetric=WEBSITE_CLICKS
 *         &dailyRange.startDate.year=2026
 *         &dailyRange.startDate.month=7
 *         &dailyRange.startDate.day=21
 *         &dailyRange.endDate.year=2026
 *         &dailyRange.endDate.month=8
 *         &dailyRange.endDate.day=20
 *
 *   Authorization: Bearer <access token minted from the client's refresh token>
 *
 * LOCATION_ID comes from each branch's `gmbLocationId` — the numeric tail of the
 * Business Profile resource name, captured in target-fetcher.js. It is NOT the
 * Maps place_id, and only the client's OWN branches have one, so competitors are
 * skipped automatically.
 *
 * One request per (location × metric): 10 metrics × N branches. Requests are
 * pooled and a location that 403s (metric not enabled for that business type,
 * e.g. BUSINESS_FOOD_ORDERS on a non-restaurant) is recorded and skipped rather
 * than failing the run.
 *
 * Output shape:
 *   [{ gmbLocationId, metric, series: [{ date: 'YYYY-MM-DD', value: 12 }, ...] }]
 */

const https = require("https");
const config = require("./config");

const HOST = "businessprofileperformance.googleapis.com";

/** Every daily metric the API exposes, in dashboard display order. */
const DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "WEBSITE_CLICKS",
  "CALL_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_BOOKINGS",
  "BUSINESS_FOOD_ORDERS",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(path, accessToken) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: HOST, path, method: "GET", headers: { Authorization: `Bearer ${accessToken}` } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, headers: res.headers, body: data }); }
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/** OAuth: same admin client credentials + the client's own refresh token. */
async function getAccessToken() {
  const cfg = config.TARGET_API;
  if (!cfg || !cfg.clientId || !cfg.clientSecret || !cfg.refreshToken) {
    throw new Error("Performance API needs GMB OAuth client id/secret and the client's refresh token");
  }
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
    grant_type: "refresh_token",
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: "oauth2.googleapis.com", path: "/token", method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) } },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(d);
            if (res.statusCode !== 200 || !parsed.access_token) {
              return reject(new Error("OAuth failed: " + JSON.stringify(parsed).slice(0, 300)));
            }
            resolve(parsed.access_token);
          } catch (e) { reject(new Error("OAuth parse failed: " + d.slice(0, 200))); }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function ymd(dateStr) {
  const d = new Date(dateStr);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** The API caps a single request at 18 months; clamp defensively. */
function resolveRange(dateStart, dateEnd) {
  const end = dateEnd ? new Date(dateEnd) : new Date();
  let start = dateStart ? new Date(dateStart) : new Date(end.getTime() - 89 * 24 * 3600 * 1000);
  const maxSpanMs = 540 * 24 * 3600 * 1000;
  if (end.getTime() - start.getTime() > maxSpanMs) start = new Date(end.getTime() - maxSpanMs);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

function buildPath(locationId, metric, range) {
  const s = ymd(range.start);
  const e = ymd(range.end);
  const qs = new URLSearchParams({
    dailyMetric: metric,
    "dailyRange.startDate.year": String(s.year),
    "dailyRange.startDate.month": String(s.month),
    "dailyRange.startDate.day": String(s.day),
    "dailyRange.endDate.year": String(e.year),
    "dailyRange.endDate.month": String(e.month),
    "dailyRange.endDate.day": String(e.day),
  });
  return `/v1/locations/${encodeURIComponent(locationId)}:getDailyMetricsTimeSeries?${qs}`;
}

/**
 * The response is a sparse series: dates with no activity may be omitted, and
 * `value` is absent rather than 0. Expand to one entry per returned date.
 */
function parseSeries(body) {
  const dated = body?.timeSeries?.datedValues || [];
  const out = [];
  for (const dv of dated) {
    const d = dv.date;
    if (!d || d.year == null || d.month == null || d.day == null) continue;
    const date = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
    out.push({ date, value: Number(dv.value || 0) });
  }
  return out;
}

/**
 * Fetch daily series for every (branch × metric).
 *
 * @param {object[]} branches  need .gmbLocationId (branches without one are skipped)
 * @param {object} opts        { dateStart, dateEnd, metrics }
 */
async function fetchPerformance(branches, opts = {}) {
  const withLoc = (branches || []).filter((b) => b.gmbLocationId);
  if (withLoc.length === 0) {
    console.warn("[gbp-perf] no branches carry a GMB location id — nothing to fetch");
    return [];
  }

  const metrics = Array.isArray(opts.metrics) && opts.metrics.length ? opts.metrics : DAILY_METRICS;
  const range = resolveRange(opts.dateStart, opts.dateEnd);
  const token = await getAccessToken();

  console.log(`\n═══ GBP PERFORMANCE: ${withLoc.length} locations × ${metrics.length} metrics (${range.start} → ${range.end}) ═══`);

  // One task per (location, metric); a small pool keeps us well under quota.
  const tasks = [];
  for (const b of withLoc) for (const metric of metrics) tasks.push({ b, metric });

  const results = [];
  const notEnabled = new Map();   // metric → count of locations that reject it
  let done = 0, failed = 0, emptied = 0;
  let throttled = 0;
  let idx = 0;
  const POOL = 3;
  const MAX_ATTEMPTS = 5;

  // Google meters this API per minute across the whole project, so a 429 is not
  // about one request — the quota is spent and every in-flight worker is about
  // to be refused too. One shared gate holds all of them until the window
  // reopens; retrying per-request instead just burns the next window as well,
  // which is how a single click turned into hundreds of 429s.
  let gateUntil = 0;
  const holdAll = (ms) => { gateUntil = Math.max(gateUntil, Date.now() + ms); };
  async function waitForGate() {
    while (Date.now() < gateUntil) await sleep(Math.min(2000, gateUntil - Date.now()));
  }

  /** Seconds Google asked us to wait, if it said. */
  const retryAfterMs = (res) => {
    const h = res && res.headers && res.headers["retry-after"];
    const n = h ? Number(h) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.min(n * 1000, 90_000) : 0;
  };

  async function worker() {
    while (idx < tasks.length) {
      const { b, metric } = tasks[idx++];
      if (config.__check) await config.__check();

      let res = null;
      let attempt = 0;
      let giveUp = false;

      while (attempt < MAX_ATTEMPTS) {
        await waitForGate();
        attempt++;
        try {
          res = await getJson(buildPath(b.gmbLocationId, metric, range), token);
        } catch (err) {
          if (attempt >= MAX_ATTEMPTS) {
            failed++;
            console.warn(`[gbp-perf] ${b.gmbLocationId} ${metric}: ${err.message}`);
            giveUp = true;
            break;
          }
          await sleep(1000 * attempt);
          continue;
        }

        if (res.status === 429 || res.status >= 500) {
          // 4s, 8s, 16s, 32s — or whatever Retry-After says, which wins.
          const wait = retryAfterMs(res) || Math.min(4000 * 2 ** (attempt - 1), 60_000);
          if (attempt === 1) throttled++;
          holdAll(wait);
          if (attempt >= MAX_ATTEMPTS) {
            failed++;
            console.warn(`[gbp-perf] ${b.gmbLocationId} ${metric} → HTTP ${res.status} after ${attempt} attempts`);
            giveUp = true;
          }
          continue;
        }
        break;
      }
      if (giveUp) continue;

      if (res.status === 403 || res.status === 400) {
        // Metric not available for this business category, or the account has
        // no access to that location. Expected for several metrics — count it
        // once per metric instead of logging N times.
        notEnabled.set(metric, (notEnabled.get(metric) || 0) + 1);
        continue;
      }
      if (res.status !== 200) {
        failed++;
        const msg = typeof res.body === "object" ? JSON.stringify(res.body).slice(0, 160) : String(res.body).slice(0, 160);
        console.warn(`[gbp-perf] ${b.gmbLocationId} ${metric} → HTTP ${res.status} ${msg}`);
        continue;
      }

      const series = parseSeries(res.body);
      if (series.length === 0) { emptied++; }
      else {
        results.push({
          gmbLocationId: b.gmbLocationId,
          placeId: b.placeId || null,
          title: b.title || "",
          metric,
          series,
        });
      }

      done++;
      if (done % 25 === 0) console.log(`[gbp-perf] ${done}/${tasks.length} requests done`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(POOL, tasks.length) }, worker));

  const totalPoints = results.reduce((s, r) => s + r.series.length, 0);
  console.log(`[gbp-perf] ${results.length} series, ${totalPoints} daily data points | ${emptied} empty | ${failed} failed`
    + (throttled ? ` | ${throttled} hit the per-minute quota and were retried` : ""));
  for (const [metric, n] of notEnabled) {
    console.log(`[gbp-perf] ${metric}: not available for ${n} location(s) — skipped`);
  }
  if (results.length === 0) {
    console.warn("[gbp-perf] no metrics returned — the refresh token may lack the business.manage scope, or the locations are too new to have data");
  }

  return results;
}

module.exports = { fetchPerformance, DAILY_METRICS };
