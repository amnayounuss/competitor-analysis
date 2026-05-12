const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Simple fetch-based check to avoid WebSocket issues
async function check() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log('Checking Admin DB...');
  const r1 = await fetch(`${url}/rest/v1/jobs?select=id,target_name,status,branches_total,reviews_total&order=queued_at.desc&limit=5`, {
    headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
  });
  const jobs = await r1.json();
  console.log('Recent Jobs:', JSON.stringify(jobs, null, 2));

  if (jobs[0] && jobs[0].status === 'succeeded') {
    console.log('Job succeeded. Checking if data was pushed...');
    // We'd need the client DB credentials to check the client DB.
    // Let's get them from the admin DB.
    const r2 = await fetch(`${url}/rest/v1/client_databases?select=supabase_url,service_role_key&limit=1`, {
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}` }
    });
    const creds = await r2.json();
    if (creds[0]) {
        console.log('Checking Client DB:', creds[0].supabase_url);
        const r3 = await fetch(`${creds[0].supabase_url}/rest/v1/branches?select=count`, {
            headers: { 
                'apikey': creds[0].service_role_key, 
                'Authorization': `Bearer ${creds[0].service_role_key}`,
                'Prefer': 'count=exact'
            }
        });
        console.log('Branches in Client DB:', r3.headers.get('content-range'));
    }
  }
}

check().catch(console.error);
