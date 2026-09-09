import { NextRequest, NextResponse } from 'next/server';
import { serverClient, adminClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient } from '@/lib/client-db';
import { buildDashboardFacts } from '@/lib/dashboard-advisor';

/**
 * The dashboard as a spreadsheet.
 *
 * One file with a block per section rather than several files, because the
 * point is a report somebody can attach to an email. Excel opens it directly.
 */

/** RFC 4180: quote anything containing a comma, quote or newline. */
function cell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (cells: unknown[]) => cells.map(cell).join(',');

export async function GET(req: NextRequest) {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await adminClient()
    .from('profiles').select('role, parent_user_id').eq('id', user.id).maybeSingle();
  const effectiveUserId = profile?.role === 'viewer' && profile.parent_user_id ? profile.parent_user_id : user.id;

  const sp = new URL(req.url).searchParams;
  const from = sp.get('from') || '';
  const to = sp.get('to') || '';
  const brandParam = sp.get('brand');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'Pick a valid date range.' }, { status: 400 });
  }

  let facts;
  try {
    const cdb = clientDbClient(await getClientDbCreds(effectiveUserId));
    facts = await buildDashboardFacts(cdb, {
      from, to, brand: brandParam && brandParam !== 'all' ? brandParam : null,
    });
  } catch (err: any) {
    const missing = err?.message === 'DASHBOARD_SCHEMA_MISSING';
    return NextResponse.json(
      { error: missing ? 'Your database is missing the tables this needs.' : 'Could not build the report.' },
      { status: missing ? 409 : 500 });
  }

  const lines: string[] = [];
  const blank = () => lines.push('');
  const heading = (s: string) => { blank(); lines.push(row([s])); };

  lines.push(row(['Review report']));
  lines.push(row(['Period', `${from} to ${to}`]));
  lines.push(row(['Compared with', `${facts.previousPeriod.from} to ${facts.previousPeriod.to}`]));
  lines.push(row(['Brand', brandParam && brandParam !== 'all' ? brandParam : 'All brands']));
  lines.push(row(['Reviews', facts.coverage.reviews]));
  lines.push(row(['Reviews with words', facts.coverage.withText]));
  lines.push(row(['Read for feeling', facts.coverage.scored]));
  lines.push(row(['Waiting to be read', facts.coverage.pending]));
  lines.push(row(['Star rating only, nothing to read', facts.coverage.noText]));

  heading('The numbers that matter');
  lines.push(row(['Measure', 'Value', 'Unit', 'Target', 'Last period', 'Change', 'Status']));
  for (const k of facts.kpis) {
    lines.push(row([k.label, k.value, k.unit, k.target, k.previous, k.change, k.status]));
  }

  heading('Are customers happy');
  lines.push(row(['Group', 'Reviews', 'Share %']));
  lines.push(row(['Happy', facts.sentimentSplit.positive, facts.sentimentSplit.positivePct]));
  lines.push(row(['So-so', facts.sentimentSplit.neutral, facts.sentimentSplit.neutralPct]));
  lines.push(row(['Unhappy', facts.sentimentSplit.negative, facts.sentimentSplit.negativePct]));

  heading('Stars customers gave');
  lines.push(row(['Stars', 'Reviews', 'Share %', 'Share % last period']));
  for (const r of facts.ratings) lines.push(row([r.star, r.reviews, r.pct, r.previousPct]));

  heading('Branch by branch');
  // Store, address and map link included because branch_name is the city, so
  // the name alone does not identify a row.
  lines.push(row([
    'Branch', 'Store', 'Address', 'Brand', 'City', 'Reviews', 'Health', 'Feeling', 'Stars',
    'Stars on 0-100', 'Unhappy %', 'Answered %', 'Moved', 'Main complaint', 'Status', 'Ranked',
    'Google Maps',
  ]));
  for (const b of facts.branches) {
    lines.push(row([
      b.branchName, b.storeName, b.address, b.brand, b.city, b.reviews, b.healthScore,
      b.avgSentiment, b.avgRating, b.ratingScaled, b.negativeShare, b.replyRate, b.trendDelta,
      b.topComplaint, b.status, b.rankable ? 'yes' : 'too few reviews', b.mapsUrl,
    ]));
  }

  heading('What customers complain about');
  if (facts.topics.length === 0) {
    lines.push(row(['Reviews have not been sorted into subjects yet']));
  } else {
    lines.push(row(['Subject', 'Mentions', 'Share %', 'Mentions last period', 'Change %', 'Complaints %', 'Severity']));
    for (const x of facts.topics) {
      lines.push(row([
        x.topic, x.reviews, x.sharePct,
        // Withheld while the corpus is only partly sorted: this period is filed
        // and the last one is not, so a change would be invented.
        facts.coverage.topicsUnsorted === 0 ? x.previousReviews : '',
        facts.coverage.topicsUnsorted === 0 ? x.changePct : '',
        x.negativeShare, x.severity,
      ]));
    }
  }

  heading('Is it getting better or worse');
  lines.push(row([facts.granularity === 'day' ? 'Day' : facts.granularity === 'week' ? 'Week starting' : 'Month', 'Reviews', 'Feeling', 'Unhappy %']));
  for (const p of facts.trend) lines.push(row([p.bucket, p.reviews, p.avgSentiment, p.negativeShare]));

  heading('How well you answer customers');
  lines.push(row(['Reviews received', facts.response.reviews]));
  lines.push(row(['You answered', facts.response.replied]));
  lines.push(row(['Still unanswered', facts.response.unanswered]));
  lines.push(row(['Answered %', facts.response.replyRate]));
  lines.push(row(['Average hours to answer', facts.response.avgReplyHours]));
  lines.push(row(['Unhappy customers still waiting', facts.response.negativeUnanswered]));

  heading('Where you stand');
  lines.push(row(['Right now', facts.benchmark.current]));
  lines.push(row(['Target', facts.benchmark.target]));
  lines.push(row(['Last period', facts.benchmark.previous]));
  lines.push(row(['Average across your branches', facts.benchmark.networkAverage]));
  lines.push(row(['Best branch', facts.benchmark.best?.name, facts.benchmark.best?.value]));
  lines.push(row(['Worst branch', facts.benchmark.worst?.name, facts.benchmark.worst?.value]));

  heading('Do the stars tell the whole story');
  lines.push(row(['What people wrote', facts.starsVsWords.feeling]));
  lines.push(row(['Stars they gave, on 0-100', facts.starsVsWords.starsScaled]));
  lines.push(row(['Gap', facts.starsVsWords.gap]));
  blank();
  lines.push(row(['Branch', 'Wrote', 'Gave', 'Gap']));
  for (const b of facts.starsVsWords.worst) lines.push(row([b.name, b.feeling, b.starsScaled, b.gap]));

  // The BOM matters: without it Excel reads the file as the local codepage and
  // every Arabic branch name arrives as mojibake.
  const csv = '﻿' + lines.join('\r\n') + '\r\n';

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="review-report-${from}-to-${to}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
