'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/lib/bilingual';

/**
 * Remove an analysis and everything it wrote.
 *
 * Offered for any run that is not still going. A succeeded run can be wrong as
 * easily as a failed one, and there was no way to clear a finished analysis
 * whose figures were nonsense. There is no undo, so the confirmation says what
 * survives.
 */
export default function DeleteJobButton({ jobId, targetName, status }: {
  jobId: string; targetName?: string; status?: string;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const t = useT();

  async function remove() {
    const name = targetName ? ` "${targetName}"` : '';
    const heading = status === 'succeeded' ? t('Delete this analysis') : t('Delete this failed analysis');
    if (!confirm(heading + name + '?\n\n' + t('It cannot be undone. Your reviews and branches stay — only this run is removed.'))) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/jobs/${jobId}/delete`, { method: 'DELETE' });
      if (r.ok) {
        router.refresh();
      } else {
        const j = await r.json().catch(() => ({}));
        alert(t('Could not delete it: ') + (j.error || t('unknown error')));
      }
    } catch {
      alert(t('Network error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); remove(); }}
      disabled={loading}
      title={t('Delete this analysis')}
      className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-slate-500 bg-slate-50 hover:bg-rose-50 hover:text-rose-600 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-rose-200 transition-all active:scale-95 disabled:opacity-50"
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round"
          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
      {loading ? t('Deleting…') : t('Delete')}
    </button>
  );
}
