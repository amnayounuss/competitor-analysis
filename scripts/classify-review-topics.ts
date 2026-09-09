/**
 * Sort every unsorted review into complaint subjects, for one client or all.
 *
 *   npx tsx scripts/classify-review-topics.ts                 every client
 *   npx tsx scripts/classify-review-topics.ts codeco@wags.sa  just one
 *
 * Safe to re-run: it only touches reviews that have no subjects yet, so an
 * interrupted run resumes where it stopped and costs nothing for work already
 * done. Uses each client's own AI key, falling back to the platform key.
 */

import { config } from 'dotenv';
config({ path: '.env' });

(async () => {
  const { adminClient } = await import('../lib/supabase');
  const { clientDbClient, getClientDbCreds, getClientAiKey } = await import('../lib/client-db');
  const { classifyReviewTopics } = await import('../lib/review-topics');

  const only = process.argv[2] || null;
  const admin = adminClient();
  const { data: u } = await admin.auth.admin.listUsers();
  const { data: rows } = await admin.from('client_databases').select('user_id');

  for (const row of rows || []) {
    const email = u.users.find(x => x.id === row.user_id)?.email || row.user_id;
    if (only && email !== only) continue;

    const key = (await getClientAiKey(row.user_id)) || process.env.ANTHROPIC_API_KEY || null;
    if (!key) { console.log(`${email}: no AI key — skipped`); continue; }

    let cdb;
    try { cdb = clientDbClient(await getClientDbCreds(row.user_id)); }
    catch { console.log(`${email}: no client database — skipped`); continue; }

    console.log(`\n═══ ${email} ═══`);
    const r = await classifyReviewTopics({
      cdb, aiKey: key,
      log: async (_lvl, m) => console.log('   ' + m),
    });
    console.log(`   sorted ${r.classified}, skipped ${r.skipped}, failed batches ${r.failedBatches}`
      + (r.keyProblem ? ` — STOPPED: ${r.keyProblem.message}` : ''));
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
