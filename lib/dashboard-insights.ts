/**
 * The written half of the advisor dashboard.
 *
 * Every chart gets a sentence, every problem gets an action, and the whole thing
 * is one model call so the sections agree with each other — asking separately
 * produced a summary that praised a branch the actions list told you to fix.
 *
 * The model receives ONLY the aggregates from lib/dashboard-advisor.ts, never
 * review text. Two reasons: a manager acting on "Food Quality complaints tripled
 * at three branches" needs that to be arithmetic on the corpus rather than an
 * impression from whichever twenty reviews fitted in the prompt; and the numbers
 * on screen and the numbers in the prose then come from the same place, so the
 * text cannot contradict the chart above it.
 *
 * The output is structured rather than prose so each section can render its own
 * explanation next to its own chart, which is the point — an essay at the top of
 * the page is what the old dashboard already did badly.
 */

import { aiComplete, parseJsonReply } from './ai-provider';
import type { DashboardFacts, Status } from './dashboard-advisor';

export interface Action {
  priority: 'critical' | 'high' | 'medium' | 'low';
  problem: string;
  evidence: string;
  branches: string[];
  action: string;
  expectedImpact: string;
}

export interface DashboardInsights {
  /** One sentence a manager could read aloud. */
  headline: string;
  /** At most two, one line each. */
  working: string[];
  attention: string[];
  /** One short line beside each chart that survived the cull. */
  charts: { trend: string; topics: string; branches: string };
  /** At most three. Anything longer stopped being a list and became a report. */
  actions: Action[];
  provider?: string;
  model?: string;
}

const SYSTEM = `You are the business advisor inside a restaurant review dashboard.
You are writing for a manager who has two minutes and does not read charts.

BREVITY IS THE POINT. An earlier version of you wrote so much that nobody read
any of it. Every field below is ONE sentence. Not two. No preamble, no
throat-clearing, no restating the question.

Each sentence must contain a real number from the data and, where something is
wrong, what to do about it.

Bad:  "Your score is 68.7 based on customer reviews."
Bad:  "There are several areas of concern across the portfolio that warrant
       attention, particularly in relation to response times, which appear to
       be lagging behind target."
Good: "Feeling is 68.7 against your 75 target, and five branches account for
       most of the gap."

Hard rules:

1. Use ONLY numbers from the JSON given. Never invent a figure, branch, subject,
   percentage or date.
1b. A measure whose target is null has NO target. Never describe such a number
   as being above, below, or against a target — say what it is, nothing more.
2. Name branches exactly as given; Arabic names stay in Arabic. Several branches
   share a city name, so add the store or street when you single one out.
3. No analytics jargon: no "sentiment distribution", "delta", "cohort", "KPI",
   "metric", "portfolio". Say "how customers feel", "compared with last month",
   "the gap".
4. No hedging. State what the numbers show.
5. When a complaint subject carries no previousReviews figure, the older period
   is not fully sorted — describe the current mix only, never a rise or fall.
6. At most three actions, most urgent first. Use "critical" only for something
   losing customers now.

Reply with ONLY this JSON:

{
  "headline": "how the business is doing right now, with the number that says so",
  "working": ["at most 2, one sentence each, each with its number"],
  "attention": ["at most 2, one sentence each, with the number and the branches"],
  "charts": {
    "trend": "what changed and whether it is improving",
    "topics": "which subject to fix first",
    "branches": "what separates the worst branches from the rest"
  },
  "actions": [
    {
      "priority": "critical|high|medium|low",
      "problem": "one sentence",
      "evidence": "the numbers behind it, one short clause",
      "branches": ["exact names, or empty"],
      "action": "what to do, one sentence",
      "expectedImpact": "one short clause"
    }
  ]
}`;

/**
 * Trim the facts to what the model needs.
 *
 * The full trend can be hundreds of points and the branch list dozens of rows;
 * sending all of it crowds out the reasoning and costs the client money. The
 * shape of the trend is carried by its ends and extremes, and advice is only
 * ever about the best and worst branches.
 */
function compact(f: DashboardFacts) {
  const subjectsComparable = f.coverage.topicsClassified > 0 && f.coverage.topicsUnsorted === 0;
  const trend = f.trend.filter(p => p.avgSentiment != null);
  const lowest  = trend.length ? trend.reduce((a, b) => (b.avgSentiment! < a.avgSentiment! ? b : a)) : null;
  const highest = trend.length ? trend.reduce((a, b) => (b.avgSentiment! > a.avgSentiment! ? b : a)) : null;

  const branch = (b: any) => ({
    name: b.branchName,
    // Several branches share a city name, so the store and street are what
    // make an instruction like "audit الخبر" actionable.
    store: b.storeName, address: b.address,
    brand: b.brand, city: b.city, reviews: b.reviews,
    feeling: b.avgSentiment, stars: b.avgRating, repliedPct: b.replyRate,
    unhappyPct: b.negativeShare, movedBy: b.trendDelta, mainComplaint: b.topComplaint,
    status: b.status,
  });

  return {
    period: f.period,
    comparedWith: f.previousPeriod,
    coverage: f.coverage,
    targets: Object.fromEntries(f.kpis.map(k => [k.key, k.target])),
    measures: f.kpis.map(k => ({
      name: k.label, key: k.key, value: k.value, unit: k.unit,
      // A zero target means there is no target for this measure. Volume used to
      // carry last period's count here and the advisor reported it as a goal.
      target: k.target > 0 ? k.target : null,
      lastPeriod: k.previous, change: k.change, lowerIsBetter: k.lowerIsBetter, status: k.status,
      howItIsMeasured: k.source,
    })),
    howCustomersFeel: f.sentimentSplit,
    stars: f.ratings,
    trendShape: {
      buckets: f.granularity,
      first: trend[0] ?? null,
      last: trend[trend.length - 1] ?? null,
      lowest, highest, points: trend.length,
    },
    branchCount: f.branches.length,
    // Only branches with enough reviews to rank; advising on a 4-review branch
    // sends the manager to the wrong place.
    bestBranches: f.branches.filter(b => b.rankable).slice(0, 5).map(branch),
    worstBranches: f.branches.filter(b => b.rankable).slice(-8).reverse().map(branch),
    branchesTooSmallToRank: f.branches.filter(b => !b.rankable).length,
    // Volume change per subject is only trustworthy once the whole corpus is
    // sorted; until then this period is filed and last period is not, which
    // reads as a huge rise that never happened. Telling the model to ignore the
    // figures was not enough — it quoted them anyway — so they are withheld.
    complaintSubjects: subjectsComparable
      ? f.topics
      : f.topics.map(({ previousReviews, changePct, ...keep }) => keep),
    subjectChangeIsComparable: subjectsComparable,
    replies: f.response,
    benchmark: f.benchmark,
    starsVersusWords: f.starsVsWords,
    // The client set these; never substitute a different standard.
    theirTargets: f.settings.targets,
    healthWeights: f.settings.weights,
  };
}

export async function generateDashboardInsights(
  key: string | null | undefined,
  facts: DashboardFacts,
): Promise<DashboardInsights> {
  const reply = await aiComplete({
    key,
    system: SYSTEM,
    user: JSON.stringify(compact(facts)),
    // 4000 truncated the reply mid-object at ~12,700 characters, and a cut-off
    // JSON object cannot be repaired — it surfaced as a raw SyntaxError.
    // The shape is small now, so this is headroom rather than a target.
    maxTokens: 3000,
  });

  let parsed: any;
  try {
    parsed = parseJsonReply<any>(reply.text);
  } catch {
    // "Came back cut short" is worth retrying; "came back as nonsense" is not,
    // and a raw SyntaxError told the user neither.
    const cutShort = !reply.text.trimEnd().endsWith('}');
    throw new Error(cutShort
      ? 'The advisor ran out of room before finishing. Try a shorter date range.'
      : 'The advisor reply could not be read. Try again.');
  }
  if (!parsed?.headline) throw new Error('The advisor reply was not usable. Try again.');

  const str = (v: any) => (typeof v === 'string' ? v.trim() : '');
  const list = (v: any, cap: number) =>
    (Array.isArray(v) ? v.map(str).filter(Boolean) : []).slice(0, cap);
  const priorities = new Set(['critical', 'high', 'medium', 'low']);

  // Caps are enforced here, not just requested in the prompt: a model that
  // ignores "at most two" should not be able to put six bullets on the page.
  return {
    headline: str(parsed.headline),
    working: list(parsed.working, 2),
    attention: list(parsed.attention, 2),
    charts: {
      trend: str(parsed.charts?.trend),
      topics: str(parsed.charts?.topics),
      branches: str(parsed.charts?.branches),
    },
    actions: (Array.isArray(parsed.actions) ? parsed.actions : [])
      .map((a: any) => ({
        priority: (priorities.has(String(a?.priority)) ? a.priority : 'medium') as Action['priority'],
        problem: str(a?.problem),
        evidence: str(a?.evidence),
        branches: list(a?.branches, 4),
        action: str(a?.action),
        expectedImpact: str(a?.expectedImpact),
      }))
      .filter((a: Action) => a.problem && a.action)
      .slice(0, 3),
    provider: reply.provider,
    model: reply.model,
  };
}

/* ────────────── running it in the background ────────────── */

/**
 * One advisory is a single large model call and takes 40-50 seconds.
 *
 * Holding the browser's request open that long produced "NetworkError when
 * attempting to fetch resource": something between the browser and this box
 * drops a connection that has sat silent for that long, so the work completed
 * server-side and the user saw a failure. This is the same fault the
 * performance sync had, and the same fix — the request returns at once and the
 * page polls.
 *
 * State lives in this process only. A restart mid-run loses it and the page
 * simply offers the button again.
 */
export interface InsightsRunState {
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  from: string;
  to: string;
  brand: string | null;
  insights: DashboardInsights | null;
  error: string | null;
}

const runs = new Map<string, InsightsRunState>();

export function getInsightsRun(userId: string): InsightsRunState | null {
  return runs.get(userId) ?? null;
}

export function startInsightsRun(opts: {
  userId: string;
  key: string | null | undefined;
  facts: DashboardFacts;
  brand: string | null;
}): InsightsRunState {
  const existing = runs.get(opts.userId);
  if (existing?.running) return existing;

  const state: InsightsRunState = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    from: opts.facts.period.from,
    to: opts.facts.period.to,
    brand: opts.brand,
    insights: null,
    error: null,
  };
  runs.set(opts.userId, state);

  void generateDashboardInsights(opts.key, opts.facts)
    .then(insights => { state.insights = insights; })
    .catch((err: any) => {
      state.error = err?.message || 'Could not write the advisory.';
      console.error('[advisor] run failed:', state.error);
    })
    .finally(() => { state.running = false; state.finishedAt = new Date().toISOString(); });

  return state;
}
