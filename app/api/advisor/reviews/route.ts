import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverClient, adminClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient } from '@/lib/client-db';

/**
 * The reviews behind a number.
 *
 * "31.9% of reviews still need a response" is only an instruction if the owner
 * can then see which ones. Without this the action buttons would be decoration.
 */

const Query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  filter: z.enum(['unanswered', 'unhappy', 'topic']),
  topic: z.string().optional(),
  brand: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await adminClient()
    .from('profiles').select('role, parent_user_id').eq('id', user.id).maybeSingle();
  const userId = profile?.role === 'viewer' && profile.parent_user_id ? profile.parent_user_id : user.id;

  const sp = new URL(req.url).searchParams;
  const parsed = Query.safeParse({
    from: sp.get('from'), to: sp.get('to'),
    filter: sp.get('filter'), topic: sp.get('topic') ?? undefined,
    brand: sp.get('brand') ?? undefined,
  });
  if (!parsed.success) return NextResponse.json({ error: 'Bad request.' }, { status: 400 });
  const { from, to, filter, topic, brand } = parsed.data;

  try {
    const cdb = clientDbClient(await getClientDbCreds(userId));

    // Own branches only, and the branch name comes along so the owner knows
    // where to go.
    let q = cdb.from('reviews')
      .select('id, rating, text, published_at, reply_text, sentiment_score, topics, branches!inner(branch_name, store_name, is_target)')
      .eq('branches.is_target', true)
      .gte('published_at', from)
      .lte('published_at', `${to}T23:59:59`)
      .not('text', 'is', null);

    if (brand && brand !== 'all') q = q.eq('brand', brand);

    if (filter === 'unanswered') {
      // Worst first: an unanswered complaint costs more than an unanswered
      // compliment.
      q = q.is('replied_at', null).order('sentiment_score', { ascending: true, nullsFirst: false });
    } else if (filter === 'unhappy') {
      q = q.lte('sentiment_score', 40).order('sentiment_score', { ascending: true });
    } else {
      if (!topic) return NextResponse.json({ error: 'Pick a subject.' }, { status: 400 });
      q = q.contains('topics', [topic]).order('sentiment_score', { ascending: true, nullsFirst: false });
    }

    const { data, error } = await q.limit(50);
    if (error) return NextResponse.json({ error: 'Could not read those reviews.' }, { status: 500 });

    return NextResponse.json({
      reviews: (data || []).map((r: any) => ({
        id: r.id,
        rating: r.rating,
        text: String(r.text || '').slice(0, 600),
        publishedAt: r.published_at,
        answered: !!r.reply_text,
        feeling: r.sentiment_score,
        topics: r.topics || [],
        branch: r.branches?.branch_name || null,
        store: r.branches?.store_name || null,
      })),
    });
  } catch {
    return NextResponse.json({ error: 'Could not read those reviews.' }, { status: 500 });
  }
}
