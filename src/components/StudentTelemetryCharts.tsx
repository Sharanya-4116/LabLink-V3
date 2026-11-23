import { ArrowUpRight } from 'lucide-react';
import type { Department, Equipment, User } from '../../shared/types.ts';
import type { EnrichedBookingRequest, EnrichedReservation } from '../lib/api.ts';
import { SurfaceCard, SurfaceCardHeader } from './ui/SurfaceCard.tsx';

interface StudentTelemetryChartsProps {
  currentUser: User;
  departments: Department[];
  equipment: Equipment[];
  bookings: EnrichedBookingRequest[];
  reservations: EnrichedReservation[];
  onExploreDepartment: (departmentId: string) => void;
}

export function StudentTelemetryCharts({
  currentUser,
  departments,
  equipment,
  bookings,
  reservations,
  onExploreDepartment,
}: StudentTelemetryChartsProps) {
  // 1. Real Department Readiness & Certification Breakdown
  const deptBreakdown = departments.map((dept) => {
    const assets = equipment.filter((eq) => eq.departmentId === dept.id);
    let certifiedReady = 0;
    let availableNeedsCert = 0;
    let unavailable = 0;

    for (const eq of assets) {
      if (eq.status !== 'AVAILABLE') {
        unavailable++;
      } else {
        const hasAll = eq.requiredCertifications.every((c) =>
          currentUser.certifications.includes(c)
        );
        if (hasAll) certifiedReady++;
        else availableNeedsCert++;
      }
    }

    return {
      dept,
      total: assets.length,
      certifiedReady,
      availableNeedsCert,
      unavailable,
    };
  });

  const maxDeptTotal = Math.max(1, ...deptBreakdown.map((d) => d.total));
  const totalAssets = equipment.length;
  const totalCertifiedReady = deptBreakdown.reduce((acc, d) => acc + d.certifiedReady, 0);

  // 2. Real Student Booking Pipeline & SmartFair Standing
  const conflictCount = bookings.filter((b) => b.status === 'CONFLICT_REVIEW').length;
  const pendingCount = bookings.filter((b) => b.status === 'PENDING').length;
  const approvedCount = bookings.filter((b) => b.status === 'APPROVED').length;
  const closedCount = bookings.filter(
    (b) => b.status === 'REJECTED' || b.status === 'CANCELLED'
  ).length;
  const totalBookings = bookings.length;

  const activeScored = bookings.filter(
    (b) =>
      (b.status === 'PENDING' || b.status === 'CONFLICT_REVIEW') &&
      b.smartFairSnapshot !== null
  );
  const avgScore =
    activeScored.length > 0
      ? activeScored.reduce((acc, b) => acc + (b.smartFairSnapshot?.score ?? 0), 0) /
        activeScored.length
      : null;

  const pipelineSegments = [
    { label: 'Approved', count: approvedCount, color: '#059669' },
    { label: 'Conflict Review', count: conflictCount, color: '#D97706' },
    { label: 'Pending', count: pendingCount, color: '#2563EB' },
    { label: 'Closed', count: closedCount, color: '#94A3B8' },
  ];

  // SVG Donut math
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  let runningOffset = 0;

  const usageHours = currentUser.rolling30DayHoursUsed;
  const usageCap = 40;
  const usagePct = Math.min(100, Math.round((usageHours / usageCap) * 100));
  const completedOrActiveRes = reservations.filter(
    (r) => r.lifecycleStatus === 'CONFIRMED' || r.lifecycleStatus === 'CHECKED_OUT' || r.lifecycleStatus === 'RETURNED'
  ).length;

  return (
    <section
      aria-label="Campus readiness and allocation telemetry"
      className="grid grid-cols-1 lg:grid-cols-12 gap-6"
    >
      {/* Left 7 cols: Department Equipment Readiness & Certification Coverage */}
      <SurfaceCard className="lg:col-span-7 overflow-hidden flex flex-col">
        <SurfaceCardHeader
          title="Department Equipment Readiness &amp; Your Clearances"
          subtitle={`${totalCertifiedReady} of ${totalAssets} campus instruments immediately bookable with your active safety clearances`}
          action={
            <div className="flex flex-wrap items-center gap-3 text-[11px] font-medium text-[#475569]">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#059669]" aria-hidden="true" />
                <span>Certified Ready</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#2563EB]" aria-hidden="true" />
                <span>Clearance Needed</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-xs bg-[#D97706]" aria-hidden="true" />
                <span>Maintenance</span>
              </span>
            </div>
          }
        />

        <div className="p-5 sm:p-6 space-y-4 flex-1 flex flex-col justify-center">
          {deptBreakdown.length === 0 ? (
            <p className="text-xs text-[#64748B]">No department equipment data available yet.</p>
          ) : (
            deptBreakdown.map(({ dept, total, certifiedReady, availableNeedsCert, unavailable }) => {
              const certWidth = (certifiedReady / maxDeptTotal) * 100;
              const needsWidth = (availableNeedsCert / maxDeptTotal) * 100;
              const maintWidth = (unavailable / maxDeptTotal) * 100;
              const isHomeDept = dept.id === currentUser.departmentId;

              return (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => onExploreDepartment(dept.id)}
                  className="w-full text-left group rounded-xl p-3 -mx-1 hover:bg-[#F8FAFC] border border-transparent hover:border-[#E2E8F0] transition-colors"
                >
                  <div className="flex items-center justify-between gap-3 text-xs mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-bold text-[#0F172A] shrink-0">
                        {dept.code}
                      </span>
                      <span className="text-[#475569] truncate">{dept.name}</span>
                      {isHomeDept && (
                        <span className="font-mono text-[10px] font-semibold text-[#2563EB] shrink-0">
                          · Home Dept
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
                        {certifiedReady}/{total} ready
                      </span>
                      <ArrowUpRight
                        className="w-3.5 h-3.5 text-[#94A3B8] group-hover:text-[#2563EB] transition-colors"
                        aria-hidden="true"
                      />
                    </div>
                  </div>

                  <div className="h-3.5 w-full bg-[#F1F5F9] rounded-full overflow-hidden flex border border-[#E2E8F0]">
                    {certifiedReady > 0 && (
                      <div
                        className="h-full bg-[#059669] transition-[width] duration-300"
                        style={{ width: `${certWidth}%` }}
                        title={`${certifiedReady} certified & available`}
                      />
                    )}
                    {availableNeedsCert > 0 && (
                      <div
                        className="h-full bg-[#2563EB] border-l border-white/50 transition-[width] duration-300"
                        style={{ width: `${needsWidth}%` }}
                        title={`${availableNeedsCert} available (additional clearance needed)`}
                      />
                    )}
                    {unavailable > 0 && (
                      <div
                        className="h-full bg-[#D97706] border-l border-white/50 transition-[width] duration-300"
                        style={{ width: `${maintWidth}%` }}
                        title={`${unavailable} in maintenance/offline`}
                      />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </SurfaceCard>

      {/* Right 5 cols: Request Pipeline Donut & 30-Day Fairness Standing */}
      <SurfaceCard className="lg:col-span-5 overflow-hidden flex flex-col">
        <SurfaceCardHeader
          title="Allocation Pipeline &amp; Fairness Standing"
          subtitle="Live request status distribution &amp; 30-day usage budget"
        />

        <div className="p-5 sm:p-6 flex-1 flex flex-col justify-between gap-5">
          <div className="flex items-center gap-5">
            {/* SVG Pipeline Ring */}
            <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
              <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96" aria-hidden="true">
                <circle
                  cx="48"
                  cy="48"
                  r={radius}
                  fill="none"
                  stroke="#E2E8F0"
                  strokeWidth="10"
                />
                {totalBookings > 0 &&
                  pipelineSegments.map((seg) => {
                    if (seg.count === 0) return null;
                    const segLength = (seg.count / totalBookings) * circumference;
                    const strokeDasharray = `${segLength} ${circumference - segLength}`;
                    const strokeDashoffset = -runningOffset;
                    runningOffset += segLength;
                    return (
                      <circle
                        key={seg.label}
                        cx="48"
                        cy="48"
                        r={radius}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="10"
                        strokeDasharray={strokeDasharray}
                        strokeDashoffset={strokeDashoffset}
                      />
                    );
                  })}
              </svg>
              <div className="absolute flex flex-col items-center leading-none">
                <span className="font-mono text-xl font-bold text-[#0F172A] tabular-nums">
                  {totalBookings}
                </span>
                <span className="font-mono text-[10px] text-[#64748B] mt-0.5">requests</span>
              </div>
            </div>

            <div className="flex-1 min-w-0 space-y-2">
              {pipelineSegments.map((seg) => (
                <div key={seg.label} className="flex items-center justify-between text-xs">
                  <span className="inline-flex items-center gap-2 text-[#475569] truncate">
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0"
                      style={{ backgroundColor: seg.color }}
                      aria-hidden="true"
                    />
                    <span className="truncate">{seg.label}</span>
                  </span>
                  <span className="font-mono font-bold text-[#0F172A] tabular-nums shrink-0">
                    {seg.count}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-4 border-t border-[#E2E8F0] space-y-3">
            <div className="flex items-baseline justify-between text-xs">
              <span className="font-semibold text-[#0F172A]">30-Day Fairness Cap Utilization</span>
              <span className="font-mono font-bold text-[#0D9488] tabular-nums">
                {usageHours.toFixed(1)}h / {usageCap}h ({usagePct}%)
              </span>
            </div>
            <div className="h-2.5 w-full bg-[#F1F5F9] rounded-full overflow-hidden border border-[#E2E8F0]">
              <div
                className="h-full bg-[#0D9488] transition-[width] duration-300"
                style={{ width: `${usagePct}%` }}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B]">
              <span>
                Avg Active SmartFair Score:{' '}
                <strong className="font-mono text-[#0F172A] tabular-nums">
                  {avgScore !== null ? `${avgScore.toFixed(1)} / 100` : 'No active queue'}
                </strong>
              </span>
              <span className="font-mono tabular-nums">
                {completedOrActiveRes} total sessions
              </span>
            </div>
          </div>
        </div>
      </SurfaceCard>
    </section>
  );
}
