import 'dotenv/config';
import { adminClient } from '../lib/supabase';
import { getClientDbCreds, clientDbClient } from '../lib/client-db';

async function main() {
  const sb = adminClient();
  const { data: latestJob } = await sb
    .from('jobs')
    .select('*')
    .eq('status', 'succeeded')
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestJob) {
    console.log('No succeeded job found.');
    return;
  }

  console.log('Latest Succeeded Job ID:', latestJob.id);
  console.log('Target Brand:', latestJob.target_name);
  console.log('Competitors:', latestJob.competitors);

  try {
    const creds = await getClientDbCreds(latestJob.user_id);
    const cdb = clientDbClient(creds);

    const { data: branches } = await cdb
      .from('branch_analytics')
      .select('brand, branch_name, city, address')
      .eq('job_id', latestJob.id);

    console.log('\n--- Stored Branch Analytics (%d rows) ---', branches?.length || 0);
    for (const b of (branches || []).slice(0, 10)) {
      console.log(`Brand: "${b.brand}" | Name: "${b.branch_name}" | City: "${b.city}" | Address: "${b.address}"`);
    }
  } catch (err) {
    console.error('Error fetching data:', err);
  }
}

main();
