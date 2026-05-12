'use client';
import { useState, useEffect } from 'react';
import OverviewTab from './tab-overview';
import GmailTab    from './tab-gmail';
import GmbTab      from './tab-gmb';
import WorkerTab   from './tab-worker';
import UsersTab    from './tab-users';

type Tab = 'overview' | 'gmail' | 'gmb' | 'worker' | 'users';

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>('overview');
  const [settings, setSettings] = useState<any>(null);
  const [loading, setLoading]   = useState(true);

  async function loadSettings() {
    setLoading(true);
    const r = await fetch('/api/admin/settings');
    const j = await r.json();
    setSettings(j.settings);
    setLoading(false);
  }
  useEffect(() => { loadSettings(); }, []);

  return (
    <div className="space-y-8">
      <nav className="flex flex-wrap gap-1 bg-slate-100/50 p-1.5 rounded-2xl w-fit">
        {([
          ['overview','Platform Overview'], 
          ['users','Clients'], 
          ['gmail','Email Config'], 
          ['gmb','Business API'], 
          ['worker','System Runner']
        ] as const).map(([t, label]) => (
          <button 
            key={t} 
            onClick={() => setTab(t as Tab)}
            className={`px-5 py-2.5 text-xs font-bold rounded-xl transition-all uppercase tracking-widest
              ${tab === t 
                ? 'bg-white text-indigo-600 shadow-md shadow-indigo-600/5 ring-1 ring-slate-200/50' 
                : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 space-y-4 modern-card">
          <div className="w-10 h-10 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Synchronizing Settings…</p>
        </div>
      ) : (
        <div className="modern-card p-10">
          <div className="max-w-4xl">
            {tab === 'overview' && <OverviewTab />}
            {tab === 'users'    && <UsersTab />}
            {tab === 'gmail'    && <GmailTab  settings={settings} reload={loadSettings} />}
            {tab === 'gmb'      && <GmbTab    settings={settings} reload={loadSettings} />}
            {tab === 'worker'   && <WorkerTab settings={settings} reload={loadSettings} />}
          </div>
        </div>
      )}
    </div>
  );
}
