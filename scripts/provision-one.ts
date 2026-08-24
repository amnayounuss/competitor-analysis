/**
 * One-off provisioning helper: creates the per-client Postgres schema for an
 * existing auth user. Same code path the /connect-database flow uses.
 *
 *   npx tsx scripts/provision-one.ts <user-uuid>
 */
import 'dotenv/config';
import { provisionClientSchema } from '../lib/provision-client-schema';

const userId = process.argv[2];
if (!userId) { console.error('usage: npx tsx scripts/provision-one.ts <user-uuid>'); process.exit(1); }

provisionClientSchema(userId)
  .then(s => { console.log('provisioned schema:', s); process.exit(0); })
  .catch(e => { console.error('FAILED:', e.message); process.exit(1); });
