'use client';

import React, { useMemo, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bi, BiInline, useT } from '@/lib/bilingual';
import { useLang } from '@/lib/lang-context';
import ReviewWordCloud, { type ReviewWordCloudData } from './review-word-cloud';

interface BranchAnalytics {
  id: string;
  job_id: string;
  branch_id: string | null;
  brand: string;
  branch_name: string;
  store_name: string | null;
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
  period_1_reviews: number;
  period_1_avg_rating: number | null;
  period_2_reviews: number;
  period_2_avg_rating: number | null;
  period_3_reviews: number;
  period_3_avg_rating: number | null;
  star_5_count: number;
  star_4_count: number;
  star_3_count: number;
  star_2_count: number;
  star_1_count: number;
  popular_times_grid: Record<string, (number | null)[]> | null;
  date_start: string | null;
  date_end: string | null;
  branches?: {
    stars: number;
    reviews_count: number;
  } | null;
}

/**
 * A branch can only be ranked if reviews stand behind its rating.
 *
 * The rating can arrive from the Places API even when the Business Profile API
 * returns no reviews for that location — one branch showed 4.60 stars from
 * Places, 188 reviews per Google, and nothing fetchable. It was ranked fifth
 * while its own row read "0 reviews", which is not a ranking, it is a guess
 * with a number next to it. Branches like that are listed in the table, never
 * placed in a league.
 */
function isRankable(a: BranchAnalytics): boolean {
  return getBranchRating(a) > 0 && Number(a.total_reviews_period ?? 0) > 0;
}

function getBranchRating(a: BranchAnalytics): number {
  if (a.branches && typeof a.branches === 'object' && a.branches.stars != null) {
    return Number(a.branches.stars);
  }
  return a.avg_rating_period ?? 0;
}

interface Analysis {
  brand: string;
  branch_count: number;
  total_reviews_period: number;
  avg_rating_period: number;
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
    aiSummary?: string | null;
    allJobs?: any[];
    /** Null when the client schema has no `review_word_cloud` view. */
    wordCloud?: ReviewWordCloudData | null;
  };
  isGlobalDashboard?: boolean;
  /** When true, show manual add/delete/dedup controls (client owners, not viewers). */
  canEdit?: boolean;
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

function hourLabel(h: number, isAr?: boolean) {
  if (isAr) {
    if (h === 0) return '١٢ ص';
    if (h < 12) return `${formatArabicDigits(h, true)} ص`;
    if (h === 12) return '١٢ م';
    return `${formatArabicDigits(h - 12, true)} م`;
  }
  if (h === 0) return '12a';
  if (h < 12) return `${h}a`;
  if (h === 12) return '12p';
  return `${h - 12}p`;
}

// Helper to clean up generic branch names (e.g. "Anoosh") to street/district names from address
export function getBranchDisplayName(a: { branch_name: string; brand: string; address?: string | null }) {
  const name = (a.branch_name || '').trim();
  const brand = (a.brand || '').trim();

  if (
    !name ||
    name === 'Unknown' ||
    name === '(unknown)' ||
    name.toLowerCase() === brand.toLowerCase() ||
    name.toLowerCase().includes(brand.toLowerCase() + ' branch') ||
    name.toLowerCase() === 'انوش' ||
    name.toLowerCase() === 'bostani'
  ) {
    if (a.address) {
      const parts = a.address.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length > 0) {
        const brandKeywords = [brand.toLowerCase(), 'انوش', 'bostani', 'بستاني', 'saudi arabia', 'sa', 'الرياض', 'riyadh', 'jeddah', 'جدة', 'الدمام', 'dammam'];
        const cleanParts = parts.filter(p => {
          const lp = p.toLowerCase();
          return !brandKeywords.some(k => lp === k || lp.includes(k));
        });

        if (cleanParts.length > 0) {
          if (cleanParts[0].length < 10 && cleanParts[1]) {
            return `${cleanParts[0]}, ${cleanParts[1]}`;
          }
          return cleanParts[0];
        }
      }
      return a.address.length > 30 ? a.address.slice(0, 27) + '...' : a.address;
    }
  }
  return name;
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
  currentPeriodReviews: number;
  currentPeriodAvg: number | null;
  color: string;
  dateStart?: string | null;
  dateEnd?: string | null;
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
    dateStart: string | null;
    dateEnd: string | null;
  }> = {};

  for (const a of analytics) {
    if (!acc[a.brand]) acc[a.brand] = {
      reviews: 0, ratingSum: 0, ratingWeight: 0,
      s5: 0, s4: 0, s3: 0, s2: 0, s1: 0,
      m1r: 0, m1s: 0, m1w: 0, m2r: 0, m2s: 0, m2w: 0, m3r: 0, m3s: 0, m3w: 0,
      count: 0,
      dateStart: a.date_start || null,
      dateEnd: a.date_end || null,
    };
    const x = acc[a.brand];
    x.count++;
    x.reviews += a.total_reviews_period;
    const branchRating = getBranchRating(a);
    if (branchRating > 0) {
      x.ratingSum += branchRating;
      x.ratingWeight += 1;
    }
    x.s5 += a.star_5_count; x.s4 += a.star_4_count;
    x.s3 += a.star_3_count; x.s2 += a.star_2_count; x.s1 += a.star_1_count;
    x.m1r += a.period_1_reviews;
    if (a.period_1_avg_rating != null) { x.m1s += a.period_1_avg_rating * a.period_1_reviews; x.m1w += a.period_1_reviews; }
    x.m2r += a.period_2_reviews;
    if (a.period_2_avg_rating != null) { x.m2s += a.period_2_avg_rating * a.period_2_reviews; x.m2w += a.period_2_reviews; }
    x.m3r += a.period_3_reviews;
    if (a.period_3_avg_rating != null) { x.m3s += a.period_3_avg_rating * a.period_3_reviews; x.m3w += a.period_3_reviews; }
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
      currentPeriodReviews: x.m1r,
      currentPeriodAvg: x.m1w > 0 ? +(x.m1s / x.m1w).toFixed(2) : null,
      color: colorMap[brand],
      dateStart: x.dateStart,
      dateEnd: x.dateEnd,
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
    const branchRating = getBranchRating(a);
    if (branchRating > 0) { x.rSum += branchRating; x.rW += 1; }
  }

  const result = Array.from(cities.entries())
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

  return result;
}

function formatDateRange(start: string | null | undefined, end: string | null | undefined) {
  if (!start && !end) return 'All Time';
  const opt: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  const sStr = start ? new Date(start).toLocaleDateString(undefined, opt) : '';
  const eStr = end ? new Date(end).toLocaleDateString(undefined, opt) : '';
  if (sStr && eStr) return `${sStr} - ${eStr}`;
  return sStr || eStr || 'All Time';
}

function formatArabicDigits(val: string | number, isAr: boolean, options?: { decimals?: number }) {
  const str = typeof val === 'number' 
    ? (options?.decimals !== undefined ? val.toFixed(options.decimals) : String(val))
    : val;
  return str;
}

export default function DashboardView({ data, isGlobalDashboard = false, canEdit = false }: DashboardProps) {
  const { analytics, targetBrand, competitorBrands, dateStart, dateEnd, jobId, allJobs = [], wordCloud = null } = data;
  const router = useRouter();
  const t = useT();
  const { isAr } = useLang();
  const tn = (val: string | number, options?: { decimals?: number }) => formatArabicDigits(val, isAr, options);

  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Resend email states
  const [isEmailModalOpen, setIsEmailModalOpen] = useState(false);
  const [emailToInput, setEmailToInput] = useState('');
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailStatus, setEmailStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [emailErrorMsg, setEmailErrorMsg] = useState('');

  const currentJob = allJobs?.find(j => j.id === jobId);

  React.useEffect(() => {
    if (isEmailModalOpen && currentJob?.email_to) {
      setEmailToInput(currentJob.email_to);
      setEmailStatus('idle');
      setEmailErrorMsg('');
    }
  }, [isEmailModalOpen, currentJob]);

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobId || !emailToInput.trim()) return;

    setIsSendingEmail(true);
    setEmailStatus('idle');
    setEmailErrorMsg('');

    try {
      const res = await fetch(`/api/jobs/${jobId}/resend-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailToInput.trim() }),
      });

      const resData = await res.json();
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to send email.');
      }

      setEmailStatus('success');
      setTimeout(() => {
        setIsEmailModalOpen(false);
      }, 2000);
    } catch (err: any) {
      setEmailStatus('error');
      setEmailErrorMsg(err.message || 'An unexpected error occurred.');
    } finally {
      setIsSendingEmail(false);
    }
  };

  // ── Manual branch management (add / delete / dedup) ──
  const [branchBusy, setBranchBusy] = useState(false);
  const [branchMsg, setBranchMsg] = useState('');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const emptyAddForm = {
    brand: '', store_name: '', branch_name: '', city: '', address: '', google_maps_link: '',
    phone: '', business_hours: '', stars: '', reviews_count: '', place_id: '',
  };
  const [addForm, setAddForm] = useState({ ...emptyAddForm });

  const handleDeleteBranch = useCallback(async (branchId: string, name: string) => {
    if (!jobId) return;
    if (!window.confirm(`Delete branch "${name}"? This recalculates all analytics.`)) return;
    setBranchBusy(true); setBranchMsg('');
    try {
      const res = await fetch('/api/branches', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, branchId }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Delete failed');
      setBranchMsg('Branch deleted.');
      router.refresh();
    } catch (e: any) { setBranchMsg('Error: ' + e.message); }
    finally { setBranchBusy(false); }
  }, [jobId, router]);

  const handleDedup = useCallback(async () => {
    if (!jobId) return;
    if (!window.confirm('Remove duplicate locations (same place / name+city)?')) return;
    setBranchBusy(true); setBranchMsg('');
    try {
      const res = await fetch('/api/branches', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, action: 'dedup' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Dedup failed');
      setBranchMsg(`Removed ${d.removed} duplicate(s).`);
      router.refresh();
    } catch (e: any) { setBranchMsg('Error: ' + e.message); }
    finally { setBranchBusy(false); }
  }, [jobId, router]);

  const handleAddBranch = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobId || !addForm.brand.trim() || !addForm.branch_name.trim()) {
      setBranchMsg('Brand and branch name are required.'); return;
    }
    setBranchBusy(true); setBranchMsg('Adding (scraping popular times if place_id given)…');
    try {
      const res = await fetch('/api/branches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, branch: {
          brand: addForm.brand.trim(), branch_name: addForm.branch_name.trim(),
          store_name: addForm.store_name.trim() || null,
          city: addForm.city.trim() || null, address: addForm.address.trim() || null,
          google_maps_link: addForm.google_maps_link.trim() || null,
          phone: addForm.phone.trim() || null, business_hours: addForm.business_hours.trim() || null,
          stars: addForm.stars ? Number(addForm.stars) : null,
          reviews_count: addForm.reviews_count ? Number(addForm.reviews_count) : 0,
          place_id: addForm.place_id.trim() || null,
        } }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Add failed');
      setBranchMsg(`Added.${d.popularTimes ? ' Popular times scraped.' : ''}`);
      setIsAddOpen(false); setAddForm({ ...emptyAddForm });
      router.refresh();
    } catch (e: any) { setBranchMsg('Error: ' + e.message); }
    finally { setBranchBusy(false); }
  }, [jobId, addForm, router]);

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

  const periodInfo = useMemo(() => {
    const s = dateStart || analytics.find(a => a.date_start)?.date_start || null;
    const e = dateEnd || analytics.find(a => a.date_end)?.date_end || null;
    if (!s || !e) return {
      label: 'Last 90 days', totalDays: 90,
      p1: { label: 'Recent (30 days)', short: 'Recent 30d' },
      p2: { label: 'Middle (30 days)', short: 'Mid 30d' },
      p3: { label: 'Oldest (30 days)', short: 'Old 30d' },
    };
    const startD = new Date(s), endD = new Date(e);
    const totalMs = endD.getTime() - startD.getTime();
    const totalDays = Math.max(1, Math.round(totalMs / 86400000));
    const thirdMs = totalMs / 3;
    const p3Start = startD;
    const p3End = new Date(startD.getTime() + thirdMs);
    const p2Start = p3End;
    const p2End = new Date(startD.getTime() + 2 * thirdMs);
    const p1Start = p2End;
    const p1End = endD;
    const thirdDays = Math.round(totalDays / 3);
    const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const fmtFull = (d: Date) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    return {
      label: `${fmtFull(startD)} → ${fmtFull(endD)}`,
      totalDays,
      p1: { label: `${fmt(p1Start)} – ${fmt(p1End)} (${thirdDays}d)`, short: `${fmt(p1Start)} – ${fmt(p1End)}` },
      p2: { label: `${fmt(p2Start)} – ${fmt(p2End)} (${thirdDays}d)`, short: `${fmt(p2Start)} – ${fmt(p2End)}` },
      p3: { label: `${fmt(p3Start)} – ${fmt(p3End)} (${thirdDays}d)`, short: `${fmt(p3Start)} – ${fmt(p3End)}` },
    };
  }, [analytics, dateStart, dateEnd]);

  const filteredBranches = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = analytics.filter(a => {
      if (filterBrand !== 'All' && a.brand !== filterBrand) return false;
      if (filterCity !== 'All' && a.city !== filterCity) return false;
      if (q && !`${getBranchDisplayName(a)} ${a.city || ''} ${a.address || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'rating') cmp = getBranchRating(a) - getBranchRating(b);
      else if (sortCol === 'reviews') cmp = a.total_reviews_period - b.total_reviews_period;
      else cmp = getBranchDisplayName(a).localeCompare(getBranchDisplayName(b));
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
      .filter(isRankable)
      .sort((a, b) => (getBranchRating(b) - getBranchRating(a)) || (b.total_reviews_period - a.total_reviews_period)),
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
        <Bi en="No Data Yet" as="h3" className="text-xl font-black text-slate-900 mb-2" />
        <Bi en="Run your first analysis to see branch-wise comparisons here." as="p" className="text-slate-500 font-medium mb-8 max-w-sm mx-auto" />
        <Link href="/dashboard/new" className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all active:scale-95 shadow-lg shadow-indigo-500/20">
          <BiInline en="Start Analysis" />
        </Link>
      </div>
    );
  }

  const ratingGap = (targetSummary?.avgRating ?? 0) - compAvgRating;
  const isAhead = ratingGap >= 0;

  const reportRef = useRef<HTMLDivElement>(null);

  const handleExportPDF = useCallback(() => {
    // Temporarily expand all tabs for print
    const originalTab = activeTab;
    const style = document.createElement('style');
    style.id = 'print-all-tabs';
    style.textContent = `
      @media print {
        body * { visibility: hidden; }
        #dashboard-report, #dashboard-report * { visibility: visible; }
        #dashboard-report { position: absolute; left: 0; top: 0; width: 100%; }
        .no-print { display: none !important; }
        .print\\:block { display: block !important; }
      }
    `;
    document.head.appendChild(style);
    window.print();
    setTimeout(() => {
      document.getElementById('print-all-tabs')?.remove();
    }, 500);
  }, [activeTab]);

  if (isGlobalDashboard) {
    return (
      <div id="dashboard-report" ref={reportRef} className="space-y-8 pb-20 animate-in fade-in duration-700">

        {/* ═══ PREMIUM GLOBAL HEADER ═══ */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-slate-900 p-8 rounded-[2.5rem] border border-indigo-500/20 shadow-2xl shadow-indigo-500/10 no-print relative overflow-hidden text-white">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.15),transparent_50%)]" />
          <div className="relative">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.25em]"><BiInline en="Unified Competitive Portal" /></span>
            </div>
            <Bi en="Cross-Brand Intelligence Dashboard" as="h1" className="text-3xl font-black tracking-tight text-white" />
            <p className="text-slate-400 font-bold text-xs mt-1.5 uppercase tracking-wider">
              {targetBrand ? (
                <>
                  <BiInline en="Comparing Your Brand" /> ({targetBrand}) <BiInline en="against" /> {competitorBrands.length} <BiInline en="competitors globally" />
                </>
              ) : (
                <BiInline en="Competitor Analysis" />
              )}
            </p>
          </div>

          <div className="relative flex flex-wrap items-center gap-3">
            {allJobs.length > 1 && (
              <div className="flex items-center gap-3 bg-white/5 border border-white/10 px-4 py-2.5 rounded-2xl">
                <span className="text-[10px] font-black uppercase text-indigo-300 tracking-wider whitespace-nowrap"><BiInline en="Analyze Single Run:" /></span>
                <select
                  value=""
                  onChange={(e) => {
                    const selectedId = e.target.value;
                    if (!selectedId) return;
                    router.push(`/jobs/${selectedId}`);
                  }}
                  className="bg-transparent text-xs font-black text-white focus:outline-none cursor-pointer"
                >
                  <option value="" disabled className="text-slate-800">{t('Select specific job...')}</option>
                  {allJobs.map((j: any) => {
                    const dateStr = new Date(j.finished_at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    });
                    return (
                      <option key={j.id} value={j.id} className="font-bold text-slate-800">
                        {j.target_name} vs {Array.isArray(j.competitors) ? j.competitors.join(', ') : ''} ({dateStr})
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
            
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-2 px-5 py-3 bg-gradient-to-r from-indigo-500 to-violet-600 text-white text-xs font-black uppercase tracking-wider rounded-2xl shadow-lg shadow-indigo-500/20 hover:shadow-indigo-500/30 transition-all duration-300 hover:scale-105"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              <BiInline en="Export Global Report" />
            </button>
          </div>
        </div>

        {/* ═══ GLOBAL EXECUTIVE OVERVIEW GRID (KPI CARDS) ═══ */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPI
            label={`${targetBrand || 'Target'} ${t('Rating')}`}
            labelColor={targetSummary?.color || PALETTE[0]}
            value={`${(targetSummary?.avgRating ?? 0).toFixed(2)} ★`}
            sub={`${t('Rating')} · ${t('Your Brand')}`}
            color="indigo"
            badge={`${t('YOUR BRAND')}`}
          />
          <KPI
            label={`${t('Your Brand Locations')}`}
            value={`${targetSummary?.branches ?? 0} ${t('Branches')}`}
            sub={`${t('Total physical branches analyzed')}`}
            color="indigo"
          />
          <KPI
            label={`${t('Competitor Locations')}`}
            value={`${compSummaries.reduce((sum, c) => sum + c.branches, 0)} ${t('Branches')}`}
            sub={`${competitorBrands.length} ${t('Competitor')}`}
            color="amber"
          />
          <KPI
            label={`${t('Rating Position')}`}
            value={isAhead ? t('Ahead') : t('Behind')}
            sub={`Gap: ${isAhead ? '+' : ''}${ratingGap.toFixed(2)} vs competitors avg (${compAvgRating.toFixed(2)} ★)`}
            color={isAhead ? 'emerald' : 'rose'}
          />
        </div>

        {/* Rating Source & Type Explanatory Callout Banner */}
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 p-5 rounded-[2rem] border border-indigo-100/50 flex items-start gap-4 shadow-sm animate-in fade-in duration-500">
          <div className="w-10 h-10 bg-indigo-500 text-white rounded-2xl flex items-center justify-center flex-shrink-0 shadow-md shadow-indigo-500/20">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </div>
          <div className="space-y-1">
            <h4 className="text-xs font-black text-slate-800 uppercase tracking-wider flex items-center gap-2">
              <BiInline en="Overall Rating System Clarification" />
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
            </h4>
            <p className="text-[11px] text-slate-500 font-bold leading-relaxed">
              <BiInline 
                en="Overall average ratings display lifetime ratings pulled directly from Google Maps up to today. Period comparison data breakdown below represents datewise changes over the specific job period duration." 
              />
            </p>
          </div>
        </div>

        {/* ═══ STANDINGS LEADERBOARD & FOOTPRINT COMPARISON ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Brand Standings Leaderboard */}
          <Card>
            <SectionHeader title={`${t('Unified Brand Standings')}`} sub={`${t('All analyzed brands ranked by overall average rating')}`} />
            <div className="mt-6 space-y-4">
              {brandSummaries.map((b, idx) => {
                const isTarget = b.isTarget;
                const rank = idx + 1;
                return (
                  <div 
                    key={b.brand} 
                    className={`flex items-center justify-between p-5 rounded-2xl border transition-all duration-300 hover:scale-[1.01] ${
                      isTarget 
                        ? 'bg-gradient-to-r from-indigo-50/50 to-indigo-100/10 border-indigo-200/60 shadow-md shadow-indigo-100/20' 
                        : 'bg-white border-slate-100 shadow-sm'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      {/* Rank Indicator */}
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shadow-sm ${
                        rank === 1 ? 'bg-amber-100 text-amber-700 border border-amber-200' :
                        rank === 2 ? 'bg-slate-100 text-slate-700 border border-slate-200' :
                        'bg-slate-50 text-slate-400 border border-slate-100'
                      }`}>
                        {rank}
                      </div>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black text-slate-800 text-sm">{b.brand}</span>
                          {isTarget && (
                            <span className="text-[8px] font-black uppercase bg-indigo-600 text-white px-2 py-0.5 rounded-full tracking-widest shadow-sm">
                              YOUR BRAND | علامتك التجارية
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-bold text-slate-400 mt-0.5">
                          {b.branches} {t('Branches')} · {b.totalReviews.toLocaleString()} {t('Reviews')}
                        </div>
                        <div className="flex items-center gap-1 text-[10px] font-bold text-indigo-600/80 bg-indigo-50/60 px-2 py-0.5 rounded-md mt-1 w-fit border border-indigo-100/20">
                          <svg className="w-2.5 h-2.5 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                          <span>{formatDateRange(b.dateStart, b.dateEnd)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-end">
                      <div className="text-base font-black text-slate-800 flex items-center justify-end gap-1">
                        <span>{(b.avgRating ?? 0).toFixed(2)}</span>
                        <span className="text-amber-400 text-xs">★</span>
                      </div>
                      <div className="w-24 h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden relative">
                        <div 
                          className="absolute inset-y-0 ltr:left-0 rtl:right-0 rounded-full animate-all" 
                          style={{ 
                            width: `${((b.avgRating ?? 0) / 5) * 100}%`,
                            backgroundColor: b.color 
                          }} 
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Physical Branch Footprint Comparison */}
          <Card>
            <SectionHeader title={`${t('Physical Presence Breakdown')}`} sub={`${t('Number of physical locations analyzed per brand')}`} />
            <div className="mt-6 space-y-6">
              {brandSummaries.map(b => {
                const maxBranches = Math.max(...brandSummaries.map(x => x.branches), 1);
                const pct = (b.branches / maxBranches) * 100;
                return (
                  <div key={b.brand} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: b.color }} />
                        <span className="text-xs font-black text-slate-700">{b.brand}</span>
                      </div>
                      <span className="text-xs font-black text-slate-800 bg-slate-100 px-2.5 py-1 rounded-lg">
                        {b.branches} {b.branches === 1 ? t('branch') : t('branches')}
                      </span>
                    </div>
                    <div className="h-3 bg-slate-100 rounded-full overflow-hidden relative">
                      <div 
                        className="absolute inset-y-0 ltr:left-0 rtl:right-0 rounded-full transition-all duration-1000" 
                        style={{ 
                          width: `${pct}%`,
                          backgroundColor: b.color,
                          boxShadow: `0 0 12px ${b.color}40`
                        }} 
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

        </div>

        {/* ═══ SENTIMENT DENSITY COMPASS (SIDE-BY-SIDE COMPOUND SENTIMENT BARS) ═══ */}
        <Card>
          <SectionHeader title={`${t('Comparative Sentiment Spectrum')}`} sub={`${t('Review rating breakdown (Positive vs Neutral vs Negative) side-by-side')}`} />
          <div className="mt-8 space-y-6">
            {brandSummaries.map(b => {
              const stars = b.stars || [0, 0, 0, 0, 0];
              const positive = stars[0] + stars[1]; // 5★ + 4★
              const neutral = stars[2];            // 3★
              const negative = stars[3] + stars[4]; // 2★ + 1★
              const total = Math.max(1, positive + neutral + negative);

              const posPct = (positive / total) * 100;
              const neuPct = (neutral / total) * 100;
              const negPct = (negative / total) * 100;

              return (
                <div key={b.brand} className="space-y-3 bg-slate-50/50 p-5 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BrandBadge brand={b.brand} color={b.color} />
                      {b.isTarget && (
                        <span className="text-[7px] font-black uppercase bg-indigo-600 text-white px-2 py-0.5 rounded-full tracking-widest">
                          YOUR BRAND
                        </span>
                      )}
                      <span className="text-[9px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md flex items-center gap-1 border border-slate-200/55">
                        <svg className="w-2.5 h-2.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        {formatDateRange(b.dateStart, b.dateEnd)}
                      </span>
                    </div>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                      {total.toLocaleString()} {t('total reviews')}
                    </span>
                  </div>

                  <div className="h-5 rounded-xl overflow-hidden flex relative shadow-sm">
                    {positive > 0 && (
                      <div 
                        className="h-full bg-emerald-500 flex items-center justify-center text-[9px] font-black text-white" 
                        style={{ width: `${posPct}%` }}
                        title={`Positive: ${positive} reviews (${posPct.toFixed(1)}%)`}
                      >
                        {posPct > 10 && `${posPct.toFixed(0)}%`}
                      </div>
                    )}
                    {neutral > 0 && (
                      <div 
                        className="h-full bg-slate-400 flex items-center justify-center text-[9px] font-black text-white" 
                        style={{ width: `${neuPct}%` }}
                        title={`Neutral: ${neutral} reviews (${neuPct.toFixed(1)}%)`}
                      >
                        {neuPct > 10 && `${neuPct.toFixed(0)}%`}
                      </div>
                    )}
                    {negative > 0 && (
                      <div 
                        className="h-full bg-rose-500 flex items-center justify-center text-[9px] font-black text-white" 
                        style={{ width: `${negPct}%` }}
                        title={`Negative: ${negative} reviews (${negPct.toFixed(1)}%)`}
                      >
                        {negPct > 10 && `${negPct.toFixed(0)}%`}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap justify-between items-center text-[10px] font-black text-slate-500 uppercase tracking-wider pt-1 gap-2">
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-md bg-emerald-500 inline-block" /> {t('Positive (4-5★):')} {positive.toLocaleString()}</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-md bg-slate-400 inline-block" /> {t('Neutral (3★):')} {neutral.toLocaleString()}</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-md bg-rose-500 inline-block" /> {t('Negative (1-2★):')} {negative.toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* ═══ CITY-WISE COMPARATIVE GRID ═══ */}
        <Card>
          <SectionHeader title={`${t('City-Wise Brand Performance Matrix')}`} sub={`${t('Comparing brand footprint and satisfaction scores side-by-side across all analyzed cities')}`} />
          <div className="mt-6 overflow-x-auto border border-slate-100 rounded-2xl shadow-sm bg-white">
            <table className="w-full text-start border-collapse min-w-[600px]">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">
                  <th className="p-5"><BiInline en="City Name" /></th>
                  {brandSummaries.map(b => (
                    <th key={b.brand} className="p-5 text-center" style={{ color: b.color }}>
                      {b.brand} {t('Presence')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {cityBreakdown.map(item => {
                  return (
                    <tr key={item.city} className="hover:bg-slate-50/50 transition-colors">
                      <td className="p-5 font-black text-slate-800">{item.city}</td>
                      {brandSummaries.map(b => {
                        const brandCityData = item.brands.find(bc => bc.brand === b.brand);
                        return (
                          <td key={b.brand} className="p-5 text-center">
                            {brandCityData ? (
                              <div className="inline-flex flex-col items-center justify-center p-2 rounded-xl bg-slate-50 border border-slate-100 min-w-[100px]">
                                <div className="text-sm font-black text-slate-700">{brandCityData.branches} {t('Branches')}</div>
                                <div className="text-[10px] font-black text-amber-500 flex items-center gap-0.5 mt-0.5">
                                  <span>{(brandCityData.avgRating ?? 0).toFixed(2)}</span>
                                  <span>★</span>
                                </div>
                                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">
                                  {brandCityData.reviews.toLocaleString()} {t('reviews')}
                                </div>
                              </div>
                            ) : (
                              <span className="text-[10px] font-black uppercase text-slate-300 tracking-wider">
                                <BiInline en="No Presence" />
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>


        {/* ── What customers talk about ──
            The word cloud used to live only in the tabbed view below, which
            this early return never reaches — so it was generated, stored and
            never shown to anyone. It belongs on the page a client actually
            opens. Own reviews only; competitors are excluded. */}
        {wordCloud && (wordCloud.positive.length > 0 || wordCloud.negative.length > 0) && (
          <Card>
            <SectionHeader
              title={t('What Customers Talk About')}
              sub={t('AI-read words from your own Google reviews — praise on the left, complaints on the right')}
            />
            <div className="mt-6">
              <ReviewWordCloud data={wordCloud} />
            </div>
          </Card>
        )}

      </div>
    );
  }

  return (
    <div id="dashboard-report" ref={reportRef} className="space-y-8 pb-20 animate-in fade-in duration-700">

      {/* ═══ PREMIUM HEADER WITH JOB SWITCHER ═══ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm no-print">
        <div>
          <Bi en="Executive Analysis Dashboard" as="h1" className="text-2xl font-black text-slate-900 tracking-tight" />
          <p className="text-slate-500 font-bold text-xs mt-1 uppercase tracking-wider">
            {targetBrand ? `${targetBrand} vs ${competitorBrands.join(', ')}` : t('Competitor Analysis')}
          </p>
        </div>

        {allJobs.length > 1 && (
          <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 px-4 py-2.5 rounded-2xl max-w-sm w-full sm:w-auto">
            <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider whitespace-nowrap"><BiInline en="Active Run:" /></span>
            <select
              value={jobId || ''}
              onChange={(e) => {
                const selectedId = e.target.value;
                if (!selectedId) return;
                const isLatest = allJobs[0]?.id === selectedId;
                if (isLatest) {
                  router.push('/dashboard');
                } else {
                  router.push(`/jobs/${selectedId}`);
                }
              }}
              className="bg-transparent text-xs font-black text-slate-700 focus:outline-none cursor-pointer w-full"
            >
              {allJobs.map((j: any) => {
                const dateStr = new Date(j.finished_at).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                });
                const isCurrent = j.id === jobId;
                return (
                  <option key={j.id} value={j.id} className="font-bold text-slate-800">
                    {j.target_name} ({dateStr}) {isCurrent ? '👈 Active' : ''}
                  </option>
                );
              })}
            </select>
          </div>
        )}
      </div>

      {/* ═══ TAB NAVIGATION ═══ */}
      {!isGlobalDashboard && (
        <div className="flex gap-1 bg-slate-100 p-1.5 rounded-2xl">
          {([
            { key: 'overview' as Tab, label: t('Overview') },
            { key: 'branches' as Tab, label: t('Branch Data') },
            { key: 'rankings' as Tab, label: t('Rankings') },
            { key: 'popular-times' as Tab, label: t('Popular Times') },
          ]).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex-1 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${activeTab === tab.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
                }`}>
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Export / Email Actions */}
      <div className="flex justify-end items-center gap-3 no-print">
        {jobId && !isGlobalDashboard && (
          <button
            onClick={() => setIsEmailModalOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 text-slate-700 hover:text-slate-900 text-xs font-black uppercase tracking-wider rounded-xl shadow-sm hover:shadow-md transition-all duration-300 hover:scale-105"
          >
            <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <BiInline en="Email Report | إرسال التقرير بالبريد" />
          </button>
        )}
        <button
          onClick={handleExportPDF}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-lg shadow-indigo-200 hover:shadow-xl hover:shadow-indigo-300 transition-all duration-300 hover:scale-105"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          <BiInline en="Export Report as PDF" />
        </button>
      </div>
      {/* ═══════════════════════════════════════════════════════
          TAB: OVERVIEW
         ═══════════════════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        <>
          {/* ── Data Period Banner ── */}
          <div className="relative overflow-hidden p-6 rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/20 shadow-2xl shadow-indigo-500/10">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.15),transparent_50%)]" />
            <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
                  <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.25em]"><BiInline en="Analysis Data Period" /></span>
                </div>
                <div className="text-xl font-black text-white tracking-tight">{periodInfo.label}</div>
                <div className="text-xs font-bold text-slate-400 mt-1">{periodInfo.totalDays} {t('days of review data analyzed')}</div>
              </div>
              <div className="flex flex-wrap gap-3">
                {[
                  { label: t('Newest'), info: periodInfo.p1.label, color: 'emerald' },
                  { label: t('Middle'), info: periodInfo.p2.label, color: 'amber' },
                  { label: t('Oldest'), info: periodInfo.p3.label, color: 'slate' },
                ].map(p => (
                  <div key={p.label} className={`px-4 py-2 rounded-xl border ${p.color === 'emerald' ? 'bg-emerald-500/10 border-emerald-500/20' :
                    p.color === 'amber' ? 'bg-amber-500/10 border-amber-500/20' :
                      'bg-slate-500/10 border-slate-500/20'
                    }`}>
                    <div className={`text-[8px] font-black uppercase tracking-widest ${p.color === 'emerald' ? 'text-emerald-400' :
                      p.color === 'amber' ? 'text-amber-400' :
                        'text-slate-400'
                      }`}>{p.label}</div>
                    <div className="text-[11px] font-bold text-white mt-0.5">{p.info}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <KPI
              label={targetBrand || 'Target'}
              labelColor={targetSummary?.color || PALETTE[0]}
              value={`${(targetSummary?.avgRating ?? 0).toFixed(2)} ★`}
              sub={`Overall avg of all ${targetSummary?.branches ?? 0} branches · ${targetSummary?.totalReviews ?? 0} reviews`}
              color="indigo"
              badge={targetBrand ? 'YOUR BRAND' : undefined}
            />
            <KPI
              label={`${t('Competitors Avg')}`}
              value={`${compAvgRating.toFixed(2)} ★`}
              sub={`Avg of all competitor branches · ${compSummaries.reduce((s, c) => s + c.totalReviews, 0).toLocaleString()} reviews`}
              color="slate"
            />
            <KPI
              label={`${t('Rating Gap')}`}
              value={`${isAhead ? '+' : ''}${ratingGap.toFixed(2)}`}
              sub={isAhead ? t('Your brand is ahead of competitors') : t('Your brand is behind competitors')}
              color={isAhead ? 'emerald' : 'rose'}
            />
            <KPI
              label={`${t('Your Branches')}`}
              value={`${targetSummary?.branches ?? 0}`}
              sub={`${t('Total locations you have')}`}
              color="amber"
            />
            <KPI
              label={`${t('Comp. Branches')}`}
              value={`${compSummaries.reduce((s, c) => s + c.branches, 0)}`}
              sub={`${t('Competitor footprint')}`}
              color="slate"
            />
          </div>

          {/* Overall Reputation */}
          <Card>
            <SectionHeader title={`${t('Overall Reputation')}`} sub={`${periodInfo.label}`} />
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
                    <span style={{ color: targetSummary?.color || PALETTE[0] }}>{targetBrand || t('Target')}</span> {isAhead ? t('is AHEAD by') : t('is BEHIND by')} {Math.abs(ratingGap).toFixed(2)} {t('stars')}
                  </div>
                  <div className="text-sm text-slate-500 font-medium">
                    {(targetSummary?.avgRating ?? 0).toFixed(2)} ★ {t('vs')} {compAvgRating.toFixed(2)} ★ {t('competitors average')}
                    {targetSummary && ` · ${targetSummary.branches} ${t('branches')} · ${targetSummary.totalReviews.toLocaleString()} ${t('reviews')}`}
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
                        <span className="text-xs font-black text-slate-300 mx-1">VS</span>
                        <BrandBadge brand={comp.brand} color={comp.color} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden relative">
                            <div className="absolute inset-y-0 ltr:left-0 rtl:right-0 rounded-full" style={{ width: `${(tRating / 5) * 100}%`, backgroundColor: targetSummary?.color || PALETTE[0] }} />
                          </div>
                          <span className="text-xs font-black text-slate-700 w-10 text-end">{tRating.toFixed(2)}</span>
                          <span className="text-[10px] text-slate-400">vs</span>
                          <span className="text-xs font-black text-slate-700 w-10">{cRating.toFixed(2)}</span>
                          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden relative">
                            <div className="absolute inset-y-0 ltr:left-0 rtl:right-0 rounded-full" style={{ width: `${(cRating / 5) * 100}%`, backgroundColor: comp.color }} />
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


          {/* ── How each brand rates against the others ── */}
          <div className="grid grid-cols-1 gap-6">
            <Card>
              <SectionHeader title={`${t('Rating Comparison')}`} sub={`${periodInfo.label}`} />
              <div className="mt-6 space-y-3">
                {brandSummaries.map((b, idx) => {
                  const rating = b.avgRating ?? 0;
                  const pct = (rating / 5) * 100;
                  return (
                    <div key={b.brand} className="flex items-center gap-3 animate-fade-slide-up" style={{ animationDelay: `${idx * 100}ms` }}>
                      <div className="min-w-[100px] text-end">
                        <span className="text-xs font-black uppercase tracking-tight" style={{ color: b.color }}>{b.brand}</span>
                      </div>
                      <div className="flex-1 h-8 bg-slate-100 rounded-xl overflow-hidden relative">
                        <div className="absolute inset-y-0 ltr:left-0 rtl:right-0 rounded-xl animate-grow-width flex items-center justify-end pe-3"
                          style={{ width: `${pct}%`, backgroundColor: b.color, boxShadow: `0 4px 14px ${b.color}30`, animationDelay: `${idx * 100 + 200}ms` }}>
                          <span className="text-[11px] font-black text-white drop-shadow">{rating.toFixed(2)} ★</span>
                        </div>
                      </div>
                      <div className="min-w-[60px] text-end">
                        <span className="text-[10px] font-bold text-slate-500">{b.totalReviews.toLocaleString()} {t('reviews')}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

          </div>


          {/* Which branches are best and worst — where an owner acts */}
          <Card>
            <SectionHeader
              title={`${t('Top Performers')} / ${t('Bottom Performers')}`}
              sub={(() => {
                const skipped = analytics.filter(a => !isRankable(a)).length;
                return skipped > 0
                  ? `${periodInfo.label} · ${skipped} ${t('branches left out — no reviews in this period')}`
                  : periodInfo.label;
              })()}
            />
            <div className="mt-6">
              {(() => {
                const sorted = [...analytics]
                  .filter(isRankable)
                  .sort((a, b) => getBranchRating(b) - getBranchRating(a));
                const top5 = sorted.slice(0, 5);
                const bottom5 = sorted.slice(-5).reverse();
                const renderEntry = (a: BranchAnalytics, i: number, variant: 'top' | 'bottom', rank: number) => {
                  const isTarget = a.brand === targetBrand;
                  const bgClass = variant === 'top' ? 'bg-emerald-50/50 border-emerald-100' : 'bg-rose-50/50 border-rose-100';
                  const textClass = variant === 'top' ? 'text-emerald-600' : 'text-rose-600';
                  return (
                    <div key={a.id} className={`flex items-center gap-2 p-2.5 rounded-lg border ${bgClass} animate-fade-slide-up`} style={{ animationDelay: `${i * 80}ms` }}>
                      <span className={`text-[10px] font-black ${textClass} w-5`}>#{rank}</span>
                      <div className="w-1.5 self-stretch rounded-full" style={{ backgroundColor: colorMap[a.brand] || '#94A3B8' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-black text-slate-900 truncate">{getBranchDisplayName(a)}</span>
                          {isTarget ? (
                            <span className="text-[7px] font-black px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded-md uppercase whitespace-nowrap"><BiInline en="Your Brand" /></span>
                          ) : (
                            <span className="text-[7px] font-black px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-md uppercase whitespace-nowrap"><BiInline en="Competitor" /></span>
                          )}
                        </div>
                        <div className="text-[8px] font-bold text-slate-400 mt-0.5">
                          <span style={{ color: colorMap[a.brand] }}>{a.brand}</span>
                          {a.city && <span className="text-slate-300"> · {a.city}</span>}
                          <span className="text-slate-300"> · {a.total_reviews_period} {t('reviews')}</span>
                        </div>
                      </div>
                      <span className={`text-[11px] font-black ${textClass}`}>{getBranchRating(a).toFixed(2)}★</span>
                    </div>
                  );
                };
                return (
                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <div className="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-3">★ Top 5 — Highest Rated</div>
                      <div className="space-y-2">
                        {top5.map((a, i) => renderEntry(a, i, 'top', i + 1))}
                      </div>
                    </div>
                    <div>
                      <div className="text-[9px] font-black text-rose-500 uppercase tracking-widest mb-3">↓ Bottom 5 — Needs Improvement</div>
                      <div className="space-y-2">
                        {bottom5.map((a, i) => renderEntry(a, i, 'bottom', sorted.length - 4 + i))}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </Card>

          {/* Every branch on one scale */}
          <Card>
            <SectionHeader title={`${t('Branch Rating Overview')}`} sub={`${periodInfo.label}`} />
            <div className="mt-6">
              <div className="mt-8 space-y-10">
                {brandSummaries.map(bs => {
                  const brandBranches = analytics
                    .filter(a => a.brand === bs.brand && isRankable(a))
                    .sort((a, b) => getBranchRating(b) - getBranchRating(a));

                  if (brandBranches.length === 0) return null;

                  // Stats for health bar
                  const green = brandBranches.filter(a => getBranchRating(a) >= 4.0).length;
                  const amber = brandBranches.filter(a => getBranchRating(a) >= 3.0 && getBranchRating(a) < 4.0).length;
                  const red = brandBranches.length - green - amber;

                  // Stats for health bar
                  const greenCount = brandBranches.filter(a => getBranchRating(a) >= 4.0).length;
                  const amberCount = brandBranches.filter(a => getBranchRating(a) >= 3.0 && getBranchRating(a) < 4.0).length;
                  const redCount = brandBranches.length - greenCount - amberCount;

                  const greenPct = Math.round((greenCount / brandBranches.length) * 100);
                  const amberPct = Math.round((amberCount / brandBranches.length) * 100);
                  const redPct = 100 - greenPct - amberPct;

                  return (
                    <div key={bs.brand} className="relative group bg-white/50 backdrop-blur-sm p-8 rounded-[3rem] border border-slate-100 shadow-sm hover:shadow-md transition-all duration-500">
                      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6 mb-8">
                        {/* Brand Ident & Status */}
                        <div className="flex items-center gap-4 min-w-[200px]">
                          <div className="w-1.5 h-10 rounded-full" style={{ backgroundColor: bs.color }} />
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-black text-slate-900 tracking-tight uppercase leading-none">{bs.brand}</h4>
                              {bs.isTarget && <span className="text-[7px] font-black bg-indigo-600 text-white px-1.5 py-0.5 rounded-md uppercase tracking-widest"><BiInline en="Your Brand" /></span>}
                            </div>
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{brandBranches.length} {t('Branches')}</span>
                              <span className="w-1 h-1 rounded-full bg-slate-300" />
                              <span className={`text-[9px] font-black uppercase tracking-tighter ${greenPct >= 70 ? 'text-emerald-500' : redPct > 20 ? 'text-rose-500' : 'text-amber-500'
                                }`}>
                                {greenPct >= 70 ? t('Market Leader') : redPct > 20 ? t('Action Required') : t('Maintaining')}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Premium Health Bar */}
                        <div className="flex-1 max-w-md">
                          <div className="flex justify-between items-center mb-2 px-1">
                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest"><BiInline en="Portfolio Quality Distribution" /></span>
                            <div className="flex gap-3 text-[10px] font-black">
                              <div className="flex items-center gap-1.5 text-emerald-600">
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                {greenPct}%
                              </div>
                              <div className="flex items-center gap-1.5 text-rose-500">
                                <div className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                                {redPct}%
                              </div>
                            </div>
                          </div>
                          <div className="h-2.5 rounded-full bg-slate-100 p-0.5 flex gap-0.5">
                            <div style={{ width: `${greenPct}%` }} className="h-full bg-emerald-500 rounded-s-full shadow-[0_0_10px_rgba(16,185,129,0.2)]" />
                            <div style={{ width: `${amberPct}%` }} className="h-full bg-amber-400" />
                            <div style={{ width: `${redPct}%` }} className="h-full bg-rose-500 rounded-e-full shadow-[0_0_10px_rgba(244,63,94,0.2)]" />
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 p-6 bg-slate-50/30 rounded-[2.5rem] border border-slate-100/50">
                        {brandBranches.map(a => {
                          const r = getBranchRating(a);
                          let bgColor = '#10B981'; let textColor = 'white';
                          if (r < 4.5) { bgColor = '#34D399'; textColor = 'white'; }
                          if (r < 4.0) { bgColor = '#FBBF24'; textColor = '#1E293B'; }
                          if (r < 3.5) { bgColor = '#FB923C'; textColor = 'white'; }
                          if (r < 3.0) { bgColor = '#F43F5E'; textColor = 'white'; }
                          const displayName = getBranchDisplayName(a);
                          const shortName = displayName.length > 18 ? displayName.slice(0, 18) + '…' : displayName;

                          return (
                            <div key={a.id}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full cursor-default transition-all duration-300 hover:scale-105 hover:z-10 hover:shadow-lg border border-white/30"
                              style={{ backgroundColor: bgColor, color: textColor }}
                              title={`${displayName}\n${r.toFixed(2)} ★ · ${a.total_reviews_period} reviews`}>
                              <span className="text-[10px] font-black">{r.toFixed(1)}★</span>
                              <span className="text-[9px] font-bold opacity-90 whitespace-nowrap">{shortName}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                <div className="flex flex-wrap items-center gap-6 mt-6 pt-6 border-t border-slate-100">
                  <div className="flex items-center gap-4">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest"><BiInline en="Quality Legend:" /></span>
                    <div className="flex gap-2">
                      {[
                        { label: '4.5+', color: '#10B981' },
                        { label: '4.0+', color: '#34D399' },
                        { label: '3.5+', color: '#FBBF24' },
                        { label: '3.0+', color: '#FB923C' },
                        { label: '<3.0', color: '#F43F5E' },
                      ].map(s => (
                        <div key={s.label} className="flex items-center gap-1">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                          <span className="text-[9px] font-bold text-slate-500">{s.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="h-4 w-[1px] bg-slate-200 hidden sm:block" />
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-1.5 rounded-full bg-slate-400 opacity-40" />
                    <span className="text-[8px] font-bold text-slate-500">{t('Opacity = Review Volume')}</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Is the rating moving */}
          <Card>
            <SectionHeader title={`${t('Rating Trend')}`} sub={`${periodInfo.label}`} />
            <div className="mt-4">
              <MultiLineChart
                series={brandSummaries.map(b => ({
                  label: b.brand,
                  data: [...b.monthly].reverse().map(m => m.avg),
                  color: b.color,
                }))}
                labels={[periodInfo.p3.short, periodInfo.p2.short, periodInfo.p1.short]}
                yMin={Math.max(0, Math.min(...brandSummaries.flatMap(b => b.monthly.map(m => m.avg)).filter(Boolean) as number[]) - 0.5)}
                yMax={5}
                yLabel="Avg Rating"
              />
              <div className="flex flex-wrap justify-center gap-4 mt-3">
                {brandSummaries.map(b => (
                  <span key={b.brand} className="flex items-center gap-2 text-xs font-black uppercase tracking-tight" style={{ color: b.color }}>
                    <span className="w-4 h-[2px] rounded-full" style={{ backgroundColor: b.color }} />
                    {b.brand}
                  </span>
                ))}
              </div>
            </div>
          </Card>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════
          TAB: BRANCH DATA
         ═══════════════════════════════════════════════════════ */}
      {activeTab === 'branches' && (
        <>
          {/* ── Branch-wise Visual Graphs (before table) ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <SectionHeader title={`${t('Branch Rating Distribution')}`} sub={`${periodInfo.label}`} />
              <div className="mt-6">
                {(() => {
                  const bands = [
                    { label: '4.5+ Excellent', min: 4.5, max: 6, color: '#10B981' },
                    { label: '4.0–4.4 Good', min: 4.0, max: 4.5, color: '#34D399' },
                    { label: '3.5–3.9 Average', min: 3.5, max: 4.0, color: '#FBBF24' },
                    { label: '3.0–3.4 Below Avg', min: 3.0, max: 3.5, color: '#FB923C' },
                    { label: 'Below 3.0 Poor', min: 0, max: 3.0, color: '#F43F5E' },
                  ];
                  return (
                    <div className="space-y-5">
                      {bands.map((band, bIdx) => (
                        <div key={band.label} className="animate-fade-slide-up" style={{ animationDelay: `${bIdx * 80}ms` }}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: band.color }} />
                            <span className="text-[10px] font-black text-slate-600">{band.label}</span>
                          </div>
                          <div className="space-y-1">
                            {brandSummaries.map(bs => {
                              const brandBranches = analytics.filter(a => a.brand === bs.brand && isRankable(a));
                              const bandCount = brandBranches.filter(a => {
                                const r = getBranchRating(a);
                                return r >= band.min && r < band.max;
                              }).length;
                              const total = brandBranches.length || 1;
                              const pct = (bandCount / total) * 100;
                              return (
                                <div key={bs.brand} className="flex items-center gap-2">
                                  <div className="min-w-[80px] flex items-center gap-1.5">
                                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: bs.color }} />
                                    <span className="text-[9px] font-black text-slate-500 truncate">{bs.brand}</span>
                                    {bs.isTarget && <span className="text-[7px] font-black px-1 py-0 bg-indigo-50 text-indigo-500 rounded">{t('YOU')}</span>}
                                  </div>
                                  <div className="flex-1 h-4 bg-slate-100 rounded overflow-hidden">
                                    <div className="h-full rounded animate-grow-width flex items-center px-1"
                                      style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: bs.color, animationDelay: `${bIdx * 80 + 200}ms` }}>
                                      {pct > 15 && <span className="text-[8px] font-black text-white">{bandCount}</span>}
                                    </div>
                                  </div>
                                  <span className="text-[9px] font-black text-slate-400 min-w-[55px] text-end">{bandCount} ({pct.toFixed(0)}%)</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {/* Legend */}
                      <div className="flex flex-wrap gap-3 pt-2 border-t border-slate-100">
                        {brandSummaries.map(bs => (
                          <span key={bs.brand} className="flex items-center gap-1 text-[9px] font-bold text-slate-500">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: bs.color }} />
                            {bs.brand} {bs.isTarget ? `(${t('Your Brand')})` : `(${t('Competitor')})`}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </Card>

            <Card>
              <SectionHeader
              title={`${t('Top Performers')} / ${t('Bottom Performers')}`}
              sub={(() => {
                const skipped = analytics.filter(a => !isRankable(a)).length;
                return skipped > 0
                  ? `${periodInfo.label} · ${skipped} ${t('branches left out — no reviews in this period')}`
                  : periodInfo.label;
              })()}
            />
              <div className="mt-6">
                {(() => {
                  const sorted = [...analytics]
                    .filter(isRankable)
                    .sort((a, b) => getBranchRating(b) - getBranchRating(a));
                  const top5 = sorted.slice(0, 5);
                  const bottom5 = sorted.slice(-5).reverse();
                  const renderEntry = (a: BranchAnalytics, i: number, variant: 'top' | 'bottom', rank: number) => {
                    const isTarget = a.brand === targetBrand;
                    const bgClass = variant === 'top' ? 'bg-emerald-50/50 border-emerald-100' : 'bg-rose-50/50 border-rose-100';
                    const textClass = variant === 'top' ? 'text-emerald-600' : 'text-rose-600';
                    return (
                      <div key={a.id} className={`flex items-center gap-2 p-2.5 rounded-lg border ${bgClass} animate-fade-slide-up`} style={{ animationDelay: `${i * 80}ms` }}>
                        <span className={`text-[10px] font-black ${textClass} w-5`}>#{rank}</span>
                        <div className="w-1.5 self-stretch rounded-full" style={{ backgroundColor: colorMap[a.brand] || '#94A3B8' }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-black text-slate-900 truncate">{getBranchDisplayName(a)}</span>
                            {isTarget ? (
                              <span className="text-[7px] font-black px-1.5 py-0.5 bg-indigo-100 text-indigo-600 rounded-md uppercase whitespace-nowrap"><BiInline en="Your Brand" /></span>
                            ) : (
                              <span className="text-[7px] font-black px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded-md uppercase whitespace-nowrap"><BiInline en="Competitor" /></span>
                            )}
                          </div>
                          <div className="text-[8px] font-bold text-slate-400 mt-0.5">
                            <span style={{ color: colorMap[a.brand] }}>{a.brand}</span>
                            {a.city && <span className="text-slate-300"> · {a.city}</span>}
                            <span className="text-slate-300"> · {a.total_reviews_period} {t('reviews')}</span>
                          </div>
                        </div>
                        <span className={`text-[11px] font-black ${textClass}`}>{getBranchRating(a) > 0 ? getBranchRating(a).toFixed(2) + '★' : '—'}</span>
                      </div>
                    );
                  };
                  return (
                    <div className="grid grid-cols-1 gap-4">
                      <div>
                        <div className="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-3">★ {t('Top 5 — Highest Rated')}</div>
                        <div className="space-y-2">
                          {top5.map((a, i) => renderEntry(a, i, 'top', i + 1))}
                        </div>
                      </div>
                      <div>
                        <div className="text-[9px] font-black text-rose-500 uppercase tracking-widest mb-3">↓ {t('Bottom 5 — Needs Improvement')}</div>
                        <div className="space-y-2">
                          {bottom5.map((a, i) => renderEntry(a, i, 'bottom', sorted.length - 4 + i))}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </Card>
          </div>

          {/* ── Branch Reviews per Period — Bar Chart ── */}
          <Card>
            <SectionHeader title={`Branch Review Volume by Period`} sub={`Reviews per period for each brand — ${periodInfo.label}`} />
            <div className="mt-4">
              <GroupedBarChart
                groups={brandSummaries.map(b => b.brand)}
                series={[
                  { label: periodInfo.p1.short, data: brandSummaries.map(b => b.monthly[0]?.reviews ?? 0), color: '#10B981' },
                  { label: periodInfo.p2.short, data: brandSummaries.map(b => b.monthly[1]?.reviews ?? 0), color: '#FBBF24' },
                  { label: periodInfo.p3.short, data: brandSummaries.map(b => b.monthly[2]?.reviews ?? 0), color: '#94A3B8' },
                ]}
                height={260}
                yLabel="Reviews"
              />
              <div className="flex flex-wrap justify-center gap-4 mt-3">
                {[
                  { label: periodInfo.p1.short, color: '#10B981' },
                  { label: periodInfo.p2.short, color: '#FBBF24' },
                  { label: periodInfo.p3.short, color: '#94A3B8' },
                ].map(s => (
                  <span key={s.label} className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600">
                    <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </span>
                ))}
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
              <SectionHeader
                title={t('Branch-wise Data')}
                sub={`${filteredBranches.length} ${t('branches')} — ${t('all columns from the Excel report')}`}
              />
              <div className="flex flex-wrap gap-2">
                {canEdit && jobId && (
                  <>
                    <button type="button" onClick={() => { setIsAddOpen(true); setBranchMsg(''); }} disabled={branchBusy}
                      className="px-3 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black hover:bg-indigo-700 disabled:opacity-50">
                      + {t('Add Location')}
                    </button>
                    <button type="button" onClick={handleDedup} disabled={branchBusy}
                      className="px-3 py-2 bg-amber-500 text-white rounded-xl text-xs font-black hover:bg-amber-600 disabled:opacity-50">
                      {t('Remove Duplicates')}
                    </button>
                  </>
                )}
                <select value={filterBrand} onChange={e => setFilterBrand(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20">
                  <option value="All">{t('All Brands')}</option>
                  {brandSummaries.map(b => <option key={b.brand} value={b.brand}>{b.brand}</option>)}
                </select>
                <select value={filterCity} onChange={e => setFilterCity(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20">
                  <option value="All">{t('All Cities')}</option>
                  {cities.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <input type="text" placeholder={t('Search branch...')} value={search} onChange={e => setSearch(e.target.value)}
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20 w-44" />
              </div>
            </div>

            {canEdit && branchMsg && (
              <div className="mb-3 text-xs font-bold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">{branchMsg}</div>
            )}

            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-start text-xs min-w-[1600px]">
                <thead>
                  <tr className="border-b border-slate-100">
                    {canEdit && <TH align="center">{t('Actions')}</TH>}
                    <TH>{t('Brand')}</TH>
                    <TH>{t('Store Name')}</TH>
                    <TH clickable onClick={() => handleSort('name')}>{t('Branch Name')} {sortCol === 'name' ? (sortAsc ? '↑' : '↓') : ''}</TH>
                    <TH>{t('Address')}</TH>
                    <TH>{t('Maps')}</TH>
                    <TH>{t('Hours')}</TH>
                    <TH>{t('Phone')}</TH>
                    <TH>{t('Peak Time')}</TH>
                    <TH>{t('Busy Hours')}</TH>
                    <TH clickable onClick={() => handleSort('rating')} align="right">{t('Avg Rating')} ({periodInfo.p1.short}) {sortCol === 'rating' ? (sortAsc ? '↑' : '↓') : ''}</TH>
                    <TH clickable onClick={() => handleSort('reviews')} align="right">{t('Reviews')} {sortCol === 'reviews' ? (sortAsc ? '↑' : '↓') : ''}</TH>
                    <TH align="right">{periodInfo.p1.short} Rev</TH>
                    <TH align="right">{periodInfo.p1.short} ★</TH>
                    <TH align="right">{periodInfo.p2.short} Rev</TH>
                    <TH align="right">{periodInfo.p2.short} ★</TH>
                    <TH align="right">{periodInfo.p3.short} Rev</TH>
                    <TH align="right">{periodInfo.p3.short} ★</TH>
                    <TH align="center">5★</TH>
                    <TH align="center">4★</TH>
                    <TH align="center">3★</TH>
                    <TH align="center">2★</TH>
                    <TH align="center">1★</TH>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredBranches.map(a => (
                    <tr key={a.id} className={`hover:bg-slate-50/50 transition-colors ${selectedId === a.id ? 'bg-indigo-50/40' : ''}`}>
                      {canEdit && (
                        <td className="px-2 py-3 text-center">
                          <button type="button" title={t('Delete branch')} disabled={branchBusy}
                            onClick={() => handleDeleteBranch(a.id, getBranchDisplayName(a))}
                            className="text-rose-500 hover:text-rose-700 font-black disabled:opacity-40 text-sm leading-none">✕</button>
                        </td>
                      )}
                      <td className="px-2 py-3">
                        <BrandBadge brand={a.brand} color={colorMap[a.brand] || '#94A3B8'} />
                      </td>
                      <td className="px-2 py-3 text-[11px] font-bold text-slate-700 max-w-[200px] truncate" title={a.store_name || ''}>{a.store_name || '—'}</td>
                      <td className="px-2 py-3 font-black text-slate-900 whitespace-nowrap">{getBranchDisplayName(a)}</td>
                      <td className="px-2 py-3 text-[10px] text-slate-500 max-w-[180px] truncate" title={a.address || ''}>{a.address || '—'}</td>
                      <td className="px-2 py-3">
                        {a.google_maps_link ? (
                          <a href={a.google_maps_link} target="_blank" rel="noopener" className="text-[10px] font-bold text-indigo-500 hover:underline whitespace-nowrap">{t('View Map')}</a>
                        ) : '—'}
                      </td>
                      <td className="px-2 py-3 text-[10px] text-slate-500 max-w-[140px] truncate" title={a.business_hours || ''}>{a.business_hours || '—'}</td>
                      <td className="px-2 py-3 text-[10px] text-slate-600 whitespace-nowrap">{a.phone || '—'}</td>
                      <td className="px-2 py-3 text-[10px] font-bold text-slate-600 whitespace-nowrap">{a.peak_time || '—'}</td>
                      <td className="px-2 py-3 text-[10px] text-slate-500 max-w-[140px] truncate" title={a.busy_hours_summary || ''}>{a.busy_hours_summary || '—'}</td>
                      <td className="px-2 py-3 text-end font-black text-slate-900">{getBranchRating(a) > 0 ? getBranchRating(a).toFixed(2) : '—'}</td>
                      <td className="px-2 py-3 text-end font-black text-slate-900">{a.total_reviews_period}</td>
                      <td className="px-2 py-3 text-end text-slate-700 font-bold">{a.period_1_reviews}</td>
                      <td className="px-2 py-3 text-end text-slate-500">{a.period_1_avg_rating?.toFixed(2) ?? '—'}</td>
                      <td className="px-2 py-3 text-end text-slate-700 font-bold">{a.period_2_reviews}</td>
                      <td className="px-2 py-3 text-end text-slate-500">{a.period_2_avg_rating?.toFixed(2) ?? '—'}</td>
                      <td className="px-2 py-3 text-end text-slate-700 font-bold">{a.period_3_reviews}</td>
                      <td className="px-2 py-3 text-end text-slate-500">{a.period_3_avg_rating?.toFixed(2) ?? '—'}</td>
                      <td className="px-2 py-3 text-center text-emerald-600 font-bold">{a.star_5_count}</td>
                      <td className="px-2 py-3 text-center text-emerald-400 font-bold">{a.star_4_count}</td>
                      <td className="px-2 py-3 text-center text-amber-500 font-bold">{a.star_3_count}</td>
                      <td className="px-2 py-3 text-center text-rose-400 font-bold">{a.star_2_count}</td>
                      <td className="px-2 py-3 text-center text-rose-600 font-bold">{a.star_1_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {canEdit && isAddOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setIsAddOpen(false)}>
              <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-black text-slate-900 mb-4">{t('Add Location')}</h3>
                <form onSubmit={handleAddBranch} className="grid grid-cols-2 gap-3">
                  {([
                    ['brand', 'Brand *'], ['store_name', 'Store Name (Google)'],
                    ['branch_name', 'Branch Name *'],
                    ['city', 'City'], ['address', 'Address'],
                    ['google_maps_link', 'Google Maps Link'], ['place_id', 'Place ID (ChIJ… → scrapes popular times)'],
                    ['phone', 'Phone'], ['business_hours', 'Hours'],
                    ['stars', 'Avg Rating (0–5)'], ['reviews_count', 'Reviews Count'],
                  ] as [keyof typeof addForm, string][]).map(([k, label]) => (
                    <label key={k} className={`flex flex-col gap-1 ${k === 'address' || k === 'google_maps_link' || k === 'place_id' ? 'col-span-2' : ''}`}>
                      <span className="text-[10px] font-black text-slate-500 uppercase">{label}</span>
                      {k === 'brand' ? (
                        <input list="brand-options" value={addForm.brand} onChange={e => setAddForm(f => ({ ...f, brand: e.target.value }))}
                          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20" />
                      ) : (
                        <input type={k === 'stars' || k === 'reviews_count' ? 'number' : 'text'} step="any"
                          value={addForm[k]} onChange={e => setAddForm(f => ({ ...f, [k]: e.target.value }))}
                          className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20" />
                      )}
                    </label>
                  ))}
                  <datalist id="brand-options">
                    {brandSummaries.map(b => <option key={b.brand} value={b.brand} />)}
                  </datalist>
                  <div className="col-span-2 flex gap-2 justify-end mt-2">
                    <button type="button" onClick={() => setIsAddOpen(false)} className="px-4 py-2 rounded-xl text-xs font-black text-slate-600 bg-slate-100 hover:bg-slate-200">{t('Cancel')}</button>
                    <button type="submit" disabled={branchBusy} className="px-4 py-2 rounded-xl text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50">{branchBusy ? '…' : t('Add Location')}</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════════════════════
          TAB: RANKINGS
         ═══════════════════════════════════════════════════════ */}
      {activeTab === 'rankings' && (
        <>
          {/* Top & Bottom visual chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <SectionHeader title={t('Top 15 Branches')} sub={t('Highest rated branches across all brands')} />
              <div className="mt-4 overflow-x-auto">
                <RankingChart
                  items={rankings.slice(0, 15).map(a => ({
                    label: getBranchDisplayName(a),
                    value: getBranchRating(a),
                    color: colorMap[a.brand] || '#94A3B8',
                    sub: isAr ? `${a.total_reviews_period} مراجعة` : `${a.total_reviews_period}r`,
                  }))}
                  maxVal={5}
                />
              </div>
            </Card>
            <Card>
              <SectionHeader title={t('Bottom 15 Branches')} sub={t('Lowest rated — focus areas for improvement')} />
              <div className="mt-4 overflow-x-auto">
                <RankingChart
                  items={[...rankings].reverse().slice(0, 15).map(a => ({
                    label: getBranchDisplayName(a),
                    value: getBranchRating(a),
                    color: colorMap[a.brand] || '#94A3B8',
                    sub: isAr ? `${a.total_reviews_period} مراجعة` : `${a.total_reviews_period}r`,
                  }))}
                  maxVal={5}
                />
              </div>
            </Card>
          </div>

          {/* Full Rankings Table */}
          <Card>
            <SectionHeader title={t('Full Branch Rankings')} sub={`${t('All')} ${tn(rankings.length)} ${t('branches ranked by rating')}`} />
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    <TH align="center">{t('Rank')}</TH>
                    <TH>{t('Brand')}</TH>
                    <TH>{t('Branch')}</TH>
                    <TH>{t('City')}</TH>
                    <TH>{t('Address')}</TH>
                    <TH align="right">{t('Avg Rating')}</TH>
                    <TH align="right">{t('Reviews')}</TH>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {rankings.map((a, i) => {
                    const isTop = i < 10;
                    const isBottom = i >= rankings.length - 10;
                    return (
                      <tr key={a.id} className={`hover:bg-slate-50/50 transition-colors ${isTop ? 'bg-emerald-50/30' : isBottom ? 'bg-rose-50/30' : ''}`}>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-black ${isTop ? 'bg-emerald-100 text-emerald-700' : isBottom ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-500'
                            }`}>
                            {tn(i + 1)}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <BrandBadge brand={a.brand} color={colorMap[a.brand] || '#94A3B8'} />
                        </td>
                        <td className="px-3 py-3 font-black text-slate-900">{getBranchDisplayName(a)}</td>
                        <td className="px-3 py-3 text-slate-500 uppercase text-[11px] tracking-tight">{a.city || '—'}</td>
                        <td className="px-3 py-3 text-[10px] text-slate-500 max-w-[250px] truncate" title={a.address || ''}>{a.address || '—'}</td>
                        <td className="px-3 py-3 text-end">
                          <span className={`font-black ${isTop ? 'text-emerald-600' : isBottom ? 'text-rose-600' : 'text-slate-900'}`}>
                            {tn(getBranchRating(a), { decimals: 2 })} ★
                          </span>
                        </td>
                        <td className="px-3 py-3 text-end font-bold text-slate-600">{tn(a.total_reviews_period)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {/* ═══════════════════════════════════════════════════════
          TAB: POPULAR TIMES
         ═══════════════════════════════════════════════════════ */}
      {activeTab === 'popular-times' && (
        <>
          {/* ── Peak Hours by Brand (visual bars first) ── */}
          {ptBranches.length > 0 && (
            <Card>
              <SectionHeader title={t('Peak Hours by Brand')} sub={`${t('Average peak busyness comparison —')} ${periodInfo.label}`} />
              
              {/* Bilingual Popular Times explanation card */}
              <div className="mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-100/80 text-xs text-slate-600 leading-relaxed space-y-3">
                <div className="flex items-start gap-2.5">
                  <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-500 mt-0.5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  </div>
                  <div>
                    <div className="font-bold text-slate-800 mb-1">
                      <Bi en="How to read Peak Busyness & Percentages?" />
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-slate-500 ps-1">
                      <li>
                        <Bi en="Scale (0% - 100%): Google's busyness score is relative. 100% represents the absolute busiest hour of the entire week for a branch. | المقياس (0٪ - 100٪): مؤشر الازدحام من Google نسبي. يمثل 100٪ ساعة الذروة القصوى للفرع طوال الأسبوع بأكمله." />
                      </li>
                      <li>
                        <Bi en="Average Peak: Represents the average occupancy during the brand's busiest operating hours across all locations. | متوسط ​​الذروة: يمثل متوسط ​​نسبة إشغال العملاء خلال ساعات التشغيل الأكثر ازدحاماً للعلامة التجارية عبر جميع الفروع." />
                      </li>
                      <li>
                        <Bi en="Peak Time: Shows when the highest customer footfall occurs, helping you identify sweet spots for marketing campaigns, staffing, and promotions. | وقت الذروة: يوضح متى يحدث أكبر إقبال للعملاء، مما يساعدك على تحديد الأوقات الأنسب للحملات التسويقية، التوظيف، والعروض الترويجية." />
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                {brandSummaries.map((bs, bIdx) => {
                  const brandBranches = ptBranches.filter(a => a.brand === bs.brand);
                  if (brandBranches.length === 0) return null;
                  const avgPeak = brandBranches.reduce((s, a) => s + (a.peak_busyness_pct ?? 0), 0) / brandBranches.length;
                  const peakDays = brandBranches.map(a => a.peak_day).filter(Boolean);
                  const mostCommonPeakDay = (peakDays.length > 0
                    ? peakDays.sort((a, b) => peakDays.filter(v => v === a).length - peakDays.filter(v => v === b).length).pop()
                    : '—') || '—';
                  return (
                    <div key={bs.brand} className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 animate-fade-slide-up" style={{ animationDelay: `${bIdx * 100}ms` }}>
                      <BrandBadge brand={bs.brand} color={bs.color} />
                      <div className="flex-1">
                        <div className="h-4 bg-slate-200 rounded-full relative overflow-hidden">
                          <div className="absolute inset-y-0 ltr:left-0 rtl:right-0 rounded-full animate-grow-width" style={{ width: `${avgPeak}%`, backgroundColor: bs.color, animationDelay: `${bIdx * 100 + 200}ms` }} />
                        </div>
                      </div>
                      <div className="text-end min-w-[120px]">
                        <div className="text-xs font-black text-slate-900">
                          {isAr ? (
                            <span className="inline-flex items-center gap-1">
                              <span>{t('avg peak')}</span>
                              <span dir="ltr">{avgPeak.toFixed(0)}%</span>
                            </span>
                          ) : (
                            `${avgPeak.toFixed(0)}% avg peak`
                          )}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {isAr ? `${brandBranches.length} فروع · ${t(mostCommonPeakDay)}` : `${brandBranches.length} branches · ${mostCommonPeakDay}`}
                        </div>
                      </div>
                    </div>
                  );
                }).filter(Boolean)}
              </div>
            </Card>
          )}

          {/* ── Average Hourly Busyness — Line Chart ── */}
          {ptBranches.length > 0 && (
            <Card>
              <SectionHeader title={t('Average Hourly Busyness')} sub={`${t('Averaged across all branches per brand —')} ${periodInfo.label}`} />
              <div className="mt-4">
                <HourlyOverlayChart
                  series={brandSummaries.map(bs => {
                    const brandPt = ptBranches.filter(a => a.brand === bs.brand && a.popular_times_grid);
                    if (brandPt.length === 0) return { label: bs.brand, data: Array(24).fill(null), color: bs.color };
                    const avgHour = Array(24).fill(null) as (number | null)[];
                    for (let h = 0; h < 24; h++) {
                      let sum = 0, cnt = 0;
                      for (const a of brandPt) {
                        if (!a.popular_times_grid) continue;
                        for (const day of DAYS) {
                          const v = a.popular_times_grid[day]?.[h];
                          if (v != null) { sum += v; cnt++; }
                        }
                      }
                      avgHour[h] = cnt > 0 ? Math.round(sum / cnt) : null;
                    }
                    return { label: bs.brand, data: avgHour, color: bs.color };
                  }).filter(s => s.data.some(v => v != null))}
                />
                <div className="flex flex-wrap justify-center gap-4 mt-3">
                  {brandSummaries.map(b => (
                    <span key={b.brand} className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600">
                      <span className="w-3 h-[3px] rounded-full" style={{ backgroundColor: b.color }} />
                      {b.brand}
                    </span>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {/* ── Peak Day Distribution + Weekday vs Weekend (Hidden/Removed per user request) ── */}
          {/* ptBranches.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <SectionHeader title={t('Peak Day Distribution')} sub={`${t('Which day of the week each brand peaks on —')} ${periodInfo.label}`} />
                <div className="mt-4">
                  <GroupedBarChart
                    groups={DAYS.map(d => t(DAY_LABELS[d]))}
                    series={brandSummaries.map(bs => {
                      const brandPt = ptBranches.filter(a => a.brand === bs.brand && a.popular_times_grid);
                      const dayCounts = DAYS.map(day => {
                        let sum = 0, cnt = 0;
                        for (const a of brandPt) {
                          if (!a.popular_times_grid) continue;
                          const hourly = a.popular_times_grid[day];
                          if (Array.isArray(hourly)) {
                            const peak = Math.max(...hourly.filter((v): v is number => v != null));
                            if (peak > 0) { sum += peak; cnt++; }
                          }
                        }
                        return cnt > 0 ? Math.round(sum / cnt) : 0;
                      });
                      return { label: bs.brand, data: dayCounts, color: bs.color };
                    })}
                    height={240}
                    yLabel={isAr ? 'ذروة الازدحام %' : 'Peak Busyness %'}
                  />
                  <div className="flex flex-wrap justify-center gap-4 mt-3">
                    {brandSummaries.map(b => (
                      <span key={b.brand} className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600">
                        <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: b.color }} />
                        {b.brand}
                      </span>
                    ))}
                  </div>
                </div>
              </Card>

              <Card>
                <SectionHeader title={t('Weekday vs Weekend')} sub={`${t('Average busyness comparison —')} ${periodInfo.label}`} />
                <div className="mt-6 space-y-4">
                  {brandSummaries.map((bs, bIdx) => {
                    const brandPt = ptBranches.filter(a => a.brand === bs.brand && a.popular_times_grid);
                    if (brandPt.length === 0) return null;
                    const weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'] as const;
                    const weekends = ['SATURDAY', 'SUNDAY'] as const;
                    let wdSum = 0, wdCnt = 0, weSum = 0, weCnt = 0;
                    for (const a of brandPt) {
                      if (!a.popular_times_grid) continue;
                      for (const day of weekdays) {
                        const hourly = a.popular_times_grid[day];
                        if (Array.isArray(hourly)) { for (const v of hourly) { if (v != null) { wdSum += v; wdCnt++; } } }
                      }
                      for (const day of weekends) {
                        const hourly = a.popular_times_grid[day];
                        if (Array.isArray(hourly)) { for (const v of hourly) { if (v != null) { weSum += v; weCnt++; } } }
                      }
                    }
                    const wdAvg = wdCnt > 0 ? Math.round(wdSum / wdCnt) : 0;
                    const weAvg = weCnt > 0 ? Math.round(weSum / weCnt) : 0;
                    const maxAvg = Math.max(wdAvg, weAvg, 1);
                    return (
                      <div key={bs.brand} className="animate-fade-slide-up" style={{ animationDelay: `${bIdx * 100}ms` }}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: bs.color }} />
                          <span className="text-xs font-black text-slate-700">{bs.brand}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <div className="text-[8px] font-black text-slate-400 uppercase mb-1">{t('Weekdays (Mon–Fri)')}</div>
                            <div className="h-6 bg-slate-100 rounded-lg relative overflow-hidden">
                              <div className="absolute inset-y-0 ltr:left-0 rtl:right-0 rounded-lg animate-grow-width flex items-center justify-end pe-2"
                                style={{ width: `${(wdAvg / maxAvg) * 100}%`, backgroundColor: bs.color, animationDelay: `${bIdx * 100 + 200}ms` }}>
                                <span dir="ltr" className="text-[9px] font-black text-white">{wdAvg}%</span>
                              </div>
                            </div>
                          </div>
                          <div>
                            <div className="text-[8px] font-black text-slate-400 uppercase mb-1">{t('Weekend (Sat–Sun)')}</div>
                            <div className="h-6 bg-slate-100 rounded-lg relative overflow-hidden">
                              <div className="absolute inset-y-0 ltr:left-0 rtl:right-0 rounded-lg animate-grow-width flex items-center justify-end pe-2"
                                style={{ width: `${(weAvg / maxAvg) * 100}%`, backgroundColor: bs.color, opacity: 0.7, animationDelay: `${bIdx * 100 + 350}ms` }}>
                                <span dir="ltr" className="text-[9px] font-black text-white">{weAvg}%</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }).filter(Boolean)}
                </div>
              </Card>
            </div>
          ) */}

          {/* NEW: Busyness Level Distribution */}
          {ptBranches.length > 0 && (
            <Card>
              <SectionHeader title={t('Busyness Level Distribution')} sub={`${t('Branch busyness tiers —')} ${periodInfo.label}`} />
              <div className="mt-6">
                {(() => {
                  const tiers = [
                    { label: 'Very Busy (80%+)', min: 80, max: 101, color: '#F43F5E' },
                    { label: 'Busy (60–79%)', min: 60, max: 80, color: '#FB923C' },
                    { label: 'Moderate (40–59%)', min: 40, max: 60, color: '#FBBF24' },
                    { label: 'Quiet (20–39%)', min: 20, max: 40, color: '#34D399' },
                    { label: 'Very Quiet (<20%)', min: 0, max: 20, color: '#10B981' },
                  ];
                  const total = ptBranches.filter(a => a.peak_busyness_pct != null).length || 1;
                  return (
                    <div className="space-y-3">
                      {tiers.map((tier, tIdx) => {
                        const count = ptBranches.filter(a => {
                          const p = a.peak_busyness_pct ?? -1;
                          return p >= tier.min && p < tier.max;
                        }).length;
                        const pct = (count / total) * 100;
                        return (
                          <div key={tier.label} className="flex items-center gap-3 animate-fade-slide-up" style={{ animationDelay: `${tIdx * 80}ms` }}>
                            <div className="min-w-[130px] text-end">
                              <span className="text-[10px] font-black text-slate-600">{t(tier.label)}</span>
                            </div>
                            <div className="flex-1 h-6 bg-slate-100 rounded-lg relative overflow-hidden">
                              <div className="absolute inset-y-0 ltr:left-0 rtl:right-0 rounded-lg animate-grow-width flex items-center ps-2"
                                style={{ width: `${Math.max(pct, 3)}%`, backgroundColor: tier.color, animationDelay: `${tIdx * 80 + 200}ms` }}>
                                {pct > 12 && <span className="text-[9px] font-black text-white">{count}</span>}
                              </div>
                            </div>
                            <div className="min-w-[50px] text-end">
                              <span dir="ltr" className="text-[10px] font-black text-slate-500 inline-flex items-center gap-1">{count} ({pct.toFixed(0)}%)</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </Card>
          )}

          {/* Selected Popular Times Heatmap */}
          {ptSelected?.popular_times_grid && (
            <Card>
              <div className="flex items-center gap-3 mb-4">
                <BrandBadge brand={ptSelected.brand} color={colorMap[ptSelected.brand] || '#94A3B8'} />
                <h3 className="text-lg font-black text-slate-900">{getBranchDisplayName(ptSelected)}</h3>
                {ptSelected.city && <span className="text-xs text-slate-400 uppercase">{ptSelected.city}</span>}
              </div>
              <PopularTimesHeatmap grid={ptSelected.popular_times_grid} />
            </Card>
          )}

          {/* ═══ DATA TABLE (at the end) ═══ */}
          <Card>
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
              <SectionHeader
                title={t('Popular Times Data')}
                sub={`${ptBranches.length} ${t('branches')} · ${periodInfo.label}`}
              />
              <select value={ptBrandFilter} onChange={e => { setPtBrandFilter(e.target.value); setPtSelectedId(null); }}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500/20">
                <option value="All">{t('All Brands')}</option>
                {brandSummaries.map(b => <option key={b.brand} value={b.brand}>{b.brand}</option>)}
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-start text-xs">
                <thead>
                  <tr className="border-b border-slate-100">
                    <TH>{t('Brand')}</TH>
                    <TH>{t('Branch')}</TH>
                    <TH>{t('City')}</TH>
                    <TH>{t('Peak Day')}</TH>
                    <TH>{t('Peak Hour')}</TH>
                    <TH align="right">{t('Peak Busyness')}</TH>
                    <TH>{t('Busy Hours')}</TH>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {ptBranches.map(a => (
                    <tr key={a.id} className={`hover:bg-slate-50/50 transition-colors ${ptSelectedId === a.id ? 'bg-indigo-50/40' : ''}`}>
                      <td className="px-2 py-3"><BrandBadge brand={a.brand} color={colorMap[a.brand] || '#94A3B8'} /></td>
                      <td className="px-2 py-3 font-black text-slate-900">{getBranchDisplayName(a)}</td>
                      <td className="px-2 py-3 text-slate-500 uppercase text-[11px]">{a.city ? t(a.city) : '—'}</td>
                      <td className="px-2 py-3 font-bold text-slate-700">{a.peak_day ? t(a.peak_day) : '—'}</td>
                      <td className="px-2 py-3 font-bold text-slate-700">{a.peak_hour ? a.peak_hour : '—'}</td>
                      <td className="px-2 py-3 text-end">
                        {a.peak_busyness_pct != null ? (
                          <span dir="ltr" className={`font-black inline-block ${a.peak_busyness_pct >= 80 ? 'text-rose-600' : a.peak_busyness_pct >= 50 ? 'text-amber-600' : 'text-slate-700'}`}>
                            {a.peak_busyness_pct}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-2 py-3 text-[10px] text-slate-500 max-w-[200px] truncate" title={a.busy_hours_summary || ''}>{a.busy_hours_summary ? tn(t(a.busy_hours_summary)) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {ptBranches.length === 0 && (
              <p className="text-sm text-slate-400 italic text-center py-8">{t('No popular times data available. Run an analysis to scrape popular times.')}</p>
            )}
          </Card>
        </>
      )}


      {/* ═══ EMAIL MODAL ═══ */}
      {isEmailModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm no-print">
          <div className="bg-white w-full max-w-md rounded-3xl p-6 border border-slate-100 shadow-2xl animate-in zoom-in-95 duration-200" dir={isAr ? 'rtl' : 'ltr'}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-black text-slate-900">
                {isAr ? 'إرسال التقرير بالبريد' : 'Email Analysis Report'}
              </h3>
              <button onClick={() => setIsEmailModalOpen(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <form onSubmit={handleSendEmail} className="space-y-4">
              <div>
                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  {isAr ? 'عنوان البريد الإلكتروني المستلم' : 'Recipient Email Address'}
                </label>
                <input
                  type="email"
                  required
                  placeholder="name@company.com"
                  value={emailToInput}
                  onChange={(e) => setEmailToInput(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-slate-800 text-sm focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-bold"
                  disabled={isSendingEmail || emailStatus === 'success'}
                />
              </div>

              {emailStatus === 'success' && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-bold flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span>{isAr ? 'تم إرسال التقرير بنجاح!' : 'Report sent successfully!'}</span>
                </div>
              )}

              {emailStatus === 'error' && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs font-bold flex items-center gap-2">
                  <svg className="w-4 h-4 shrink-0 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <span className="break-all">{emailErrorMsg}</span>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setIsEmailModalOpen(false)}
                  className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-black uppercase tracking-wider rounded-xl transition-colors"
                  disabled={isSendingEmail}
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="flex items-center justify-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black uppercase tracking-wider rounded-xl shadow-lg shadow-indigo-100 transition-all min-w-[80px]"
                  disabled={isSendingEmail || emailStatus === 'success'}
                >
                  {isSendingEmail ? (
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (
                    isAr ? 'إرسال' : 'Send'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}

// ── Custom Resilient Markdown Renderer for Claude Summaries ──
function MarkdownRenderer({ text }: { text: string }) {
  const lines = text.split('\n');
  const renderedElements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (key: number) => {
    if (listItems.length > 0) {
      renderedElements.push(
        <ul key={`list-${key}`} className="list-none text-center my-3 space-y-2 text-slate-700 text-sm leading-relaxed">
          {listItems.map((item, idx) => (
            <li key={idx} dangerouslySetInnerHTML={{ __html: parseInlineStyles(item) }} />
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  const parseInlineStyles = (txt: string) => {
    return txt.replace(/\*\*(.*?)\*\*/g, '<strong class="font-black text-slate-900">$1</strong>');
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('#')) {
      flushList(idx);
      const level = trimmed.match(/^#+/)?.[0].length || 1;
      const content = trimmed.replace(/^#+\s*/, '');
      if (level === 1) {
        renderedElements.push(<h1 key={idx} className="text-xl font-black text-slate-900 tracking-tight mt-6 mb-3 border-b border-slate-100 pb-2 text-center" dangerouslySetInnerHTML={{ __html: parseInlineStyles(content) }} />);
      } else if (level === 2) {
        renderedElements.push(<h2 key={idx} className="text-base font-black text-indigo-900 tracking-tight mt-5 mb-3 text-center" dangerouslySetInnerHTML={{ __html: parseInlineStyles(content) }} />);
      } else {
        renderedElements.push(<h3 key={idx} className="text-sm font-bold text-slate-950 mt-4 mb-2 text-center" dangerouslySetInnerHTML={{ __html: parseInlineStyles(content) }} />);
      }
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const content = trimmed.substring(2);
      listItems.push(content);
    } else if (trimmed.startsWith('>')) {
      flushList(idx);
      const content = trimmed.replace(/^>\s*/, '');
      renderedElements.push(
        <blockquote key={idx} className="border-l-4 border-indigo-500 bg-indigo-50/40 px-4 py-3 my-4 rounded-e-xl text-slate-700 text-sm font-medium leading-relaxed italic text-center" dangerouslySetInnerHTML={{ __html: parseInlineStyles(content) }} />
      );
    } else if (trimmed === '') {
      flushList(idx);
    } else {
      flushList(idx);
      renderedElements.push(
        <p
          key={idx}
          className="text-slate-600 text-sm leading-relaxed my-3 text-balance text-center"
          dangerouslySetInnerHTML={{ __html: parseInlineStyles(trimmed) }}
        />
      );
    }
  });

  flushList(lines.length);

  return <div className="space-y-1">{renderedElements}</div>;
}


// ═══════════════════════════════════════════════════════════
//  SVG Chart Components (zero dependencies)
// ═══════════════════════════════════════════════════════════

/** Donut / Pie chart for star distribution */
function DonutChart({ stars, color, size = 140 }: { stars: [number, number, number, number, number]; color: string; size?: number }) {
  const total = stars.reduce((s, n) => s + n, 0) || 1;
  const STAR_COLORS = ['#10B981', '#34D399', '#FBBF24', '#FB7185', '#F43F5E'];
  const STAR_LABELS = ['5★', '4★', '3★', '2★', '1★'];
  const cx = size / 2, cy = size / 2, r = size / 2 - 12, inner = r * 0.58;
  let cumAngle = -Math.PI / 2;

  const slices = stars.map((count, i) => {
    const pct = count / total;
    const startAngle = cumAngle;
    cumAngle += pct * 2 * Math.PI;
    const endAngle = cumAngle;
    const large = pct > 0.5 ? 1 : 0;
    if (pct === 0) return null;
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    const ix1 = cx + inner * Math.cos(endAngle), iy1 = cy + inner * Math.sin(endAngle);
    const ix2 = cx + inner * Math.cos(startAngle), iy2 = cy + inner * Math.sin(startAngle);
    const d = `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${ix1},${iy1} A${inner},${inner} 0 ${large} 0 ${ix2},${iy2} Z`;
    return <path key={i} d={d} fill={STAR_COLORS[i]} className="transition-opacity hover:opacity-80 cursor-default">
      <title>{`${STAR_LABELS[i]}: ${count} (${(pct * 100).toFixed(1)}%)`}</title>
    </path>;
  });

  const avg = stars.reduce((s, n, i) => s + n * (5 - i), 0) / total;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices}
      </svg>
    </div>
  );
}

/** Multi-line chart — e.g. monthly rating trend per brand */
function MultiLineChart({
  series,
  labels,
  height = 200,
  yMin = 0,
  yMax = 5,
  yLabel,
  showDots = true,
  showArea = true,
}: {
  series: { label: string; data: (number | null)[]; color: string }[];
  labels: string[];
  height?: number;
  yMin?: number;
  yMax?: number;
  yLabel?: string;
  showDots?: boolean;
  showArea?: boolean;
}) {
  const { isAr } = useLang();
  const W = 600, H = height, pad = { t: 20, r: 20, b: 36, l: 44 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const xStep = labels.length > 1 ? cw / (labels.length - 1) : cw;
  const toX = (i: number) => pad.l + i * xStep;
  const toY = (v: number) => pad.t + ch - ((v - yMin) / (yMax - yMin || 1)) * ch;

  const yTicks = 5;
  const yLines = Array.from({ length: yTicks + 1 }, (_, i) => yMin + (i / yTicks) * (yMax - yMin));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
      {/* Grid */}
      {yLines.map((v, i) => (
        <g key={i}>
          <line x1={pad.l} y1={toY(v)} x2={W - pad.r} y2={toY(v)} stroke="#E2E8F0" strokeWidth={1} strokeDasharray={i === 0 ? undefined : '4,4'} />
          <text 
            x={isAr ? W - pad.r + 8 : pad.l - 8} 
            y={toY(v) + 3} 
            textAnchor={isAr ? "start" : "end"} 
            style={{ fontSize: 9, fontWeight: 700 }} 
            className="fill-slate-400"
          >
            {v.toFixed(1)}
          </text>
        </g>
      ))}
      {/* X labels */}
      {labels.map((l, i) => (
        <text key={i} x={toX(i)} y={H - 8} textAnchor="middle" style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }} className="fill-slate-400">{l}</text>
      ))}
      {/* Y label */}
      {yLabel && (
        <text 
          x={isAr ? W - 12 : 12} 
          y={pad.t + ch / 2} 
          textAnchor="middle" 
          transform={`rotate(${isAr ? 90 : -90},${isAr ? W - 12 : 12},${pad.t + ch / 2})`} 
          style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }} 
          className="fill-slate-400"
        >
          {yLabel}
        </text>
      )}
      {/* Lines + areas */}
      {series.map((s, si) => {
        const points = s.data.map((v, i) => v != null ? { x: toX(i), y: toY(v), v } : null);
        const validPts = points.filter(Boolean) as { x: number; y: number; v: number }[];
        if (validPts.length < 2) return null;
        const line = validPts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
        const areaPath = line + ` L${validPts[validPts.length - 1].x},${toY(yMin)} L${validPts[0].x},${toY(yMin)} Z`;
        return (
          <g key={si}>
            {showArea && <path d={areaPath} fill={s.color} opacity={0.08} />}
            <path d={line} fill="none" stroke={s.color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            {showDots && validPts.map((p, i) => (
              <g key={i}>
                <circle cx={p.x} cy={p.y} r={5} fill="white" stroke={s.color} strokeWidth={2.5} className="cursor-default">
                  <title>{`${s.label}: ${p.v.toFixed(2)}`}</title>
                </circle>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/** Grouped vertical bar chart */
function GroupedBarChart({
  groups,
  series,
  height = 220,
  yLabel,
}: {
  groups: string[];
  series: { label: string; data: number[]; color: string }[];
  height?: number;
  yLabel?: string;
}) {
  const { isAr } = useLang();
  const W = 600, H = height, pad = { t: 16, r: 16, b: 44, l: 48 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const maxVal = Math.max(1, ...series.flatMap(s => s.data));
  const groupW = cw / groups.length;
  const barW = Math.min(24, (groupW - 12) / series.length);
  const toY = (v: number) => pad.t + ch - (v / maxVal) * ch;

  const yTicks = 4;
  const yLines = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((i / yTicks) * maxVal));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
      {yLines.map((v, i) => (
        <g key={i}>
          <line x1={pad.l} y1={toY(v)} x2={W - pad.r} y2={toY(v)} stroke="#E2E8F0" strokeWidth={1} strokeDasharray={i === 0 ? undefined : '4,4'} />
          <text 
            x={isAr ? W - pad.r + 8 : pad.l - 8} 
            y={toY(v) + 3} 
            textAnchor={isAr ? "start" : "end"} 
            style={{ fontSize: 9, fontWeight: 700 }} 
            className="fill-slate-400"
          >
            {formatArabicDigits(v, isAr)}
          </text>
        </g>
      ))}
      {yLabel && (
        <text 
          x={isAr ? W - 12 : 12} 
          y={pad.t + ch / 2} 
          textAnchor="middle" 
          transform={`rotate(${isAr ? 90 : -90},${isAr ? W - 12 : 12},${pad.t + ch / 2})`} 
          style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', direction: 'ltr', unicodeBidi: 'bidi-override' }} 
          className="fill-slate-400"
        >
          {yLabel}
        </text>
      )}
      {groups.map((g, gi) => {
        const gx = pad.l + gi * groupW + groupW / 2;
        const totalW = barW * series.length;
        return (
          <g key={gi}>
            <text x={gx} y={H - 8} textAnchor="middle" style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase' }} className="fill-slate-400">{g}</text>
            {series.map((s, si) => {
              const val = s.data[gi] ?? 0;
              const bx = gx - totalW / 2 + si * barW;
              const by = toY(val);
              const bh = toY(0) - by;
              return (
                <g key={si}>
                  <rect x={bx} y={by} width={barW - 2} height={Math.max(0, bh)} rx={3} fill={s.color} className="transition-opacity hover:opacity-70 cursor-default">
                    <title>{`${s.label}: ${formatArabicDigits(val, isAr)}`}</title>
                  </rect>
                  {val > 0 && bh > 14 && (
                    <text x={bx + (barW - 2) / 2} y={by + 12} textAnchor="middle" style={{ fontSize: 8, fontWeight: 800 }} fill="white">{formatArabicDigits(val, isAr)}</text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal progress chart for rankings - completely responsive HTML layout */
function RankingChart({ items, maxVal }: {
  items: { label: string; value: number; color: string; sub?: string }[];
  maxVal: number;
}) {
  const { isAr } = useLang();
  const tn = (val: string | number, decimals?: number) => formatArabicDigits(val, isAr, decimals !== undefined ? { decimals } : undefined);

  return (
    <div className="flex flex-col gap-3 w-full py-2">
      {items.map((item, i) => {
        const pct = maxVal > 0 ? (item.value / maxVal) * 100 : 0;
        return (
          <div key={i} className="flex items-center gap-3 text-xs w-full">
            {/* Branch Label */}
            <div className="w-[140px] sm:w-[180px] min-w-[140px] sm:min-w-[180px] truncate text-slate-700 font-bold text-end ltr:text-end rtl:text-start">
              {item.label}
            </div>
            
            {/* The Bar Container */}
            <div className="flex-1 h-5 bg-slate-100 rounded-[6px] overflow-hidden relative">
              <div 
                className="h-full rounded-[6px] opacity-85 transition-all duration-500 flex items-center justify-end px-2"
                style={{ 
                  width: `${pct}%`, 
                  backgroundColor: item.color 
                }} 
              />
            </div>
            
            {/* Rating and reviews */}
            <div className="w-[85px] sm:w-[100px] min-w-[85px] sm:min-w-[100px] flex items-center gap-1 text-slate-900 font-black ltr:text-start rtl:text-end justify-start rtl:justify-end">
              <span>{tn(item.value, 2)} ★</span>
              {item.sub && (
                <span className="text-[10px] text-slate-400 font-bold">({tn(item.sub)})</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Stacked area chart for hourly popular times — overlays multiple brands */
/** Stacked area chart for hourly popular times — overlays multiple brands */
function HourlyOverlayChart({
  series,
  height = 220,
}: {
  series: { label: string; data: (number | null)[]; color: string }[];
  height?: number;
}) {
  const { isAr } = useLang();
  const W = 600, H = height, pad = { t: 16, r: 16, b: 36, l: 40 };
  const cw = W - pad.l - pad.r, ch = H - pad.t - pad.b;
  const xStep = cw / 23;
  const toX = (h: number) => pad.l + h * xStep;
  const toY = (v: number) => pad.t + ch - (v / 100) * ch;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
      {/* Y grid */}
      {[0, 25, 50, 75, 100].map(v => (
        <g key={v}>
          <line x1={pad.l} y1={toY(v)} x2={W - pad.r} y2={toY(v)} stroke="#E2E8F0" strokeWidth={1} strokeDasharray={v === 0 ? undefined : '4,4'} />
          <text 
            x={isAr ? W - pad.r + 6 : pad.l - 6} 
            y={toY(v) + 3} 
            textAnchor={isAr ? "start" : "end"} 
            style={{ fontSize: 8, fontWeight: 700, direction: 'ltr', unicodeBidi: 'bidi-override' }} 
            className="fill-slate-400"
          >
            {v}%
          </text>
        </g>
      ))}
      {/* X labels */}
      {[0, 3, 6, 9, 12, 15, 18, 21].map(h => (
        <text key={h} x={toX(h)} y={H - 8} textAnchor="middle" style={{ fontSize: 9, fontWeight: 800 }} className="fill-slate-400">{hourLabel(h, isAr)}</text>
      ))}
      {/* Lines */}
      {series.map((s, si) => {
        const pts = s.data.map((v, h) => v != null ? { x: toX(h), y: toY(v) } : null).filter(Boolean) as { x: number; y: number }[];
        if (pts.length < 2) return null;
        const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
        const area = line + ` L${pts[pts.length - 1].x},${toY(0)} L${pts[0].x},${toY(0)} Z`;
        return (
          <g key={si}>
            <path d={area} fill={s.color} opacity={0.06} />
            <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
          </g>
        );
      })}
    </svg>
  );
}


// ── Popular Times Heatmap Component ──

function PopularTimesHeatmap({ grid }: { grid: Record<string, (number | null)[]> }) {
  const t = useT();
  const { isAr } = useLang();
  const tn = (val: string | number) => formatArabicDigits(val, isAr);

  return (
    <div className="overflow-x-auto">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3"><BiInline en="Popular Times Heatmap" /></p>
      <div className="min-w-[640px]">
        <div className="grid gap-1" style={{ gridTemplateColumns: 'auto repeat(24, minmax(0,1fr))' }}>
          <div />
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} className="text-[8px] font-black text-slate-400 text-center">{hourLabel(h, isAr)}</div>
          ))}
          {DAYS.map(day => {
            const hourly = grid[day] || [];
            return (
              <React.Fragment key={day}>
                <div className="text-[10px] font-black text-slate-500 uppercase pe-2 flex items-center">{t(DAY_LABELS[day])}</div>
                {Array.from({ length: 24 }).map((_, h) => {
                  const v = hourly[h];
                  const alpha = v == null ? 0 : Math.max(0.05, v / 100);
                  return (
                    <div key={h}
                      className="aspect-square rounded-[2px] transition-transform hover:scale-150 hover:z-10 cursor-default"
                      style={{ backgroundColor: v == null ? '#F1F5F9' : `rgba(79, 70, 229, ${alpha})` }}
                      title={v == null ? `${t(DAY_LABELS[day])} ${hourLabel(h, isAr)} — ${isAr ? 'لا توجد بيانات' : 'no data'}` : `${t(DAY_LABELS[day])} ${hourLabel(h, isAr)} — ${tn(`${v}%`)}`} />
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          <span><BiInline en="Quiet" /></span>
          <div className="h-1 flex-1 mx-4 bg-gradient-to-r from-slate-100 to-indigo-600 rounded-full" />
          <span><BiInline en="Peak" /></span>
        </div>
      </div>
    </div>
  );
}


// ── Helper Components ──

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`p-6 md:p-8 bg-white/70 backdrop-blur-xl rounded-3xl border border-white/40 shadow-[0_20px_50px_rgba(0,0,0,0.05)] hover:shadow-[0_20px_60px_rgba(99,102,241,0.08)] transition-all duration-500 relative overflow-hidden group ${className || ''}`}>
      <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      {children}
    </div>
  );
}

function SectionHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <h3 className="text-lg font-black text-slate-900 tracking-tight">{title}</h3>
      <p className="text-xs font-medium text-slate-500 mt-0.5">{sub}</p>
    </div>
  );
}

function KPI({ label, value, sub, color, badge, labelColor }: { label: string; value: string; sub: string; color: string; badge?: string; labelColor?: string }) {
  const isEmerald = color === 'emerald';
  const isRose = color === 'rose';

  return (
    <div className={`p-6 rounded-3xl bg-slate-900 border transition-all hover:scale-[1.02] duration-300 group
      ${isEmerald ? 'border-emerald-500/50 shadow-[0_0_20px_rgba(16,185,129,0.1)]' :
        isRose ? 'border-rose-500/50 shadow-[0_0_20px_rgba(244,63,94,0.1)]' :
          'border-slate-800 shadow-2xl hover:border-slate-700'}`}>

      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: labelColor || '#94a3b8' }}>{label}</span>
        {badge && <span className="text-[8px] font-black px-1.5 py-0.5 bg-indigo-600 text-white rounded-md uppercase">{badge}</span>}
      </div>

      <div className={`text-3xl font-black leading-none tracking-tight
        ${isEmerald ? 'text-emerald-400' : isRose ? 'text-rose-400' : 'text-white'}`}>
        {value}
      </div>

      <div className={`text-[10px] font-bold mt-2 transition-colors
        ${isEmerald ? 'text-emerald-500/70' : isRose ? 'text-rose-500/70' : 'text-slate-500 group-hover:text-slate-400'}`}>
        {sub}
      </div>
    </div>
  );
}

function BrandBadge({ brand, color }: { brand: string; color: string }) {
  return (
    <span className="text-sm font-black uppercase tracking-tight whitespace-nowrap"
      style={{ color: color }}>
      {brand}
    </span>
  );
}

function Seg({ n, t, c }: { n: number; t: number; c: string }) {
  const pct = (n / t) * 100;
  if (pct === 0) return null;
  return (
    <div className="h-full first:rounded-s-lg last:rounded-e-lg transition-all duration-700"
      style={{ width: `${pct}%`, backgroundColor: c }}
      title={`${n} (${pct.toFixed(0)}%)`} />
  );
}

function Mini({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
      <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{label}</div>
      <div className="text-sm font-black text-slate-900 mt-1 leading-none">
        {value}{unit && <span className="text-xs font-bold text-slate-500 ms-1">{unit}</span>}
      </div>
    </div>
  );
}

function TH({ children, clickable, onClick, align }: { children: React.ReactNode; clickable?: boolean; onClick?: () => void; align?: 'right' | 'center' }) {
  const base = `px-2 py-3 text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap ${align === 'right' ? 'text-end' : align === 'center' ? 'text-center' : 'text-start'}`;
  if (clickable) {
    return <th className={`${base} cursor-pointer hover:text-indigo-600 select-none`} onClick={onClick}>{children}</th>;
  }
  return <th className={base}>{children}</th>;
}

function Star({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.97a1 1 0 00.95.69h4.18c.969 0 1.371 1.24.588 1.81l-3.388 2.46a1 1 0 00-.364 1.118l1.286 3.97c.3.921-.755 1.688-1.54 1.118l-3.388-2.46a1 1 0 00-1.175 0l-3.388 2.46c-.784.57-1.838-.197-1.539-1.118l1.286-3.97a1 1 0 00-.364-1.118L2.245 9.397c-.783-.57-.38-1.81.588-1.81h4.18a1 1 0 00.95-.69l1.286-3.97z" />
    </svg>
  );
}
