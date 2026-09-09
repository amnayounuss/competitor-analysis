/**
 * Fill branches.stars and branches.reviews_count from the reviews already stored.
 *
 * Only the analysis scrape ever set these, so a client whose reviews came from
 * the standalone sync showed a rating of zero on the Overview. Derived from the
 * review rows so the two can never disagree.
 *
 *   npx tsx scripts/backfill-branch-ratings.ts [email] [--dry-run]
 */

import { config } from 'dotenv';
config({ path: '.env' });

(async () => {
  const { adminClient } = await import('../lib/supabase');
  const { clientDbClient, getClientDbCreds } = await import('../lib/client-db');

  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const only = args.find(a => !a.startsWith('--')) || null;

  const admin = adminClient();
  const { data: users } = await admin.auth.admin.listUsers();
  const { data: rows } = await admin.from('client_databases').select('user_id');

  for (const row of rows || []) {
    const email = users.users.find(u => u.id === row.user_id)?.email || row.user_id;
    if (only && email !== only) continue;

    let cdb;
    try { cdb = clientDbClient(await getClientDbCreds(row.user_id)); }
    catch { console.log(`${email}: no client database — skipped`); continue; }

    const { data: branches } = await cdb.from('branches').select('id, branch_name, stars, reviews_count');
    if (!branches?.length) { console.log(`${email}: no branches`); continue; }

    let changed = 0, withRating = 0;
    for (const b of branches) {
      const { data: rated } = await cdb
        .from('reviews').select('rating').eq('branch_id', b.id).not('rating', 'is', null);
      const ratings = (rated || []).map((r: any) => Number(r.rating)).filter((n: number) => n >= 1 && n <= 5);
      if (ratings.length > 0) withRating++;

      // Null when there is nothing to average. A stored 0 is not "unknown", it
      // is the worst possible rating, and it showed as one.
      const stars = ratings.length
        ? Number((ratings.reduce((a: number, c: number) => a + c, 0) / ratings.length).toFixed(2))
        : null;
      const same = (b.stars == null ? null : Number(b.stars)) === stars
        && Number(b.reviews_count || 0) === ratings.length;
      if (same) continue;
      changed++;
      if (!dryRun) {
        await cdb.from('branches').update({ stars, reviews_count: ratings.length }).eq('id', b.id);
      }
    }
    console.log(`${email.padEnd(25)} ${dryRun ? 'would update' : 'updated'} ${String(changed).padEnd(4)} branch(es); ${withRating} have rated reviews`);
  }
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
