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
      <button onClick={() => setOpen(!open)}
        className="relative border rounded p-1.5 hover:bg-gray-50">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
             strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-white border rounded-lg shadow-lg z-10">
          <div className="flex items-center justify-between p-3 border-b">
            <span className="font-medium text-sm">Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-blue-600 hover:underline">Mark all read</button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0
              ? <p className="text-sm text-gray-500 p-4 text-center">No notifications</p>
              : items.slice(0, 20).map(n => (
                  <Link key={n.id} href={n.job_id ? `/jobs/${n.job_id}` : '#'}
                    className={`block p-3 border-b hover:bg-gray-50 ${!n.read_at ? 'bg-blue-50' : ''}`}>
                    <div className="flex items-start gap-2">
                      <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${
                        n.kind === 'job_succeeded' ? 'bg-green-500' :
                        n.kind === 'job_failed'    ? 'bg-red-500'   :
                        n.kind === 'email_sent'    ? 'bg-blue-500'  : 'bg-gray-400'
                      }`}/>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{n.title}</p>
                        {n.body && <p className="text-xs text-gray-600 truncate">{n.body}</p>}
                        <p className="text-xs text-gray-400 mt-0.5">{new Date(n.created_at).toLocaleString()}</p>
                      </div>
                    </div>
                  </Link>
                ))}
          </div>
        </div>
      )}
    </div>
  );
}
