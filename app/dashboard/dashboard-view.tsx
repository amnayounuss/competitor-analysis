'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';

interface BranchAnalytics {
  id: string;
  job_id: string;
  branch_id: string | null;
  brand: string;
  branch_name: string;
  city: string | null;
  address: string | null;
  google_maps_link: string | null;
  business_hours: string | null;
  phone: string | null;
  peak_day: string | null;
  peak_hour: string | null;
  peak_busyness_pct: number | null;
  peak_time: string | null;
  busy_hours_summary: string | null;
  avg_rating_period: number | null;
  total_reviews_period: number;
  month_1_reviews: number;
  month_1_avg_rating: number | null;
  month_2_reviews: number;
  month_2_avg_rating: number | null;
  month_3_reviews: number;
  month_3_avg_rating: number | null;
  star_5_count: number;
  star_4_count: number;
  star_3_count: number;
  star_2_count: number;
  star_1_count: number;
  popular_times_grid: Record<string, (number | null)[]> | null;
  date_start: string | null;
  date_end: string | null;
}

interface Analysis {
  brand: string;
  branch_count: number;
  total_reviews_3m: number;
  avg_rating_3m: number;
  star_5_count: number;
  star_4_count: number;
  star_3_count: number;
  star_2_count: number;
  star_1_count: number;
}

interface DashboardProps {
  data: {
    analytics: BranchAnalytics[];
    analyses: Analysis[];
    targetBrand: string | null;
    competitorBrands: string[];
    jobId: string | null;
    dateStart: string | null;
    dateEnd: string | null;
    finishedAt: string | null;
  };
}

const PALETTE = ['#4F46E5', '#10B981', '#EF4444', '#F59E0B', '#0EA5E9', '#A855F7', '#EC4899', '#14B8A6'];
const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const DAY_LABELS: Record<string, string> = {
  SUNDAY: 'Sun', MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed',
  THURSDAY: 'Thu', FRIDAY: 'Fri', SATURDAY: 'Sat',
};

type Tab = 'overview' | 'branches' | 'rankings' | 'popular-times';

function fmtDate(iso?: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function hourLabel(h: number) {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

// ── Brand-level aggregation ──

interface BrandSummary {
  brand: string;
  isTarget: boolean;
  branches: number;
  totalReviews: number;
  avgRating: number | null;
  stars: [number, number, number, number, number];
  monthly: { reviews: number; avg: number | null }[];
  currentMonthReviews: number;
  currentMonthAvg: number | null;
  color: string;
}

function buildBrandSummaries(
  analytics: BranchAnalytics[],
  targetBrand: string | null,
  competitorBrands: string[],
): BrandSummary[] {
  const brandOrder = [targetBrand, ...competitorBrands].filter(Boolean) as string[];
  const colorMap: Record<string, string> = {};
  brandOrder.forEach((b, i) => { colorMap[b] = PALETTE[i % PALETTE.length]; });

  const acc: Record<string, {
    reviews: number; ratingSum: number; ratingWeight: number;
    s5: number; s4: number; s3: number; s2: number; s1: number;
    m1r: number; m1s: number; m1w: number;
    m2r: number; m2s: number; m2w: number;
    m3r: number; m3s: number; m3w: number;
    count: number;
  }> = {};

  for (const a of analytics) {
    if (!acc[a.brand]) acc[a.brand] = {
      reviews: 0, ratingSum: 0, ratingWeight: 0,
      s5: 0, s4: 0, s3: 0, s2: 0, s1: 0,
      m1r: 0, m1s: 0, m1w: 0, m2r: 0, m2s: 0, m2w: 0, m3r: 0, m3s: 0, m3w: 0,
      count: 0,
    };
    const x = acc[a.brand];
    x.count++;
    x.reviews += a.total_reviews_period;
    if (a.avg_rating_period != null) {
      x.ratingSum += a.avg_rating_period * a.total_reviews_period;
      x.ratingWeight += a.total_reviews_period;
    }
    x.s5 += a.star_5_count; x.s4 += a.star_4_count;
    x.s3 += a.star_3_count; x.s2 += a.star_2_count; x.s1 += a.star_1_count;
    x.m1r += a.month_1_reviews;
    if (a.month_1_avg_rating != null) { x.m1s += a.month_1_avg_rating * a.month_1_reviews; x.m1w += a.month_1_reviews; }
    x.m2r += a.month_2_reviews;
    if (a.month_2_avg_rating != null) { x.m2s += a.month_2_avg_rating * a.month_2_reviews; x.m2w += a.month_2_reviews; }
    x.m3r += a.month_3_reviews;
    if (a.month_3_avg_rating != null) { x.m3s += a.month_3_avg_rating * a.month_3_reviews; x.m3w += a.month_3_reviews; }
  }

  const allBrands = new Set([...brandOrder, ...Object.keys(acc)]);
  const result: BrandSummary[] = [];
  let idx = brandOrder.length;
  for (const brand of allBrands) {
    const x = acc[brand];
    if (!x) continue;
    if (!colorMap[brand]) { colorMap[brand] = PALETTE[idx % PALETTE.length]; idx++; }
    result.push({
      brand,
      isTarget: brand === targetBrand,
      branches: x.count,
      totalReviews: x.reviews,
      avgRating: x.ratingWeight > 0 ? +(x.ratingSum / x.ratingWeight).toFixed(2) : null,
      stars: [x.s5, x.s4, x.s3, x.s2, x.s1],
      monthly: [
        { reviews: x.m1r, avg: x.m1w > 0 ? +(x.m1s / x.m1w).toFixed(2) : null },
        { reviews: x.m2r, avg: x.m2w > 0 ? +(x.m2s / x.m2w).toFixed(2) : null },
        { reviews: x.m3r, avg: x.m3w > 0 ? +(x.m3s / x.m3w).toFixed(2) : null },
      ],
      currentMonthReviews: x.m1r,
      currentMonthAvg: x.m1w > 0 ? +(x.m1s / x.m1w).toFixed(2) : null,
      color: colorMap[brand],
    });
  }

  return result.sort((a, b) => {
    if (a.isTarget) return -1;
    if (b.isTarget) return 1;
    return (b.avgRating ?? 0) - (a.avgRating ?? 0);
  });
}

interface CityBreakdown {
  city: string;
  brands: { brand: string; branches: number; avgRating: number | null; reviews: number; color: string }[];
  totalBranches: number;
}

function buildCityBreakdown(analytics: BranchAnalytics[], brandSummaries: BrandSummary[]): CityBreakdown[] {
  const colorMap: Record<string, string> = {};
  brandSummaries.forEach(b => { colorMap[b.brand] = b.color; });

  const cities = new Map<string, Map<string, { count: number; rSum: number; rW: number; reviews: number }>>();
  for (const a of analytics) {
    const city = a.city || 'Unknown';
    if (!cities.has(city)) cities.set(city, new Map());
    const brands = cities.get(city)!;
    if (!brands.has(a.brand)) brands.set(a.brand, { count: 0, rSum: 0, rW: 0, reviews: 0 });
    const x = brands.get(a.brand)!;
    x.count++;
    x.reviews += a.total_reviews_period;
    if (a.avg_rating_period != null) { x.rSum += a.avg_rating_period * a.total_reviews_period; x.rW += a.total_reviews_period; }
  }

  return Array.from(cities.entries())
    .map(([city, brands]) => ({
      city,
      brands: Array.from(brands.entries()).map(([brand, x]) => ({
        brand,
        branches: x.count,
        avgRating: x.rW > 0 ? +(x.rSum / x.rW).toFixed(2) : null,
        reviews: x.reviews,
        color: colorMap[brand] || '#94A3B8',
      })),
      totalBranches: Array.from(brands.values()).reduce((s, x) => s + x.count, 0),
    }))
    .sort((a, b) => b.totalBranches - a.totalBranches);
}


export default function DashboardView({ data }: DashboardProps) {
  const { analytics, targetBrand, competitorBrands, dateStart, dateEnd } = data;

  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [filterBrand, setFilterBrand] = useState('All');
  const [filterCity, setFilterCity] = useState('All');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<'rating' | 'reviews' | 'name'>('rating');
  const [sortAsc, setSortAsc] = useState(false);
  const [ptBrandFilter, setPtBrandFilter] = useState('All');
  const [ptSelectedId, setPtSelectedId] = useState<string | null>(null);

  const brandSummaries = useMemo(
    () => buildBrandSummaries(analytics, targetBrand, competitorBrands),
    [analytics, targetBrand, competitorBrands],
  );

  const colorMap = useMemo(() => {
    const m: Record<string, string> = {};
    brandSummaries.forEach(b => { m[b.brand] = b.color; });
    return m;
  }, [brandSummaries]);

  const targetSummary = brandSummaries.find(b => b.isTarget);
  const compSummaries = brandSummaries.filter(b => !b.isTarget);
  const compAvgRating = compSummaries.length > 0
    ? +(compSummaries.reduce((s, c) => s + (c.avgRating ?? 0), 0) / compSummaries.length).toFixed(2)
    : 0;

  const cities = useMemo(() =>
    Array.from(new Set(analytics.map(a => a.city).filter(Boolean))) as string[],
    [analytics],
  );

  const cityBreakdown = useMemo(
    () => buildCityBreakdown(analytics, brandSummaries),
    [analytics, brandSummaries],
  );

  const periodLabel = useMemo(() => {
    if (dateStart && dateEnd) return `${fmtDate(dateStart)} → ${fmtDate(dateEnd)}`;
    const s = analytics.find(a => a.date_start)?.date_start;
    const e = analytics.find(a => a.date_end)?.date_end;
    if (s && e) return `${fmtDate(s)} → ${fmtDate(e)}`;
    return 'Last 90 days';
  }, [analytics, dateStart, dateEnd]);

  const filteredBranches = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = analytics.filter(a => {
      if (filterBrand !== 'All' && a.brand !== filterBrand) return false;
      if (filterCity !== 'All' && a.city !== filterCity) return false;
      if (q && !`${a.branch_name} ${a.city || ''} ${a.address || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'rating') cmp = (a.avg_rating_period ?? 0) - (b.avg_rating_period ?? 0);
      else if (sortCol === 'reviews') cmp = a.total_reviews_period - b.total_reviews_period;
      else cmp = a.branch_name.localeCompare(b.branch_name);
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [analytics, filterBrand, filterCity, search, sortCol, sortAsc]);

  const selected = useMemo(() => {
    if (selectedId) return analytics.find(a => a.id === selectedId);
    return null;
  }, [analytics, selectedId]);

  const rankings = useMemo(() =>
    [...analytics]
      .filter(a => a.total_reviews_period > 0 && a.avg_rating_period != null)
      .sort((a, b) => (b.avg_rating_period! - a.avg_rating_period!) || (b.total_reviews_period - a.total_reviews_period)),
    [analytics],
  );

  const ptBranches = useMemo(() => {
    let list = analytics.filter(a => a.popular_times_grid && Object.keys(a.popular_times_grid).length > 0);
    if (ptBrandFilter !== 'All') list = list.filter(a => a.brand === ptBrandFilter);
    return list;
  }, [analytics, ptBrandFilter]);

  const ptSelected = useMemo(() => {
    if (ptSelectedId) return analytics.find(a => a.id === ptSelectedId);
    return null;
  }, [analytics, ptSelectedId]);

  const handleSort = (col: 'rating' | 'reviews' | 'name') => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(false); }
  };

  if (!analytics.length) {
    return (
      <div className="p-20 text-center bg-white rounded-3xl border border-dashed border-slate-200">
        <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center text-slate-300 mx-auto mb-6">
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
        </div>
        <h3 className="text-xl font-black text-slate-900 mb-2">No Data Yet</h3>
        <p className="text-slate-500 font-medium mb-8 max-w-sm mx-auto">Run your first analysis to see branch-wise comparisons here.</p>
        <Link href="/dashboard/new" className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-500/20">
          Start Analysis
        </Link>
      </div>
    );
  }

  const ratingGap = (targetSummary?.avgRating ?? 0) - compAvgRating;
  const isAhead = ratingGap >= 0;

  return (
    <div className="space-y-8 pb-20 animate-in fade-in duration-700">

      {/* ═══ TAB NAVIGATION ═══ */}
      <div className="flex gap-1 bg-slate-100 p-1.5 rounded-2xl">
        {([
          { key: 'overview' as Tab, label: 'Overview' },
          { key: 'branches' as Tab, label: 'Branch Data' },
          { key: 'rankings' as Tab, label: 'Rankings' },
          { key: 'popular-times' as Tab, label: 'Popular Times' },
        ]).map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
              activeTab === tab.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ═══════════════════════════════════════════════════════
          TAB: OVERVIEW
         ═══════════════════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        <>
          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <KPI
              label={targetBrand || 'Target'}
              value={`${(targetSummary?.avgRating ?? 0).toFixed(1)} ★`}
              sub={`${targetSummary?.branches ?? 0} branches · ${(targetSummary?.totalReviews ?? 0).toLocaleString()} reviews`}
              color="indigo"
              badge={targetBrand ? 'TARGET' : undefined}
            />
            <KPI
              label="Competitors Avg"
              value={`${compAvgRating.toFixed(1)} ★`}
              sub={`${compSummaries.reduce((s, c) => s + c.branches, 0)} branches · ${compSummaries.reduce((s, c) => s + c.totalReviews, 0).toLocaleString()} reviews`}
              color="slate"
            />
            <KPI
              label="Rating Gap"
              value={`${isAhead ? '+' : ''}${ratingGap.toFixed(2)}`}
              sub={isAhead ? 'Target is ahead' : 'Target is behind'}
              color={isAhead ? 'emerald' : 'rose'}
            />
            <KPI
              label="Analysis Period"
              value={`${analytics.length} branches`}
              sub={periodLabel}
              color="amber"
            />
          </div>

          {/* Overall Reputation */}
          <Card>
            <SectionHeader title="Overall Reputation" sub="Your brand position vs each competitor" />
            <div className="mt-6">
              <div className="flex items-center gap-4 mb-6 p-5 rounded-2xl border-2 border-dashed" style={{
                borderColor: isAhead ? '#10B981' : '#F43F5E',
                backgroundColor: isAhead ? 'rgba(16,185,129,0.03)' : 'rgba(244,63,94,0.03)',
              }}>
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-black ${isAhead ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                  {isAhead ? '↑' : '↓'}
                </div>
                <div>
                  <div className="text-lg font-black text-slate-900">
                    {targetBrand || 'Target'} is {isAhead ? 'AHEAD' : 'BEHIND'} by {Math.abs(ratingGap).toFixed(2)} stars
                  </div>
                  <div className="text-sm text-slate-500 font-medium">
                    {(targetSummary?.avgRating ?? 0).toFixed(2)} ★ vs {compAvgRating.toFixed(2)} ★ competitors average
                    {targetSummary && ` · ${targetSummary.branches} branches · ${targetSummary.totalReviews.toLocaleString()} total reviews`}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                {compSummaries.map(comp => {
                  const tRating = targetSummary?.avgRating ?? 0;
                  const cRating = comp.avgRating ?? 0;
                  const gap = tRating - cRating;
                  const ahead = gap >= 0;
                  return (
                    <div key={comp.brand} className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <div className="flex items-center gap-2 min-w-[200px]">
                        <BrandBadge brand={targetBrand || 'Target'} color={targetSummary?.color || PALETTE[0]} />
                        <span className="text-[10px] font-black text-slate-400">vs</span>
                        <BrandBadge brand={comp.brand} color={comp.color} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden relative">
                            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(tRating / 5) * 100}%`, backgroundColor: targetSummary?.color || PALETTE[0] }} />
                          </div>
                          <span className="text-xs font-black text-slate-700 w-10 text-right">{tRating.toFixed(1)}</span>
                          <span className="text-[10px] text-slate-400">vs</span>
                          <span className="text-xs font-black text-slate-700 w-10">{cRating.toFixed(1)}</span>
                          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden relative">
                            <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(cRating / 5) * 100}%`, backgroundColor: comp.color }} />
                          </div>
                        </div>
                      </div>
                      <span className={`text-xs font-black px-3 py-1.5 rounded-lg shrink-0 ${ahead ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                        {ahead ? '+' : ''}{gap.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* Brand Comparison Table */}
          <Card>
            <SectionHeader title="Brand Comparison" sub="Aggregated performance per brand — current period" />
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Brand</th>
                    <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Avg Rating (Current Period)</th>
                    <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Total Reviews (Current Period)</th>
                    <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Total Branches</th>
                    <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Overall Avg Rating</th>
                    <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Overall Reviews</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {brandSummaries.map(b => (
                    <tr key={b.brand} className="hover:bg-slate-50/50">
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <BrandBadge brand={b.brand} color={b.color} />
                          {b.isTarget && <span className="text-[8px] font-black px-1.5 py-0.5 bg-indigo-50 text-indigo-600 rounded uppercase">Target</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-black text-slate-900">{b.currentMonthAvg?.toFixed(2) ?? '—'} ★</td>
                      <td className="px-3 py-3 text-right font-black text-slate-900">{b.currentMonthReviews.toLocaleString()}</td>
                      <td className="px-3 py-3 text-right font-black text-slate-900">{b.branches}</td>
                      <td className="px-3 py-3 text-right font-bold text-slate-600">{b.avgRating?.toFixed(2) ?? '—'} ★</td>
                      <td className="px-3 py-3 text-right font-bold text-slate-600">{b.totalReviews.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Star Distribution + Monthly Trend */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <SectionHeader title="Star Distribution" sub="5★ to 1★ breakdown per brand" />
              <div className="space-y-6 mt-6">
                {brandSummaries.map(b => {
                  const total = b.stars.reduce((s, n) => s + n, 0) || 1;
                  return (
                    <div key={b.brand}>
                      <div className="flex justify-between items-center mb-2">
                        <BrandBadge brand={b.brand} color={b.color} />
                        <span className="text-[10px] font-black text-slate-400">{total.toLocaleString()} reviews</span>
                      </div>
                      <div className="h-6 w-full flex rounded-lg overflow-hidden border border-slate-100">
                        <Seg n={b.stars[0]} t={total} c="#10B981" />
                        <Seg n={b.stars[1]} t={total} c="#34D399" />
                        <Seg n={b.stars[2]} t={total} c="#FBBF24" />
                        <Seg n={b.stars[3]} t={total} c="#FB7185" />
                        <Seg n={b.stars[4]} t={total} c="#F43F5E" />
                      </div>
                      <div className="grid grid-cols-5 mt-1 text-[9px] font-black text-slate-400">
                        {b.stars.map((c, i) => (
                          <span key={i} className={i === 0 ? 'text-left' : i === 4 ? 'text-right' : 'text-center'}>
                            {5 - i}★ {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card>
              <SectionHeader title="Monthly Trend" sub="Review volume & rating across 3 sub-periods (newest → oldest)" />
              <div className="space-y-6 mt-6">
                {brandSummaries.map(b => {
                  const maxR = Math.max(1, ...b.monthly.map(m => m.reviews));
                  return (
                    <div key={b.brand}>
                      <div className="flex items-center gap-2 mb-3">
                        <BrandBadge brand={b.brand} color={b.color} />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {b.monthly.map((m, i) => (
                          <div key={i} className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                            <div className="text-[9px] font-black text-slate-400 uppercase mb-1">Period {i + 1}</div>
                            <div className="text-lg font-black text-slate-900 leading-none">{m.reviews}</div>
                            <div className="text-[10px] font-bold text-slate-500 mt-0.5">{m.avg != null ? `${m.avg.toFixed(2)} ★` : '—'}</div>
                            <div className="mt-2 h-1 bg-slate-200 rounded overflow-hidden">
                              <div className="h-full" style={{ width: `${(m.reviews / maxR) * 100}%`, backgroundColor: b.color }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* City-wise Performance */}
          <Card>
            <SectionHeader title="City-wise Brand Performance" sub="How target and competitors compare in each city" />
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">City</th>
                    {brandSummaries.map(b => (
                      <th key={b.brand} className="px-3 py-3 text-center">
                        <BrandBadge brand={b.brand} color={b.color} />
                      </th>
                    ))}
                    <th className="px-3 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {cityBreakdown.slice(0, 20).map(row => (
                    <tr key={row.city} className="hover:bg-slate-50/50">
                      <td className="px-3 py-3 font-black text-slate-900 uppercase text-[11px] tracking-tight">{row.city}</td>
                      {brandSummaries.map(bs => {
                        const cell = row.brands.find(b => b.brand === bs.brand);
                        return (
                          <td key={bs.brand} className="px-3 py-3 text-center">
                            {cell ? (
                              <div>
                                <span className="font-black text-slate-900">{(cell.avgRating ?? 0).toFixed(1)} ★</span>
                                <span className="text-[10px] text-slate-400 ml-1">({cell.branches}b · {cell.reviews}r)</span>
                              </div>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-3 py-3 text-right font-black text-slate-500">{row.totalBranches}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════
          TAB: BRANCH DATA
         ═══════════════════════════════════════════════════════ */}
      {activeTab === 'branches' && (
        <>
          <Card>
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
              <SectionHeader
                title="Branch-wise Data"
                sub={`${filteredBranches.length} branches — all columns from the Excel report`}
              />
              <div className="flex flex-wrap gap-2">
                <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20">
                  <option value="All">All Brands</option>
                  {brandSummaries.map(b => <option key={b.brand} value={b.brand}>{b.brand}</option>)}
                </select>
                <select value={filterCity} onChange={e => setFilterCity(e.target.value)}
                        className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20">
                  <option value="All">All Cities</option>
                  {cities.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input type="text" placeholder="Search branch..." value={search} onChange={e => setSearch(e.target.value)}
                       className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 w-44" />
              </div>
            </div>

            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-left text-xs min-w-[1600px]">
                <thead>
                  <tr className="border-b border-slate-100">
                    <TH>Brand</TH>
                    <TH clickable onClick={() => handleSort('name')}>Branch Name {sortCol === 'name' ? (sortAsc ? '↑' : '↓') : ''}</TH>
                    <TH>Address</TH>
                    <TH>Maps</TH>
                    <TH>Hours</TH>
                    <TH>Phone</TH>
                    <TH>Peak Time</TH>
                    <TH>Busy Hours</TH>
                    <TH clickable onClick={() => handleSort('rating')} align="right">Avg ★ {sortCol === 'rating' ? (sortAsc ? '↑' : '↓') : ''}</TH>
                    <TH clickable onClick={() => handleSort('reviews')} align="right">Reviews {sortCol === 'reviews' ? (sortAsc ? '↑' : '↓') : ''}</TH>
                    <TH align="right">M1 Rev</TH>
                    <TH align="right">M1 ★</TH>
                    <TH align="right">M2 Rev</TH>
                    <TH align="right">M2 ★</TH>
                    <TH align="right">M3 Rev</TH>
                    <TH align="right">M3 ★</TH>
                    <TH align="center">5★</TH>
                    <TH align="center">4★</TH>
                    <TH align="center">3★</TH>
                    <TH align="center">2★</TH>
                    <TH align="center">1★</TH>
                    <TH align="right">Detail</TH>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredBranches.map(a => (
                    <tr key={a.id} className={`hover:bg-slate-50/50 transition-colors ${selectedId === a.id ? 'bg-indigo-50/40' : ''}`}>
                      <td className="px-2 py-3">
                        <BrandBadge brand={a.brand} color={colorMap[a.brand] || '#94A3B8'} />
                      </td>
                      <td className="px-2 py-3 font-black text-slate-900 whitespace-nowrap">{a.branch_name}</td>
                      <td className="px-2 py-3 text-[10px] text-slate-500 max-w-[180px] truncate" title={a.address || ''}>{a.address || '—'}</td>
                      <td className="px-2 py-3">
                        {a.google_maps_link ? (
                          <a href={a.google_maps_link} target="_blank" rel="noopener" className="text-[10px] font-bold text-indigo-500 hover:underline whitespace-nowrap">View Map</a>
                        ) : '—'}
                      </td>
                      <td className="px-2 py-3 text-[10px] text-slate-500 max-w-[140px] truncate" title={a.business_hours || ''}>{a.business_hours || '—'}</td>
                      <td className="px-2 py-3 text-[10px] text-slate-600 whitespace-nowrap">{a.phone || '—'}</td>
                      <td className="px-2 py-3 text-[10px] font-bold text-slate-600 whitespace-nowrap">{a.peak_time || '—'}</td>
                      <td className="px-2 py-3 text-[10px] text-slate-500 max-w-[140px] truncate" title={a.busy_hours_summary || ''}>{a.busy_hours_summary || '—'}</td>
                      <td className="px-2 py-3 text-right font-black text-slate-900">{a.avg_rating_period?.toFixed(2) ?? '—'}</td>
                      <td className="px-2 py-3 text-right font-black text-slate-900">{a.total_reviews_period}</td>
                      <td className="px-2 py-3 text-right text-slate-700 font-bold">{a.month_1_reviews}</td>
                      <td className="px-2 py-3 text-right text-slate-500">{a.month_1_avg_rating?.toFixed(2) ?? '—'}</td>
                      <td className="px-2 py-3 text-right text-slate-700 font-bold">{a.month_2_reviews}</td>
                      <td className="px-2 py-3 text-right text-slate-500">{a.month_2_avg_rating?.toFixed(2) ?? '—'}</td>
                      <td className="px-2 py-3 text-right text-slate-700 font-bold">{a.month_3_reviews}</td>
                      <td className="px-2 py-3 text-right text-slate-500">{a.month_3_avg_rating?.toFixed(2) ?? '—'}</td>
                      <td className="px-2 py-3 text-center text-emerald-600 font-bold">{a.star_5_count}</td>
                      <td className="px-2 py-3 text-center text-emerald-400 font-bold">{a.star_4_count}</td>
                      <td className="px-2 py-3 text-center text-amber-500 font-bold">{a.star_3_count}</td>
                      <td className="px-2 py-3 text-center text-rose-400 font-bold">{a.star_2_count}</td>
                      <td className="px-2 py-3 text-center text-rose-600 font-bold">{a.star_1_count}</td>
                      <td className="px-2 py-3 text-right">
                        <button onClick={() => setSelectedId(selectedId === a.id ? null : a.id)}
                                className="text-[10px] font-black px-2 py-1 rounded-md bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-600">
                          {selectedId === a.id ? 'Close' : 'View'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Selected Branch Detail */}
          {selected && (
            <Card>
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6 mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <BrandBadge brand={selected.brand} color={colorMap[selected.brand] || '#94A3B8'} />
                    {selected.brand === targetBrand && (
                      <span className="text-[9px] font-black px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded uppercase">Target</span>
                    )}
                  </div>
                  <h3 className="text-xl font-black text-slate-900 tracking-tight">{selected.branch_name}</h3>
                  {selected.address && <p className="text-xs text-slate-500 mt-1">{selected.address}</p>}
                  {selected.google_maps_link && (
                    <a href={selected.google_maps_link} target="_blank" rel="noopener" className="text-xs font-bold text-indigo-500 hover:underline mt-1 inline-block">
                      Open in Google Maps
                    </a>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Mini label="Avg Rating" value={selected.avg_rating_period?.toFixed(2) ?? '—'} unit="★" />
                  <Mini label="Reviews" value={selected.total_reviews_period.toString()} />
                  <Mini label="Peak" value={selected.peak_time || '—'} />
                  <Mini label="Phone" value={selected.phone || '—'} />
                </div>
              </div>

              {selected.business_hours && (
                <p className="text-[11px] font-bold text-slate-400 mb-2">
                  <span className="uppercase tracking-wider mr-2 text-slate-500">Hours:</span>{selected.business_hours}
                </p>
              )}
              {selected.busy_hours_summary && (
                <p className="text-[11px] font-bold text-slate-400 mb-4">
                  <span className="uppercase tracking-wider mr-2 text-slate-500">Busy:</span>{selected.busy_hours_summary}
                </p>
              )}

              {/* Monthly breakdown */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                {[
                  { label: 'Period 1 (Newest)', reviews: selected.month_1_reviews, avg: selected.month_1_avg_rating },
                  { label: 'Period 2', reviews: selected.month_2_reviews, avg: selected.month_2_avg_rating },
                  { label: 'Period 3 (Oldest)', reviews: selected.month_3_reviews, avg: selected.month_3_avg_rating },
                ].map((m, i) => (
                  <div key={i} className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="text-[9px] font-black text-slate-400 uppercase">{m.label}</div>
                    <div className="text-lg font-black text-slate-900 leading-none mt-1">{m.reviews} reviews</div>
                    <div className="text-[10px] font-bold text-slate-500">{m.avg != null ? `${m.avg.toFixed(2)} ★` : '—'}</div>
                  </div>
                ))}
              </div>

              {/* Star breakdown */}
              <div className="mb-6">
                <div className="h-5 w-full flex rounded-lg overflow-hidden border border-slate-100">
                  <Seg n={selected.star_5_count} t={selected.total_reviews_period || 1} c="#10B981" />
                  <Seg n={selected.star_4_count} t={selected.total_reviews_period || 1} c="#34D399" />
                  <Seg n={selected.star_3_count} t={selected.total_reviews_period || 1} c="#FBBF24" />
                  <Seg n={selected.star_2_count} t={selected.total_reviews_period || 1} c="#FB7185" />
                  <Seg n={selected.star_1_count} t={selected.total_reviews_period || 1} c="#F43F5E" />
                </div>
                <div className="grid grid-cols-5 mt-1 text-[9px] font-black text-slate-400">
                  <span>5★ {selected.star_5_count}</span>
                  <span className="text-center">4★ {selected.star_4_count}</span>
                  <span className="text-center">3★ {selected.star_3_count}</span>
                  <span className="text-center">2★ {selected.star_2_count}</span>
                  <span className="text-right">1★ {selected.star_1_count}</span>
                </div>
              </div>

              {/* Popular Times Heatmap for this branch */}
              {selected.popular_times_grid ? (
                <PopularTimesHeatmap grid={selected.popular_times_grid} />
              ) : (
                <p className="text-sm text-slate-400 italic">Popular times data not available for this branch.</p>
              )}
            </Card>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════
          TAB: RANKINGS
         ═══════════════════════════════════════════════════════ */}
      {activeTab === 'rankings' && (
        <Card>
          <SectionHeader title="Branch Rankings" sub={`All ${rankings.length} branches ranked by rating`} />
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-100">
                  <TH align="center">Rank</TH>
                  <TH>Brand</TH>
                  <TH>Branch</TH>
                  <TH>City</TH>
                  <TH>Address</TH>
                  <TH align="right">Avg Rating</TH>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rankings.map((a, i) => {
                  const isTop = i < 10;
                  const isBottom = i >= rankings.length - 10;
                  return (
                    <tr key={a.id} className={`hover:bg-slate-50/50 transition-colors ${isTop ? 'bg-emerald-50/30' : isBottom ? 'bg-rose-50/30' : ''}`}>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-black ${
                          isTop ? 'bg-emerald-100 text-emerald-700' : isBottom ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {i + 1}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <BrandBadge brand={a.brand} color={colorMap[a.brand] || '#94A3B8'} />
                      </td>
                      <td className="px-3 py-3 font-black text-slate-900">{a.branch_name}</td>
                      <td className="px-3 py-3 text-slate-500 uppercase text-[11px] tracking-tight">{a.city || '—'}</td>
                      <td className="px-3 py-3 text-[10px] text-slate-500 max-w-[250px] truncate" title={a.address || ''}>{a.address || '—'}</td>
                      <td className="px-3 py-3 text-right">
                        <span className={`font-black ${isTop ? 'text-emerald-600' : isBottom ? 'text-rose-600' : 'text-slate-900'}`}>
                          {a.avg_rating_period?.toFixed(2)} ★
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ═══════════════════════════════════════════════════════
          TAB: POPULAR TIMES
         ═══════════════════════════════════════════════════════ */}
      {activeTab === 'popular-times' && (
        <>
          <Card>
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
              <SectionHeader
                title="Popular Times"
                sub={`${ptBranches.length} branches have popular times data`}
              />
              <select value={ptBrandFilter} onChange={e => { setPtBrandFilter(e.target.value); setPtSelectedId(null); }}
                      className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20">
                <option value="All">All Brands</option>
                {brandSummaries.map(b => <option key={b.brand} value={b.brand}>{b.brand}</option>)}
              </select>
            </div>

            {/* Peak Hours Summary Table */}
            <div className="overflow-x-auto mb-6">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    <TH>Brand</TH>
                    <TH>Branch</TH>
                    <TH>City</TH>
                    <TH>Peak Day</TH>
                    <TH>Peak Hour</TH>
                    <TH align="right">Peak Busyness</TH>
                    <TH>Busy Hours</TH>
                    <TH align="right">Heatmap</TH>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {ptBranches.map(a => (
                    <tr key={a.id} className={`hover:bg-slate-50/50 transition-colors ${ptSelectedId === a.id ? 'bg-indigo-50/40' : ''}`}>
                      <td className="px-2 py-3"><BrandBadge brand={a.brand} color={colorMap[a.brand] || '#94A3B8'} /></td>
                      <td className="px-2 py-3 font-black text-slate-900">{a.branch_name}</td>
                      <td className="px-2 py-3 text-slate-500 uppercase text-[11px]">{a.city || '—'}</td>
                      <td className="px-2 py-3 font-bold text-slate-700">{a.peak_day || '—'}</td>
                      <td className="px-2 py-3 font-bold text-slate-700">{a.peak_hour || '—'}</td>
                      <td className="px-2 py-3 text-right">
                        {a.peak_busyness_pct != null ? (
                          <span className={`font-black ${a.peak_busyness_pct >= 80 ? 'text-rose-600' : a.peak_busyness_pct >= 50 ? 'text-amber-600' : 'text-slate-700'}`}>
                            {a.peak_busyness_pct}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-2 py-3 text-[10px] text-slate-500 max-w-[200px] truncate" title={a.busy_hours_summary || ''}>{a.busy_hours_summary || '—'}</td>
                      <td className="px-2 py-3 text-right">
                        <button onClick={() => setPtSelectedId(ptSelectedId === a.id ? null : a.id)}
                                className="text-[10px] font-black px-2 py-1 rounded-md bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-600">
                          {ptSelectedId === a.id ? 'Hide' : 'Show'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {ptBranches.length === 0 && (
              <p className="text-sm text-slate-400 italic text-center py-8">No popular times data available. Run an analysis to scrape popular times.</p>
            )}
          </Card>

          {/* Selected Popular Times Heatmap */}
          {ptSelected?.popular_times_grid && (
            <Card>
              <div className="flex items-center gap-3 mb-4">
                <BrandBadge brand={ptSelected.brand} color={colorMap[ptSelected.brand] || '#94A3B8'} />
                <h3 className="text-lg font-black text-slate-900">{ptSelected.branch_name}</h3>
                {ptSelected.city && <span className="text-xs text-slate-400 uppercase">{ptSelected.city}</span>}
              </div>
              <PopularTimesHeatmap grid={ptSelected.popular_times_grid} />
            </Card>
          )}

          {/* Brand-wise Popular Times Comparison */}
          {ptBranches.length > 0 && (
            <Card>
              <SectionHeader title="Peak Hours by Brand" sub="Average peak busyness comparison across brands" />
              <div className="mt-6 space-y-4">
                {brandSummaries.map(bs => {
                  const brandBranches = ptBranches.filter(a => a.brand === bs.brand);
                  if (brandBranches.length === 0) return null;
                  const avgPeak = brandBranches.reduce((s, a) => s + (a.peak_busyness_pct ?? 0), 0) / brandBranches.length;
                  const peakDays = brandBranches.map(a => a.peak_day).filter(Boolean);
                  const mostCommonPeakDay = peakDays.length > 0
                    ? peakDays.sort((a, b) => peakDays.filter(v => v === a).length - peakDays.filter(v => v === b).length).pop()
                    : '—';
                  return (
                    <div key={bs.brand} className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <BrandBadge brand={bs.brand} color={bs.color} />
                      <div className="flex-1">
                        <div className="h-3 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${avgPeak}%`, backgroundColor: bs.color }} />
                        </div>
                      </div>
                      <div className="text-right min-w-[120px]">
                        <div className="text-xs font-black text-slate-900">{avgPeak.toFixed(0)}% avg peak</div>
                        <div className="text-[10px] text-slate-500">{brandBranches.length} branches · {mostCommonPeakDay}</div>
                      </div>
                    </div>
                  );
                }).filter(Boolean)}
              </div>
            </Card>
          )}
        </>
      )}

    </div>
  );
}


// ── Popular Times Heatmap Component ──

function PopularTimesHeatmap({ grid }: { grid: Record<string, (number | null)[]> }) {
  return (
    <div className="overflow-x-auto">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Popular Times Heatmap</p>
      <div className="min-w-[640px]">
        <div className="grid gap-1" style={{ gridTemplateColumns: 'auto repeat(24, minmax(0,1fr))' }}>
          <div />
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} className="text-[8px] font-black text-slate-400 text-center">{hourLabel(h)}</div>
          ))}
          {DAYS.map(day => {
            const hourly = grid[day] || [];
            return (
              <React.Fragment key={day}>
                <div className="text-[10px] font-black text-slate-500 uppercase pr-2 flex items-center">{DAY_LABELS[day]}</div>
                {Array.from({ length: 24 }).map((_, h) => {
                  const v = hourly[h];
                  const alpha = v == null ? 0 : Math.max(0.05, v / 100);
                  return (
                    <div key={h}
                         className="aspect-square rounded-[2px] transition-transform hover:scale-150 hover:z-10 cursor-help"
                         style={{ backgroundColor: v == null ? '#F1F5F9' : `rgba(79, 70, 229, ${alpha})` }}
                         title={v == null ? `${DAY_LABELS[day]} ${hourLabel(h)} — no data` : `${DAY_LABELS[day]} ${hourLabel(h)} — ${v}%`} />
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          <span>Quiet</span>
          <div className="h-1 flex-1 mx-4 bg-gradient-to-r from-slate-100 to-indigo-600 rounded-full" />
          <span>Peak</span>
        </div>
      </div>
    </div>
  );
}


// ── Helper Components ──

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-6 md:p-8 bg-white rounded-2xl md:rounded-3xl border border-slate-100 shadow-lg shadow-slate-200/30 ${className || ''}`}>{children}</div>;
}

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h3 className="text-lg font-black text-slate-900 tracking-tight">{title}</h3>
      <p className="text-xs font-medium text-slate-500 mt-0.5">{sub}</p>
    </div>
  );
}

function KPI({ label, value, sub, color, badge }: { label: string; value: string; sub: string; color: string; badge?: string }) {
  const palettes: Record<string, string> = {
    indigo: 'border-indigo-200 bg-indigo-50/50',
    emerald: 'border-emerald-200 bg-emerald-50/50',
    rose: 'border-rose-200 bg-rose-50/50',
    amber: 'border-amber-200 bg-amber-50/50',
    slate: 'border-slate-200 bg-slate-50/50',
  };
  return (
    <div className={`p-5 rounded-2xl border ${palettes[color] || palettes.slate}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{label}</span>
        {badge && <span className="text-[8px] font-black px-1.5 py-0.5 bg-indigo-600 text-white rounded uppercase">{badge}</span>}
      </div>
      <div className="text-2xl font-black text-slate-900 leading-none">{value}</div>
      <div className="text-[10px] font-bold text-slate-500 mt-1">{sub}</div>
    </div>
  );
}

function BrandBadge({ brand, color }: { brand: string; color: string }) {
  return (
    <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase text-white shadow-sm whitespace-nowrap"
          style={{ backgroundColor: color }}>
      {brand}
    </span>
  );
}

function Seg({ n, t, c }: { n: number; t: number; c: string }) {
  const pct = (n / t) * 100;
  if (pct === 0) return null;
  return (
    <div className="h-full first:rounded-l-lg last:rounded-r-lg transition-all duration-700"
         style={{ width: `${pct}%`, backgroundColor: c }}
         title={`${n} (${pct.toFixed(0)}%)`} />
  );
}

function Mini({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
      <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</div>
      <div className="text-sm font-black text-slate-900 mt-1 leading-none">
        {value}{unit && <span className="text-xs font-bold text-slate-500 ml-1">{unit}</span>}
      </div>
    </div>
  );
}

function TH({ children, clickable, onClick, align }: { children: React.ReactNode; clickable?: boolean; onClick?: () => void; align?: 'right' | 'center' }) {
  const base = `px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap ${align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : ''}`;
  if (clickable) {
    return <th className={`${base} cursor-pointer hover:text-indigo-600 select-none`} onClick={onClick}>{children}</th>;
  }
  return <th className={base}>{children}</th>;
}
