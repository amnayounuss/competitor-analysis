import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function run() {
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: { users }, error } = await admin.auth.admin.listUsers();

  if (error) {
    console.error('Error fetching users:', error);
  } else {
    console.log('Registered Users:');
    users.forEach(u => {
      console.log(`- ID: ${u.id}, Email: ${u.email}, CreatedAt: ${u.created_at}`);
    });
  }
}

run();
