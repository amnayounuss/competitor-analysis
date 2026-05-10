'use client';
import { useState, useEffect } from 'react';
import GmailTab    from './tab-gmail';
import GmbTab      from './tab-gmb';
import WorkerTab   from './tab-worker';
import UsersTab    from './tab-users';

type Tab = 'gmail' | 'gmb' | 'worker' | 'users';

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>('gmail');
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
    <div>
      <nav className="flex border-b mb-6">
        {([['gmail','Gmail'], ['gmb','GMB'], ['worker','Worker'], ['users','Users']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t as Tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors
              ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
            {label}
          </button>
        ))}
      </nav>

      {loading ? <p className="text-sm text-gray-500">Loading…</p> : (
        <div className="bg-white border rounded-lg p-6 shadow-sm">
          {tab === 'gmail'  && <GmailTab  settings={settings} reload={loadSettings} />}
          {tab === 'gmb'    && <GmbTab    settings={settings} reload={loadSettings} />}
          {tab === 'worker' && <WorkerTab settings={settings} reload={loadSettings} />}
          {tab === 'users'  && <UsersTab />}
        </div>
      )}
    </div>
  );
}
