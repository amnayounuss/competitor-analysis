/**
 * Every number the advisor dashboard shows, computed once.
 *
 * The rule the dashboard follows is NUMBER → MEANING → COMPARISON → REASON →
 * ACTION, and the comparison half is what makes this a module rather than a few
 * queries: a figure with no target and no previous period cannot tell a manager
 * whether to act. So nothing here returns a bare value — every measure carries
 * its target, the same measure last period, and a status.
 *
 * All of it derives from `review_daily_facts` and `review_topic_rows`
 * (client migration 012), which means the KPI tiles, the charts and the
 * per-branch tables are arithmetic on identical rows and cannot disagree with
 * each other — a class of bug that is invisible until a customer spots it.
 *
 * The AI never sees raw reviews here, only these aggregates; see
 * lib/dashboard-insights.ts for why.
 */

/**
 * What "good" means by default.
 *
 * These are operating targets, not industry statistics — a manager needs a line
 * to be above, and an invented benchmark presented as research would be worse
 * than an explicit house standard. A client can replace every one of them; see
 * DashboardSettings. The dashboard shows whose number it is using, because
 * "Target 24 hours" with no author is not a standard, it is an assertion.
 */
export const DEFAULT_TARGETS = {
  /** Sentiment read from what customers wrote, 0-100. */
  sentiment: 75,
  /** Share of reviews that got a reply. */
  replyRate: 80,
  /** Hours to reply. Lower is better. */
  replyHours: 24,
  /** Share of scored reviews that read as negative. Lower is better. */
  negativeShare: 10,
  /** Stars, on the usual 1-5 scale. */
  rating: 4.3,
} as const;

/**
 * How the health score is built, by default.
 *
 * Two parts, not four. The original had stars and review volume in it as well,
 * and neither survived contact with a reader: stars barely move the result
 * because feeling already reflects them, and volume is not health at all — a
 * quiet branch is quiet, not sick, yet it dragged small branches down. Cutting
 * both made the score explainable in one sentence, which matters more than the
 * third decimal place.
 *
 * Weights are normalised on read, so they need not sum to 1 here.
 */
export const DEFAULT_WEIGHTS = {
  /** Sentiment read from the review text, 0-100. */
  feeling: 0.8,
  /** Share of reviews answered — a branch that ignores customers is less healthy. */
  replyRate: 0.2,
} as const;

export type Targets = Record<keyof typeof DEFAULT_TARGETS, number>;
export type Weights = Record<keyof typeof DEFAULT_WEIGHTS, number>;

export interface DashboardSettings {
  targets: Targets;
  weights: Weights;
  /** False when the client has never saved their own, so the UI can say so. */
  customised: boolean;
}

/** Merge a client's stored settings over the defaults, ignoring rubbish. */
export function resolveSettings(stored: any): DashboardSettings {
  const num = (v: any, fallback: number, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };

  const targets: Targets = {
    sentiment:     num(stored?.targets?.sentiment,     DEFAULT_TARGETS.sentiment, 1, 100),
    replyRate:     num(stored?.targets?.replyRate,     DEFAULT_TARGETS.replyRate, 1, 100),
    replyHours:    num(stored?.targets?.replyHours,    DEFAULT_TARGETS.replyHours, 0.5, 720),
    negativeShare: num(stored?.targets?.negativeShare, DEFAULT_TARGETS.negativeShare, 0.5, 100),
    rating:        num(stored?.targets?.rating,        DEFAULT_TARGETS.rating, 1, 5),
  };

  /**
   * Weights saved before the score was cut to two parts are discarded.
   *
   * An old blob held feeling 0.55 and replyRate 0.20 alongside a rating and a
   * volume weight that no longer exist. Normalising just the two survivors gave
   * 0.73/0.27 — a ratio nobody chose, quietly different from both the old
   * formula and the new default. Presence of a removed key is the signal, so
   * such a client goes back to the current defaults rather than inheriting an
   * accident.
   */
  const legacyWeights = stored?.weights
    && ('rating' in stored.weights || 'volume' in stored.weights);

  const raw: Weights = legacyWeights
    ? { ...DEFAULT_WEIGHTS }
    : {
        feeling:   num(stored?.weights?.feeling,   DEFAULT_WEIGHTS.feeling, 0, 1),
        replyRate: num(stored?.weights?.replyRate, DEFAULT_WEIGHTS.replyRate, 0, 1),
      };

  // Normalised so the score stays on 0-100 whatever the client typed; two
  // weights of 1 would otherwise put every branch at 200.
  const sum = raw.feeling + raw.replyRate;
  const weights: Weights = sum > 0
    ? {
        feeling:   Math.round((raw.feeling / sum) * 1000) / 1000,
        replyRate: Math.round((raw.replyRate / sum) * 1000) / 1000,
      }
    : { ...DEFAULT_WEIGHTS };

  return {
    targets, weights,
    // A legacy blob is not a choice the client still holds, so it does not
    // count as customised.
    customised: !!(stored?.targets || (stored?.weights && !legacyWeights)),
  };
}

/**
 * Reviews a branch needs before it can be called best or worst.
 *
 * Without this the leaderboards fill with noise: a branch with four reviews and
 * a perfect score outranks one with five hundred, and a manager is sent to
 * congratulate a kiosk instead of rescuing a restaurant. Such branches still
 * appear in the full table — they are just not ranked.
 */
export const MIN_REVIEWS_FOR_RANKING = 10;

export type Status = 'good' | 'attention' | 'critical';

export interface Kpi {
  key: string;
  /** Plain-language name. Translated in the UI. */
  label: string;
  /** One sentence: what this measure actually is. */
  definition: string;
  /** Why a business owner should care. */
  whyItMatters: string;
  /**
   * The counts this value was worked out from, in words.
   *
   * Added because a bare "69.7" with a target beside it is unauditable — the
   * client could not tell which reviews it covered or how it was averaged, and
   * neither could the AI writing about it.
   */
  source: string;
  value: number | null;
  unit: '' | '%' | 'h' | '★';
  target: number;
  /** Same measure over the equally long period immediately before. */
  previous: number | null;
  /** Signed change in the measure's own unit. */
  change: number | null;
  /** True when a smaller number is better. */
  lowerIsBetter: boolean;
  status: Status;
}

export interface TrendPoint {
  bucket: string;
  reviews: number;
  avgSentiment: number | null;
  negativeShare: number | null;
}

export interface BranchRow {
  branchId: number | null;
  branchName: string;
  brand: string | null;
  city: string | null;
  /**
   * The name Google holds for this location, and its street address.
   *
   * branch_name is the city, so several different stores in one city collide —
   * "الخبر" appears four times. These two are what actually tell them apart.
   */
  storeName: string | null;
  address: string | null;
  /** Opens this exact location on Google Maps. Null when Google gave no place id. */
  mapsUrl: string | null;
  reviews: number;
  avgSentiment: number | null;
  avgRating: number | null;
  ratingScaled: number | null;
  replyRate: number;
  negativeShare: number | null;
  healthScore: number | null;
  /** Second half of the period minus the first, in sentiment points. */
  trendDelta: number | null;
  topComplaint: string | null;
  status: Status;
  /** Enough reviews this period to be ranked against other branches. */
  rankable: boolean;
}

export interface TopicRow {
  topic: string;
  reviews: number;
  sharePct: number;
  previousReviews: number;
  /** Percent change in volume against the previous period. */
  changePct: number | null;
  negativeShare: number | null;
  severity: Status;
}

/**
 * A one-line finding, as data rather than a sentence.
 *
 * Composing the English here would strand it in English: these strings never
 * pass through a t() call the i18n checker can see, and an Arabic page showed
 * "Customer Sentiment is 69.7, below your target of 75." untranslated. The page
 * builds the sentence from these parts instead.
 */
export interface Finding {
  /** Which measure it came from, so the UI can link the two. */
  key: string;
  kind: 'onTarget' | 'offTarget' | 'improving' | 'starsGap' | 'branchesCritical';
  /** The measure's plain-language name, itself a dictionary key. */
  label: string;
  value: number | null;
  target: number | null;
  unit: string;
  /** Size of the change, already made positive. */
  change: number | null;
  /** True when a smaller number is the better one. */
  lowerIsBetter: boolean;
}

/** Something to actually do, again as parts rather than prose. */
export interface Suggestion {
  key: 'reply' | 'unhappy' | 'topic' | 'branch';
  /** Numbers the page drops into its own sentence. */
  values: Record<string, string | number>;
  /** Which drill-down answers it, if any. */
  drill: 'unanswered' | 'unhappy' | 'topics' | 'branches' | null;
  priority: Status;
}

export interface DashboardFacts {
  period: { from: string; to: string; days: number };
  previousPeriod: { from: string; to: string };
  granularity: 'day' | 'week' | 'month';
  coverage: {
    reviews: number;
    /** Reviews that actually contain words. A star-only review has nothing to read. */
    withText: number;
    scored: number;
    /** Has words, not read yet. This is the number a client can act on. */
    pending: number;
    /** Star rating only. Can never be scored, so never counts against coverage. */
    noText: number;
    topicsClassified: number;
    /** Reviews anywhere in the schema still waiting to be sorted by subject. */
    topicsUnsorted: number;
  };
  kpis: Kpi[];
  sentimentSplit: {
    positive: number; neutral: number; negative: number; scored: number;
    positivePct: number; neutralPct: number; negativePct: number;
    previousNegativePct: number | null;
  };
  ratings: { star: number; reviews: number; pct: number; previousPct: number | null }[];
  trend: TrendPoint[];
  branches: BranchRow[];
  topics: TopicRow[];
  response: {
    reviews: number; replied: number; unanswered: number; replyRate: number;
    avgReplyHours: number | null; negativeUnanswered: number;
  };
  benchmark: {
    current: number | null; target: number; previous: number | null;
    networkAverage: number | null; best: { name: string; value: number } | null;
    worst: { name: string; value: number } | null;
  };
  /**
   * Stars against the words, both on 0-100.
   *
   * The two disagree, and the disagreement is the point: a branch can hold a
   * 4.5 average while its comments read as complaints. Stars are rescaled
   * (1 star = 0, 5 stars = 100) purely so the two can sit on one axis.
   */
  starsVsWords: {
    feeling: number | null;
    starsScaled: number | null;
    gap: number | null;
    worst: { name: string; feeling: number; starsScaled: number; gap: number }[];
  };
  /** The targets and weights this build used, so the page can show them. */
  settings: DashboardSettings;
  /**
   * What is going well and what is not, worked out here rather than asked for.
   *
   * The page must answer "how are we doing" before anyone presses a button and
   * pays for a model call — and a rule that reads a target is more reliable
   * than a sentence that describes one.
   */
  goodNews: Finding[];
  problems: Finding[];
  suggestions: Suggestion[];
}

/* ────────────── helpers ────────────── */

const n = (v: any) => Number(v || 0);
const r1 = (v: number) => Math.round(v * 10) / 10;
const pct = (part: number, whole: number) => (whole > 0 ? r1((part / whole) * 100) : 0);
/** Thousands separators, so a source sentence reads "1,396" not "1396". */
const nf = (v: number) => v.toLocaleString('en-US');

const daysBetween = (from: string, to: string) =>
  Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1);
const shiftDays = (iso: string, delta: number) =>
  new Date(Date.parse(iso) + delta * 864e5).toISOString().slice(0, 10);

/** One place decides Good / Needs Attention / Critical, so labels never drift. */
function statusFor(value: number | null, target: number, lowerIsBetter = false): Status {
  if (value == null) return 'attention';
  const miss = lowerIsBetter ? value - target : target - value;
  // Within 5% of target reads as fine; more than 20% adrift is critical. The
  // band is relative to the target so it behaves the same for 75 points, 80%
  // and 24 hours.
  const tolerance = Math.max(1, Math.abs(target) * 0.05);
  if (miss <= tolerance) return 'good';
  if (miss <= Math.max(2, Math.abs(target) * 0.2)) return 'attention';
  return 'critical';
}

/** Buckets sized so a chart shows roughly 8-30 points whatever the span. */
function pickGranularity(days: number): 'day' | 'week' | 'month' {
  if (days <= 45) return 'day';
  if (days <= 400) return 'week';
  return 'month';
}

function bucketOf(day: string, g: 'day' | 'week' | 'month'): string {
  if (g === 'day') return day;
  if (g === 'month') return day.slice(0, 7);
  // ISO-ish week bucket: snap back to Monday.
  const d = new Date(day + 'T00:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - dow * 864e5).toISOString().slice(0, 10);
}

interface FactRow {
  brand: string | null; branch_id: number | null; branch_name: string | null; city: string | null;
  day: string; reviews: any; with_text: any; scored: any; avg_sentiment: any; avg_rating: any;
  stars_1: any; stars_2: any; stars_3: any; stars_4: any; stars_5: any;
  negative: any; neutral: any; positive: any; replied: any;
  negative_unanswered: any; reply_hours_sum: any; reply_hours_n: any;
}

/** Weighted mean of a per-day average, weighted by that day's review count. */
function weightedMean(rows: FactRow[], valueKey: keyof FactRow, weightKey: keyof FactRow): number | null {
  let sum = 0, w = 0;
  for (const row of rows) {
    const v = row[valueKey], weight = n(row[weightKey]);
    if (v == null || weight <= 0) continue;
    sum += Number(v) * weight; w += weight;
  }
  return w > 0 ? r1(sum / w) : null;
}

/* ────────────── the build ────────────── */

export async function buildDashboardFacts(
  cdb: any,
  opts: {
    from: string; to: string; brand?: string | null;
    /** The client's own targets and weights; defaults when omitted. */
    settings?: DashboardSettings;
  },
): Promise<DashboardFacts> {
  const settings = opts.settings ?? resolveSettings(null);
  const { targets, weights } = settings;
  const { from, to } = opts;
  const brand = opts.brand || null;
  const days = daysBetween(from, to);

  // The comparison period is the same length, ending the day before this one.
  const prevTo = shiftDays(from, -1);
  const prevFrom = shiftDays(prevTo, -(days - 1));

  // Both periods in one round trip; the fact view is already aggregated per
  // (branch, day), so this stays small even over years.
  let factQ = cdb.from('review_daily_facts').select('*').gte('day', prevFrom).lte('day', to);
  if (brand) factQ = factQ.eq('brand', brand);

  let topicQ = cdb.from('review_topic_rows').select('topic, day, sentiment_score, branch_name')
    .gte('day', prevFrom).lte('day', to);
  if (brand) topicQ = topicQ.eq('brand', brand);

  let healthQ = cdb.from('branch_health').select('branch_id, branch_name, health_score, reviews');
  if (brand) healthQ = healthQ.eq('brand', brand);

  // Street address and place id: the only fields that separate two branches
  // sharing a city name.
  const metaQ = cdb.from('branches')
    .select('id, store_name, address, place_id')
    .eq('is_target', true);

  // Counted schema-wide, not for the period: it decides whether a
  // period-on-period comparison of subjects can be trusted at all.
  const unsortedQ = cdb.from('reviews')
    .select('id', { count: 'exact', head: true })
    .is('topics', null).not('text', 'is', null);

  const [factRes, topicRes, healthRes, unsortedRes, metaRes] = await Promise.all([
    factQ.limit(50000), topicQ.limit(80000), healthQ, unsortedQ, metaQ,
  ]);
  if (factRes.error) throw new Error('DASHBOARD_SCHEMA_MISSING');

  const all: FactRow[] = factRes.data || [];
  const cur = all.filter(f => f.day >= from && f.day <= to);
  const prev = all.filter(f => f.day >= prevFrom && f.day <= prevTo);

  const topicsAll: any[] = topicRes.error ? [] : (topicRes.data || []);
  const topicsCur = topicsAll.filter(t => t.day >= from && t.day <= to);
  const topicsPrev = topicsAll.filter(t => t.day >= prevFrom && t.day <= prevTo);

  /** place_id is the stable way to open one exact location, not a name search. */
  const mapsUrlFor = (m: any): string | null => {
    if (m?.place_id) return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(m.place_id)}`;
    const query = [m?.store_name, m?.address].filter(Boolean).join(' ');
    return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
  };

  const metaByBranch = new Map<string, any>();
  for (const m of (metaRes.error ? [] : metaRes.data || [])) metaByBranch.set(String(m.id), m);

  const healthByBranch = new Map<number, number>();
  for (const h of (healthRes.error ? [] : healthRes.data || [])) {
    if (h.branch_id != null) healthByBranch.set(Number(h.branch_id), Number(h.health_score));
  }

  const total = (rows: FactRow[], k: keyof FactRow) => rows.reduce((s, r) => s + n(r[k]), 0);

  /* ── coverage ── */
  const reviews = total(cur, 'reviews');
  const withText = total(cur, 'with_text');
  const scored = total(cur, 'scored');
  const classified = new Set(topicsCur.map(t => t.topic)).size > 0 ? topicsCur.length : 0;

  /* ── KPIs ── */
  const sentiment     = weightedMean(cur, 'avg_sentiment', 'scored');
  const prevSentiment = weightedMean(prev, 'avg_sentiment', 'scored');
  const rating        = weightedMean(cur, 'avg_rating', 'reviews');
  const prevRating    = weightedMean(prev, 'avg_rating', 'reviews');

  const replied      = total(cur, 'replied');
  const prevReplied  = total(prev, 'replied');
  const prevReviews  = total(prev, 'reviews');
  const replyRate     = pct(replied, reviews);

  /**
   * A fair previous-period reply rate.
   *
   * Straight period-on-period comparison is rigged: a review from three months
   * ago has had three months to be answered, one from yesterday has had a day.
   * That is why this client's figures read 27.7% a year ago, 99.0% last period
   * and 68.1% now — the middle number is not an achievement, it is age. Both
   * periods are therefore cut at the same maturity: only reviews that have had
   * at least MATURITY_DAYS to receive a reply count towards the comparison.
   */
  const MATURITY_DAYS = 7;
  const matureCutoff = shiftDays(to, -MATURITY_DAYS);
  const prevMatureCutoff = shiftDays(prevTo, -MATURITY_DAYS);
  const curMature  = cur.filter(f => f.day <= matureCutoff);
  const prevMature = prev.filter(f => f.day <= prevMatureCutoff);
  const curMatureReviews  = total(curMature, 'reviews');
  const prevMatureReviews = total(prevMature, 'reviews');
  const matureRate     = curMatureReviews > 0 ? pct(total(curMature, 'replied'), curMatureReviews) : null;
  const prevReplyRate  = prevMatureReviews > 0 && matureRate != null
    ? pct(total(prevMature, 'replied'), prevMatureReviews)
    : null;

  const replyHoursSum  = total(cur, 'reply_hours_sum');
  const replyHoursN    = total(cur, 'reply_hours_n');
  const avgReplyHours  = replyHoursN > 0 ? r1(replyHoursSum / replyHoursN) : null;
  const prevHoursN     = total(prev, 'reply_hours_n');
  const prevReplyHours = prevHoursN > 0 ? r1(total(prev, 'reply_hours_sum') / prevHoursN) : null;

  const negative     = total(cur, 'negative');
  const neutral      = total(cur, 'neutral');
  const positive     = total(cur, 'positive');
  const prevScored   = total(prev, 'scored');
  const negShare     = scored > 0 ? pct(negative, scored) : null;
  const prevNegShare = prevScored > 0 ? pct(total(prev, 'negative'), prevScored) : null;

  const diff = (a: number | null, b: number | null) => (a != null && b != null ? r1(a - b) : null);

  const kpis: Kpi[] = [
    {
      key: 'sentiment', label: 'Customer Sentiment',
      definition: 'How positive or negative customers sound in the words they write. Higher is better.',
      whyItMatters: 'Stars are a click; words are what people actually thought. This is the closest thing you have to how customers really felt.',
      source: `${nf(scored)} of ${nf(reviews)} reviews had words the AI could read; this is their average, weighted by how many arrived each day.`,
      value: sentiment, unit: '', target: targets.sentiment,
      previous: prevSentiment, change: diff(sentiment, prevSentiment),
      lowerIsBetter: false, status: statusFor(sentiment, targets.sentiment),
    },
    {
      key: 'rating', label: 'Star Rating',
      definition: 'The average number of stars customers gave you, out of 5.',
      whyItMatters: 'This is the number people see before they choose you. It decides whether a new customer walks in.',
      source: `The plain average of the stars on ${nf(reviews)} reviews.`,
      value: rating, unit: '★', target: targets.rating,
      previous: prevRating, change: diff(rating, prevRating),
      lowerIsBetter: false, status: statusFor(rating, targets.rating),
    },
    {
      key: 'negativeShare', label: 'Unhappy Customers',
      definition: 'Out of every 100 reviews we could read, how many sound unhappy. Lower is better.',
      whyItMatters: 'Every unhappy review is a customer who may not come back, and one that others read before deciding.',
      source: `${nf(negative)} of the ${nf(scored)} reviews the AI read scored 40 or below out of 100.`,
      value: negShare, unit: '%', target: targets.negativeShare,
      previous: prevNegShare, change: diff(negShare, prevNegShare),
      lowerIsBetter: true, status: statusFor(negShare, targets.negativeShare, true),
    },
    {
      key: 'replyRate', label: 'Reviews Responded',
      definition: 'Out of every 100 reviews, how many you replied to. Higher is better.',
      whyItMatters: 'An answered complaint often gets edited or withdrawn. An ignored one stays on your page for good.',
      source: `${nf(replied)} of ${nf(reviews)} reviews have a reply. The change ignores the last ${MATURITY_DAYS} days on both sides, because a review from yesterday has not had time to be answered.`,
      value: replyRate, unit: '%', target: targets.replyRate,
      previous: prevReplyRate,
      // Both sides of this subtraction exclude the last week, so it measures a
      // change in behaviour rather than the age of the reviews.
      change: diff(matureRate, prevReplyRate),
      lowerIsBetter: false, status: statusFor(replyRate, targets.replyRate),
    },
    {
      key: 'replyHours', label: 'Response Time',
      definition: 'How long you take to reply to a review, on average. Lower is better.',
      whyItMatters: 'A reply within a day still feels like service. A reply after a week reads as an excuse.',
      source: `Average gap between a review appearing and your reply, across ${nf(replyHoursN)} replies.`,
      value: avgReplyHours, unit: 'h', target: targets.replyHours,
      previous: prevReplyHours, change: diff(avgReplyHours, prevReplyHours),
      lowerIsBetter: true, status: statusFor(avgReplyHours, targets.replyHours, true),
    },
    {
      key: 'reviews', label: 'Reviews Received',
      definition: 'How many reviews customers left in this period.',
      whyItMatters: 'More reviews means a more reliable picture, and a busier listing on Google.',
      // No target: more reviews is not a goal to hit, and passing last
      // period's count off as one made the advisor write "1,396 reviews
      // against 738 target", which was never a target at all.
      source: `Counted from ${nf(cur.length)} branch-days of review activity.`,
      value: reviews, unit: '', target: 0,
      previous: prevReviews || null, change: prevReviews ? reviews - prevReviews : null,
      lowerIsBetter: false,
      // Volume is context, not a pass/fail measure, so it never reads critical.
      status: prevReviews > 0 && reviews < prevReviews * 0.7 ? 'attention' : 'good',
    },
  ];

  /* ── trend ── */
  const g = pickGranularity(days);
  const buckets = new Map<string, { reviews: number; sSum: number; sW: number; neg: number; scored: number }>();
  for (const f of cur) {
    const b = bucketOf(f.day, g);
    const e = buckets.get(b) || { reviews: 0, sSum: 0, sW: 0, neg: 0, scored: 0 };
    e.reviews += n(f.reviews);
    if (f.avg_sentiment != null && n(f.scored) > 0) { e.sSum += Number(f.avg_sentiment) * n(f.scored); e.sW += n(f.scored); }
    e.neg += n(f.negative);
    e.scored += n(f.scored);
    buckets.set(b, e);
  }
  const trend: TrendPoint[] = Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([bucket, e]) => ({
      bucket, reviews: e.reviews,
      avgSentiment: e.sW > 0 ? r1(e.sSum / e.sW) : null,
      negativeShare: e.scored > 0 ? pct(e.neg, e.scored) : null,
    }));

  /* ── per branch ── */
  const midpoint = shiftDays(from, Math.floor(days / 2));
  const byBranch = new Map<string, FactRow[]>();
  for (const f of cur) {
    const k = String(f.branch_id ?? f.branch_name ?? 'unknown');
    (byBranch.get(k) || byBranch.set(k, []).get(k)!).push(f);
  }

  // Most frequent subject among this branch's negative reviews.
  const complaintByBranch = new Map<string, string>();
  const complaintTally = new Map<string, Map<string, number>>();
  for (const t of topicsCur) {
    if (t.sentiment_score == null || Number(t.sentiment_score) > 40) continue;
    const name = String(t.branch_name || '');
    const tally = complaintTally.get(name) || new Map<string, number>();
    tally.set(t.topic, (tally.get(t.topic) || 0) + 1);
    complaintTally.set(name, tally);
  }
  for (const [name, tally] of complaintTally) {
    const top = Array.from(tally.entries()).sort((a, b) => b[1] - a[1])[0];
    if (top) complaintByBranch.set(name, top[0]);
  }

  /**
   * One branch's health, from the client's weights.
   *
   * Components are coalesced rather than dropped so a branch with no replies
   * scores zero on that part instead of vanishing from the ranking. Feeling
   * falls back to the rescaled stars when nothing has been read yet.
   */
  const healthFor = (c: {
    feeling: number | null; ratingScaled: number | null; replyRate: number;
  }): number | null => {
    if (c.feeling == null && c.ratingScaled == null) return null;
    // Feeling falls back to the rescaled stars when nothing has been read yet,
    // so a branch still ranks instead of vanishing.
    return r1(
        weights.feeling   * (c.feeling ?? c.ratingScaled ?? 0)
      + weights.replyRate * c.replyRate
    );
  };

  const branches: BranchRow[] = Array.from(byBranch.values()).map(rows => {
    const name = rows[0].branch_name || 'Unknown';
    const meta = rows[0].branch_id != null ? metaByBranch.get(String(rows[0].branch_id)) : null;
    const bReviews = total(rows, 'reviews');
    const bScored  = total(rows, 'scored');
    const bSent    = weightedMean(rows, 'avg_sentiment', 'scored');
    const bRating  = weightedMean(rows, 'avg_rating', 'reviews');
    const bNeg     = total(rows, 'negative');
    const firstHalf  = weightedMean(rows.filter(r => r.day < midpoint), 'avg_sentiment', 'scored');
    const secondHalf = weightedMean(rows.filter(r => r.day >= midpoint), 'avg_sentiment', 'scored');
    return {
      branchId: rows[0].branch_id, branchName: name, brand: rows[0].brand, city: rows[0].city,
      storeName: meta?.store_name ?? null,
      address: meta?.address ?? null,
      mapsUrl: meta ? mapsUrlFor(meta) : null,
      reviews: bReviews,
      avgSentiment: bSent,
      avgRating: bRating,
      ratingScaled: bRating != null ? r1(((bRating - 1) / 4) * 100) : null,
      replyRate: pct(total(rows, 'replied'), bReviews),
      negativeShare: bScored > 0 ? pct(bNeg, bScored) : null,
      healthScore: healthFor({
        feeling: bSent,
        ratingScaled: bRating != null ? ((bRating - 1) / 4) * 100 : null,
        replyRate: pct(total(rows, 'replied'), bReviews),
      }),
      trendDelta: diff(secondHalf, firstHalf),
      topComplaint: complaintByBranch.get(name) ?? null,
      // Same fallback for the verdict, so a branch is not marked "needs
      // attention" merely because its words have not been read.
      status: bSent != null
        ? statusFor(bSent, targets.sentiment)
        : statusFor(bRating, targets.rating),
      // Ranked on stars when nothing has been read for feeling yet. A brand-new
      // client has reviews, stars and reply rates but no AI key, and refusing
      // to rank left both branch tables empty on the one screen that was
      // supposed to tell them where to start.
      rankable: bReviews >= MIN_REVIEWS_FOR_RANKING && (bSent != null || bRating != null),
    };
  }).sort((a, b) =>
    (b.avgSentiment ?? b.ratingScaled ?? -1) - (a.avgSentiment ?? a.ratingScaled ?? -1));

  /* ── topics ── */
  const tally = (rows: any[]) => {
    const m = new Map<string, { reviews: number; neg: number; scored: number }>();
    for (const t of rows) {
      const e = m.get(t.topic) || { reviews: 0, neg: 0, scored: 0 };
      e.reviews++;
      if (t.sentiment_score != null) { e.scored++; if (Number(t.sentiment_score) <= 40) e.neg++; }
      m.set(t.topic, e);
    }
    return m;
  };
  const curTopics = tally(topicsCur);
  const prevTopics = tally(topicsPrev);
  const topicTotal = Array.from(curTopics.values()).reduce((s, e) => s + e.reviews, 0);

  const topics: TopicRow[] = Array.from(curTopics.entries()).map(([topic, e]) => {
    const before = prevTopics.get(topic)?.reviews ?? 0;
    const negativeShare = e.scored > 0 ? pct(e.neg, e.scored) : null;
    return {
      topic, reviews: e.reviews, sharePct: pct(e.reviews, topicTotal),
      previousReviews: before,
      changePct: before > 0 ? r1(((e.reviews - before) / before) * 100) : null,
      negativeShare,
      // Severity blends how loud a subject is with how badly it reads: a subject
      // that is 5% of comments but almost all complaints still deserves the top
      // of the list.
      severity: (negativeShare == null ? 'attention'
        : negativeShare >= 50 || (negativeShare >= 30 && e.reviews >= topicTotal * 0.15) ? 'critical'
        : negativeShare >= 20 ? 'attention' : 'good') as Status,
    };
  }).sort((a, b) => (b.negativeShare ?? 0) * b.reviews - (a.negativeShare ?? 0) * a.reviews);

  /* ── benchmark ── */
  // Fall back to any scored branch only when nothing clears the bar, so a small
  // client still sees a best and worst rather than two blanks.
  const rankable = branches.filter(b => b.rankable);
  const ranked = (rankable.length >= 2 ? rankable : branches.filter(b => b.avgSentiment != null));
  const networkAverage = sentiment;

  /* ── what is going well, what is not, and what to do ── */

  const kpi = (k: string) => kpis.find(x => x.key === k);
  const goodNews: Finding[] = [];
  const problems: Finding[] = [];

  const improved = (k: Kpi) =>
    k.change != null && (k.lowerIsBetter ? k.change < -0.05 : k.change > 0.05);

  const part = (k: Kpi, kind: Finding['kind'], change: number | null = null): Finding => ({
    key: k.key, kind, label: k.label, value: k.value, target: k.target,
    unit: k.unit, change, lowerIsBetter: k.lowerIsBetter,
  });

  for (const k of kpis) {
    if (k.value == null || k.key === 'reviews') continue;
    // On target is good news whether or not it moved; off target is a problem
    // whether or not it improved. Direction is context, not the verdict —
    // "improving but still failing" is still failing.
    if (k.status === 'good') goodNews.push(part(k, 'onTarget'));
    else problems.push(part(k, 'offTarget'));

    if (improved(k) && k.status !== 'good') {
      goodNews.push(part(k, 'improving', Math.abs(k.change!)));
    }
  }

  const gapSize = sentiment != null && rating != null ? r1(((rating - 1) / 4) * 100 - sentiment) : null;
  if (gapSize != null && gapSize >= 4) {
    problems.push({
      key: 'gap', kind: 'starsGap', label: 'Star Rating',
      value: gapSize, target: null, unit: '', change: null, lowerIsBetter: false,
    });
  }

  const criticalBranches = branches.filter(b => b.rankable && b.status === 'critical').length;
  if (criticalBranches > 0) {
    problems.push({
      key: 'branches', kind: 'branchesCritical', label: 'Branches',
      value: criticalBranches, target: null, unit: '', change: null, lowerIsBetter: true,
    });
  }

  const suggestions: Suggestion[] = [];
  const unanswered = Math.max(0, reviews - replied);
  if (replyRate < targets.replyRate && unanswered > 0) {
    suggestions.push({
      key: 'reply',
      values: { waiting: unanswered, unhappyWaiting: total(cur, 'negative_unanswered') },
      drill: 'unanswered', priority: replyRate < targets.replyRate * 0.7 ? 'critical' : 'attention',
    });
  }
  if (negShare != null && negShare > targets.negativeShare) {
    suggestions.push({
      key: 'unhappy',
      values: { share: negShare, target: targets.negativeShare },
      drill: 'unhappy', priority: negShare > targets.negativeShare * 2 ? 'critical' : 'attention',
    });
  }
  const worstTopic = topics.find(x => x.severity === 'critical') || topics[0];
  if (worstTopic) {
    suggestions.push({
      key: 'topic',
      values: {
        topic: worstTopic.topic, mentions: worstTopic.reviews,
        complaintShare: worstTopic.negativeShare ?? '',
      },
      drill: 'topics', priority: worstTopic.severity,
    });
  }
  const worstBranch = [...branches].reverse().find(b => b.rankable && b.status !== 'good');
  if (worstBranch) {
    suggestions.push({
      key: 'branch',
      values: {
        branch: worstBranch.branchName,
        feeling: worstBranch.avgSentiment ?? '',
        complaint: worstBranch.topComplaint ?? '',
      },
      drill: 'branches', priority: worstBranch.status,
    });
  }

  const order: Status[] = ['critical', 'attention', 'good'];
  suggestions.sort((a, b) => order.indexOf(a.priority) - order.indexOf(b.priority));

  return {
    settings,
    goodNews: goodNews.slice(0, 4),
    problems: problems.slice(0, 4),
    suggestions: suggestions.slice(0, 4),
    period: { from, to, days },
    previousPeriod: { from: prevFrom, to: prevTo },
    granularity: g,
    coverage: {
      reviews, withText, scored,
      pending: Math.max(0, withText - scored),
      noText: Math.max(0, reviews - withText),
      topicsClassified: classified,
      topicsUnsorted: unsortedRes.error ? 0 : (unsortedRes.count || 0),
    },
    kpis,
    sentimentSplit: {
      positive, neutral, negative, scored,
      positivePct: pct(positive, scored), neutralPct: pct(neutral, scored), negativePct: pct(negative, scored),
      previousNegativePct: prevNegShare,
    },
    ratings: [1, 2, 3, 4, 5].map(star => {
      const key = `stars_${star}` as keyof FactRow;
      const c = total(cur, key), p = total(prev, key);
      return {
        star, reviews: c, pct: pct(c, reviews),
        previousPct: prevReviews > 0 ? pct(p, prevReviews) : null,
      };
    }),
    trend,
    branches,
    topics,
    response: {
      reviews, replied, unanswered: Math.max(0, reviews - replied), replyRate,
      avgReplyHours, negativeUnanswered: total(cur, 'negative_unanswered'),
    },
    starsVsWords: {
      feeling: sentiment,
      starsScaled: rating != null ? r1(((rating - 1) / 4) * 100) : null,
      gap: sentiment != null && rating != null ? r1(((rating - 1) / 4) * 100 - sentiment) : null,
      // Biggest overstatement first: those are the branches whose stars are
      // hiding a problem.
      worst: branches
        .filter(b => b.rankable && b.avgSentiment != null && b.ratingScaled != null)
        .map(b => ({
          name: b.branchName, feeling: b.avgSentiment!, starsScaled: b.ratingScaled!,
          gap: r1(b.ratingScaled! - b.avgSentiment!),
        }))
        .sort((a, b) => b.gap - a.gap)
        .slice(0, 5),
    },
    benchmark: {
      current: sentiment, target: targets.sentiment, previous: prevSentiment,
      networkAverage,
      best:  ranked.length ? { name: ranked[0].branchName, value: ranked[0].avgSentiment! } : null,
      worst: ranked.length ? { name: ranked[ranked.length - 1].branchName, value: ranked[ranked.length - 1].avgSentiment! } : null,
    },
  };
}
