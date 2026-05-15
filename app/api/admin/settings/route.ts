import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverClient, adminClient } from '@/lib/supabase';
import { clearSettingsCache } from '@/lib/settings';

async function requireAdmin() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: 'unauthorized', status: 401 as const };
  const { data: profile } = await sb.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return { error: 'forbidden', status: 403 as const };
  return { user };
}

export async function GET() {
  const auth = await requireAdmin();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const sb = adminClient();
  const { data, error } = await sb.from('app_settings').select('*').eq('id', 1).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    settings: {
      smtp_host:                  data.smtp_host || '',
      smtp_port:                  data.smtp_port,
      smtp_user:                  data.smtp_user || '',
      smtp_pass:                  mask(data.smtp_pass),
      smtp_secure:                data.smtp_secure,
      smtp_from_name:             data.smtp_from_name || '',
      smtp_from_email:            data.smtp_from_email || '',
      
      gmb_oauth_client_id:        data.gmb_oauth_client_id || '',
      gmb_oauth_client_secret:    mask(data.gmb_oauth_client_secret),
      
      worker_poll_ms:             data.worker_poll_ms,
      puppeteer_headless:         data.puppeteer_headless,
      signup_allowed:             data.signup_allowed,
      setup_completed:            data.setup_completed,
      updated_at:                 data.updated_at,
    },
  });
}

const UpdateSchema = z.object({
  smtp_host:                 z.string().min(1).optional(),
  smtp_port:                 z.number().int().optional(),
  smtp_user:                 z.string().min(1).optional(),
  smtp_pass:                 z.string().min(1).optional(),
  smtp_secure:               z.boolean().optional(),
  smtp_from_name:            z.string().min(1).optional(),
  smtp_from_email:           z.string().email().or(z.literal('')).optional(),

  gmb_oauth_client_id:       z.string().min(10).optional(),
  gmb_oauth_client_secret:   z.string().min(10).optional(),
  
  worker_poll_ms:            z.number().int().min(1000).max(60000).optional(),
  puppeteer_headless:        z.boolean().optional(),
  signup_allowed:            z.boolean().optional(),
  setup_completed:           z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const update: Record<string, unknown> = { ...parsed.data };
  
  // Don't overwrite with masks
  if (typeof update.smtp_pass === 'string' && update.smtp_pass.includes('•')) delete update.smtp_pass;
  if (typeof update.gmb_oauth_client_secret === 'string' && update.gmb_oauth_client_secret.includes('•')) delete update.gmb_oauth_client_secret;

  update.updated_at = new Date().toISOString();
  update.updated_by = auth.user.id;

  const sb = adminClient();
  const { error } = await sb.from('app_settings').update(update).eq('id', 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  clearSettingsCache();
  return NextResponse.json({ ok: true });
}

function mask(v: string | null): string {
  if (!v) return '';
  if (v.length <= 4) return '•'.repeat(v.length);
  return '•'.repeat(Math.max(0, v.length - 4)) + v.slice(-4);
}
