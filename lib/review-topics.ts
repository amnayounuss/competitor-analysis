/**
 * What each review is actually about.
 *
 * The health score says a branch is struggling; it cannot say why. "Food Quality
 * is up 40% in complaints at three branches" is the sentence a manager can act
 * on, and it needs the reviews sorted into subjects first.
 *
 * A review gets every topic it genuinely raises. "Cold food and the waiter was
 * rude" is two complaints, and forcing it into one column would discard half of
 * every mixed comment — which is most of the useful ones.
 *
 * Runs through lib/ai-provider, so a client's Claude or OpenAI key both work.
 */

import { aiComplete, parseJsonReply, AiKeyProblem } from './ai-provider';

/** The fixed set. A closed list keeps the charts comparable across periods. */
export const TOPICS = [
  'Food Quality',
  'Service',
  'Waiting Time',
  'Cleanliness',
  'Pricing',
  'Staff',
  'Delivery',
  'Other',
] as const;

export type Topic = typeof TOPICS[number];

const ALLOWED = new Set<string>(TOPICS);

export interface TopicRunResult {
  classified: number;
  skipped: number;
  failedBatches: number;
  provider?: string;
  model?: string;
  keyProblem: AiKeyProblem | null;
}

const SYSTEM = `You sort customer reviews of restaurants into subjects.

Return every subject the review genuinely raises — praise or complaint, both
count. A comment that mentions two things gets two subjects. Do not infer a
subject the customer did not actually mention.

The only permitted subjects, spelled exactly like this:

  Food Quality   the food or drink itself: taste, temperature, freshness,
                 portion size, being wrong or missing from the order
  Service        how the visit was handled: order accuracy, attentiveness,
                 the process, getting the bill, handling of a problem
  Waiting Time   how long anything took: queue, seating, food arriving, delivery
                 being late
  Cleanliness    the state of the place: tables, floors, toilets, utensils, pests
  Pricing        cost, value for money, feeling overcharged, a billing error
  Staff          a specific person's conduct: rude, friendly, helpful, unhelpful
  Delivery       an order that arrived by courier or app, and how it arrived
  Other          anything real but outside the list: parking, music, decor,
                 location, opening hours

Service vs Staff: Service is the process, Staff is a person. "Order took an hour
and nobody checked on us" is Service and Waiting Time. "The waiter Ahmed was
lovely" is Staff.

Arabic reviews often carry Google's English translation in the same text. They
are one review — read both halves and answer once.

Reply ONLY with a JSON array, one object per input review, in input order:
[{"id": <the id given>, "topics": ["Food Quality", "Staff"]}]

One to three subjects each. No prose. If the comment carries no real subject —
"good", a bare emoji, gibberish — return an empty array for it.`;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Strip the Maps scaffolding so the model reads customer prose only. */
function clean(text: string): string {
  return String(text || '')
    // A half-written emoji leaves an unpaired surrogate, which cannot be encoded
    // as JSON — the provider rejected the whole batch with "no low surrogate in
    // string" and thirty reviews were lost to one broken character.
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .replace(/\(Translated by Google\)|\(Original\)/g, ' ')
    .replace(/…\s*More/g, ' ')
    .replace(/(Food|Service|Atmosphere|Order type|Price per person|Recommended dishes|Meal type|Dine in|Takeout|Delivery)\s*:?\s*\d*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600)
    // Slicing at a fixed length can land between an emoji's two halves and
    // manufacture a new unpaired surrogate, so strip again after cutting.
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

/**
 * Classify the reviews that have no topics yet.
 *
 * Skips anything already done, so a re-run costs only what is new. Batches of 30
 * keeps each reply small enough to come back as valid JSON.
 */
export async function classifyReviewTopics(opts: {
  cdb: any;
  aiKey: string | null | undefined;
  batchSize?: number;
  maxReviews?: number;
  log?: (level: 'info' | 'warn', message: string) => Promise<void>;
}): Promise<TopicRunResult> {
  const { cdb, aiKey } = opts;
  const batchSize = opts.batchSize ?? 30;
  const maxReviews = opts.maxReviews ?? 4000;
  const log = opts.log ?? (async () => {});

  const empty: TopicRunResult = { classified: 0, skipped: 0, failedBatches: 0, keyProblem: null };

  const { data: rows, error } = await cdb
    .from('reviews')
    .select('id, text, rating, branches!inner(is_target)')
    .eq('branches.is_target', true)
    .is('topics', null)
    .not('text', 'is', null)
    .order('id', { ascending: true })
    .limit(maxReviews);

  if (error) {
    // Column absent means this schema predates migration 012.
    await log('warn', `Topic classification skipped: ${error.message}`);
    return empty;
  }

  interface Pending { id: number; text: string }
  // Kept at one character for the same reason as sentiment: an emoji has no
  // subject, but it has to be *asked* about so that an empty answer gets stored
  // and the review stops being counted as waiting.
  const pending: Pending[] = (rows || [])
    .filter((r: any) => String(r.text || '').trim().length >= 1)
    .map((r: any) => ({ id: Number(r.id), text: String(r.text) }));

  if (pending.length === 0) return empty;

  const result: TopicRunResult = { ...empty };
  await log('info', `Sorting ${pending.length} review(s) into subjects`);

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const user = batch
      .map((r: Pending) => `id ${r.id}\ncomment: "${clean(r.text).replace(/"/g, "'")}"`)
      .join('\n\n');

    let parsed: { id: number; topics: string[] }[];
    try {
      const reply = await aiComplete({ key: aiKey, system: SYSTEM, user, maxTokens: 2000 });
      result.provider = reply.provider;
      result.model = reply.model;
      parsed = parseJsonReply<{ id: number; topics: string[] }[]>(reply.text);
      if (!Array.isArray(parsed)) throw new Error('reply was not a JSON array');
    } catch (err: any) {
      if (err instanceof AiKeyProblem) {
        // No retry helps, and every remaining batch fails identically.
        result.keyProblem = err;
        await log('warn', `Topic classification stopped: ${err.message}`);
        return result;
      }
      result.failedBatches++;
      await log('warn', `Topic batch failed (${err?.message}) — those reviews stay unsorted`);
      continue;
    }

    const ids = new Set(batch.map((r: Pending) => r.id));
    const model = result.model || null;
    const at = new Date().toISOString();

    for (const item of parsed) {
      const id = Number(item?.id);
      if (!ids.has(id)) continue;

      // Keep only names from the fixed list; a model-invented subject would
      // split a topic in two and quietly break period-on-period comparison.
      const topics = Array.from(new Set(
        (Array.isArray(item?.topics) ? item.topics : [])
          .map(x => String(x || '').trim())
          .filter(x => ALLOWED.has(x))
      )).slice(0, 3);

      // An empty array is a real answer ("no subject"), and storing it stops
      // the review coming back on the next run.
      const { error: uErr } = await cdb
        .from('reviews')
        .update({ topics, topic_model: model, topic_at: at })
        .eq('id', id);
      if (uErr) { result.failedBatches++; break; }
      result.classified++;
    }

    result.skipped += batch.length - parsed.length;
    await sleep(250);
  }

  return result;
}

/* ────────────── running it in the background ────────────── */

/**
 * Sorting a full corpus is hundreds of model calls and minutes of work, so it
 * never happens inside a request — a browser connection held open that long is
 * exactly what produced "NetworkError" on the performance sync. The page starts
 * a run and then polls for its state.
 *
 * State lives in this process only. A restart mid-run loses the progress
 * reading, not the work: classified reviews are already saved, and the next run
 * picks up whatever is still unsorted.
 */
export interface TopicRunState {
  running: boolean;
  startedAt: string;
  finishedAt: string | null;
  classified: number;
  total: number;
  error: string | null;
}

const runs = new Map<string, TopicRunState>();

export function getTopicRunState(userId: string): TopicRunState | null {
  return runs.get(userId) ?? null;
}

export function startTopicClassification(opts: {
  userId: string;
  cdb: any;
  aiKey: string | null | undefined;
  total: number;
}): TopicRunState {
  const existing = runs.get(opts.userId);
  if (existing?.running) return existing;

  const state: TopicRunState = {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    classified: 0,
    total: opts.total,
    error: null,
  };
  runs.set(opts.userId, state);

  void classifyReviewTopics({
    cdb: opts.cdb,
    aiKey: opts.aiKey,
    log: async (_l, m) => { console.log('[topics]', m); },
  })
    .then(r => {
      state.classified = r.classified;
      if (r.keyProblem) state.error = r.keyProblem.message;
      else if (r.classified === 0 && r.failedBatches > 0) state.error = 'Could not sort the reviews. Try again.';
    })
    .catch((err: any) => { state.error = err?.message || 'Sorting the reviews failed.'; })
    .finally(() => { state.running = false; state.finishedAt = new Date().toISOString(); });

  return state;
}
