import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { adminClient } from '@/lib/supabase';
import { isSetupCompleted, clearSettingsCache } from '@/lib/settings';

const SetupSchema = z.object({
  admin: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    full_name: z.string().min(1).optional(),
  }),
  gmail: z.object({
    user: z.string().email(),
    from_name: z.string().min(1).default('Reports'),
    oauth_client_id: z.string().min(10),
    oauth_client_secret: z.string().min(10),
    refresh_token: z.string().min(20),
  }),
  gmb: z.object({
    oauth_client_id: z.string().min(10),
    oauth_client_secret: z.string().min(10),
  }),
  signup_allowed: z.boolean().default(true),
});

export async function POST(req: NextRequest) {
  if (await isSetupCompleted()) {
    return NextResponse.json(
      { error: 'Setup is already complete. Sign in and use /admin to make changes.' },
      { status: 403 }
    );
  }

  let body: unknown;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const parsed = SetupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const sb = adminClient();
  const { admin, gmail, gmb, signup_allowed } = parsed.data;

  let userId: string | undefined;

  // 1. Try to create the admin user
  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email: admin.email,
    password: admin.password,
    email_confirm: true,
    user_metadata: { full_name: admin.full_name || admin.email },
  });

  if (createErr) {
    // If user already exists, we find their ID to promote them
    if (createErr.message.toLowerCase().includes('already been registered')) {
      const { data: listData, error: listErr } = await sb.auth.admin.listUsers();
      if (listErr) return NextResponse.json({ error: 'list users failed: ' + listErr.message }, { status: 500 });

      const existing = listData.users.find(u => u.email?.toLowerCase() === admin.email.toLowerCase());
      if (!existing) return NextResponse.json({ error: 'User exists but not found in list' }, { status: 500 });
      userId = existing.id;
    } else {
      return NextResponse.json({ error: createErr.message }, { status: 500 });
    }
  } else {
    userId = created.user?.id;
  }

  if (!userId) {
    return NextResponse.json({ error: 'failed to identify admin user' }, { status: 500 });
  }

  // 2. Promote to admin in profiles
  const { error: profileErr } = await sb
    .from('profiles')
    .upsert({
      id: userId,
      email: admin.email,
      is_admin: true,
      full_name: admin.full_name || admin.email
    }, { onConflict: 'id' });

  if (profileErr) {
    return NextResponse.json({ error: 'role grant failed: ' + profileErr.message }, { status: 500 });
  }

  const { error: settingsErr } = await sb
    .from('app_settings')
    .upsert({
      id: 1,
      gmail_user: gmail.user,
      gmail_from_name: gmail.from_name,
      gmail_oauth_client_id: gmail.oauth_client_id,
      gmail_oauth_client_secret: gmail.oauth_client_secret,
      gmail_refresh_token: gmail.refresh_token,
      gmb_oauth_client_id: gmb.oauth_client_id,
      gmb_oauth_client_secret: gmb.oauth_client_secret,
      signup_allowed,
      setup_completed: true,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    }, { onConflict: 'id' });
  if (settingsErr) {
    return NextResponse.json({ error: 'settings save failed: ' + settingsErr.message }, { status: 500 });
  }

  clearSettingsCache();
  return NextResponse.json({ ok: true, admin_email: admin.email });
}

export async function GET() {
  const completed = await isSetupCompleted();
  return NextResponse.json({ setup_completed: completed });
}
