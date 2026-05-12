'use client';
import { useEffect, useState, useRef } from 'react';
import { browserClient } from '@/lib/supabase';
import Link from 'next/link';

interface Notification {
  id: number; kind: string; title: string; body: string|null;
  read_at: string|null; created_at: string; job_id: string|null;
}

export default function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    load();
    const sb = browserClient();
    const ch = sb.channel('notifications-bell')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (p) => setItems(prev => [p.new as Notification, ...prev]))
      .subscribe();
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => { sb.removeChannel(ch); document.removeEventListener('mousedown', onClickOutside); };
  }, []);

  async function load() {
    const r = await fetch('/api/notifications');
    const j = await r.json();
    setItems(j.notifications || []);
  }

  async function markAllRead() {
    await fetch('/api/notifications', {
      method:'PATCH', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ markAllRead: true }),
    });
    load();
  }

  const unread = items.filter(n => !n.read_at).length;

  return (
    <div ref={ref} className="relative">
      <button 
        onClick={() => setOpen(!open)}
        className={`relative p-2.5 rounded-xl transition-all ${
          open 
            ? 'bg-indigo-50 text-indigo-600 ring-2 ring-indigo-200' 
            : 'bg-white border border-slate-100 text-slate-400 hover:bg-slate-50 hover:text-slate-600'
        }`}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-rose-500 text-white text-[9px] font-black rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 border-2 border-white shadow-sm">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-3 w-80 bg-white/80 backdrop-blur-xl border border-slate-100 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between p-4 border-b border-slate-50/50 bg-white/50">
            <span className="font-bold text-slate-900 text-sm tracking-tight">Intelligence Feed</span>
            {unread > 0 && (
              <button 
                onClick={markAllRead} 
                className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 uppercase tracking-widest px-2 py-1 rounded-lg hover:bg-indigo-50 transition-colors"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 ? (
              <div className="py-12 px-6 text-center">
                <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
                </div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Awaiting Events</p>
              </div>
            ) : (
              items.slice(0, 20).map(n => (
                <Link 
                  key={n.id} 
                  href={n.job_id ? `/jobs/${n.job_id}` : '#'}
                  className={`block p-4 border-b border-slate-50 last:border-0 transition-colors ${!n.read_at ? 'bg-indigo-50/30' : 'hover:bg-slate-50/50'}`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 shadow-sm ${
                      n.kind === 'job_succeeded' ? 'bg-emerald-500 ring-4 ring-emerald-500/10' :
                      n.kind === 'job_failed'    ? 'bg-rose-500 ring-4 ring-rose-500/10'   :
                      n.kind === 'email_sent'    ? 'bg-indigo-500 ring-4 ring-indigo-500/10'  : 'bg-slate-300 ring-4 ring-slate-300/10'
                    }`}/>
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm tracking-tight ${!n.read_at ? 'font-bold text-slate-900' : 'font-medium text-slate-600'}`}>
                        {n.title}
                      </p>
                      {n.body && <p className="text-xs text-slate-500 truncate mt-0.5 leading-relaxed">{n.body}</p>}
                      <p className="text-[10px] font-bold text-slate-300 uppercase tracking-tighter mt-1.5">
                        {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(n.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </p>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
