export function KpiStripSkeleton() {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-hidden="true">
      {[1, 2, 3, 4].map((n) => (
        <div key={n} className="surface-card rounded-2xl p-5 space-y-3 animate-pulse">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2 flex-1">
              <div className="h-3 w-24 bg-[#E2E8F0] rounded" />
              <div className="h-7 w-16 bg-[#E2E8F0] rounded" />
            </div>
            <div className="w-10 h-10 rounded-xl bg-[#E2E8F0]" />
          </div>
          <div className="h-3 w-32 bg-[#F1F5F9] rounded" />
        </div>
      ))}
    </div>
  );
}

export function CardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3.5" aria-hidden="true">
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="surface-card rounded-2xl p-5 space-y-3 animate-pulse">
          <div className="flex items-center gap-3">
            <div className="h-3 w-20 bg-[#E2E8F0] rounded" />
            <div className="h-3 w-36 bg-[#F1F5F9] rounded" />
          </div>
          <div className="h-5 w-2/3 bg-[#E2E8F0] rounded" />
          <div className="h-3 w-full bg-[#F1F5F9] rounded" />
          <div className="h-3 w-1/2 bg-[#F1F5F9] rounded" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="surface-card rounded-2xl overflow-hidden animate-pulse" aria-hidden="true">
      <div className="h-11 bg-[#F3F6FA] border-b border-[#DCE4EE]" />
      <div className="divide-y divide-[#E2E8F0]">
        {Array.from({ length: rows }).map((_, idx) => (
          <div key={idx} className="px-4 py-4 flex items-center justify-between gap-4">
            <div className="space-y-1.5 flex-1">
              <div className="h-3.5 w-48 bg-[#E2E8F0] rounded" />
              <div className="h-3 w-32 bg-[#F1F5F9] rounded" />
            </div>
            <div className="h-3.5 w-28 bg-[#F1F5F9] rounded" />
            <div className="h-7 w-16 bg-[#E2E8F0] rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-8" role="status" aria-label="Loading workspace data">
      <div className="space-y-2 animate-pulse">
        <div className="h-3 w-36 bg-[#E2E8F0] rounded" />
        <div className="h-7 w-72 bg-[#E2E8F0] rounded" />
        <div className="h-4 w-96 max-w-full bg-[#F1F5F9] rounded" />
      </div>
      <KpiStripSkeleton />
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7">
          <CardListSkeleton count={2} />
        </div>
        <div className="lg:col-span-5">
          <TableSkeleton rows={3} />
        </div>
      </div>
    </div>
  );
}
