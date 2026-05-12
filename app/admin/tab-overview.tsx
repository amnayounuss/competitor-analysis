'use client';
import { useState, useEffect } from 'react';

interface Client {
  id: string;
  email: string;
  full_name?: string;
  db_connected: boolean;
  jobs_active: number;
  jobs_total: number;
}

interface Stats {
  totalClients: number;
  connectedDBs: number;
  activeJobs: number;
  totalJobs: number;
}

export default function OverviewTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const r = await fetch('/api/admin/users');
    const j = await r.json();
    
    // Compute stats from client data
    const clients: Client[] = j.clients || [];
    const totalClients = clients.length;
    const connectedDBs = clients.filter(u => u.db_connected).length;
    const activeJobs = clients.reduce((acc, u) => acc + u.jobs_active, 0);
    const totalJobs = clients.reduce((acc, u) => acc + u.jobs_total, 0);

    setStats({ totalClients, connectedDBs, activeJobs, totalJobs });
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  if (loading || !stats) return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Platform Overview</h2>
        <p className="text-sm text-slate-500 mt-1">Real-time system performance and client activity</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard label="Total Clients" value={stats.totalClients} icon="👥" color="indigo" />
        <StatCard label="Live Databases" value={stats.connectedDBs} icon="🗄️" color="emerald" sub={`${Math.round((stats.connectedDBs / stats.totalClients) * 100) || 0}% coverage`} />
        <StatCard label="Active Jobs" value={stats.activeJobs} icon="⚡" color="amber" sub="Across all users" />
        <StatCard label="Total Reports" value={stats.totalJobs} icon="📊" color="slate" />
      </div>

      <div className="bg-slate-50 border border-slate-100 rounded-2xl p-6">
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-widest mb-4">Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 hover:border-indigo-300 transition-colors cursor-pointer group">
            <p className="font-bold text-slate-900 group-hover:text-indigo-600">Infrastructure Health</p>
            <p className="text-xs text-slate-500 mt-1">Check worker status and API latency</p>
          </div>
          <div className="bg-white p-4 rounded-xl border border-slate-200 hover:border-indigo-300 transition-colors cursor-pointer group">
            <p className="font-bold text-slate-900 group-hover:text-indigo-600">Broadcast Message</p>
            <p className="text-xs text-slate-500 mt-1">Send notification to all active clients</p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  icon: string;
  color: 'indigo' | 'emerald' | 'amber' | 'slate';
  sub?: string;
}

function StatCard({ label, value, icon, color, sub }: StatCardProps) {
  const colors: Record<string, string> = {
    indigo: 'text-indigo-600 bg-indigo-50',
    emerald: 'text-emerald-600 bg-emerald-50',
    amber: 'text-amber-600 bg-amber-50',
    slate: 'text-slate-600 bg-slate-50',
  };

  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${colors[color]}`}>
          {icon}
        </div>
      </div>
      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{label}</p>
      <p className="text-3xl font-black text-slate-900 mt-1 tracking-tight">{value}</p>
      {sub && <p className="text-[10px] font-bold text-slate-400 mt-2 uppercase tracking-wide">{sub}</p>}
    </div>
  );
}
