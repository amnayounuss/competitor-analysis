/**
 * ai-review-words.mjs
 *
 * Has Claude read the client's own Google Business Profile reviews and report,
 * per review, which words carry POSITIVE sentiment and which carry NEGATIVE
 * sentiment. Results land in <schema>.review_ai_words and drive the dashboard
 * word clouds via the review_word_cloud_ai view.
 *
 * Only the client's own branches are read (branches.is_target = true) — that is
 * exactly the GMB-sourced set; competitor reviews come from Apify and are
 * excluded.
 *
 * Incremental by design: reviews already listed in review_ai_processed are
 * skipped, so re-running after a new analysis job only costs the new reviews.
 * Safe to interrupt and re-run — each batch is committed before the next starts.
 *
 * Usage:
 *   node scripts/ai-review-words.mjs <schema> [--limit N] [--batch N] [--redo]
 *
 * Examples:
 *   node scripts/ai-review-words.mjs client_4ab678b7
 *   node scripts/ai-review-words.mjs client_4ab678b7 --limit 60   # dry-ish trial
 *   node scripts/ai-review-words.mjs client_4ab678b7 --redo       # relabel all
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SCHEMA = process.argv[2];
if (!SCHEMA || !/^client_[0-9a-f]{8}$/.test(SCHEMA)) {
  console.error('usage: node scripts/ai-review-words.mjs <client_xxxxxxxx> [--limit N] [--batch N] [--redo]');
  process.exit(1);
}

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? parseInt(process.argv[i + 1], 10) : dflt;
};
const LIMIT = argOf('--limit', Infinity);
const BATCH = argOf('--batch', 25);
const REDO  = process.argv.includes('--redo');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_KEY      = process.env.ANTHROPIC_API_KEY;
const MODEL        = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

for (const [k, v] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, ANTHROPIC_API_KEY: API_KEY })) {
  if (!v) { console.error(`missing env var ${k}`); process.exit(1); }
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: SCHEMA }, auth: { persistSession: false } });

const SYSTEM = `You read customer reviews of a coffee chain and extract the words that carry sentiment.

For each review you are given, return the words the customer used that express a POSITIVE judgement and the words that express a NEGATIVE judgement.

Rules:
- Return words EXACTLY as they appear in the review, same script and spelling. Arabic reviews often include Google's English translation in the same text; take words from BOTH — they are both real customer voice.
- Extract only sentiment-bearing words or short 2-word phrases: qualities, judgements, praise, complaints ("excellent", "slow", "rude", "delicious", "overpriced", "ممتاز", "سيئة", "بطيء").
- Do NOT extract neutral nouns with no judgement attached: place, branch, employee, cashier, coffee, order, time, day, price, staff, قهوة, مكان, فرع, موظف.
- Do NOT extract the brand name (Camel Step, خطوة الجمل) or people's names.
- Do NOT extract religious formulae (mashallah, praise be to God, ما شاء الله, الحمد لله).
- Judge by CONTEXT, not by the star rating. A positive review can contain a complaint and vice versa. "cold" is negative for served coffee but neutral in "cold brew".
- Lowercase English words. Leave Arabic as-is.
- If a review carries no sentiment words at all, return empty arrays for it.
- Never invent words that are not in the review.

Output ONLY a raw JSON array inside a \`\`\`json\`\`\` code block, one object per input review, in input order:
[{"id": <the id given>, "positive": ["..."], "negative": ["..."]}, ...]`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Strip Google Maps scaffolding so the model sees only customer prose. */
function clean(text) {
  return String(text || '')
    .replace(/\(Translated by Google\)|\(Original\)/g, ' ')
    .replace(/…\s*More/g, ' ')
    .replace(/(Food|Service|Atmosphere|Order type|Price per person|Parking space|Parking options|Recommended dishes|Meal type|Dine in|Takeout|Delivery)\s*:?\s*\d*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

async function callClaude(batch, attempt = 1) {
  const userContent = batch
    .map(r => `id ${r.id}: "${clean(r.text).replace(/"/g, "'")}"`)
    .join('\n\n');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (res.status === 429 || res.status >= 500) {
    if (attempt >= 4) throw new Error(`Anthropic ${res.status} after ${attempt} attempts`);
    const wait = 2000 * attempt;
    console.warn(`  ! HTTP ${res.status} — retrying in ${wait}ms`);
    await sleep(wait);
    return callClaude(batch, attempt + 1);
  }
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const body = await res.json();
  const text = body.content?.[0]?.text || '';
  const m = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\[[\s\S]*\]/);
  if (!m) throw new Error('no JSON array in model reply');
  const parsed = JSON.parse(m[1] || m[0]);
  if (!Array.isArray(parsed)) throw new Error('model reply was not a JSON array');
  return parsed;
}

/**
 * Normalise a label for storage: lowercase Latin, strip Arabic diacritics and
 * unify ة/ه plus alef variants so "ممتازة" and "ممتازه" count as one word.
 */
function normalise(word) {
  let w = String(word || '').trim().replace(/\s+/g, ' ');
  w = w.replace(/[\u064B-\u0652\u0640]/g, '');          // harakat + tatweel
  w = w.replace(/[\u0623\u0625\u0622]/g, '\u0627');    // أ إ آ → ا
  w = w.replace(/\u0649/g, '\u064A');                    // ى → ي
  w = w.replace(/\u0629/g, '\u0647');                    // ة → ه
  if (!/[\u0600-\u06FF]/.test(w)) w = w.toLowerCase();   // Latin-only → lowercase
  return w.trim();
}

/**
 * Keep only labels the review actually contains — guards against invention —
 * and only ones that read well in a cloud: at most two words, no digits.
 */
function verify(words, haystack) {
  const hay = normalise(haystack);
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(words) ? words : []) {
    const w = normalise(raw);
    if (w.length < 3 || w.length > 24) continue;
    if (/\d/.test(w)) continue;
    if (w.split(' ').length > 2) continue;   // long phrases crowd out real words
    if (seen.has(w)) continue;
    if (!hay.includes(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

async function fetchPending() {
  // Client's own branches only, newest first, keyset-paginated on the primary
  // key (never on a non-unique column — batch-written rows share timestamps).
  const rows = [];
  let last = 0;
  for (;;) {
    const { data, error } = await db
      .from('reviews')
      .select('id, text, branch_id, branches!inner(is_target)')
      .eq('branches.is_target', true)
      .not('text', 'is', null)
      .gt('id', last)
      .order('id', { ascending: true })
      .limit(1000);
    if (error) throw new Error('fetch reviews: ' + error.message);
    if (!data || data.length === 0) break;
    for (const r of data) if (String(r.text || '').trim()) rows.push({ id: r.id, text: r.text });
    last = data[data.length - 1].id;
    if (data.length < 1000) break;
  }

  if (REDO) return rows;

  const done = new Set();
  let lastDone = 0;
  for (;;) {
    const { data, error } = await db
      .from('review_ai_processed').select('review_id')
      .gt('review_id', lastDone).order('review_id', { ascending: true }).limit(1000);
    if (error) throw new Error('fetch processed: ' + error.message);
    if (!data || data.length === 0) break;
    for (const d of data) done.add(d.review_id);
    lastDone = data[data.length - 1].review_id;
    if (data.length < 1000) break;
  }
  return rows.filter(r => !done.has(r.id));
}

async function main() {
  console.log(`[ai-words] schema=${SCHEMA} model=${MODEL} batch=${BATCH}${REDO ? ' (redo)' : ''}`);

  const pending = (await fetchPending()).slice(0, LIMIT === Infinity ? undefined : LIMIT);
  if (pending.length === 0) { console.log('[ai-words] nothing to do — all reviews already labelled'); return; }
  console.log(`[ai-words] ${pending.length} review(s) to read`);

  let posTotal = 0, negTotal = 0, failedBatches = 0, reviewsDone = 0;

  for (let i = 0; i < pending.length; i += BATCH) {
    const batch = pending.slice(i, i + BATCH);
    const label = `${i + 1}-${Math.min(i + BATCH, pending.length)}/${pending.length}`;

    let parsed;
    try {
      parsed = await callClaude(batch);
    } catch (err) {
      // Leave the batch unprocessed so the next run retries it, rather than
      // marking it done and silently losing those reviews.
      failedBatches++;
      console.warn(`[ai-words] ${label} FAILED: ${err.message} — will retry on next run`);
      continue;
    }

    const byId = new Map(batch.map(r => [r.id, r]));
    const wordRows = [];
    const processedRows = [];

    for (const item of parsed) {
      const review = byId.get(Number(item?.id));
      if (!review) continue;
      const pos = verify(item.positive, review.text);
      const neg = verify(item.negative, review.text);
      for (const w of pos) wordRows.push({ review_id: review.id, word: w, sentiment: 'positive' });
      for (const w of neg) wordRows.push({ review_id: review.id, word: w, sentiment: 'negative' });
      processedRows.push({ review_id: review.id, word_count: pos.length + neg.length });
      posTotal += pos.length;
      negTotal += neg.length;
    }

    // Reviews the model skipped entirely still count as read — otherwise every
    // future run re-sends them forever.
    for (const r of batch) if (!processedRows.some(p => p.review_id === r.id)) {
      processedRows.push({ review_id: r.id, word_count: 0 });
    }

    if (REDO) {
      const ids = batch.map(r => r.id);
      const { error } = await db.from('review_ai_words').delete().in('review_id', ids);
      if (error) console.warn(`[ai-words] ${label} clear-old warning: ${error.message}`);
    }

    if (wordRows.length > 0) {
      const { error } = await db.from('review_ai_words')
        .upsert(wordRows, { onConflict: 'review_id,word,sentiment', ignoreDuplicates: true });
      if (error) { failedBatches++; console.warn(`[ai-words] ${label} insert words failed: ${error.message}`); continue; }
    }
    const { error: pErr } = await db.from('review_ai_processed')
      .upsert(processedRows, { onConflict: 'review_id' });
    if (pErr) { failedBatches++; console.warn(`[ai-words] ${label} mark-processed failed: ${pErr.message}`); continue; }

    reviewsDone += processedRows.length;
    console.log(`[ai-words] ${label} → +${wordRows.length} words (pos ${posTotal} / neg ${negTotal})`);
    await sleep(400);
  }

  console.log(`\n[ai-words] done — ${reviewsDone} reviews read, ${posTotal} positive + ${negTotal} negative word hits`);
  if (failedBatches > 0) {
    console.error(`[ai-words] ${failedBatches} batch(es) failed and were NOT marked processed — re-run to pick them up`);
    process.exit(1);
  }
}

main().catch(err => { console.error('[ai-words] fatal:', err.message); process.exit(1); });
