import { NextResponse } from 'next/server';
import { serverClient } from '@/lib/supabase';

export async function POST() {
  const sb = serverClient();
  await sb.auth.signOut();
  return NextResponse.json({ ok: true });
}
