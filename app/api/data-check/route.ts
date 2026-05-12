import { NextResponse } from 'next/server';
import { serverClient, adminClient } from '@/lib/supabase';
import { getClientDbCreds, clientDbClient } from '@/lib/client-db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const sb = serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const admin = adminClient();
    const creds = await getClientDbCreds(user.id);
    const cdb = clientDbClient(creds);

    const { data: latestJob } = await admin
      .from('jobs')
      .select('id, target_name, competitors')
      .eq('user_id', user.id)
      .eq('status', 'succeeded')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestJob) {
      return NextResponse.json({ status: 'no_data', message: 'No succeeded job found. Run a job first.' });
    }

    const jobId = latestJob.id;
    const targetName = latestJob.target_name;
    const competitorNames: string[] = Array.isArray(latestJob.competitors) ? latestJob.competitors : [];

    const { data: rows } = await cdb
      .from('branch_analytics')
      .select('brand, branch_name, city, address, google_maps_link, business_hours, phone, peak_time, busy_hours_summary, avg_rating_period, total_reviews_period, month_1_reviews, month_1_avg_rating, month_2_reviews, month_2_avg_rating, month_3_reviews, month_3_avg_rating, star_5_count, popular_times_grid, date_start, date_end')
      .eq('job_id', jobId);

    if (!rows || rows.length === 0) {
      return NextResponse.json({ status: 'no_data', message: 'No branch analytics for latest job.' });
    }

    const brands = new Map<string, {
      total: number;
      withCity: number;
      withAddress: number;
      withMapsLink: number;
      withHours: number;
      withPhone: number;
      withPeakTime: number;
      withBusyHours: number;
      withRating: number;
      withReviews: number;
      withMonth1: number;
      withMonth2: number;
      withMonth3: number;
      withPopularTimes: number;
      withStars: number;
    }>();

    for (const r of rows) {
      if (!brands.has(r.brand)) {
        brands.set(r.brand, {
          total: 0, withCity: 0, withAddress: 0, withMapsLink: 0,
          withHours: 0, withPhone: 0, withPeakTime: 0, withBusyHours: 0,
          withRating: 0, withReviews: 0, withMonth1: 0, withMonth2: 0,
          withMonth3: 0, withPopularTimes: 0, withStars: 0,
        });
      }
      const b = brands.get(r.brand)!;
      b.total++;
      if (r.city) b.withCity++;
      if (r.address) b.withAddress++;
      if (r.google_maps_link) b.withMapsLink++;
      if (r.business_hours) b.withHours++;
      if (r.phone) b.withPhone++;
      if (r.peak_time) b.withPeakTime++;
      if (r.busy_hours_summary) b.withBusyHours++;
      if (r.avg_rating_period != null) b.withRating++;
      if (r.total_reviews_period > 0) b.withReviews++;
      if (r.month_1_reviews > 0) b.withMonth1++;
      if (r.month_2_reviews > 0) b.withMonth2++;
      if (r.month_3_reviews > 0) b.withMonth3++;
      if (r.popular_times_grid && Object.keys(r.popular_times_grid).length > 0) b.withPopularTimes++;
      if (r.star_5_count > 0 || (r as any).star_4_count > 0 || (r as any).star_3_count > 0 || (r as any).star_2_count > 0 || (r as any).star_1_count > 0) b.withStars++;
    }

    const dateRange = {
      start: rows[0]?.date_start || null,
      end: rows[0]?.date_end || null,
    };

    const buildReport = (brand: string, b: typeof brands extends Map<string, infer V> ? V : never) => {
      const pct = (n: number) => b.total > 0 ? Math.round((n / b.total) * 100) : 0;
      const issues: string[] = [];

      if (pct(b.withCity) < 50) issues.push(`city missing on ${b.total - b.withCity}/${b.total} branches`);
      if (pct(b.withAddress) < 80) issues.push(`address missing on ${b.total - b.withAddress}/${b.total}`);
      if (pct(b.withPopularTimes) < 30) issues.push(`popular times missing on ${b.total - b.withPopularTimes}/${b.total}`);
      if (pct(b.withRating) < 50) issues.push(`rating missing on ${b.total - b.withRating}/${b.total}`);
      if (pct(b.withHours) < 50) issues.push(`hours missing on ${b.total - b.withHours}/${b.total}`);
      if (pct(b.withPhone) < 30) issues.push(`phone missing on ${b.total - b.withPhone}/${b.total}`);

      return {
        brand,
        totalBranches: b.total,
        coverage: {
          city: `${b.withCity}/${b.total} (${pct(b.withCity)}%)`,
          address: `${b.withAddress}/${b.total} (${pct(b.withAddress)}%)`,
          mapsLink: `${b.withMapsLink}/${b.total} (${pct(b.withMapsLink)}%)`,
          hours: `${b.withHours}/${b.total} (${pct(b.withHours)}%)`,
          phone: `${b.withPhone}/${b.total} (${pct(b.withPhone)}%)`,
          peakTime: `${b.withPeakTime}/${b.total} (${pct(b.withPeakTime)}%)`,
          busyHours: `${b.withBusyHours}/${b.total} (${pct(b.withBusyHours)}%)`,
          rating: `${b.withRating}/${b.total} (${pct(b.withRating)}%)`,
          reviews: `${b.withReviews}/${b.total} (${pct(b.withReviews)}%)`,
          month1: `${b.withMonth1}/${b.total} (${pct(b.withMonth1)}%)`,
          month2: `${b.withMonth2}/${b.total} (${pct(b.withMonth2)}%)`,
          month3: `${b.withMonth3}/${b.total} (${pct(b.withMonth3)}%)`,
          popularTimes: `${b.withPopularTimes}/${b.total} (${pct(b.withPopularTimes)}%)`,
          starBreakdown: `${b.withStars}/${b.total} (${pct(b.withStars)}%)`,
        },
        issues,
      };
    };

    const targetData = brands.get(targetName);
    const targetReport = targetData ? buildReport(targetName, targetData) : null;

    const competitorReports = competitorNames
      .map(name => {
        const data = brands.get(name);
        return data ? buildReport(name, data) : null;
      })
      .filter(Boolean);

    const otherBrands = Array.from(brands.entries())
      .filter(([name]) => name !== targetName && !competitorNames.includes(name))
      .map(([name, data]) => buildReport(name, data));

    const overallIssues: string[] = [];
    const totalBranches = rows.length;
    const totalWithPT = rows.filter(r => r.popular_times_grid && Object.keys(r.popular_times_grid).length > 0).length;
    const totalWithCity = rows.filter(r => r.city).length;

    if (totalWithPT < totalBranches * 0.3) overallIssues.push(`Popular times data is low (${totalWithPT}/${totalBranches}). Re-run job to scrape.`);
    if (totalWithCity < totalBranches * 0.5) overallIssues.push(`City data is low (${totalWithCity}/${totalBranches}). Re-run job for proper Saudi address parsing.`);
    if (!dateRange.start) overallIssues.push('No date range set — old hardcoded 3-month run. Re-run with explicit dates.');

    const needsRerun = overallIssues.length > 0;

    return NextResponse.json({
      status: needsRerun ? 'needs_rerun' : 'ok',
      jobId,
      dateRange,
      totalBranches,
      summary: {
        popularTimesCoverage: `${totalWithPT}/${totalBranches}`,
        cityCoverage: `${totalWithCity}/${totalBranches}`,
      },
      target: targetReport,
      competitors: competitorReports,
      ...(otherBrands.length > 0 ? { other: otherBrands } : {}),
      overallIssues,
      recommendation: needsRerun
        ? 'Data is incomplete. Run a new analysis job with proper date range to get full coverage.'
        : 'Data looks complete. Dashboard should display properly.',
    });
  } catch (err: any) {
    return NextResponse.json({ status: 'error', message: err.message }, { status: 500 });
  }
}
