export default function Loading() {
  return (
    <div className="p-8 space-y-8 animate-pulse">
      {/* Header Skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-3">
          <div className="h-9 w-64 bg-slate-200 rounded-xl" />
          <div className="h-4 w-48 bg-slate-100 rounded-lg" />
        </div>
        <div className="h-12 w-40 bg-slate-200 rounded-2xl" />
      </div>

      {/* Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-32 bg-white rounded-[2rem] border border-slate-100 p-6 space-y-4">
            <div className="h-3 w-16 bg-slate-100 rounded" />
            <div className="h-8 w-24 bg-slate-200 rounded-lg" />
          </div>
        ))}
      </div>

      {/* Table/Content Skeleton */}
      <div className="bg-white rounded-[2rem] border border-slate-100 overflow-hidden">
        <div className="p-8 border-b border-slate-50">
          <div className="h-6 w-32 bg-slate-200 rounded-lg" />
        </div>
        <div className="p-8 space-y-6">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="h-12 w-full bg-slate-50 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
