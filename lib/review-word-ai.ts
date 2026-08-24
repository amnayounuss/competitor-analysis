/**
 * AI review-word extraction, pipeline edition.
 *
 * Claude reads the client's own reviews and reports which words carry positive
 * and which carry negative sentiment, in context. Results feed the dashboard's
 * two word clouds via the `review_word_cloud_ai` view.
 *
 * Sentiment is judged from the TEXT, not from the star rating: a 5-star review
 * routinely contains one complaint, and rating-bucketing files that complaint as
 * praise. Judging in context also drops neutral nouns (place, branch, coffee)
 * that would otherwise dominate both clouds.
 *
 * Only the client's own branches are read (branches.is_target), which is exactly
 * the set fetched from the Business Profile API — competitor reviews come from
 * Apify and are excluded.
 *
 * `scripts/ai-review-words.mjs` is the standalone backfill counterpart for
 * reviews collected before this stage existed; it mirrors the prompt below.
 */

export interface WordExtractionResult {
  reviewsRead: number;
  positiveHits: number;
  negativeHits: number;
  failedBatches: number;
  /** Set when the client's Anthropic key itself is the problem. */
  keyProblem: KeyProblem | null;
}

export interface KeyProblem {
  kind: 'missing' | 'invalid' | 'no_credit' | 'rate_limited';
  message: string;
}

/** One review to label. supabase-js hands back `any`, so state the shape here. */
interface ReviewRow {
  id: number;
  text: string;
}

const SYSTEM = `You read customer reviews of a business and extract the words that carry sentiment.

For each review you are given, return the words the customer used that express a POSITIVE judgement and the words that express a NEGATIVE judgement.

Rules:
- Return words EXACTLY as they appear in the review, same script and spelling. Arabic reviews often include Google's English translation in the same text; take words from BOTH — they are both real customer voice.
- Extract only sentiment-bearing words or short 2-word phrases: qualities, judgements, praise, complaints ("excellent", "slow", "rude", "delicious", "overpriced", "ممتاز", "سيئة", "بطيء").
- Do NOT extract neutral nouns with no judgement attached: place, branch, employee, cashier, order, time, day, price, staff, مكان, فرع, موظف.
- Do NOT extract the business's own brand name, or people's names.
- Do NOT extract religious formulae (mashallah, praise be to God, ما شاء الله, الحمد لله).
- Judge by CONTEXT, not by the star rating. A positive review can contain a complaint and vice versa.
- Lowercase English words. Leave Arabic as-is.
- If a review carries no sentiment words at all, return empty arrays for it.
- Never invent words that are not in the review.

Output ONLY a raw JSON array inside a \`\`\`json\`\`\` code block, one object per input review, in input order:
[{"id": <the id given>, "positive": ["..."], "negative": ["..."]}, ...]`;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Strip Google Maps scaffolding so the model sees only customer prose. */
function clean(text: string): string {
  return String(text || '')
    .replace(/\(Translated by Google\)|\(Original\)/g, ' ')
    .replace(/…\s*More/g, ' ')
    .replace(/(Food|Service|Atmosphere|Order type|Price per person|Parking space|Parking options|Recommended dishes|Meal type|Dine in|Takeout|Delivery)\s*:?\s*\d*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

/**
 * Lowercase Latin, strip Arabic diacritics, unify ة/ه and alef variants so
 * "ممتازة" and "ممتازه" count as one word rather than two.
 */
function normalise(word: string): string {
  let w = String(word || '').trim().replace(/\s+/g, ' ');
  w = w.replace(/[ً-ْـ]/g, '');
  w = w.replace(/[أإآ]/g, 'ا');
  w = w.replace(/ى/g, 'ي');
  w = w.replace(/ة/g, 'ه');
  if (!/[؀-ۿ]/.test(w)) w = w.toLowerCase();
  return w.trim();
}

/** Keep only labels the review actually contains, and only cloud-friendly ones. */
function verify(words: unknown, haystack: string): string[] {
  const hay = normalise(haystack);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of Array.isArray(words) ? words : []) {
    const w = normalise(String(raw ?? ''));
    if (w.length < 3 || w.length > 24) continue;
    if (/\d/.test(w)) continue;
    if (w.split(' ').length > 2) continue;
    if (seen.has(w)) continue;
    if (!hay.includes(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/**
 * Turn an Anthropic failure into something the client can act on. A bad or
 * out-of-credit key is the client's to fix, so it must surface as guidance
 * rather than as a stack trace buried in the job log.
 */
export function classifyAnthropicError(status: number, body: string): KeyProblem | null {
  const b = (body || '').toLowerCase();
  if (status === 401 || status === 403 || b.includes('invalid x-api-key') || b.includes('authentication_error')) {
    return { kind: 'invalid', message: 'Your Claude API key was rejected. Add a new key in your settings and run the analysis again.' };
  }
  if (status === 400 && (b.includes('credit balance') || b.includes('insufficient'))) {
    return { kind: 'no_credit', message: 'Your Claude API key has no credit left. Top it up or add a new key, then run the analysis again.' };
  }
  if (status === 429 && b.includes('credit')) {
    return { kind: 'no_credit', message: 'Your Claude API key is out of credit. Top it up or add a new key, then run the analysis again.' };
  }
  return null;
}

async function callClaude(
  apiKey: string,
  model: string,
  batch: ReviewRow[],
  attempt = 1,
): Promise<{ parsed?: any[]; keyProblem?: KeyProblem; error?: string }> {
  const userContent = batch.map(r => `id ${r.id}: "${clean(r.text).replace(/"/g, "'")}"`).join('\n\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4096, system: SYSTEM, messages: [{ role: 'user', content: userContent }] }),
  });

  if (!res.ok) {
    const body = await res.text();
    const keyProblem = classifyAnthropicError(res.status, body);
    if (keyProblem) return { keyProblem };            // no point retrying a bad key
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(2000 * attempt);
      return callClaude(apiKey, model, batch, attempt + 1);
    }
    return { error: `Anthropic ${res.status}: ${body.slice(0, 200)}` };
  }

  const body = await res.json();
  const text = body.content?.[0]?.text || '';
  const m = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\[[\s\S]*\]/);
  if (!m) return { error: 'no JSON array in model reply' };
  try {
    const parsed = JSON.parse(m[1] || m[0]);
    if (!Array.isArray(parsed)) return { error: 'model reply was not a JSON array' };
    return { parsed };
  } catch (err: any) {
    return { error: 'unparseable model reply: ' + err.message };
  }
}

/**
 * Extract sentiment words for the reviews of one job.
 *
 * Scoped to the job rather than the whole schema so cost scales with the new
 * reviews of that run, and reviews already in review_ai_processed are skipped.
 */
export async function extractReviewWordsForJob(opts: {
  cdb: any;
  jobId: string;
  anthropicKey: string | null;
  batchSize?: number;
  maxReviews?: number;
  log?: (level: 'info' | 'warn' | 'error', message: string) => Promise<void>;
}): Promise<WordExtractionResult> {
  const { cdb, jobId, anthropicKey } = opts;
  const batchSize = opts.batchSize ?? 20;
  const maxReviews = opts.maxReviews ?? 4000;
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
  const log = opts.log ?? (async () => {});

  const empty: WordExtractionResult = { reviewsRead: 0, positiveHits: 0, negativeHits: 0, failedBatches: 0, keyProblem: null };

  if (!anthropicKey) {
    return { ...empty, keyProblem: { kind: 'missing', message: 'No Claude API key is set for your account, so the review word clouds were skipped. Add a key in your settings.' } };
  }

  // Client's own branches only.
  const { data: reviewRows, error: rErr } = await cdb
    .from('reviews')
    .select('id, text, branches!inner(is_target)')
    .eq('job_id', jobId)
    .eq('branches.is_target', true)
    .not('text', 'is', null)
    .order('id', { ascending: true })
    .limit(maxReviews);
  if (rErr) { await log('warn', `Word clouds: cannot read reviews (${rErr.message})`); return empty; }

  const candidates: ReviewRow[] = (reviewRows || [])
    .filter((r: any) => String(r.text || '').trim())
    .map((r: any) => ({ id: Number(r.id), text: String(r.text) }));
  if (candidates.length === 0) return empty;

  // Skip anything already labelled (a re-run of the same job).
  const { data: doneRows } = await cdb
    .from('review_ai_processed').select('review_id')
    .in('review_id', candidates.map(c => c.id));
  const done = new Set<number>((doneRows || []).map((d: any) => Number(d.review_id)));
  const pending: ReviewRow[] = candidates.filter(c => !done.has(c.id));
  if (pending.length === 0) return empty;

  await log('info', `Word clouds: reading ${pending.length} review(s) with Claude`);

  const result: WordExtractionResult = { ...empty };

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const { parsed, keyProblem, error } = await callClaude(anthropicKey, model, batch);

    if (keyProblem) {
      // Stop immediately — every remaining batch would fail the same way.
      result.keyProblem = keyProblem;
      await log('warn', `Word clouds stopped: ${keyProblem.message}`);
      return result;
    }
    if (error || !parsed) {
      result.failedBatches++;
      await log('warn', `Word clouds: batch failed (${error}) — those reviews stay unlabelled`);
      continue;
    }

    const byId = new Map<number, ReviewRow>(batch.map(r => [r.id, r] as [number, ReviewRow]));
    const wordRows: any[] = [];
    const processedRows: any[] = [];

    for (const item of parsed as any[]) {
      const review = byId.get(Number(item?.id));
      if (!review) continue;
      const pos = verify(item.positive, review.text);
      const neg = verify(item.negative, review.text);
      for (const w of pos) wordRows.push({ review_id: review.id, word: w, sentiment: 'positive' });
      for (const w of neg) wordRows.push({ review_id: review.id, word: w, sentiment: 'negative' });
      processedRows.push({ review_id: review.id, word_count: pos.length + neg.length });
      result.positiveHits += pos.length;
      result.negativeHits += neg.length;
    }
    // Reviews the model skipped still count as read, or they get re-sent forever.
    for (const r of batch) {
      if (!processedRows.some(p => p.review_id === r.id)) processedRows.push({ review_id: r.id, word_count: 0 });
    }

    if (wordRows.length > 0) {
      const { error: wErr } = await cdb.from('review_ai_words')
        .upsert(wordRows, { onConflict: 'review_id,word,sentiment', ignoreDuplicates: true });
      if (wErr) { result.failedBatches++; await log('warn', `Word clouds: insert failed (${wErr.message})`); continue; }
    }
    const { error: pErr } = await cdb.from('review_ai_processed').upsert(processedRows, { onConflict: 'review_id' });
    if (pErr) { result.failedBatches++; await log('warn', `Word clouds: bookkeeping failed (${pErr.message})`); continue; }

    result.reviewsRead += processedRows.length;
    await sleep(300);
  }

  return result;
}
