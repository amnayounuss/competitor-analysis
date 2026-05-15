'use client';

export default function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    queued:    'bg-slate-100 text-slate-600 border-slate-200',
    running:   'bg-indigo-100 text-indigo-700 border-indigo-200',
    succeeded: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    failed:    'bg-rose-100 text-rose-800 border-rose-200',
    cancelled: 'bg-amber-100 text-amber-800 border-amber-200',
  };
  return (
    <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border shadow-sm ${map[status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
      {status}
    </span>
  );
}
