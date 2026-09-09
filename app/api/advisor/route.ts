import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { serverClient, adminClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient, getClientAiKey } from '@/lib/client-db';
import { buildDashboardFacts, resolveSettings } from '@/lib/dashboard-advisor';
import { startInsightsRun, getInsightsRun } from '@/lib/dashboard-insights';
import { startTopicClassification, getTopicRunState } from '@/lib/review-topics';
import {
  startReviewSync, getReviewSyncRun, startFeelingRun, getFeelingRun,
} from '@/lib/data-setup';
import { AiKeyProblem, describeKey, verifyKey } from '@/lib/ai-provider';

async function resolveUser() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: 'unauthorized' as const, status: 401 };
  const { data: profile } = await adminClient()
    .from('profiles').select('role, parent_user_id').eq('id', user.id).maybeSingle();
  return {
    user,
    role: profile?.role || 'client',
    effectiveUserId: profile?.role === 'viewer' && profile.parent_user_id ? profile.parent_user_id : user.id,
  };
}

const Range = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine(d => d.from <= d.to, { message: 'The start date must be on or before the end date.' });

/** Every figure the dashboard draws, plus how much of the corpus is readable. */
export async function GET(req: NextRequest) {
  const ctx = await resolveUser();
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const sp = new URL(req.url).searchParams;
  const parsed = Range.safeParse({ from: sp.get('from'), to: sp.get('to') });
  if (!parsed.success) return NextResponse.json({ error: 'Pick a valid date range.' }, { status: 400 });
  const brand = sp.get('brand');

  const clientKey = await getClientAiKey(ctx.effectiveUserId);
  const usable = clientKey || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || null;
  const info = describeKey(usable);

  const { data: settingsRow } = await adminClient()
    .from('client_databases').select('dashboard_settings').eq('user_id', ctx.effectiveUserId).maybeSingle();
  const settings = resolveSettings(settingsRow?.dashboard_settings);

  let facts: any = null, schemaReady = true, brands: string[] = [], unsortedReviews = 0;
  let unscoredReviews = 0, totalReviews = 0, connectedToGoogle = false;
  try {
    const cdb = clientDbClient(await getClientDbCreds(ctx.effectiveUserId));
    facts = await buildDashboardFacts(cdb, {
      from: parsed.data.from, to: parsed.data.to, brand: brand && brand !== 'all' ? brand : null,
      settings,
    });

    const { data: brandRows } = await cdb.from('branch_health').select('brand');
    brands = Array.from(new Set((brandRows || []).map((b: any) => b.brand).filter(Boolean))).sort() as string[];

    // Everything the setup panel needs, over the same branches the page is
    // showing — a count spanning brands the user has filtered out would not
    // match anything else on screen.
    const scopedBrand = brand && brand !== 'all' ? brand : null;

    // The inner join on is_target is not optional: the runners only ever touch
    // the client's own branches, so counting a competitor's reviews here left
    // four rows permanently "waiting" that no button could ever clear.
    const scoped = () => {
      let q = cdb.from('reviews')
        .select('id, branches!inner(is_target)', { count: 'exact', head: true })
        .eq('branches.is_target', true);
      if (scopedBrand) q = q.eq('brand', scopedBrand);
      return q;
    };

    const unsorted = await scoped().is('topics', null).not('text', 'is', null);
    unsortedReviews = unsorted.count || 0;

    const unscored = await scoped().is('sentiment_score', null).not('text', 'is', null);
    unscoredReviews = unscored.count || 0;

    const all = await scoped();
    totalReviews = all.count || 0;
  } catch (err: any) {
    if (err?.message === 'DASHBOARD_SCHEMA_MISSING') schemaReady = false;
    else return NextResponse.json({ error: err?.message || 'Could not read your figures.' }, { status: 500 });
  }

  const { data: cdRow } = await adminClient()
    .from('client_databases').select('gmb_refresh_token').eq('user_id', ctx.effectiveUserId).maybeSingle();
  connectedToGoogle = !!cdRow?.gmb_refresh_token;

  return NextResponse.json({
    schemaReady,
    facts,
    brands,
    unsortedReviews,
    setup: {
      connectedToGoogle,
      totalReviews,
      unscoredReviews,
      unsortedReviews,
      // Batch sizes match the runners: 25 reviews per feeling request, 30 per
      // subject request. Shown before anything runs so the cost is a decision,
      // not a surprise.
      feelingRequests: Math.ceil(unscoredReviews / 25),
      subjectRequests: Math.ceil(unsortedReviews / 30),
      reviewRun: getReviewSyncRun(ctx.effectiveUserId),
      feelingRun: getFeelingRun(ctx.effectiveUserId),
    },
    topicRun: getTopicRunState(ctx.effectiveUserId),
    insightsRun: getInsightsRun(ctx.effectiveUserId),
    ai: {
      configured: !!info,
      provider: info?.provider ?? null,
      model: info?.model ?? null,
      usingOwnKey: !!clientKey,
    },
  });
}

const Body = Range.and(z.object({
  brand: z.string().nullable().optional(),
  action: z.enum(['insights', 'classify', 'fetch-reviews', 'read-feeling']).default('insights'),
}));

/** Write the advisory, or start sorting reviews into subjects. */
export async function POST(req: NextRequest) {
  const ctx = await resolveUser();
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Pick a valid date range.' }, { status: 400 });
  }
  const { from, to, action } = parsed.data;
  const brand = parsed.data.brand && parsed.data.brand !== 'all' ? parsed.data.brand : null;

  const key = (await getClientAiKey(ctx.effectiveUserId))
    || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || null;

  try {
    const cdb = clientDbClient(await getClientDbCreds(ctx.effectiveUserId));

    if (action === 'fetch-reviews') {
      if (ctx.role === 'viewer') {
        return NextResponse.json({ error: 'Viewers cannot start this.' }, { status: 403 });
      }
      const running = getReviewSyncRun(ctx.effectiveUserId);
      if (running?.running) return NextResponse.json({ started: false, reviewRun: running }, { status: 202 });
      return NextResponse.json(
        { started: true, reviewRun: startReviewSync(ctx.effectiveUserId) }, { status: 202 });
    }

    if (action === 'read-feeling') {
      if (ctx.role === 'viewer') {
        return NextResponse.json({ error: 'Viewers cannot start this.' }, { status: 403 });
      }
      if (!key) {
        return NextResponse.json(
          { error: 'No AI key is set for your account. Add a Claude or OpenAI key below.', kind: 'missing' },
          { status: 409 });
      }
      const running = getFeelingRun(ctx.effectiveUserId);
      if (running?.running) return NextResponse.json({ started: false, feelingRun: running }, { status: 202 });

      const { count } = await cdb.from('reviews')
        .select('id', { count: 'exact', head: true })
        .is('sentiment_score', null).not('text', 'is', null);
      return NextResponse.json({
        started: true,
        feelingRun: startFeelingRun({ userId: ctx.effectiveUserId, cdb, total: count || 0 }),
      }, { status: 202 });
    }

    if (action === 'classify') {
      if (ctx.role === 'viewer') {
        return NextResponse.json({ error: 'Viewers cannot start this.' }, { status: 403 });
      }
      const running = getTopicRunState(ctx.effectiveUserId);
      if (running?.running) return NextResponse.json({ started: false, topicRun: running }, { status: 202 });

      const { count } = await cdb.from('reviews')
        .select('id', { count: 'exact', head: true })
        .is('topics', null).not('text', 'is', null);
      const state = startTopicClassification({
        userId: ctx.effectiveUserId, cdb, aiKey: key, total: count || 0,
      });
      return NextResponse.json({ started: true, topicRun: state }, { status: 202 });
    }

    const running = getInsightsRun(ctx.effectiveUserId);
    if (running?.running) {
      return NextResponse.json({ started: false, insightsRun: running, alreadyRunning: true }, { status: 202 });
    }

    const { data: sRow } = await adminClient()
      .from('client_databases').select('dashboard_settings').eq('user_id', ctx.effectiveUserId).maybeSingle();
    const facts = await buildDashboardFacts(cdb, {
      from, to, brand, settings: resolveSettings(sRow?.dashboard_settings),
    });
    if (facts.coverage.reviews === 0) {
      return NextResponse.json(
        { error: 'There are no reviews in these dates to advise on.' }, { status: 409 });
    }
    if (!key) {
      return NextResponse.json(
        { error: 'No AI key is set for your account. Add a Claude or OpenAI key below.', kind: 'missing' },
        { status: 409 });
    }

    // Returns at once; the page polls GET. Holding this open for the 40-50
    // seconds the model takes is what produced "NetworkError".
    const state = startInsightsRun({ userId: ctx.effectiveUserId, key, facts, brand });
    return NextResponse.json({ started: true, insightsRun: state }, { status: 202 });
  } catch (err: any) {
    if (err instanceof AiKeyProblem) {
      return NextResponse.json({ error: err.message, kind: err.kind }, { status: 409 });
    }
    if (err?.message === 'DASHBOARD_SCHEMA_MISSING') {
      return NextResponse.json(
        { error: 'Your database is missing the tables this needs. Re-run database setup.' }, { status: 409 });
    }
    console.error('[advisor]', err);
    return NextResponse.json({ error: err?.message || 'Could not write the advisory.' }, { status: 500 });
  }
}

const KeyBody = z.object({ ai_api_key: z.string().trim().min(20) });

/**
 * Store an AI key for this client, verified first.
 *
 * There is no shared platform key behind this any more, so a client without a
 * key gets a clear prompt rather than someone else's billing error.
 */
export async function PUT(req: NextRequest) {
  const ctx = await resolveUser();
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (ctx.role === 'viewer') return NextResponse.json({ error: 'Viewers cannot change settings.' }, { status: 403 });

  const parsed = KeyBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Provide a Claude or OpenAI API key.' }, { status: 400 });

  const key = parsed.data.ai_api_key;
  const info = describeKey(key);
  if (!info) {
    return NextResponse.json(
      { error: 'That does not look like a Claude key (sk-ant-…) or an OpenAI key (sk-…).' }, { status: 400 });
  }

  // Checked against the provider before storing, so a bad key fails here rather
  // than halfway through an analysis.
  const check = await verifyKey(key);
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

  const { error } = await adminClient()
    .from('client_databases')
    .update({ ai_api_key: key, updated_at: new Date().toISOString() })
    .eq('user_id', ctx.effectiveUserId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, provider: info.provider, model: info.model });
}

const SettingsBody = z.object({
  targets: z.object({
    sentiment: z.number(), replyRate: z.number(), replyHours: z.number(),
    negativeShare: z.number(), rating: z.number(),
  }).partial().optional(),
  weights: z.object({
    feeling: z.number(), replyRate: z.number(),
  }).partial().optional(),
  /** Send this to go back to the house defaults. */
  reset: z.boolean().optional(),
});

/** Save this client's targets and health weights. */
export async function PATCH(req: NextRequest) {
  const ctx = await resolveUser();
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  if (ctx.role === 'viewer') return NextResponse.json({ error: 'Viewers cannot change settings.' }, { status: 403 });

  const parsed = SettingsBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Those values could not be read.' }, { status: 400 });

  // resolveSettings clamps and normalises, so what is stored is already sane
  // and a later read cannot produce a score above 100.
  const next = parsed.data.reset ? null : resolveSettings(parsed.data);

  const { error } = await adminClient()
    .from('client_databases')
    .update({
      dashboard_settings: next ? { targets: next.targets, weights: next.weights } : null,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', ctx.effectiveUserId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, settings: resolveSettings(next) });
}
