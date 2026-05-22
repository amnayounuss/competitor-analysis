'use client';

import React, { useMemo, useState } from 'react';
import type { Job } from '@/lib/types';

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
  popular_times_grid: Record<string, (number|null)[]> | null;
  date_start: string | null;
  date_end: string | null;
  branches?: {
    stars: number;
    reviews_count: number;
  } | null;
}

function getBranchRating(a: BranchAnalytics): number {
  if (a.branches && typeof a.branches === 'object' && a.branches.stars != null) {
    return Number(a.branches.stars);
  }
  return a.avg_rating_period ?? 0;
}

interface Review {
  id: number;
  brand: string;
  rating: number | null;
  text: string | null;
  reviewer_name: string | null;
  published_at: string | null;
  branch_id?: string | null;
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
  job: Job;
  data: {
    analytics: BranchAnalytics[];
    reviews: Review[];
    analyses: Analysis[];
  };
}

const PALETTE = ['#4F46E5', '#10B981', '#EF4444', '#F59E0B', '#0EA5E9', '#A855F7', '#EC4899'];
const DAYS = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
const DAY_LABEL: Record<string, string> = {
  SUNDAY:'Sun', MONDAY:'Mon', TUESDAY:'Tue', WEDNESDAY:'Wed',
  THURSDAY:'Thu', FRIDAY:'Fri', SATURDAY:'Sat',
};

function hourLabel(h: number) {
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

function fmtDate(iso?: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year:'numeric', month:'short', day:'numeric' });
}

export default function AnalysisDashboard({ job, data }: DashboardProps) {
  const { analytics, reviews, analyses } = data;

  const [filterBrand, setFilterBrand] = useState('All');
  const [filterCity, setFilterCity]   = useState('All');
  const [search, setSearch]           = useState('');
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [reviewLimit, setReviewLimit] = useState(10);

  const brandColor = useMemo(() => {
    const map: Record<string, string> = {};
    const brands = Array.from(new Set([job.target_name, ...job.competitors, ...analytics.map(a => a.brand)]));
    brands.forEach((b, i) => { map[b] = PALETTE[i % PALETTE.length]; });
    return map;
  }, [job, analytics]);

  const stats = useMemo(() => {
    const totalBranches = analytics.length;
    const totalReviews  = analytics.reduce((s, a) => s + a.total_reviews_period, 0);
    const weightedAvg   = totalBranches > 0
      ? analytics.reduce((s, a) => s + getBranchRating(a), 0) / totalBranches
      : 0;
    const branchesWithPT = analytics.filter(a => a.popular_times_grid).length;
    const cities = Array.from(new Set(analytics.map(a => a.city).filter(Boolean))) as string[];
    return { totalBranches, totalReviews, weightedAvg, branchesWithPT, cities };
  }, [analytics]);

  const brandStats = useMemo(() => {
    const acc: Record<string, {
      brand: string; branchCount: number; reviews: number; ratingSum: number; ratingW: number;
      s5: number; s4: number; s3: number; s2: number; s1: number;
      m1r: number; m1rs: number; m1rw: number;
      m2r: number; m2rs: number; m2rw: number;
      m3r: number; m3rs: number; m3rw: number;
    }> = {};
    for (const a of analytics) {
      if (!acc[a.brand]) acc[a.brand] = {
        brand: a.brand, branchCount: 0, reviews: 0, ratingSum: 0, ratingW: 0,
        s5:0,s4:0,s3:0,s2:0,s1:0,
        m1r:0, m1rs:0, m1rw:0, m2r:0, m2rs:0, m2rw:0, m3r:0, m3rs:0, m3rw:0,
      };
      const x = acc[a.brand];
      x.branchCount += 1;
      x.reviews     += a.total_reviews_period;
      const branchRating = getBranchRating(a);
      if (branchRating > 0) {
        x.ratingSum += branchRating;
        x.ratingW   += 1;
      }
      x.s5 += a.star_5_count; x.s4 += a.star_4_count;
      x.s3 += a.star_3_count; x.s2 += a.star_2_count; x.s1 += a.star_1_count;
      x.m1r += a.month_1_reviews;
      if (a.month_1_avg_rating != null) { x.m1rs += a.month_1_avg_rating * a.month_1_reviews; x.m1rw += a.month_1_reviews; }
      x.m2r += a.month_2_reviews;
      if (a.month_2_avg_rating != null) { x.m2rs += a.month_2_avg_rating * a.month_2_reviews; x.m2rw += a.month_2_reviews; }
      x.m3r += a.month_3_reviews;
      if (a.month_3_avg_rating != null) { x.m3rs += a.month_3_avg_rating * a.month_3_reviews; x.m3rw += a.month_3_reviews; }
    }
    return Object.values(acc).map(x => ({
      brand: x.brand,
      branches: x.branchCount,
      reviews: x.reviews,
      avg: x.ratingW > 0 ? +(x.ratingSum / x.ratingW).toFixed(2) : null,
      stars: [x.s5, x.s4, x.s3, x.s2, x.s1],
      monthly: [
        { reviews: x.m1r, avg: x.m1rw > 0 ? +(x.m1rs / x.m1rw).toFixed(2) : null },
        { reviews: x.m2r, avg: x.m2rw > 0 ? +(x.m2rs / x.m2rw).toFixed(2) : null },
        { reviews: x.m3r, avg: x.m3rw > 0 ? +(x.m3rs / x.m3rw).toFixed(2) : null },
      ],
    })).sort((a, b) => (b.avg ?? 0) - (a.avg ?? 0));
  }, [analytics]);

  const rankings = useMemo(() => {
    return [...analytics]
      .filter(a => getBranchRating(a) > 0)
      .sort((a, b) =>
        (getBranchRating(b) - getBranchRating(a)) ||
        (b.total_reviews_period - a.total_reviews_period)
      );
  }, [analytics]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return analytics.filter(a => {
      if (filterBrand !== 'All' && a.brand !== filterBrand) return false;
      if (filterCity  !== 'All' && a.city  !== filterCity)  return false;
      if (q && !`${a.branch_name} ${a.city || ''} ${a.address || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [analytics, filterBrand, filterCity, search]);

  const selected = useMemo(() => {
    if (selectedId) return analytics.find(a => a.id === selectedId);
    return analytics.find(a => a.brand === job.target_name && a.popular_times_grid) || analytics[0];
  }, [analytics, selectedId, job.target_name]);

  const selectedReviews = useMemo(() => {
    if (!selected) return [];
    if (!selected.branch_id) return [];
    return reviews.filter(r => r.branch_id === selected.branch_id);
  }, [reviews, selected]);

  const periodLabel = useMemo(() => {
    const s = job.date_start || analytics.find(a => a.date_start)?.date_start;
    const e = job.date_end   || analytics.find(a => a.date_end)?.date_end;
    if (s && e) return `${fmtDate(s)} → ${fmtDate(e)}`;
    return 'Last 90 days';
  }, [job, analytics]);

  // Empty state — old job that ran before branch_analytics existed
  if (analytics.length === 0) {
    return (
      <div className="p-12 bg-white rounded-3xl border border-dashed border-slate-200 text-center">
        <h3 className="text-xl font-black text-slate-900 mb-2">No analytics rows for this job</h3>
        <p className="text-slate-500 mb-6 max-w-md mx-auto">
          This job ran before the new <code className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">branch_analytics</code> table existed.
          Run a fresh analysis to populate the dashboard, or open the Excel below.
        </p>
        {job.excel_url && (
          <a href={job.excel_url} className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-sm hover:bg-indigo-700">
            Download Excel
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">

      {/* ── Header ── */}
      <header className="relative p-8 rounded-[2rem] bg-white border border-slate-100 shadow-xl shadow-slate-200/40 overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50/50 rounded-full blur-3xl -mr-32 -mt-32" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="px-3 py-1 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-widest rounded-full border border-emerald-100">Analysis Complete</span>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{periodLabel}</span>
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight leading-none mb-2">
              {job.target_name}
              <span className="text-slate-400 font-light"> vs </span>
              <span className="text-indigo-600">{job.competitors.join(', ')}</span>
            </h1>
            <p className="text-slate-500 font-medium max-w-2xl">
              Across {stats.totalBranches} locations and {stats.totalReviews.toLocaleString()} customer reviews.
            </p>
          </div>
          <div className="flex gap-3">
            {job.excel_url && (
              <a href={job.excel_url} download className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 font-bold text-sm rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm active:scale-95">
                <DownloadIcon />
                Export Excel
              </a>
            )}
            {job.report_url && (
              <a href={job.report_url} download className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 font-bold text-sm rounded-2xl hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm active:scale-95">
                Report .md
              </a>
            )}
          </div>
        </div>
      </header>

      {/* ── KPI bar ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPI label="Branches" value={stats.totalBranches.toString()} sub={`${stats.cities.length} cities`} color="indigo" />
        <KPI label="Reviews" value={stats.totalReviews.toLocaleString()} sub={periodLabel} color="emerald" />
        <KPI label="Weighted Avg" value={`${stats.weightedAvg.toFixed(2)} ★`} sub="Across all reviews" color="amber" />
        <KPI label="Popular Times" value={`${stats.branchesWithPT} / ${stats.totalBranches}`} sub="Branches covered" color="slate" />
      </div>

      {/* ── Brand Comparison ── */}
      <Card>
        <SectionHeader title="Brand Comparison" sub="Sheet 2: how each brand performs against the others" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-8">
          {/* Avg rating bars */}
          <div>
            <p className="text-[10px] font-black uppercase text-slate-400 mb-6 tracking-widest">Average Rating</p>
            <div className="flex items-end gap-4 h-48">
              {brandStats.map(b => (
                <div key={b.brand} className="flex-1 flex flex-col items-center gap-3 group">
                  <div className="w-full relative">
                    <div className="w-full rounded-t-xl transition-all duration-1000 group-hover:brightness-110"
                         style={{ height: `${((b.avg ?? 0) / 5) * 160}px`, backgroundColor: brandColor[b.brand] || '#94A3B8' }} />
                    <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-black text-slate-900">{(b.avg ?? 0).toFixed(2)}</span>
                  </div>
                  <span className="text-[10px] font-black uppercase text-slate-500 truncate w-full text-center">{b.brand}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Review market share donut */}
          <div className="flex flex-col items-center">
            <p className="text-[10px] font-black uppercase text-slate-400 mb-6 tracking-widest">Review Share</p>
            <Donut data={brandStats.map(b => ({ label: b.brand, value: b.reviews, color: brandColor[b.brand] || '#94A3B8' }))} />
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {brandStats.map(b => (
                <div key={b.brand} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: brandColor[b.brand] || '#94A3B8' }} />
                  <span className="text-[10px] font-black text-slate-500 uppercase">{b.brand}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Summary table */}
          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Quick Summary</p>
            {brandStats.map(b => (
              <div key={b.brand} className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-black text-slate-900">{b.brand}</span>
                  <span className="text-[10px] font-black text-slate-500">{b.branches} branches · {b.reviews.toLocaleString()} reviews</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full" style={{ width: `${((b.avg ?? 0) / 5) * 100}%`, backgroundColor: brandColor[b.brand] || '#94A3B8' }} />
                  </div>
                  <span className="text-[10px] font-black w-8 text-right">{(b.avg ?? 0).toFixed(2)} ★</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* ── Star distribution + Monthly trend ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card>
          <SectionHeader title="Star Distribution" sub="Sentiment split per brand" />
          <div className="space-y-6 mt-8">
            {brandStats.map(b => {
              const total = b.stars.reduce((s, n) => s + n, 0) || 1;
              return (
                <div key={b.brand}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-black text-slate-900">{b.brand}</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{total.toLocaleString()} total</span>
                  </div>
                  <div className="h-5 w-full flex rounded-lg overflow-hidden border border-slate-100">
                    <Seg n={b.stars[0]} t={total} c="#10B981" title="5★" />
                    <Seg n={b.stars[1]} t={total} c="#34D399" title="4★" />
                    <Seg n={b.stars[2]} t={total} c="#FBBF24" title="3★" />
                    <Seg n={b.stars[3]} t={total} c="#FB7185" title="2★" />
                    <Seg n={b.stars[4]} t={total} c="#F43F5E" title="1★" />
                  </div>
                  <div className="grid grid-cols-5 mt-1 text-[9px] font-black text-slate-400 tracking-tight">
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
          <SectionHeader title="Window Trend" sub="Three equal sub-periods within the analysis window" />
          <div className="space-y-8 mt-8">
            {brandStats.map(b => {
              const maxR = Math.max(1, ...b.monthly.map(m => m.reviews));
              return (
                <div key={b.brand}>
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-xs font-black text-slate-900">{b.brand}</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Newest → Oldest</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {b.monthly.map((m, i) => (
                      <div key={i} className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <div className="text-[9px] font-black text-slate-400 uppercase tracking-tight mb-1">Period {i+1}</div>
                        <div className="text-lg font-black text-slate-900 leading-none">{m.reviews}</div>
                        <div className="text-[10px] font-bold text-slate-500 mt-0.5">{m.avg != null ? `${m.avg.toFixed(2)} ★` : 'No data'}</div>
                        <div className="mt-2 h-1 bg-slate-200 rounded overflow-hidden">
                          <div className="h-full" style={{ width: `${(m.reviews / maxR) * 100}%`, backgroundColor: brandColor[b.brand] || '#94A3B8' }} />
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

      {/* ── Rankings ── */}
      <Card>
        <SectionHeader title="Rankings" sub={`Sheet 3: top ${Math.min(20, rankings.length)} of ${rankings.length} branches`} />
        <div className="overflow-x-auto mt-8">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest w-12">#</th>
                <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Brand</th>
                <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Branch</th>
                <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">City</th>
                <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Rating</th>
                <th className="pb-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Reviews</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rankings.slice(0, 20).map((a, i) => (
                <tr key={a.id} className="hover:bg-slate-50/50 transition-colors cursor-pointer"
                    onClick={() => setSelectedId(a.id)}>
                  <td className="py-3 font-black text-slate-400 text-xs">{i + 1}</td>
                  <td className="py-3">
                    <span className="px-2 py-0.5 rounded text-[9px] font-black uppercase text-white shadow-sm"
                          style={{ backgroundColor: brandColor[a.brand] || '#94A3B8' }}>
                      {a.brand}
                    </span>
                  </td>
                  <td className="py-3 font-black text-slate-900 text-xs">{a.branch_name}</td>
                  <td className="py-3 text-slate-500 text-xs uppercase tracking-tighter">{a.city || '—'}</td>
                  <td className="py-3 text-right">
                    <span className="text-xs font-black text-slate-900">{getBranchRating(a).toFixed(2)} ★</span>
                  </td>
                  <td className="py-3 text-right font-black text-slate-900 text-xs">{a.total_reviews_period}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Branch Wise Data ── */}
      <Card>
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
          <SectionHeader title="Branch Wise Data" sub={`Sheet 1: ${filtered.length} of ${analytics.length} branches`} />
          <div className="flex flex-wrap gap-2">
            <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="All">All Brands</option>
              {brandStats.map(b => <option key={b.brand} value={b.brand}>{b.brand}</option>)}
            </select>
            <select value={filterCity} onChange={e => setFilterCity(e.target.value)}
                    className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20">
              <option value="All">All Cities</option>
              {stats.cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}
                   className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 w-44" />
          </div>
        </div>

        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Brand</th>
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Branch</th>
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">City</th>
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest">Peak Time</th>
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Avg ★</th>
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Reviews</th>
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">M1/M2/M3</th>
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">5/4/3/2/1 ★</th>
                <th className="px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">View</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.slice(0, 50).map(a => (
                <tr key={a.id} className={`hover:bg-slate-50/50 transition-colors ${selectedId === a.id ? 'bg-indigo-50/40' : ''}`}>
                  <td className="px-2 py-3">
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase text-white"
                          style={{ backgroundColor: brandColor[a.brand] || '#94A3B8' }}>{a.brand}</span>
                  </td>
                  <td className="px-2 py-3">
                    <div className="font-black text-slate-900">{a.branch_name}</div>
                    {a.google_maps_link && (
                      <a href={a.google_maps_link} target="_blank" rel="noopener" className="text-[10px] font-bold text-indigo-500 hover:underline">Maps ↗</a>
                    )}
                  </td>
                  <td className="px-2 py-3 text-slate-500 uppercase tracking-tight">{a.city || '—'}</td>
                  <td className="px-2 py-3 text-slate-600 text-[10px] font-bold">{a.peak_time || '—'}</td>
                  <td className="px-2 py-3 text-right font-black text-slate-900">{getBranchRating(a).toFixed(2)}</td>
                  <td className="px-2 py-3 text-right font-black text-slate-900">{a.total_reviews_period}</td>
                  <td className="px-2 py-3 text-center text-[10px] font-bold text-slate-500">
                    {a.month_1_reviews}/{a.month_2_reviews}/{a.month_3_reviews}
                  </td>
                  <td className="px-2 py-3 text-center text-[10px] font-bold text-slate-500">
                    {a.star_5_count}/{a.star_4_count}/{a.star_3_count}/{a.star_2_count}/{a.star_1_count}
                  </td>
                  <td className="px-2 py-3 text-right">
                    <button onClick={() => setSelectedId(a.id)}
                            className="text-[10px] font-black px-2 py-1 rounded-md bg-slate-100 hover:bg-indigo-100 hover:text-indigo-700 text-slate-600">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 50 && (
            <p className="text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest py-3">
              Showing first 50 — refine filters to see more
            </p>
          )}
        </div>
      </Card>

      {/* ── Selected branch detail + Popular Times heatmap ── */}
      {selected && (
        <Card>
          <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
            <div>
              <SectionHeader title={selected.branch_name}
                             sub={`Sheet 5 view · ${selected.brand}${selected.city ? ` · ${selected.city}` : ''}`} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                <Mini label="Avg Rating" value={getBranchRating(selected).toFixed(2)} unit="★" />
                <Mini label="Reviews" value={selected.total_reviews_period.toString()} />
                <Mini label="Peak Day" value={selected.peak_day || '—'} />
                <Mini label="Peak Hour" value={selected.peak_hour || '—'}
                      unit={selected.peak_busyness_pct != null ? `${selected.peak_busyness_pct}%` : ''} />
              </div>
              {selected.address && (
                <p className="text-xs font-medium text-slate-500 mt-4">
                  {selected.address}
                  {selected.google_maps_link && <a href={selected.google_maps_link} target="_blank" rel="noopener" className="ml-2 text-indigo-500 hover:underline">Open in Maps ↗</a>}
                </p>
              )}
              {selected.business_hours && (
                <p className="text-[11px] font-bold text-slate-400 mt-2 leading-relaxed">
                  <span className="uppercase tracking-wider mr-2">Hours</span>{selected.business_hours}
                </p>
              )}
              {selected.busy_hours_summary && (
                <p className="text-[11px] font-bold text-slate-400 mt-1 leading-relaxed">
                  <span className="uppercase tracking-wider mr-2">Busy</span>{selected.busy_hours_summary}
                </p>
              )}
            </div>
          </div>

          {/* Heatmap */}
          <div className="mt-8 overflow-x-auto">
            {selected.popular_times_grid ? (
              <div className="min-w-[640px]">
                <div className="grid gap-1" style={{ gridTemplateColumns: 'auto repeat(24, minmax(0,1fr))' }}>
                  <div />
                  {Array.from({ length: 24 }).map((_, h) => (
                    <div key={h} className="text-[8px] font-black text-slate-400 text-center">{hourLabel(h)}</div>
                  ))}
                  {DAYS.map(day => {
                    const hourly = selected.popular_times_grid?.[day] || [];
                    return (
                      <React.Fragment key={day}>
                        <div className="text-[10px] font-black text-slate-500 uppercase pr-2 flex items-center">{DAY_LABEL[day]}</div>
                        {Array.from({ length: 24 }).map((_, h) => {
                          const v = hourly[h];
                          const alpha = v == null ? 0 : Math.max(0.05, v / 100);
                          return (
                            <div key={h}
                                 className="aspect-square rounded-[2px] transition-transform hover:scale-150 hover:z-10 cursor-help"
                                 style={{ backgroundColor: v == null ? '#F1F5F9' : `rgba(79, 70, 229, ${alpha})` }}
                                 title={v == null ? `${DAY_LABEL[day]} ${hourLabel(h)} — no data` : `${DAY_LABEL[day]} ${hourLabel(h)} — ${v}%`} />
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>
                <div className="mt-4 flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  <span>Quiet</span>
                  <div className="h-1 flex-1 mx-4 bg-gradient-to-r from-slate-100 to-indigo-600 rounded-full" />
                  <span>Peak</span>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400 italic">Popular times data not available for this branch.</p>
            )}
          </div>
        </Card>
      )}

      {/* ── Reviews for selected branch ── */}
      {selected && selectedReviews.length > 0 && (
        <Card>
          <SectionHeader title="Reviews for this branch" sub={`Sheet 4 slice — ${selectedReviews.length} reviews`} />
          <div className="space-y-3 mt-6">
            {selectedReviews.slice(0, reviewLimit).map(r => (
              <div key={r.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center font-black text-slate-400 text-xs">
                      {(r.reviewer_name || '?')[0]}
                    </div>
                    <div>
                      <p className="text-xs font-black text-slate-900">{r.reviewer_name || 'Anonymous'}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">{fmtDate(r.published_at)}</p>
                    </div>
                  </div>
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <svg key={i} className={`w-3 h-3 ${i < (r.rating || 0) ? 'text-amber-400' : 'text-slate-200'}`}
                           fill="currentColor" viewBox="0 0 20 20">
                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                      </svg>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed font-medium">{r.text || <em className="text-slate-400">No comment.</em>}</p>
              </div>
            ))}
          </div>
          {selectedReviews.length > reviewLimit && (
            <button onClick={() => setReviewLimit(n => n + 20)}
                    className="mt-4 w-full py-2 text-xs font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-xl">
              Show {Math.min(20, selectedReviews.length - reviewLimit)} more
            </button>
          )}
        </Card>
      )}
    </div>
  );
}

// ── helpers ──
function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`p-6 md:p-8 bg-white rounded-3xl md:rounded-[2rem] border border-slate-100 shadow-xl shadow-slate-200/40 ${className || ''}`}>{children}</div>;
}
function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h3 className="text-xl font-black text-slate-900 tracking-tight leading-tight">{title}</h3>
      <p className="text-xs font-medium text-slate-500 mt-1">{sub}</p>
    </div>
  );
}
function KPI({ label, value, sub, color }: any) {
  const palette: Record<string, string> = {
    indigo: 'bg-indigo-600 text-white shadow-indigo-600/20',
    emerald:'bg-emerald-600 text-white shadow-emerald-600/20',
    amber:  'bg-amber-500 text-white shadow-amber-500/20',
    slate:  'bg-slate-700 text-white shadow-slate-700/20',
  };
  return (
    <div className="bg-white p-5 rounded-2xl border border-slate-100 shadow-md shadow-slate-200/40">
      <div className={`inline-flex px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest mb-3 ${palette[color] || palette.slate}`}>{label}</div>
      <div className="text-2xl font-black text-slate-900 leading-none">{value}</div>
      <div className="text-[10px] font-bold text-slate-500 mt-1">{sub}</div>
    </div>
  );
}
function Seg({ n, t, c, title }: { n: number; t: number; c: string; title: string }) {
  const pct = (n / t) * 100;
  if (pct === 0) return null;
  return <div className="h-full first:rounded-l-lg last:rounded-r-lg transition-all duration-1000"
              style={{ width: `${pct}%`, backgroundColor: c }} title={`${title}: ${n} (${pct.toFixed(0)}%)`} />;
}
function Mini({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
      <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</div>
      <div className="text-base font-black text-slate-900 mt-1 leading-none">
        {value}{unit && <span className="text-xs font-bold text-slate-500 ml-1">{unit}</span>}
      </div>
    </div>
  );
}
function Donut({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  let offset = 0;
  const C = 2 * Math.PI * 40;
  return (
    <svg className="w-32 h-32 transform -rotate-90" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="40" fill="transparent" stroke="#F1F5F9" strokeWidth="12" />
      {data.map(d => {
        const pct = d.value / total;
        const dash = pct * C;
        const node = (
          <circle key={d.label} cx="50" cy="50" r="40" fill="transparent"
                  stroke={d.color} strokeWidth="12"
                  strokeDasharray={`${dash} ${C - dash}`}
                  strokeDashoffset={-offset}
                  className="transition-all duration-1000" />
        );
        offset += dash;
        return node;
      })}
    </svg>
  );
}
function DownloadIcon() {
  return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
  </svg>;
}
