'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface RecentJob {
  id: string;
  target_name: string;
  status: string;
  user_email: string;
  queued_at: string;
  kind: string;
}

interface RecentError {
  message: string;
  created_at: string;
  job_id: string;
}

interface Stats {
  totalClients: number;
  connectedDBs: number;
  activeSchedules: number;
  activeJobs: number;
  succeededJobs: number;
  failedJobs: number;
  totalReviews: number;
  totalBranches: number;
  recentJobs: RecentJob[];
  recentErrors: RecentError[];
}

export default function OverviewTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      setLoading(true);
      const r = await fetch('/api/admin/stats');
      const j = await r.json();
      setStats(j);
    } catch (err) {
      console.error('Failed to load stats:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (loading || !stats) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <div className="w-10 h-10 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Compiling System Intel…</p>
      </div>
    );
  }

  const successRate = stats.succeededJobs + stats.failedJobs > 0 
    ? Math.round((stats.succeededJobs / (stats.succeededJobs + stats.failedJobs)) * 100) 
    : 100;

  const dbConnectionRate = stats.totalClients > 0 
    ? Math.round((stats.connectedDBs / stats.totalClients) * 100) 
    : 0;

  return (
    <div className="space-y-10 animate-in fade-in duration-500">
      {/* Top Level KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          label="Total Clients" 
          value={stats.totalClients} 
          icon={<UsersIcon />} 
          color="indigo" 
          sub={`${dbConnectionRate}% Setup Completed`}
        />
        <StatCard 
          label="Platform Health" 
          value={`${successRate}%`} 
          icon={<TrendIcon />} 
          color="emerald" 
          sub={`${stats.activeJobs} Jobs in Queue`}
        />
        <StatCard 
          label="Data Velocity" 
          value={stats.totalReviews.toLocaleString()} 
          icon={<DatabaseIcon />} 
          color="amber" 
          sub={`${stats.totalBranches} Branches Cached`}
        />
        <StatCard 
          label="Automations" 
          value={stats.activeSchedules} 
          icon={<ClockIcon />} 
          color="slate" 
          sub="Monthly Cycles Active"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Feed: Recent Activity */}
        <div className="lg:col-span-2 space-y-8">
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Live Activity Stream</h3>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Real-time</span>
              </div>
            </div>
            
            <div className="bg-white border border-slate-100 rounded-[2.5rem] overflow-hidden shadow-sm">
              {stats.recentJobs.length === 0 ? (
                <div className="p-16 text-center">
                  <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-300 mx-auto mb-4">
                    <DatabaseIcon />
                  </div>
                  <p className="text-slate-400 font-bold italic">No jobs recorded yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {stats.recentJobs.map(job => (
                    <div key={job.id} className="p-6 flex items-center justify-between hover:bg-slate-50/50 transition-all cursor-default group">
                      <div className="flex items-center gap-5">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 ${
                          job.status === 'succeeded' ? 'bg-emerald-50 text-emerald-600' : 
                          job.status === 'failed' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'
                        }`}>
                          {job.kind === 'scheduled' ? <ClockIcon /> : <ZapIcon />}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 text-sm leading-tight group-hover:text-indigo-600 transition-colors">{job.target_name}</p>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight mt-1">{job.user_email}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-[10px] font-black uppercase tracking-widest mb-1 ${
                          job.status === 'succeeded' ? 'text-emerald-500' : 
                          job.status === 'failed' ? 'text-rose-500' : 'text-amber-500'
                        }`}>
                          {job.status}
                        </div>
                        <p className="text-[10px] font-medium text-slate-400">
                          {new Date(job.queued_at).toLocaleDateString([], { month: 'short', day: 'numeric' })} at {new Date(job.queued_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* System Warnings Section */}
          {stats.recentErrors.length > 0 && (
            <div className="space-y-6">
              <h3 className="text-sm font-black text-rose-600 uppercase tracking-widest flex items-center gap-2">
                <WarningIcon />
                System Alerts
              </h3>
              <div className="space-y-3">
                {stats.recentErrors.map((err, i) => (
                  <div key={i} className="bg-rose-50/50 border border-rose-100 rounded-2xl p-4 flex items-start gap-4">
                    <div className="p-2 bg-rose-100 text-rose-600 rounded-lg shrink-0">
                      <WarningIcon />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-rose-900 line-clamp-1">{err.message}</p>
                      <p className="text-[10px] font-medium text-rose-500 mt-1 uppercase tracking-tight">
                        Triggered {new Date(err.created_at).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: System Specs & Monitoring */}
        <div className="space-y-8">
          <div className="bg-slate-900 rounded-[2.5rem] p-8 text-white shadow-2xl shadow-slate-900/20 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 blur-3xl -mr-16 -mt-16 group-hover:bg-indigo-500/20 transition-all duration-700" />
            
            <div className="relative z-10 space-y-8">
              <div className="flex items-center justify-between">
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Worker Instance</h4>
                <div className="px-2 py-1 bg-emerald-500/10 text-emerald-400 rounded-lg text-[9px] font-black uppercase tracking-widest border border-emerald-500/20">
                  Healthy
                </div>
              </div>

              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                    <span>Processing Load</span>
                    <span>{stats.activeJobs > 0 ? 'High' : 'Idle'}</span>
                  </div>
                  <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-indigo-500 transition-all duration-1000" 
                      style={{ width: `${stats.activeJobs > 0 ? 65 : 5}%` }} 
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Queue Size</p>
                    <p className="text-2xl font-black text-white">{stats.activeJobs}</p>
                  </div>
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5">
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-1">Success</p>
                    <p className="text-2xl font-black text-emerald-400">{successRate}%</p>
                  </div>
                </div>
              </div>

              <div className="pt-4">
                <Link href="/admin?tab=worker" className="flex items-center justify-center gap-2 w-full py-4 bg-white text-slate-900 rounded-2xl font-bold text-xs hover:bg-slate-100 transition-all active:scale-95">
                  <SettingsIcon />
                  Infrastructure Specs
                </Link>
              </div>
            </div>
          </div>

          {/* Setup Coverage Card */}
          <div className="bg-white border border-slate-100 rounded-[2.5rem] p-8 space-y-6 shadow-sm">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Connectivity Coverage</h4>
            
            <div className="flex items-center gap-6">
              <div className="relative w-20 h-20 shrink-0">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="40" cy="40" r="36" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-slate-50" />
                  <circle cx="40" cy="40" r="36" stroke="currentColor" strokeWidth="8" fill="transparent" strokeDasharray={226} strokeDashoffset={226 - (226 * dbConnectionRate) / 100} className="text-indigo-600 transition-all duration-1000" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs font-black text-slate-900">{dbConnectionRate}%</span>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-bold text-slate-900">Database Ready</p>
                <p className="text-[10px] font-medium text-slate-500 leading-relaxed">
                  {stats.connectedDBs} of {stats.totalClients} clients have completed their database setup.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: 'indigo' | 'emerald' | 'amber' | 'slate';
  sub?: string;
}

function StatCard({ label, value, icon, color, sub }: StatCardProps) {
  const colors: Record<string, string> = {
    indigo: 'text-indigo-600 bg-indigo-50 border-indigo-100',
    emerald: 'text-emerald-600 bg-emerald-50 border-emerald-100',
    amber: 'text-amber-600 bg-amber-50 border-amber-100',
    slate: 'text-slate-600 bg-slate-50 border-slate-100',
  };

  return (
    <div className="bg-white border border-slate-100 rounded-[2.5rem] p-8 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group">
      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl mb-6 border ${colors[color]} group-hover:scale-110 transition-transform duration-500`}>
        {icon}
      </div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</p>
      <p className="text-4xl font-black text-slate-900 mt-2 tracking-tight">{value}</p>
      {sub && (
        <div className="flex items-center gap-2 mt-5">
          <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest truncate">{sub}</p>
        </div>
      )}
    </div>
  );
}

// Minimal Icons
function UsersIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>; }
function TrendIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m0 0a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 012-2h2a2 2 0 012 2v16" /></svg>; }
function DatabaseIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>; }
function ClockIcon() { return <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>; }
function ZapIcon() { return <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>; }
function WarningIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>; }
function SettingsIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>; }
