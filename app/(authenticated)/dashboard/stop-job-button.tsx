'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function StopJobButton({ jobId }: { jobId: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function stop() {
    if (!confirm('Are you sure you want to stop this analysis?')) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
      if (r.ok) {
        router.refresh();
      } else {
        const j = await r.json();
        alert('Failed to stop job: ' + (j.error || 'unknown error'));
      }
    } catch (err) {
      alert('Network error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button 
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        stop();
      }}
      disabled={loading}
      className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-lg border border-rose-100 transition-all active:scale-95 disabled:opacity-50"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M6 18L18 6M6 6l12 12" />
      </svg>
      {loading ? 'Stopping...' : 'Stop Job'}
    </button>
  );
}
