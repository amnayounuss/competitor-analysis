/**
 * backfill-sentiment.ts
 *
 * Scores the review text of existing clients, whose reviews were collected
 * before per-review sentiment existed.
 *
 * Each client is scored with THEIR OWN key, so the cost lands on the account it
 * belongs to. A client without a key is reported and skipped rather than
 * quietly billed to someone else.
 *
 * Idempotent: only rows with sentiment_score IS NULL are sent, so re-running
 * picks up where a previous run stopped.
 *
 *   npx tsx scripts/backfill-sentiment.ts                    # every client
 *   npx tsx scripts/backfill-sentiment.ts client_1a36f301    # one schema
 *   npx tsx scripts/backfill-sentiment.ts --limit 100        # trial slice
 */

import 'dotenv/config';
import { adminClient } from '../lib/supabase';
import { clientDbClient, getClientAiKey, getClientDbCreds } from '../lib/client-db';
import { scoreReviewsForJob } from '../lib/review-sentiment';
import { describeKey } from '../lib/ai-provider';

const args  = process.argv.slice(2);
const only  = args.filter(a => a.startsWith('client_'));
const li    = args.indexOf('--limit');
const limit = li > -1 ? parseInt(args[li + 1], 10) : Infinity;

async function main() {
  const sb = adminClient();
  const { data: clients } = await sb
    .from('client_databases')
    .select('user_id, schema_name')
    .not('schema_name', 'is', null);

  const targets = (clients || []).filter(c => only.length === 0 || only.includes(c.schema_name));
  if (targets.length === 0) { console.error('No matching client schemas.'); process.exit(1); }

  let totalScored = 0;
  const skipped: string[] = [];

  for (const c of targets) {
    const key = await getClientAiKey(c.user_id);
    const info = describeKey(key);
    if (!info) {
      console.log(`\n${c.schema_name}  — no AI key on this client, skipped`);
      skipped.push(c.schema_name);
      continue;
    }

    const cdb = clientDbClient(await getClientDbCreds(c.user_id));

    // Score the whole schema in one pass rather than iterating job ids.
    // Reviews from a standalone sync carry no job_id, and grouping by job
    // silently skipped every one of them.
    const { count } = await cdb
      .from('reviews')
      .select('id', { count: 'exact', head: true })
      .is('sentiment_score', null)
      .not('text', 'is', null);

    console.log(`\n${c.schema_name}  via ${info.provider} (${info.model})  ·  ${count ?? '?'} unscored review(s)`);

    let scoredHere = 0;
    // Each call is capped, so loop until it stops making progress.
    for (;;) {
      if (scoredHere >= limit) break;
      const r = await scoreReviewsForJob({
        cdb, jobId: null, aiKey: key,
        maxReviews: Number.isFinite(limit) ? Math.max(0, limit - scoredHere) : 2000,
        log: async (level, m) => console.log(`   [${level}] ${m}`),
      });
      if (r.keyProblem) {
        console.log(`   stopped — ${r.keyProblem.message}`);
        skipped.push(`${c.schema_name} (${r.keyProblem.kind})`);
        break;
      }
      if (r.failedBatches > 0) console.log(`   ${r.failedBatches} batch(es) failed, will retry next run`);
      if (r.scored === 0) break;
      scoredHere += r.scored;
      console.log(`   ${scoredHere} scored so far`);
    }
    console.log(`   → ${scoredHere} scored`);
    totalScored += scoredHere;
  }

  console.log(`\n${totalScored} review(s) scored in total.`);
  if (skipped.length) {
    console.log(`Skipped (need an AI key): ${skipped.join(', ')}`);
  }
  process.exit(0);
}

main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
