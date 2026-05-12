'use client';
import { useEffect, useState } from 'react';

interface Schedule {
  id: string;
  enabled: boolean;
  target_name: string;
  competitors: string[];
  email_to: string;
  day_of_month: number;
  next_run_at: string;
  last_run_at: string | null;
  has_token: boolean;
}

export default function SchedulesList() {
  const [items, setItems] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const r = await fetch('/api/schedules');
    const j = await r.json();
    setItems(j.schedules || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function remove(id: string) {
    if (!confirm('Delete this schedule?')) return;
    await fetch(`/api/schedules?id=${id}`, { method:'DELETE' });
    load();
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 space-y-4">
        <div className="w-12 h-12 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
        <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Accessing Automation Registry…</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="modern-card p-16 text-center">
        <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-slate-100">
          <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2 tracking-tight">No active schedules</h3>
        <p className="text-slate-500 max-w-sm mx-auto leading-relaxed">
          Enable the "Run monthly" toggle when initiating a new analysis to see your recurring automations here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {items.map(s => (
        <div key={s.id} className="modern-card p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 group hover:border-indigo-200 transition-all">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-bold text-slate-900 truncate tracking-tight">{s.target_name}</h3>
              <span className="text-slate-400 font-medium">vs</span>
              <p className="text-sm font-semibold text-slate-600 truncate max-w-[200px]">{s.competitors.join(', ')}</p>
              
              {s.enabled ? (
                <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-600 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border border-emerald-100">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-500 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full border border-slate-200">
                  Paused
                </span>
              )}
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400 uppercase tracking-wide">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                Next Trigger: {new Date(s.next_run_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: 'numeric' })}
              </div>
              <div className="flex items-center gap-2 text-[11px] font-bold text-slate-400 uppercase tracking-wide">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                Recipient: {s.email_to}
              </div>
            </div>

            {s.last_run_at && (
              <p className="text-[10px] font-medium text-slate-400/80 italic">
                Execution history: Last cycle completed on {new Date(s.last_run_at).toLocaleDateString()}
              </p>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            <button 
              onClick={() => remove(s.id)}
              className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-rose-600 transition-colors uppercase tracking-widest"
            >
              Terminate
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
