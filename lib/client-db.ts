/**
 * Client database connector.
 *
 * Each user has THEIR OWN Supabase. We connect to it on demand using the
 * credentials they saved during onboarding. Never cache the client across
 * jobs — different users have different DBs.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { adminClient } from './supabase';

export interface ClientDbCreds {
  supabase_url: string;
  service_role_key: string;
}

/** Pull the user's saved client-DB credentials from admin DB. */
export async function getClientDbCreds(userId: string): Promise<ClientDbCreds> {
  const sb = adminClient();
  const { data, error } = await sb
    .from('client_databases')
    .select('supabase_url, service_role_key, last_test_ok')
    .eq('user_id', userId)
    .single();

  if (error || !data) {
    throw new Error('Client database is not connected. User must complete /connect-database first.');
  }
  if (!data.last_test_ok) {
    throw new Error('Client database connection has failed validation. Re-test from the connection page.');
  }
  return { supabase_url: data.supabase_url, service_role_key: data.service_role_key };
}

/** Build a fresh Supabase client pointed at the user's own DB. */
export function clientDbClient(creds: ClientDbCreds): SupabaseClient {
  // For Node.js < 22, we need to provide a WebSocket implementation for Realtime
  let ws;
  if (typeof window === 'undefined') {
    try {
      ws = require('ws');
    } catch (e) {
      console.error('[client-db] Failed to load "ws" package:', e);
    }
  }

  return createClient(creds.supabase_url, creds.service_role_key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: {
      transport: ws
    }
  });
}

/**
 * Validate a Supabase URL + service key combo.
 * Used by the connection-test endpoint and the worker's pre-flight check.
 */
export async function testClientDb(creds: ClientDbCreds): Promise<{
  ok: boolean;
  error?: string;
  schemaReady?: boolean;
}> {
  if (!creds.supabase_url.startsWith('https://') || !creds.supabase_url.includes('.supabase.co')) {
    return { ok: false, error: 'URL should look like https://xxxx.supabase.co' };
  }
  if (!creds.service_role_key.startsWith('eyJ')) {
    return { ok: false, error: 'Service role key should be a JWT (starts with "eyJ...")' };
  }

  let cli: SupabaseClient;
  try {
    cli = clientDbClient(creds);
  } catch (e: any) {
    return { ok: false, error: 'Could not initialize client: ' + e.message };
  }

  // Try a harmless read — list tables we expect
  try {
    const { error: branchErr } = await cli.from('branches').select('id').limit(1);
    const { error: reviewErr } = await cli.from('reviews').select('id').limit(1);
    const { error: analysisErr } = await cli.from('analyses').select('id').limit(1);
    const { error: reportsErr } = await cli.from('reports').select('id').limit(1);

    const errs = [branchErr, reviewErr, analysisErr, reportsErr].filter(Boolean);

    if (errs.length === 0) return { ok: true, schemaReady: true };

    // Distinguish auth/network failures from "table missing"
    const hasAuthFail = errs.some(e => /jwt|auth|invalid|unauthor/i.test(e!.message));
    if (hasAuthFail) {
      return { ok: false, error: 'Service role key was rejected. Double-check the key is from "Settings → API → service_role".' };
    }
    
    // Concatenate unique error messages for missing tables
    const uniqueMsgs = Array.from(new Set(errs.map(e => e!.message))).join(', ');
    return {
      ok: true,
      schemaReady: false,
      error: `Missing tables or types (${uniqueMsgs}). Please run the client-schema.sql in your SQL editor.`,
    };
  } catch (e: any) {
    return { ok: false, error: 'Connection failed: ' + (e.message || 'unknown') };
  }
}
