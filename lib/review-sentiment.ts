/**
 * Per-review sentiment scoring, 0-100.
 *
 * Runs through lib/ai-provider, so a client's Claude key or OpenAI key both
 * work with no branching here.
 *
 * Why a score and not just the star rating: they disagree, and the disagreement
 * is the interesting part. A four-star review that reads as a complaint, or a
 * three-star one that is actually delighted, both vanish into a rating average.
 * The Branch Health module plots the two against each other precisely so that
 * gap is visible.
 *
 * Only the client's own reviews are scored — competitors' come from scraping and
 * carry no reply data, so they cannot take part in a health score anyway.
 */

import { aiComplete, parseJsonReply, AiKeyProblem } from './ai-provider';

export interface SentimentRunResult {
  scored: number;
  skipped: number;
  failedBatches: number;
  provider?: string;
  model?: string;
  keyProblem: AiKeyProblem | null;
}

const SYSTEM = `You score customer reviews for sentiment on a 0-100 scale.

Use every piece of information the review carries — the star rating, the comment
text, the specific positive and negative expressions in it, and the overall
context together. The score must reflect the sentiment as a whole, NOT a
conversion of the star rating.

  0-20    Very Negative
  21-40   Negative
  41-60   Neutral
  61-80   Positive
  81-100  Very Positive

The rating is one signal among several, and the text overrules it when they
disagree:

  - A 5-star review whose comment is negative must NOT score near 100. Score the
    complaint.
  - A 3-star review with a strongly positive comment scores on that comment, not
    on the middling rating.
  - A high rating with no comment sits where the rating alone suggests, since
    there is nothing else to read.
  - A review praising the product but condemning one member of staff, or the
    delivery, is mixed — not very negative — however few stars it carries.

Arabic reviews often include Google's English translation in the same text.
They are one review: read both halves together and score once.

Reply ONLY with a JSON array, one object per input review, in input order:
[{"id": <the id given>, "score": <integer 0-100>}]

No prose, no explanation, no percent signs. If a review has no scoreable
content at all, score it 50.`;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** One review to score. supabase-js hands back `any`, so name the shape here. */
interface ReviewRow {
  id: number;
  text: string;
  /** Passed to the model as one signal among several, never as the answer. */
  rating: number | null;
}

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
    .slice(0, 700)
    // Slicing at a fixed length can land between an emoji's two halves and
    // manufacture a new unpaired surrogate, so strip again after cutting.
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

/**
 * Score the unscored reviews of one job.
 *
 * Scoped to a job and skipping anything already scored, so a re-run costs only
 * what is new. Batches of 25 keeps each reply small enough to stay valid JSON.
 */
export async function scoreReviewsForJob(opts: {
  cdb: any;
  /**
   * Scope to one job, or null for every unscored review in the schema.
   *
   * A standalone review sync writes rows with no job attached, so a job filter
   * skips the entire corpus — which is exactly what happened here: 10,000 synced
   * reviews were passed over because the caller could only iterate job ids.
   */
  jobId: string | null;
  aiKey: string | null | undefined;
  batchSize?: number;
  maxReviews?: number;
  log?: (level: 'info' | 'warn', message: string) => Promise<void>;
}): Promise<SentimentRunResult> {
  const { cdb, jobId, aiKey } = opts;
  const batchSize = opts.batchSize ?? 25;
  const maxReviews = opts.maxReviews ?? 4000;
  const log = opts.log ?? (async () => {});

  const empty: SentimentRunResult = { scored: 0, skipped: 0, failedBatches: 0, keyProblem: null };

  // The client's own branches only.
  let query = cdb
    .from('reviews')
    .select('id, text, rating, branches!inner(is_target)')
    .eq('branches.is_target', true)
    .is('sentiment_score', null)
    .not('text', 'is', null)
    .order('id', { ascending: true })
    .limit(maxReviews);
  if (jobId) query = query.eq('job_id', jobId);
  const { data: rows, error } = await query;

  if (error) {
    // Column absent means this schema predates migration 010.
    await log('warn', `Sentiment scoring skipped: ${error.message}`);
    return empty;
  }

  // A review that is only "👍" or "☹️" still says something, and the model can
  // score it. The old three-character floor skipped them AND never marked them,
  // so they sat in the pending count forever and no amount of clicking cleared
  // them.
  const pending: ReviewRow[] = (rows || [])
    .filter((r: any) => String(r.text || '').trim().length >= 1)
    .map((r: any) => ({ id: Number(r.id), text: String(r.text), rating: r.rating ?? null }));

  if (pending.length === 0) return empty;

  const result: SentimentRunResult = { ...empty };
  await log('info', `Scoring sentiment for ${pending.length} review(s)`);

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const user = batch.map((r: ReviewRow) =>
      `id ${r.id}\nrating: ${r.rating ?? 'not given'} of 5\ncomment: "${clean(r.text).replace(/"/g, "'")}"`
    ).join('\n\n');

    let parsed: { id: number; score: number }[];
    try {
      const reply = await aiComplete({ key: aiKey, system: SYSTEM, user, maxTokens: 1500 });
      result.provider = reply.provider;
      result.model = reply.model;
      parsed = parseJsonReply<{ id: number; score: number }[]>(reply.text);
      if (!Array.isArray(parsed)) throw new Error('reply was not a JSON array');
    } catch (err: any) {
      if (err instanceof AiKeyProblem) {
        // No retry will help, and every remaining batch fails the same way.
        result.keyProblem = err;
        await log('warn', `Sentiment scoring stopped: ${err.message}`);
        return result;
      }
      result.failedBatches++;
      await log('warn', `Sentiment batch failed (${err?.message}) — those reviews stay unscored`);
      continue;
    }

    const byId = new Map<number, ReviewRow>(batch.map((r: ReviewRow) => [r.id, r] as [number, ReviewRow]));
    const updates: { id: number; score: number }[] = [];
    for (const item of parsed) {
      const id = Number(item?.id);
      if (!byId.has(id)) continue;
      const score = Math.round(Number(item?.score));
      // Guard the range rather than trusting the model — a stray 0-1 or 0-10
      // scale would quietly distort every health score built on top.
      if (!Number.isFinite(score) || score < 0 || score > 100) continue;
      updates.push({ id, score });
    }

    const model = result.model || null;
    const at = new Date().toISOString();
    for (const u of updates) {
      const { error: uErr } = await cdb
        .from('reviews')
        .update({ sentiment_score: u.score, sentiment_model: model, sentiment_at: at })
        .eq('id', u.id);
      if (uErr) { result.failedBatches++; break; }
      result.scored++;
    }
    result.skipped += batch.length - updates.length;

    await sleep(250);
  }

  return result;
}
