/**
 * Client database connector.
 *
 * Self-hosted mode: all clients share one Supabase instance, each with their
 * own Postgres schema. The supabase-js `db.schema` option routes queries to
 * the right schema automatically.
 *
 * Legacy cloud mode: if schema_name is NULL, falls back to the stored
 * supabase_url / service_role_key (external Supabase project).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './supabase';

export interface ClientDbCreds {
  supabase_url: string;
  service_role_key: string;
  schema_name: string | null;
}

export async function getClientAnthropicKey(userId: string): Promise<string | null> {
  const sb = adminClient();
  const { data } = await sb.from('client_databases').select('anthropic_api_key').eq('user_id', userId).single();
  return data?.anthropic_api_key || null;
}

export async function getClientDbCreds(userId: string): Promise<ClientDbCreds> {
  const sb = adminClient();
  const { data, error } = await sb
    .from('client_databases')
    .select('supabase_url, service_role_key, schema_name, last_test_ok')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw new Error('Client database is not connected. User must complete /connect-database first.');
  }
  if (!data.last_test_ok) {
    throw new Error('Client database connection has failed validation. Re-test from the connection page.');
  }
  return {
    supabase_url: data.supabase_url,
    service_role_key: data.service_role_key,
    schema_name: data.schema_name ?? null,
  };
}

/** Build a Supabase client pointed at the client's data schema. */
export function clientDbClient(creds: ClientDbCreds): SupabaseClient {
  let ws;
  if (typeof window === 'undefined') {
    try {
      ws = require('ws');
    } catch (e) {
      console.error('[client-db] Failed to load "ws" package:', e);
    }
  }

  if (creds.schema_name) {
    // Self-hosted: same instance, different schema
    return createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { autoRefreshToken: false, persistSession: false },
        db: { schema: creds.schema_name as any },
        realtime: { transport: ws },
      },
    );
  }

  // Legacy cloud: external Supabase project
  return createClient(creds.supabase_url, creds.service_role_key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });
}

/**
 * Validate client DB connection and schema readiness.
 * Works for both self-hosted (schema) and cloud (external URL).
 */
export async function testClientDb(creds: ClientDbCreds): Promise<{
  ok: boolean;
  error?: string;
  schemaReady?: boolean;
}> {
  // Cloud mode: validate URL format
  if (!creds.schema_name) {
    if (!creds.supabase_url.startsWith('https://')) {
      return { ok: false, error: 'URL should start with https://' };
    }
    if (!creds.service_role_key.startsWith('eyJ')) {
      return { ok: false, error: 'Service role key should be a JWT (starts with "eyJ...")' };
    }
  }

  let cli: SupabaseClient;
  try {
    cli = clientDbClient(creds);
  } catch (e: any) {
    return { ok: false, error: 'Could not initialize client: ' + e.message };
  }

  try {
    const { error: branchErr } = await cli.from('branches').select('id').limit(1);
    const { error: reviewErr } = await cli.from('reviews').select('id').limit(1);
    const { error: analysisErr } = await cli.from('analyses').select('id').limit(1);
    const { error: reportsErr } = await cli.from('reports').select('id').limit(1);

    const errs = [branchErr, reviewErr, analysisErr, reportsErr].filter(Boolean);

    if (errs.length === 0) return { ok: true, schemaReady: true };

    const hasAuthFail = errs.some(e => /jwt|auth|invalid|unauthor/i.test(e!.message));
    if (hasAuthFail) {
      return { ok: false, error: 'Service role key was rejected. Double-check the key.' };
    }

    const uniqueMsgs = Array.from(new Set(errs.map(e => e!.message))).join(', ');
    return {
      ok: true,
      schemaReady: false,
      error: `Missing tables (${uniqueMsgs}). Schema may need provisioning.`,
    };
  } catch (e: any) {
    return { ok: false, error: 'Connection failed: ' + (e.message || 'unknown') };
  }
}
