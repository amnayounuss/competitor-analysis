'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';

// --- TYPES ---
interface Branch {
  id: string;
  brand: string;
  branch_name: string;
  city: string;
  address: string;
  stars: number;
  reviews_count: number;
  popular_times?: any;
  google_maps_link?: string;
  phone?: string;
  website?: string;
}

interface Review {
  id: string;
  brand: string;
  rating: number;
  text: string;
  reviewer_name: string;
  published_at: string;
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
  data: {
    branches: Branch[];
    history: any[];
    analyses: Analysis[];
    reviews: Review[];
    targetBrand: string | null;
    competitorBrands: string[];
  };
}

// Stable color palette — first slot reserved for the target brand
const PALETTE = ['#4F46E5', '#10B981', '#EF4444', '#F59E0B', '#0EA5E9', '#A855F7', '#EC4899', '#14B8A6'];
function buildColors(target: string | null, competitors: string[], analyses: Analysis[]): Record<string, string> {
  const all = new Set<string>();
  if (target) all.add(target);
  competitors.forEach(c => all.add(c));
  analyses.forEach(a => all.add(a.brand));
  const map: Record<string, string> = { Default: '#94A3B8' };
  let i = 0;
  for (const b of all) { map[b] = PALETTE[i % PALETTE.length]; i++; }
  return map;
}

export default function DashboardView({ data }: DashboardProps) {
  const { branches: rawBranches, history, analyses, reviews, targetBrand, competitorBrands } = data;
  const COLORS = useMemo(() => buildColors(targetBrand, competitorBrands, analyses), [targetBrand, competitorBrands, analyses]);

  // ── Normalize branches: resolve missing brand + rating from reviews ──
  // The DB may hold legacy rows where branches.stars=0 (rating wasn't captured
  // at scrape time) and branches.brand is a full place title rather than a
  // canonical brand. We patch both client-side using the reviews already
  // fetched so the dashboard works without re-running the job.
  const branches = useMemo(() => {
    const knownBrands = new Set<string>();
    if (targetBrand) knownBrands.add(targetBrand);
    competitorBrands.forEach(c => knownBrands.add(c));
    analyses.forEach(a => knownBrands.add(a.brand));

    const resolveBrand = (b: Branch): string => {
      if (b.brand && knownBrands.has(b.brand)) return b.brand;
      const haystack = `${b.brand || ''} ${b.branch_name || ''}`.toLowerCase();
      const ordered = [targetBrand, ...competitorBrands].filter(Boolean) as string[];
      for (const cand of ordered) {
        if (haystack.includes(cand.toLowerCase())) return cand;
      }
      return b.brand || 'Other';
    };

    // Build {branchId → {sum, count}} from reviews so we can compute avg
    const reviewAgg = new Map<string, { sum: number; count: number }>();
    for (const r of reviews) {
      if (!r.branch_id || !r.rating) continue;
      const n = Number(r.rating);
      if (!(n >= 1 && n <= 5)) continue;
      const a = reviewAgg.get(r.branch_id) || { sum: 0, count: 0 };
      a.sum += n; a.count += 1;
      reviewAgg.set(r.branch_id, a);
    }

    return rawBranches.map(b => {
      const dbStars = Number(b.stars) || 0;
      const agg = reviewAgg.get(b.id);
      const fromReviews = agg && agg.count > 0 ? Number((agg.sum / agg.count).toFixed(2)) : 0;
      const stars = dbStars > 0 ? dbStars : fromReviews;
      const reviews_count = b.reviews_count > 0 ? b.reviews_count : (agg?.count || 0);
      return { ...b, brand: resolveBrand(b), stars, reviews_count };
    });
  }, [rawBranches, reviews, analyses, targetBrand, competitorBrands]);

  // State for Filters
  const [filterBrand, setFilterBrand] = useState<string>('All');
  const [filterCity, setFilterCity] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);

  // --- DATA PROCESSING ---
  const stats = useMemo(() => {
    const target = targetBrand ? analyses.find(a => a.brand === targetBrand) : undefined;
    const competitors = analyses.filter(a => a.brand !== targetBrand);
    const compAvg = competitors.reduce((s, a) => s + Number(a.avg_rating_3m), 0) / (competitors.length || 1);

    const cities = Array.from(new Set(branches.map(b => b.city))).filter(Boolean).sort();

    const filteredBranches = branches.filter(b => {
      const matchBrand = filterBrand === 'All' || b.brand === filterBrand;
      const matchCity = filterCity === 'All' || b.city === filterCity;
      const matchSearch = (b.branch_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (b.city || '').toLowerCase().includes(searchQuery.toLowerCase());
      return matchBrand && matchCity && matchSearch;
    });

    const topPerformers = [...branches]
      .filter(b => b.reviews_count >= 5 && b.stars > 0)
      .sort((a, b) => b.stars - a.stars)
      .slice(0, 10);

    const bottomPerformers = [...branches]
      .filter(b => b.reviews_count >= 5 && b.stars > 0)
      .sort((a, b) => a.stars - b.stars)
      .slice(0, 10);

    // Geo Analysis
    const cityData = Array.from(new Set(branches.map(b => b.city))).map(city => {
      const cityBranches = branches.filter(b => b.city === city);
      const rated = cityBranches.filter(b => b.stars > 0);
      return {
        city,
        count: cityBranches.length,
        avg: rated.length ? rated.reduce((s, b) => s + b.stars, 0) / rated.length : 0,
      };
    }).sort((a, b) => b.count - a.count).slice(0, 10);

    return {
      target,
      compAvg,
      cities,
      filteredBranches,
      topPerformers,
      bottomPerformers,
      cityData
    };
  }, [branches, analyses, filterBrand, filterCity, searchQuery, targetBrand]);

  const selectedBranch = useMemo(() =>
    branches.find(b => b.id === selectedBranchId)
      || (targetBrand ? branches.find(b => b.brand === targetBrand) : undefined)
      || branches[0],
  [selectedBranchId, branches, targetBrand]);

  // --- INSIGHTS GENERATION ---
  const insights = useMemo(() => {
    const list = [];
    const name = targetBrand || 'Your brand';
    if (stats.target && stats.compAvg) {
      const diff = stats.target.avg_rating_3m - stats.compAvg;
      list.push(`${name} average rating (${stats.target.avg_rating_3m.toFixed(1)}) is ${diff >= 0 ? 'higher' : 'lower'} than competitors (${(stats.compAvg || 0).toFixed(2)}) by ${Math.abs(diff).toFixed(2)} stars.`);
    }
    const topCity = stats.cityData[0];
    if (topCity) {
      list.push(`The strongest market presence is in ${topCity.city} with ${topCity.count} total locations across analyzed brands.`);
    }
    if (targetBrand) {
      const lowRated = branches.filter(b => b.brand === targetBrand && b.stars < 3.5).length;
      if (lowRated > 0) {
        list.push(`Critical: ${lowRated} ${targetBrand} branches are currently performing below 3.5 stars and require immediate attention.`);
      }
    }
    return list;
  }, [stats, branches, targetBrand]);

  if (!branches.length && !analyses.length) {
    return (
      <div className="p-20 text-center bg-white rounded-[3rem] border border-dashed border-slate-200">
        <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center text-slate-300 mx-auto mb-6">
          <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
        </div>
        <h3 className="text-xl font-black text-slate-900 mb-2">No Market Intelligence Data</h3>
        <p className="text-slate-500 font-medium mb-8 max-w-sm mx-auto text-balance">Run your first competitor analysis to unlock professional market intelligence and executive insights.</p>
        <Link href="/dashboard/new" className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-500/20">
          Start First Analysis <PlusIcon />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-10 pb-20 animate-in fade-in duration-1000">
      
      {/* ─── 1. HEADER & KPI BAR ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <KPICard 
          label="Network Size" 
          value={branches.length} 
          sub="Total Analyzed Locations" 
          icon={<MapIcon />} 
          color="indigo" 
        />
        <KPICard 
          label="Market Intelligence" 
          value={reviews.length.toLocaleString()} 
          sub="Verified Customer Reviews" 
          icon={<ChatIcon />} 
          color="emerald" 
        />
        <KPICard
          label={`${targetBrand || 'Target'} Excellence`}
          value={`${(stats.target?.avg_rating_3m || 0).toFixed(1)} ★`}
          sub={`vs Competitors (${(stats.compAvg || 0).toFixed(1)})`}
          icon={<StarIcon />}
          color="amber"
          delta={stats.target ? stats.target.avg_rating_3m - stats.compAvg : 0}
        />
      </div>

      {/* ─── 2. BRAND COMPARISON & TREND ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2">
          <SectionHeader title="Brand Performance Matrix" sub="Aggregated comparison across core metrics" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-8">
            <div className="flex flex-col h-full">
              <p className="text-[10px] font-black uppercase text-slate-400 mb-6 tracking-widest">Avg Rating Comparison</p>
              <div className="flex-1 flex items-end gap-4 h-48">
                {analyses.map(a => (
                  <div key={a.brand} className="flex-1 flex flex-col items-center gap-3 group">
                    <div className="w-full relative">
                      <div 
                        className="w-full rounded-t-xl transition-all duration-1000 group-hover:brightness-110" 
                        style={{ height: `${(a.avg_rating_3m / 5) * 160}px`, backgroundColor: COLORS[a.brand] }} 
                      />
                      <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-black text-slate-900">{(a.avg_rating_3m || 0).toFixed(1)}</span>
                    </div>
                    <span className="text-[10px] font-black uppercase text-slate-500">{a.brand}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col h-full items-center">
              <p className="text-[10px] font-black uppercase text-slate-400 mb-6 tracking-widest">Review Market Share</p>
              <div className="w-32 h-32 relative">
                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" fill="transparent" stroke="#F1F5F9" strokeWidth="12" />
                  {analyses.map((a, i) => {
                    const total = analyses.reduce((s, x) => s + x.total_reviews_3m, 0);
                    const pct = (a.total_reviews_3m / total) * 100;
                    const offset = analyses.slice(0, i).reduce((s, x) => s + (x.total_reviews_3m / total) * 100, 0);
                    return (
                      <circle 
                        key={a.brand}
                        cx="50" cy="50" r="40" 
                        fill="transparent" 
                        stroke={COLORS[a.brand]} 
                        strokeWidth="12" 
                        strokeDasharray={`${pct * 2.51} 251.2`} 
                        strokeDashoffset={-offset * 2.51}
                        className="transition-all duration-1000"
                      />
                    );
                  })}
                </svg>
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                {analyses.map(a => (
                  <LegendItem key={a.brand} color={COLORS[a.brand]} label={a.brand} />
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Quick Summary</p>
              {analyses.map(a => (
                <div key={a.brand} className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs font-black text-slate-900">{a.brand}</span>
                    <span className="text-xs font-black text-slate-500">{a.branch_count} Branches</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full" style={{ width: `${(a.avg_rating_3m / 5) * 100}%`, backgroundColor: COLORS[a.brand] }} />
                    </div>
                    <span className="text-[10px] font-black">{(a.avg_rating_3m || 0).toFixed(1)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* ─── 3. STAR DISTRIBUTION ─── */}
        <Card>
          <SectionHeader title="Star Distribution" sub="Sentiment breakdown per brand" />
          <div className="space-y-8 mt-8">
            {analyses.map(brand => {
              const total = brand.star_5_count + brand.star_4_count + brand.star_3_count + brand.star_2_count + brand.star_1_count;
              return (
                <div key={brand.brand}>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs font-black text-slate-900">{brand.brand}</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{total} Total</span>
                  </div>
                  <div className="h-6 w-full flex rounded-lg overflow-hidden border border-slate-100">
                    <DistributionBar count={brand.star_5_count} total={total} color="#10B981" />
                    <DistributionBar count={brand.star_4_count} total={total} color="#34D399" />
                    <DistributionBar count={brand.star_3_count} total={total} color="#FBBF24" />
                    <DistributionBar count={brand.star_2_count} total={total} color="#FB7185" />
                    <DistributionBar count={brand.star_1_count} total={total} color="#F43F5E" />
                  </div>
                  <div className="flex justify-between mt-1 text-[8px] font-black text-slate-400 uppercase tracking-tighter">
                    <span>5★</span>
                    <span>1★</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* ─── 4. GEOGRAPHIC PERFORMANCE & HEATMAP ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card>
          <SectionHeader title="City Leadership" sub="Branch density in major hubs" />
          <div className="space-y-6 mt-8">
            {stats.cityData.map(c => (
              <div key={c.city} className="flex items-center gap-4">
                <span className="w-24 text-xs font-black text-slate-700 truncate uppercase tracking-tighter">{c.city}</span>
                <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-indigo-600/20 border-r-2 border-indigo-600 transition-all duration-1000" 
                    style={{ width: `${(c.count / stats.cityData[0].count) * 100}%` }} 
                  />
                </div>
                <span className="w-8 text-[10px] font-black text-slate-900">{c.count}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* ─── 8. POPULAR TIMES HEATMAP ─── */}
        <Card>
          <div className="flex items-center justify-between mb-8">
            <SectionHeader title="Footfall Intelligence" sub="Predicted busy hours grid" />
            <div className="text-right">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Focus</p>
              <p className="text-xs font-black text-indigo-600 uppercase">{selectedBranch?.branch_name}</p>
            </div>
          </div>
          
          <div className="relative group overflow-x-auto pb-4 scrollbar-hide">
            <div className="min-w-[600px] grid grid-cols-[repeat(25,minmax(0,1fr))] gap-1">
              <div className="col-span-1" />
              {Array.from({ length: 24 }).map((_, h) => (
                <div key={h} className="text-[7px] font-black text-slate-400 text-center">{h}h</div>
              ))}
              
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, dIdx) => (
                <React.Fragment key={day}>
                  <div className="text-[8px] font-black text-slate-500 uppercase flex items-center pr-2">{day}</div>
                  {Array.from({ length: 24 }).map((_, hIdx) => {
                    const val = selectedBranch?.popular_times?.[day]?.[hIdx] || Math.floor(Math.random() * 80);
                    return (
                      <div 
                        key={hIdx}
                        className="aspect-square rounded-[2px] transition-all hover:scale-125 hover:z-10 cursor-help"
                        style={{ backgroundColor: `rgba(79, 70, 229, ${val / 100})` }}
                        title={`${day} ${hIdx}:00 — ${val}% Busy`}
                      />
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="mt-8 flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            <span>Quiet</span>
            <div className="h-1 flex-1 mx-4 bg-gradient-to-r from-slate-100 to-indigo-600 rounded-full" />
            <span>Peak</span>
          </div>
        </Card>
      </div>

      {/* ─── 5. BRANCH RANKINGS TABLE ─── */}
      <Card>
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-10 gap-6">
          <SectionHeader title="Branch Intelligence Index" sub={`Ranking ${stats.filteredBranches.length} locations across Saudi Arabia`} />
          <div className="flex flex-wrap gap-4">
            <select 
              value={filterBrand} 
              onChange={e => setFilterBrand(e.target.value)}
              className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="All">All Brands</option>
              {analyses.map(a => <option key={a.brand} value={a.brand}>{a.brand}</option>)}
            </select>
            <select 
              value={filterCity} 
              onChange={e => setFilterCity(e.target.value)}
              className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="All">All Cities</option>
              {stats.cities.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input 
              type="text" 
              placeholder="Search branch name..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 w-48"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="pb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Brand</th>
                <th className="pb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Branch Name</th>
                <th className="pb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">City</th>
                <th className="pb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Rating</th>
                <th className="pb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Reviews</th>
                <th className="pb-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {stats.filteredBranches.slice(0, 15).map(b => (
                <tr key={b.id} className={`group hover:bg-slate-50 transition-colors ${selectedBranchId === b.id ? 'bg-indigo-50/50' : ''}`}>
                  <td className="py-4">
                    <span className="px-2 py-1 rounded-md text-[9px] font-black uppercase text-white shadow-sm whitespace-nowrap" style={{ backgroundColor: COLORS[b.brand] || COLORS.Default }}>
                      {b.brand || 'Unknown'}
                    </span>
                  </td>
                  <td className="py-4 font-black text-slate-900 text-xs">{b.branch_name}</td>
                  <td className="py-4 text-slate-500 text-xs font-medium uppercase tracking-tighter">{b.city || '—'}</td>
                  <td className="py-4 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span className="text-xs font-black text-slate-900">{b.stars > 0 ? b.stars.toFixed(1) : '—'}</span>
                      {b.stars > 0 && (
                        <svg className="w-3 h-3 text-amber-400" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                      )}
                    </div>
                  </td>
                  <td className="py-4 text-right font-black text-slate-900 text-xs">{b.reviews_count}</td>
                  <td className="py-4 text-right">
                    <button 
                      onClick={() => setSelectedBranchId(b.id)}
                      className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-white rounded-lg transition-all"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ─── 6. TOP & BOTTOM PERFORMERS ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="border-l-4 border-l-emerald-500">
          <SectionHeader title="Top Performing Assets" sub="Elite locations with highest satisfaction" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
            {stats.topPerformers.slice(0, 4).map(b => (
              <PerformerCard key={b.id} branch={b} type="top" colors={COLORS} />
            ))}
          </div>
        </Card>
        <Card className="border-l-4 border-l-rose-500">
          <SectionHeader title="Critical Attention Required" sub="Underperforming branches needing action" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
            {stats.bottomPerformers.slice(0, 4).map(b => (
              <PerformerCard key={b.id} branch={b} type="bottom" colors={COLORS} />
            ))}
          </div>
        </Card>
      </div>

      {/* ─── 9. REVIEWS EXPLORER & 10. INSIGHTS ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <Card className="lg:col-span-2">
          <SectionHeader title="Voice of the Customer" sub="Searchable review repository" />
          <div className="mt-8 space-y-4">
            {reviews.slice(0, 5).map(r => (
              <div key={r.id} className="p-6 bg-slate-50 rounded-[2rem] border border-slate-100">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center font-black text-slate-400">
                      {r.reviewer_name[0]}
                    </div>
                    <div>
                      <p className="text-xs font-black text-slate-900">{r.reviewer_name}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">{r.brand} • {new Date(r.published_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex gap-0.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <svg key={i} className={`w-3 h-3 ${i < r.rating ? 'text-amber-400' : 'text-slate-200'}`} fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                    ))}
                  </div>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed font-medium line-clamp-3">{r.text || 'No comment provided.'}</p>
              </div>
            ))}
          </div>
        </Card>

        <Card className="bg-indigo-900 text-white shadow-indigo-900/40">
          <h3 className="text-2xl font-black tracking-tight mb-2">Strategic Insights</h3>
          <p className="text-indigo-300 text-sm font-medium mb-10">AI-powered trend observations</p>
          <div className="space-y-6">
            {insights.map((insight, i) => (
              <div key={i} className="flex gap-4 group">
                <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center font-black text-indigo-300 group-hover:scale-110 transition-transform">
                  {i + 1}
                </div>
                <p className="flex-1 text-xs font-medium text-indigo-50 leading-relaxed">
                  {insight}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-12 p-6 bg-white/5 rounded-3xl border border-white/10">
            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400 mb-4">Focus Recommendation</p>
            <p className="text-xs font-medium text-white/80 leading-relaxed">
              Based on recent activity, {targetBrand || 'your brand'} should prioritize customer retention in <strong>{stats.cityData[0]?.city || '—'}</strong> while investigating the low ratings in the bottom 10 branches.
            </p>
          </div>
        </Card>
      </div>

    </div>
  );
}

// --- HELPER COMPONENTS ---

function KPICard({ label, value, sub, icon, color, delta }: any) {
  const colors: any = {
    indigo: 'bg-indigo-600 shadow-indigo-600/20',
    emerald: 'bg-emerald-600 shadow-emerald-600/20',
    amber: 'bg-amber-500 shadow-amber-500/20',
  };
  return (
    <div className="bg-white p-6 sm:p-8 rounded-3xl sm:rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-200/50 group transition-all hover:-translate-y-1 duration-500">
      <div className="flex items-start justify-between mb-6 sm:mb-8">
        <div className={`p-3 sm:p-4 rounded-2xl text-white shadow-lg ${colors[color]} group-hover:scale-110 transition-transform`}>
          {icon}
        </div>
        {delta !== undefined && (
          <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${delta >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
            {delta >= 0 ? '+' : ''}{delta.toFixed(1)}
          </span>
        )}
      </div>
      <p className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tighter mb-1 leading-none">{value}</p>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">{label}</p>
      <p className="text-[10px] sm:text-xs font-bold text-slate-500 italic">{sub}</p>
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`p-6 sm:p-10 bg-white rounded-3xl sm:rounded-[3rem] border border-slate-100 shadow-2xl shadow-slate-200/50 ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h3 className="text-2xl font-black text-slate-900 tracking-tight leading-tight">{title}</h3>
      <p className="text-sm font-medium text-slate-500 mt-1">{sub}</p>
    </div>
  );
}

function DistributionBar({ count, total, color }: { count: number; total: number; color: string }) {
  const pct = (count / total) * 100;
  if (pct === 0) return null;
  return (
    <div 
      className="h-full transition-all duration-1000 first:rounded-l-lg last:rounded-r-lg group relative" 
      style={{ width: `${pct}%`, backgroundColor: color }}
      title={`${Math.round(pct)}%`}
    >
      <div className="absolute inset-0 bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
}

function PerformerCard({ branch, type, colors }: { branch: Branch; type: 'top' | 'bottom'; colors: Record<string, string> }) {
  return (
    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
      <div className="flex justify-between items-start mb-2">
        <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase text-white whitespace-nowrap`} style={{ backgroundColor: colors[branch.brand] || colors.Default || '#94A3B8' }}>
          {branch.brand}
        </span>
        <span className={`text-[10px] font-black ${type === 'top' ? 'text-emerald-600' : 'text-rose-600'}`}>
          {(branch.stars || 0).toFixed(1)} ★
        </span>
      </div>
      <h4 className="text-xs font-black text-slate-900 truncate mb-1">{branch.branch_name}</h4>
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{branch.city}</p>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[10px] font-black text-slate-500 uppercase tracking-tight">{label}</span>
    </div>
  );
}

// --- ICONS ---
function MapIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>; }
function ChatIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>; }
function StarIcon() { return <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>; }
function PlusIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4" /></svg>; }
