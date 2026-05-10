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

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (items.length === 0) {
    return (
      <div className="bg-white border rounded-lg p-6 text-center">
        <p className="text-sm text-gray-600">No schedules yet.</p>
        <p className="text-xs text-gray-500 mt-1">Tick "Run monthly" when you submit an analysis to create one.</p>
      </div>
    );
  }

  return (
    <ul className="bg-white border rounded-lg divide-y shadow-sm">
      {items.map(s => (
        <li key={s.id} className="p-4 flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {s.target_name}
              <span className="text-gray-500 font-normal"> vs {s.competitors.join(', ')}</span>
              {s.enabled
                ? <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">active</span>
                : <span className="ml-2 text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded">paused</span>}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Day {s.day_of_month} → next: {new Date(s.next_run_at).toLocaleString()}
              {' • '}emails {s.email_to}
            </p>
            {s.last_run_at && (
              <p className="text-xs text-gray-400">Last run: {new Date(s.last_run_at).toLocaleString()}</p>
            )}
          </div>
          <button onClick={() => remove(s.id)}
            className="text-xs text-red-600 hover:text-red-800">Delete</button>
        </li>
      ))}
    </ul>
  );
}
