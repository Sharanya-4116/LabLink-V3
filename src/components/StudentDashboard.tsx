import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  Download,
  Inbox,
  MapPin,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import { DateTime } from 'luxon';
import type {
  AlternativeSlot,
  Department,
  Equipment,
  MaintenanceWindow,
  User,
} from '../../shared/types.ts';
import { formatCampusDateTime, formatCampusSlotRange } from '../../shared/timezone.ts';
import {
  api,
  type EnrichedBookingRequest,
  type EnrichedReservation,
} from '../lib/api.ts';
import { EquipmentImage } from './EquipmentImage.tsx';
import { SmartFairPanel } from './SmartFairPanel.tsx';
import { StatusText } from './StatusText.tsx';
import { StudentTelemetryCharts } from './StudentTelemetryCharts.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { KpiCard } from './ui/KpiCard.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { DashboardSkeleton } from './ui/Skeleton.tsx';
import { SurfaceCard, SurfaceCardHeader } from './ui/SurfaceCard.tsx';

interface StudentDashboardProps {
  currentUser: User;
  departments: Department[];
  equipment: Equipment[];
  maintenanceWindows: MaintenanceWindow[];
  bookings: EnrichedBookingRequest[];
  reservations: EnrichedReservation[];
  loading?: boolean;
  onRefresh: () => Promise<void>;
  onNavigateCatalog: (opts?: {
    equipId?: string;
    searchQuery?: string;
    certifiedOnly?: boolean;
    departmentId?: string;
  }) => void;
}

type RequestFilter = 'ALL' | 'ACTION_NEEDED' | 'DECIDED';

export function StudentDashboard({
  currentUser,
  departments,
  equipment,
  maintenanceWindows,
  bookings,
  reservations,
  loading = false,
  onRefresh,
  onNavigateCatalog,
}: StudentDashboardProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const userToggledExpandRef = useRef(false);
  const [requestFilter, setRequestFilter] = useState<RequestFilter>('ALL');
  const [actionId, setActionId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Auto-expand the highest-priority conflict request once live bookings arrive
  useEffect(() => {
    if (userToggledExpandRef.current) return;
    const conflictItem = bookings.find((b) => b.status === 'CONFLICT_REVIEW');
    const fallbackItem = conflictItem ?? bookings[0] ?? null;
    if (fallbackItem && !expandedId) {
      setExpandedId(fallbackItem.id);
    }
  }, [bookings, expandedId]);

  const deptById = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments]);
  const userDept = deptById.get(currentUser.departmentId);

  // Live Asia/Kolkata time greeting
  const istNow = DateTime.now().setZone('Asia/Kolkata');
  const greeting =
    istNow.hour < 12 ? 'Good morning' : istNow.hour < 17 ? 'Good afternoon' : 'Good evening';

  const activeRequests = useMemo(
    () => bookings.filter((b) => b.status === 'PENDING' || b.status === 'CONFLICT_REVIEW'),
    [bookings]
  );
  const conflictRequests = useMemo(
    () => bookings.filter((b) => b.status === 'CONFLICT_REVIEW'),
    [bookings]
  );
  const confirmedUpcoming = useMemo(
    () =>
      reservations.filter(
        (r) => r.lifecycleStatus === 'CONFIRMED' || r.lifecycleStatus === 'CHECKED_OUT'
      ),
    [reservations]
  );

  // Real Equipment Availability & Certification Eligibility metrics
  const equipmentStats = useMemo(() => {
    const available = equipment.filter((e) => e.status === 'AVAILABLE');
    const certifiedAvailable = available.filter((e) =>
      e.requiredCertifications.every((c) => currentUser.certifications.includes(c))
    );
    const maintenanceCount = equipment.filter((e) => e.status === 'MAINTENANCE').length;
    return {
      total: equipment.length,
      availableCount: available.length,
      certifiedAvailable,
      maintenanceCount,
    };
  }, [equipment, currentUser.certifications]);

  const filteredBookings = useMemo(() => {
    if (requestFilter === 'ACTION_NEEDED') {
      return bookings.filter((b) => b.status === 'CONFLICT_REVIEW' || b.status === 'PENDING');
    }
    if (requestFilter === 'DECIDED') {
      return bookings.filter(
        (b) => b.status === 'APPROVED' || b.status === 'REJECTED' || b.status === 'CANCELLED'
      );
    }
    return bookings;
  }, [bookings, requestFilter]);

  async function handleReschedule(bookingId: string, slot: AlternativeSlot) {
    setActionId(bookingId);
    setFeedback(null);
    try {
      await api.rescheduleBooking(bookingId, {
        requestedStart: slot.startTime,
        requestedEnd: slot.endTime,
      });
      await onRefresh();
      setFeedback({
        type: 'success',
        message: `Rescheduled to ${slot.campusLabel}. Original queue timestamp preserved for anti-gaming fairness.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to reschedule booking',
      });
    } finally {
      setActionId(null);
    }
  }

  async function handleCancel(bookingId: string) {
    setActionId(bookingId);
    setFeedback(null);
    try {
      await api.cancelBooking(bookingId);
      await onRefresh();
      setFeedback({ type: 'success', message: 'Booking request cancelled.' });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to cancel booking',
      });
    } finally {
      setActionId(null);
    }
  }

  if (loading) {
    return <DashboardSkeleton />;
  }

  const nextReservation = confirmedUpcoming[0] ?? reservations[0] ?? null;

  return (
    <div className="space-y-7">
      {/* Architectural High-Contrast Student Command Header */}
      <PageHeader
        variant="hero"
        kicker="Student Command Center · Asia/Kolkata"
        title={`${greeting}, ${currentUser.name}`}
        description="Monitor live SmartFair allocation rankings, resolve slot conflicts, and reserve certified cross-department laboratory instruments."
        contextLine={
          <>
            <span className="font-semibold text-white">
              {userDept ? `${userDept.code} · ${userDept.name}` : currentUser.departmentId}
            </span>
            <span aria-hidden="true">·</span>
            <span>Clearances:</span>
            <span className="font-mono text-[#34D399]">
              {currentUser.certifications.join(', ') || 'None'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-[#CBD5E1]">
              {istNow.toFormat('dd LLL yyyy, HH:mm')} IST
            </span>
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => onNavigateCatalog({ certifiedOnly: true })}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-white bg-white/10 border border-white/15 rounded-xl hover:bg-white/15 transition-colors whitespace-nowrap shrink-0"
            >
              <ShieldCheck className="w-4 h-4 text-[#34D399]" aria-hidden="true" />
              <span>Certified Assets ({equipmentStats.certifiedAvailable.length})</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigateCatalog()}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl shadow-sm hover:bg-[#1D4ED8] active:scale-[0.99] transition-all whitespace-nowrap shrink-0"
            >
              <CalendarPlus className="w-4 h-4" aria-hidden="true" />
              <span>New Equipment Request</span>
            </button>
          </>
        }
      />

      {/* Live KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Active Requests"
          value={activeRequests.length}
          subtext={`${conflictRequests.length} in SmartFair conflict review`}
          icon={Clock}
          tone={conflictRequests.length > 0 ? 'amber' : 'blue'}
        />
        <KpiCard
          label="Confirmed Sessions"
          value={confirmedUpcoming.length}
          subtext={
            nextReservation
              ? `Next: ${formatCampusSlotRange(nextReservation.startTime, nextReservation.endTime)}`
              : 'No active upcoming lab slots'
          }
          icon={CalendarCheck2}
          tone="emerald"
        />
        <KpiCard
          label="Rolling 30-Day Usage"
          value={`${currentUser.rolling30DayHoursUsed.toFixed(1)}h`}
          rightMeta="40h cap"
          progressPercent={(currentUser.rolling30DayHoursUsed / 40) * 100}
          subtext={`${(40 - currentUser.rolling30DayHoursUsed).toFixed(1)}h fairness headroom left`}
          icon={Cpu}
          tone="teal"
        />
        <KpiCard
          label="Certified Equipment"
          value={`${equipmentStats.certifiedAvailable.length} / ${equipmentStats.total}`}
          subtext={`${currentUser.certifications.length} safety clearances active`}
          icon={ShieldCheck}
          tone="navy"
        />
      </div>

      {/* Live Data Visualization Row */}
      <StudentTelemetryCharts
        currentUser={currentUser}
        departments={departments}
        equipment={equipment}
        bookings={bookings}
        reservations={reservations}
        onExploreDepartment={(departmentId) => onNavigateCatalog({ departmentId })}
      />

      {/* Actionable Conflict Alert Bar */}
      {conflictRequests.length > 0 && (
        <SurfaceCard className="p-4 sm:p-5 bg-[#FFFBEB]/75 border-[#FDE68A]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#FEF3C7] text-[#B45309] flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h3 className="font-display text-sm font-bold text-[#0F172A]">
                  {conflictRequests.length} booking request{conflictRequests.length > 1 ? 's' : ''}{' '}
                  flagged for conflict or constraint review
                </h3>
                <p className="text-xs text-[#475569] mt-0.5">
                  Review the expanded SmartFair breakdown below to switch into an open Asia/Kolkata
                  slot while keeping your original queue timestamp.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                userToggledExpandRef.current = true;
                setRequestFilter('ACTION_NEEDED');
                setExpandedId(conflictRequests[0].id);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#92400E] bg-white border border-[#FCD34D] rounded-xl hover:bg-[#FEF3C7] transition-colors whitespace-nowrap"
            >
              <span>Focus Conflict Queue</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </SurfaceCard>
      )}

      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`p-3.5 rounded-xl text-xs border ${
            feedback.type === 'success'
              ? 'bg-[#ECFDF5] border-[#A7F3D0] text-[#065F46]'
              : 'bg-[#FEF2F2] border-[#FECACA] text-[#B91C1C]'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* Main Command-Center Operational Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left 7 Columns: Project Requests & SmartFair Tracking */}
        <section aria-labelledby="my-requests-heading" className="xl:col-span-7 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="my-requests-heading" className="font-display text-lg font-bold text-[#0F172A]">
                Project Booking Activity &amp; SmartFair Scores
              </h3>
              <p className="text-xs text-[#64748B]">
                Live evaluation across pending, conflict-review, approved, and historical requests.
              </p>
            </div>

            <div className="inline-flex items-center gap-1 p-1 bg-[#E4EAF2] border border-[#DCE4EE] rounded-xl">
              {(
                [
                  { id: 'ALL', label: `All (${bookings.length})` },
                  { id: 'ACTION_NEEDED', label: `Active (${activeRequests.length})` },
                  {
                    id: 'DECIDED',
                    label: `Decided (${bookings.length - activeRequests.length})`,
                  },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setRequestFilter(tab.id)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                    requestFilter === tab.id
                      ? 'bg-white text-[#0F172A] shadow-2xs'
                      : 'text-[#475569] hover:text-[#0F172A]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {filteredBookings.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={
                bookings.length === 0
                  ? 'No booking requests submitted yet'
                  : 'No requests in this filter view'
              }
              description={
                bookings.length === 0
                  ? 'Explore cross-department instruments, verify safety clearances, and submit your first project booking.'
                  : 'Switch to All requests or submit a new laboratory booking request.'
              }
              action={
                bookings.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => onNavigateCatalog()}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#2563EB] rounded-xl hover:bg-[#1D4ED8]"
                  >
                    Browse Equipment Catalog
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRequestFilter('ALL')}
                    className="px-4 py-2 text-xs font-semibold text-[#0F172A] bg-[#F1F5F9] rounded-xl hover:bg-[#E2E8F0]"
                  >
                    Show All Requests
                  </button>
                )
              }
            />
          ) : (
            <div className="space-y-4">
              {filteredBookings.map((b) => {
                const isExpanded = expandedId === b.id;
                const isActionable = b.status === 'PENDING' || b.status === 'CONFLICT_REVIEW';
                const snap = b.smartFairSnapshot;
                return (
                  <SurfaceCard
                    key={b.id}
                    className="p-5 sm:p-6 transition-colors hover:border-[#CBD5E1]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-2 max-w-xl">
                        <div className="flex flex-wrap items-center gap-2.5 text-xs text-[#64748B]">
                          <StatusText status={b.status} />
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{b.id}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-[#0F172A]">{b.equipmentName}</span>
                          {snap?.recommendationRank && snap.eligible && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono font-semibold text-[#059669]">
                                Rank #{snap.recommendationRank}
                              </span>
                            </>
                          )}
                        </div>
                        <h4 className="font-display text-base font-bold text-[#0F172A]">
                          {b.projectTitle}
                        </h4>
                        <p className="text-xs sm:text-sm text-[#475569] leading-relaxed">
                          {b.projectSummary}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-[#475569] pt-1">
                          <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
                            {formatCampusSlotRange(b.requestedStart, b.requestedEnd)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{b.durationHours.toFixed(1)}h</span>
                          <span aria-hidden="true">·</span>
                          <span>Deadline: {formatCampusDateTime(b.projectDeadline)} IST</span>
                        </div>
                        {b.facultyDecisionReason && (
                          <div className="text-xs text-[#334155] pt-1.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg px-3 py-2">
                            <span className="font-semibold text-[#0F172A]">Faculty Note:</span>{' '}
                            {b.facultyDecisionReason}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {snap && (
                          <button
                            type="button"
                            onClick={() => {
                              userToggledExpandRef.current = true;
                              setExpandedId(isExpanded ? null : b.id);
                            }}
                            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl border transition-colors whitespace-nowrap ${
                              isExpanded
                                ? 'bg-[#0B132B] text-white border-[#0B132B]'
                                : 'bg-[#F8FAFC] text-[#0F172A] border-[#CBD5E1] hover:bg-[#EFF6FF] hover:border-[#BFDBFE] hover:text-[#1D4ED8]'
                            }`}
                          >
                            <span className="font-mono tabular-nums">
                              Score {snap.score.toFixed(1)}/100
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                          </button>
                        )}
                        {isActionable && (
                          <button
                            type="button"
                            disabled={actionId === b.id}
                            onClick={() => handleCancel(b.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#DC2626] bg-white border border-[#FECACA] rounded-xl hover:bg-[#FEF2F2] disabled:opacity-50 whitespace-nowrap"
                          >
                            <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Cancel</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {isExpanded && snap && (
                      <SmartFairPanel
                        evaluation={snap}
                        onSelectAlternativeSlot={
                          isActionable ? (slot) => handleReschedule(b.id, slot) : undefined
                        }
                        reschedulePending={actionId === b.id}
                      />
                    )}
                  </SurfaceCard>
                );
              })}
            </div>
          )}
        </section>

        {/* Right 5 Columns: Polished Upcoming Reservations + Visual Equipment Availability Cards */}
        <div className="xl:col-span-5 space-y-6">
          {/* Polished Upcoming Reservations */}
          <SurfaceCard className="overflow-hidden">
            <SurfaceCardHeader
              headingId="my-reservations-heading"
              title="Upcoming &amp; Recent Lab Sessions"
              subtitle="Confirmed bookings &amp; .ics Asia/Kolkata calendar invites"
              dark
            />
            {reservations.length === 0 ? (
              <div className="p-6 text-xs text-[#64748B]">
                No confirmed reservations yet. Approved requests appear here with instant .ics
                calendar exports.
              </div>
            ) : (
              <div className="divide-y divide-[#E2E8F0]">
                {reservations.map((r) => {
                  const startIst = DateTime.fromISO(r.startTime, { zone: 'utc' }).setZone(
                    'Asia/Kolkata'
                  );
                  return (
                    <div
                      key={r.id}
                      className="p-4 flex items-center justify-between gap-3.5 hover:bg-[#F8FAFC] transition-colors"
                    >
                      <div className="flex items-start gap-3.5 min-w-0">
                        <div className="w-12 rounded-xl bg-[#F3F6FA] border border-[#DCE4EE] py-1.5 text-center shrink-0">
                          <div className="font-mono text-[10px] font-bold uppercase text-[#2563EB] leading-none">
                            {startIst.toFormat('LLL')}
                          </div>
                          <div className="font-mono text-lg font-bold text-[#0F172A] tabular-nums leading-tight mt-0.5">
                            {startIst.toFormat('dd')}
                          </div>
                        </div>

                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <StatusText status={r.lifecycleStatus} />
                            <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
                            <span className="font-mono font-semibold text-[#0F172A]">
                              Bench #{r.benchNumber ?? 1}
                            </span>
                            <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
                            <span className="text-[#64748B] truncate">{r.labRoom}</span>
                          </div>
                          <div className="text-sm font-semibold text-[#0F172A] truncate">
                            {r.projectTitle}
                          </div>
                          <div className="text-xs text-[#475569] truncate">{r.equipmentName}</div>
                          <div className="font-mono text-[11px] font-medium text-[#0F172A] tabular-nums">
                            {formatCampusSlotRange(r.startTime, r.endTime)}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => api.downloadIcsUrl(r.id)}
                        aria-label={`Download .ics invite for ${r.projectTitle}`}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#1D4ED8] bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl hover:bg-[#2563EB] hover:text-white hover:border-[#2563EB] transition-colors shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>.ics</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </SurfaceCard>

          {/* Improved Visual Equipment Availability Cards */}
          <SurfaceCard className="overflow-hidden">
            <SurfaceCardHeader
              title="Campus Equipment Availability"
              subtitle={`${equipmentStats.availableCount} available · ${equipmentStats.maintenanceCount} in maintenance · ${maintenanceWindows.length} scheduled blocks`}
              action={
                <button
                  type="button"
                  onClick={() => onNavigateCatalog()}
                  className="text-xs font-semibold text-[#2563EB] hover:underline whitespace-nowrap"
                >
                  Full Catalog →
                </button>
              }
            />

            {equipment.length === 0 ? (
              <div className="p-6 text-xs text-[#64748B]">No laboratory equipment registered.</div>
            ) : (
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3.5 bg-[#F3F6FA]/55">
                {equipment.slice(0, 4).map((eq) => {
                  const dept = deptById.get(eq.departmentId);
                  const isCertified = eq.requiredCertifications.every((c) =>
                    currentUser.certifications.includes(c)
                  );
                  return (
                    <article
                      key={eq.id}
                      className="group rounded-xl border border-[#DCE4EE] bg-white hover:border-[#CBD5E1] hover:shadow-sm overflow-hidden flex flex-col transition-all"
                    >
                      <div className="relative aspect-[16/10] bg-[#0B132B] overflow-hidden border-b border-[#E2E8F0]">
                        <EquipmentImage
                          src={eq.imageUrl}
                          alt={eq.name}
                          title={eq.name}
                          className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-200"
                        />
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#0B132B]/90 via-[#0B132B]/35 to-transparent px-3 py-2 flex items-center justify-between text-[11px] font-mono text-white">
                          <span className="font-semibold">{dept?.code ?? eq.departmentId}</span>
                          <span className="text-[#CBD5E1]">{eq.assetTag}</span>
                        </div>
                      </div>

                      <div className="p-3.5 flex-1 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <StatusText status={eq.status} />
                          <span className="font-mono text-[11px] text-[#64748B] tabular-nums">
                            Max {eq.maxBookingHours}h
                          </span>
                        </div>
                        <h4 className="font-display text-xs sm:text-sm font-bold text-[#0F172A] leading-snug line-clamp-1">
                          {eq.name}
                        </h4>
                        <div className="flex items-center gap-1 text-[11px] text-[#64748B] truncate">
                          <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{eq.labRoom}</span>
                        </div>
                        <div className="text-[11px] pt-1">
                          {isCertified ? (
                            <span className="font-semibold text-[#059669]">
                              ✓ Clearances met
                            </span>
                          ) : (
                            <span className="font-semibold text-[#B45309]">
                              Clearance required
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => onNavigateCatalog({ equipId: eq.id })}
                          className="mt-auto pt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0F172A] bg-white border border-[#CBD5E1] rounded-lg hover:bg-[#2563EB] hover:text-white hover:border-[#2563EB] transition-colors"
                        >
                          <span>Inspect &amp; Book</span>
                          <ArrowRight className="w-3 h-3" aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {maintenanceWindows.length > 0 && (
              <div className="px-4 py-3 bg-[#FFFBEB]/75 border-t border-[#FDE68A] flex items-center gap-2 text-xs text-[#92400E]">
                <Wrench className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  Scheduled maintenance: {maintenanceWindows[0].reason} (
                  {formatCampusSlotRange(
                    maintenanceWindows[0].startTime,
                    maintenanceWindows[0].endTime
                  )}
                  )
                </span>
              </div>
            )}
          </SurfaceCard>
        </div>
      </div>
    </div>
  );
}
