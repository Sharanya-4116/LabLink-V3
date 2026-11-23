import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck2,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Cpu,
  Download,
  LogIn,
  LogOut,
  Plus,
  RotateCw,
  ShieldAlert,
  UserX,
  Wrench,
  X,
} from 'lucide-react';
import { DateTime } from 'luxon';
import type {
  Department,
  Equipment,
  EquipmentStatus,
  MaintenanceWindow,
  User,
} from '../../shared/types.ts';
import {
  formatCampusDateTime,
  formatCampusSlotRange,
  fromCampusDatetimeLocalValue,
  intervalsOverlap,
  toCampusDatetimeLocalValue,
  toEpochMs,
} from '../../shared/timezone.ts';
import {
  api,
  ApiClientError,
  type EnrichedBookingRequest,
  type EnrichedReservation,
} from '../lib/api.ts';
import { EquipmentOnboardingModal } from './EquipmentOnboardingModal.tsx';
import { SmartFairPanel } from './SmartFairPanel.tsx';
import { StatusText } from './StatusText.tsx';
import { EmptyState } from './ui/EmptyState.tsx';
import { KpiCard } from './ui/KpiCard.tsx';
import { PageHeader } from './ui/PageHeader.tsx';
import { DashboardSkeleton } from './ui/Skeleton.tsx';
import { SurfaceCard, SurfaceCardHeader } from './ui/SurfaceCard.tsx';

interface FacultyDashboardProps {
  currentUser: User;
  departments: Department[];
  noShowGraceMinutes?: number;
  bookings: EnrichedBookingRequest[];
  reservations: EnrichedReservation[];
  loading?: boolean;
  onRefresh: () => Promise<void>;
}

const OVERRIDE_CODES = [
  { value: 'SAFETY_CRITICAL_PRIORITY', label: 'Safety-Critical Priority' },
  { value: 'CAPSTONE_DEMO_DEADLINE', label: 'Capstone Evaluation / Demo Deadline' },
  { value: 'EQUIPMENT_CALIBRATION_BATCH', label: 'Equipment Material / Calibration Batching' },
  { value: 'FACULTY_RESEARCH_GRANT', label: 'Sponsored Faculty Research Milestone' },
  { value: 'CROSS_DEPT_EMERGENCY', label: 'Cross-Department Urgent Fabrication' },
] as const;

export function FacultyDashboard({
  currentUser,
  departments,
  noShowGraceMinutes = 20,
  bookings,
  reservations,
  loading = false,
  onRefresh,
}: FacultyDashboardProps) {
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [maintenance, setMaintenance] = useState<MaintenanceWindow[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);
  const userToggledExpandRef = useRef(false);
  const [onboardModalOpen, setOnboardModalOpen] = useState(false);
  const [sweepingNoShows, setSweepingNoShows] = useState(false);

  const [decisionTarget, setDecisionTarget] = useState<{
    booking: EnrichedBookingRequest;
    mode: 'APPROVE' | 'REJECT';
    requiresOverride: boolean;
  } | null>(null);

  const [decisionReason, setDecisionReason] = useState('');
  const [overrideCode, setOverrideCode] = useState<string>('CAPSTONE_DEMO_DEADLINE');
  const [overrideJustification, setOverrideJustification] = useState('');
  const [submittingDecision, setSubmittingDecision] = useState(false);

  // Maintenance scheduler state
  const [maintEquipId, setMaintEquipId] = useState('');
  const [maintStartLocal, setMaintStartLocal] = useState('');
  const [maintEndLocal, setMaintEndLocal] = useState('');
  const [maintReason, setMaintReason] = useState('');
  const [maintPending, setMaintPending] = useState(false);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  async function loadFacultyAssets() {
    setAssetsLoading(true);
    try {
      const [eqRes, mRes] = await Promise.all([api.getEquipment(), api.getMaintenanceWindows()]);
      setEquipment(eqRes.equipment);
      setMaintenance(mRes.maintenanceWindows);
      if (!maintEquipId && eqRes.equipment.length > 0) {
        setMaintEquipId(eqRes.equipment[0].id);
      }
    } finally {
      setAssetsLoading(false);
    }
  }

  useEffect(() => {
    loadFacultyAssets();
    const tomorrow = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).startOf('day');
    setMaintStartLocal(toCampusDatetimeLocalValue(tomorrow.set({ hour: 15, minute: 0 }).toUTC().toISO()!));
    setMaintEndLocal(toCampusDatetimeLocalValue(tomorrow.set({ hour: 17, minute: 0 }).toUTC().toISO()!));
  }, [currentUser.id]);

  // Group active PENDING / CONFLICT_REVIEW requests by equipment
  const reviewQueue = useMemo(
    () => bookings.filter((b) => b.status === 'PENDING' || b.status === 'CONFLICT_REVIEW'),
    [bookings]
  );

  const groupedByEquipment = useMemo(() => {
    const map = new Map<string, EnrichedBookingRequest[]>();
    for (const b of reviewQueue) {
      const arr = map.get(b.equipmentId) ?? [];
      arr.push(b);
      map.set(b.equipmentId, arr);
    }
    for (const [, list] of map.entries()) {
      list.sort((a, b) => {
        const rankA = a.smartFairSnapshot?.recommendationRank ?? 999;
        const rankB = b.smartFairSnapshot?.recommendationRank ?? 999;
        return rankA - rankB;
      });
    }
    return Array.from(map.entries());
  }, [reviewQueue]);

  useEffect(() => {
    if (userToggledExpandRef.current) return;
    if (!expandedRequestId && groupedByEquipment.length > 0) {
      const firstGroup = groupedByEquipment[0][1];
      if (firstGroup[0]) setExpandedRequestId(firstGroup[0].id);
    }
  }, [groupedByEquipment, expandedRequestId]);

  const activeSessionCount = reservations.filter(
    (r) => r.lifecycleStatus === 'CONFIRMED' || r.lifecycleStatus === 'CHECKED_OUT'
  ).length;

  function openDecisionModal(booking: EnrichedBookingRequest, mode: 'APPROVE' | 'REJECT') {
    const snap = booking.smartFairSnapshot;
    const peers = reviewQueue.filter(
      (p) =>
        p.equipmentId === booking.equipmentId &&
        p.id !== booking.id &&
        intervalsOverlap(
          toEpochMs(p.requestedStart),
          toEpochMs(p.requestedEnd),
          toEpochMs(booking.requestedStart),
          toEpochMs(booking.requestedEnd)
        )
    );
    const hasHigherEligibleContender = peers.some(
      (p) => p.smartFairSnapshot?.eligible && p.smartFairSnapshot?.isTopRecommended
    );
    const requiresOverride =
      mode === 'APPROVE' && Boolean(snap && !snap.isTopRecommended && hasHigherEligibleContender);

    setDecisionTarget({ booking, mode, requiresOverride });
    setDecisionReason(
      mode === 'APPROVE'
        ? requiresOverride
          ? 'Approved via faculty SmartFair override.'
          : 'Approved per SmartFair #1 recommendation.'
        : ''
    );
    setOverrideJustification('');
    setFeedback(null);
  }

  async function submitDecision(e: React.FormEvent) {
    e.preventDefault();
    if (!decisionTarget) return;
    setSubmittingDecision(true);
    setFeedback(null);

    try {
      const res = await api.submitFacultyDecision(decisionTarget.booking.id, {
        decision: decisionTarget.mode,
        reason: decisionReason,
        isOverride: decisionTarget.requiresOverride,
        overrideReasonCode: decisionTarget.requiresOverride ? overrideCode : undefined,
        overrideJustification: decisionTarget.requiresOverride ? overrideJustification : undefined,
      });

      setDecisionTarget(null);
      await onRefresh();
      await loadFacultyAssets();

      setFeedback({
        type: 'success',
        message:
          decisionTarget.mode === 'APPROVE'
            ? `Approved "${decisionTarget.booking.projectTitle}". Reservation ${res.reservation?.id} (Bench #${res.reservation?.benchNumber ?? 1}) locked.${
                res.conflictedRequestIds.length > 0
                  ? ` ${res.conflictedRequestIds.length} overlapping request(s) updated with alternative slots.`
                  : ''
              }`
            : `Rejected "${decisionTarget.booking.projectTitle}" with recorded explanation.`,
      });
    } catch (err) {
      const msg =
        err instanceof ApiClientError || err instanceof Error
          ? err.message
          : 'Failed to submit decision';
      setFeedback({ type: 'error', message: msg });
    } finally {
      setSubmittingDecision(false);
    }
  }

  async function handleStatusChange(equipId: string, status: EquipmentStatus) {
    setFeedback(null);
    try {
      await api.updateEquipment(equipId, { status });
      await loadFacultyAssets();
      setFeedback({ type: 'success', message: `Equipment status updated to ${status}.` });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to update equipment status',
      });
    }
  }

  async function handleScheduleMaintenance(e: React.FormEvent) {
    e.preventDefault();
    setMaintPending(true);
    setFeedback(null);
    try {
      const res = await api.createMaintenanceWindow({
        equipmentId: maintEquipId,
        startTime: fromCampusDatetimeLocalValue(maintStartLocal),
        endTime: fromCampusDatetimeLocalValue(maintEndLocal),
        reason: maintReason,
      });
      setMaintReason('');
      await Promise.all([loadFacultyAssets(), onRefresh()]);
      setFeedback({
        type: 'success',
        message: `Maintenance window scheduled. ${res.impactedRequestIds.length} overlapping pending request(s) flagged for review.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to schedule maintenance window',
      });
    } finally {
      setMaintPending(false);
    }
  }

  async function handleLifecycleAction(
    resId: string,
    action: 'checkout' | 'return' | 'noshow'
  ) {
    setFeedback(null);
    try {
      if (action === 'checkout') {
        await api.checkoutReservation(resId);
      } else if (action === 'return') {
        await api.returnReservation(resId);
      } else {
        await api.markReservationNoShow(resId, {
          reason: `Marked NO_SHOW at lab desk after ${noShowGraceMinutes}m grace window.`,
        });
      }
      await onRefresh();
      setFeedback({
        type: 'success',
        message: `Reservation ${resId} marked ${
          action === 'checkout' ? 'CHECKED_OUT' : action === 'return' ? 'RETURNED' : 'NO_SHOW (slot released)'
        }.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to update reservation lifecycle',
      });
    }
  }

  async function handleSweepNoShows() {
    setSweepingNoShows(true);
    setFeedback(null);
    try {
      const res = await api.sweepNoShows();
      await onRefresh();
      setFeedback({
        type: 'success',
        message:
          res.releasedCount > 0
            ? `Released ${res.releasedCount} overdue NO_SHOW reservation(s) and freed their slot locks.`
            : `Sweep complete: 0 confirmed reservations past the ${noShowGraceMinutes}m grace window.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to sweep overdue no-shows',
      });
    } finally {
      setSweepingNoShows(false);
    }
  }

  if (loading && assetsLoading) {
    return <DashboardSkeleton />;
  }

  const nowMs = Date.now();

  return (
    <div className="space-y-8">
      <PageHeader
        variant="hero"
        kicker="Faculty Supervisor Desk · Asia/Kolkata"
        title={`Supervision & Conflict Resolution · ${currentUser.name}`}
        description="Inspect competing SmartFair cluster rankings, approve or override with mandatory audit logging, and manage laboratory availability."
        contextLine={
          <>
            <span className="font-mono font-semibold text-white">{currentUser.role}</span>
            <span aria-hidden="true">·</span>
            <span className="text-[#FBBF24] font-semibold">
              {reviewQueue.length} pending conflict/review items
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-[#CBD5E1]">
              Grace Window: {noShowGraceMinutes}m · Asia/Kolkata
            </span>
          </>
        }
        actions={
          <button
            type="button"
            onClick={() => setOnboardModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-[#2563EB] rounded-xl shadow-sm hover:bg-[#1D4ED8] transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Onboard Equipment</span>
          </button>
        }
      />

      {/* Elevated Summary KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Requests in Queue"
          value={reviewQueue.length}
          subtext={`Across ${groupedByEquipment.length} lab asset(s)`}
          icon={ClipboardCheck}
          tone="amber"
        />
        <KpiCard
          label="Active Lab Sessions"
          value={activeSessionCount}
          subtext="Confirmed or checked out"
          icon={CalendarCheck2}
          tone="blue"
        />
        <KpiCard
          label="Monitored Equipment"
          value={`${equipment.filter((e) => e.status === 'AVAILABLE').length} / ${equipment.length}`}
          subtext="Available for scheduling"
          icon={Cpu}
          tone="emerald"
        />
        <KpiCard
          label="Maintenance Blocks"
          value={maintenance.length}
          subtext="Scheduled calibration windows"
          icon={Wrench}
          tone="navy"
        />
      </div>

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

      {/* Conflict Review & SmartFair Queue */}
      <section aria-labelledby="conflict-queue-heading" className="space-y-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-4 h-4 text-[#2563EB]" aria-hidden="true" />
          <h3 id="conflict-queue-heading" className="font-display text-lg font-bold text-[#0F172A]">
            Pending &amp; Conflict Review Queue ({reviewQueue.length})
          </h3>
        </div>

        {groupedByEquipment.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="All equipment queues are clear"
            description="No pending or conflicting booking requests currently require faculty supervision."
          />
        ) : (
          <div className="space-y-6">
            {groupedByEquipment.map(([equipId, group]) => {
              const equipName = group[0]?.equipmentName || equipId;
              const topContender = group.find((g) => g.smartFairSnapshot?.isTopRecommended);
              return (
                <SurfaceCard key={equipId} className="overflow-hidden">
                  <SurfaceCardHeader
                    title={equipName}
                    subtitle={`${group.length} competing/pending request(s)`}
                    dark
                    action={
                      topContender?.smartFairSnapshot ? (
                        <div className="text-xs font-mono font-semibold text-[#34D399]">
                          Top SmartFair Pick: {topContender.studentName} (
                          {topContender.smartFairSnapshot.score.toFixed(1)}/100)
                        </div>
                      ) : undefined
                    }
                  />

                  <div className="divide-y divide-[#E2E8F0]">
                    {group.map((b) => {
                      const snap = b.smartFairSnapshot;
                      const isExpanded = expandedRequestId === b.id;
                      const isTop = snap?.isTopRecommended;
                      return (
                        <div
                          key={b.id}
                          className={`p-5 sm:p-6 transition-colors ${
                            isTop ? 'bg-[#F0FDF4]/45' : !snap?.eligible ? 'bg-[#FEF2F2]/35' : 'bg-white'
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="space-y-1.5 max-w-2xl">
                              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                                {snap?.eligible ? (
                                  <span
                                    className={`font-mono font-bold ${
                                      isTop ? 'text-[#059669]' : 'text-[#2563EB]'
                                    }`}
                                  >
                                    {isTop
                                      ? `SmartFair #1 Recommended (${snap.score.toFixed(1)}/100)`
                                      : `Rank #${snap.recommendationRank ?? '—'} (${snap.score.toFixed(1)}/100)`}
                                  </span>
                                ) : (
                                  <span className="font-mono font-bold text-[#DC2626]">
                                    INELIGIBLE ({snap?.violations.map((v) => v.code).join(', ')})
                                  </span>
                                )}
                                <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
                                <StatusText status={b.status} />
                                <span aria-hidden="true" className="text-[#CBD5E1]">·</span>
                                <span className="text-[#0F172A] font-semibold">{b.studentName}</span>
                              </div>

                              <h4 className="font-display text-base font-bold text-[#0F172A]">
                                {b.projectTitle}
                              </h4>
                              <p className="text-xs sm:text-sm text-[#475569] leading-relaxed">
                                {b.justification}
                              </p>

                              <div className="flex flex-wrap items-center gap-3 text-xs text-[#475569] pt-1">
                                <span className="font-mono font-semibold text-[#0F172A] tabular-nums">
                                  {formatCampusSlotRange(b.requestedStart, b.requestedEnd)}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>Deadline: {formatCampusDateTime(b.projectDeadline)} IST</span>
                                <span aria-hidden="true">·</span>
                                <span>
                                  Original Queue: {formatCampusDateTime(b.originalCreatedAt)} IST
                                </span>
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  userToggledExpandRef.current = true;
                                  setExpandedRequestId(isExpanded ? null : b.id);
                                }}
                                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border transition-colors whitespace-nowrap ${
                                  isExpanded
                                    ? 'bg-[#0B132B] text-white border-[#0B132B]'
                                    : 'bg-white text-[#0F172A] border-[#CBD5E1] hover:bg-[#F8FAFC]'
                                }`}
                              >
                                <span>{isExpanded ? 'Hide Breakdown' : 'Inspect Score'}</span>
                                {isExpanded ? (
                                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                                )}
                              </button>

                              <button
                                type="button"
                                disabled={!snap?.eligible}
                                onClick={() => openDecisionModal(b, 'APPROVE')}
                                title={
                                  !snap?.eligible
                                    ? 'Hard constraints H1–H4 block approval'
                                    : isTop
                                      ? 'Approve SmartFair top recommendation'
                                      : 'Override SmartFair recommendation (requires justification)'
                                }
                                className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
                                  isTop
                                    ? 'bg-[#059669] text-white hover:bg-[#047857]'
                                    : 'bg-[#FFFBEB] text-[#B45309] border border-[#FCD34D] hover:bg-[#FEF3C7]'
                                }`}
                              >
                                {isTop ? (
                                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                                ) : (
                                  <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                                )}
                                <span>{isTop ? 'Approve #1' : 'Override & Approve'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => openDecisionModal(b, 'REJECT')}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#DC2626] bg-white border border-[#FECACA] rounded-xl hover:bg-[#FEF2F2] whitespace-nowrap"
                              >
                                <X className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>Reject</span>
                              </button>
                            </div>
                          </div>

                          {isExpanded && snap && <SmartFairPanel evaluation={snap} />}
                        </div>
                      );
                    })}
                  </div>
                </SurfaceCard>
              );
            })}
          </div>
        )}
      </section>

      {/* Check-In / Check-Out Desk */}
      <section aria-labelledby="lab-desk-heading" className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 id="lab-desk-heading" className="font-display text-lg font-bold text-[#0F172A]">
              Active Reservations &amp; Check-In / Check-Out Desk
            </h3>
            <p className="text-xs text-[#64748B]">
              Confirmed sessions not checked in within {noShowGraceMinutes} minutes of start can be
              released to free bench locks.
            </p>
          </div>
          <button
            type="button"
            disabled={sweepingNoShows}
            onClick={handleSweepNoShows}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#92400E] bg-[#FFFBEB] border border-[#FCD34D] rounded-xl hover:bg-[#FEF3C7] disabled:opacity-50 whitespace-nowrap"
          >
            <RotateCw
              className={`w-3.5 h-3.5 ${sweepingNoShows ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{sweepingNoShows ? 'Sweeping...' : 'Sweep Overdue No-Shows'}</span>
          </button>
        </div>

        <SurfaceCard className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-[#F3F6FA] border-b border-[#DCE4EE] text-[#475569]">
              <tr>
                <th className="py-3.5 px-4 font-semibold">Student &amp; Project</th>
                <th className="py-3.5 px-4 font-semibold">Equipment &amp; Bench</th>
                <th className="py-3.5 px-4 font-semibold">Slot (IST)</th>
                <th className="py-3.5 px-4 font-semibold">Status</th>
                <th className="py-3.5 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
              {reservations.map((r) => {
                const isOverdueNoShowEligible =
                  r.lifecycleStatus === 'CONFIRMED' &&
                  !r.checkedOutAt &&
                  nowMs > Date.parse(r.startTime) + noShowGraceMinutes * 60_000;

                return (
                  <tr key={r.id} className="hover:bg-[#F8FAFC] transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-semibold text-[#0F172A]">{r.studentName}</div>
                      <div className="text-[#64748B] mt-0.5">{r.projectTitle}</div>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="text-[#334155] font-medium">{r.equipmentName}</div>
                      <div className="font-mono text-[11px] text-[#64748B] mt-0.5">
                        Bench #{r.benchNumber ?? 1} · {r.labRoom}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-mono tabular-nums whitespace-nowrap">
                      {formatCampusSlotRange(r.startTime, r.endTime)}
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusText status={r.lifecycleStatus} />
                    </td>
                    <td className="py-3.5 px-4 text-right space-x-2 whitespace-nowrap">
                      {r.lifecycleStatus === 'CONFIRMED' && (
                        <button
                          type="button"
                          onClick={() => handleLifecycleAction(r.id, 'checkout')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-[#2563EB] rounded-lg hover:bg-[#1D4ED8]"
                        >
                          <LogIn className="w-3 h-3" aria-hidden="true" />
                          <span>Check Out</span>
                        </button>
                      )}
                      {isOverdueNoShowEligible && (
                        <button
                          type="button"
                          onClick={() => handleLifecycleAction(r.id, 'noshow')}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-[#DC2626] bg-[#FEF2F2] border border-[#FECACA] rounded-lg hover:bg-[#FEE2E2]"
                        >
                          <UserX className="w-3 h-3" aria-hidden="true" />
                          <span>Mark No-Show</span>
                        </button>
                      )}
                      {r.lifecycleStatus === 'CHECKED_OUT' && (
                        <button
                          type="button"
                          onClick={() => handleLifecycleAction(r.id, 'return')}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-white bg-[#059669] rounded-lg hover:bg-[#047857]"
                        >
                          <LogOut className="w-3 h-3" aria-hidden="true" />
                          <span>Mark Returned</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => api.downloadIcsUrl(r.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#475569] border border-[#CBD5E1] rounded-lg hover:bg-[#F1F5F9]"
                      >
                        <Download className="w-3 h-3" aria-hidden="true" />
                        <span>.ics</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </SurfaceCard>
      </section>

      {/* Equipment Status & Maintenance Scheduler */}
      <section aria-labelledby="maint-heading" className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <SurfaceCard className="lg:col-span-7 p-5 sm:p-6 space-y-4">
          <h3 id="maint-heading" className="font-display text-base font-bold text-[#0F172A]">
            Laboratory Equipment Availability Controls
          </h3>
          <div className="divide-y divide-[#E2E8F0]">
            {equipment.map((eq) => (
              <div key={eq.id} className="py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[#0F172A]">{eq.name}</div>
                  <div className="text-xs text-[#64748B] font-mono mt-0.5">
                    {eq.assetTag} · {eq.labRoom} · {String(eq.operatingHours.startHour).padStart(2, '0')}
                    :00–{String(eq.operatingHours.endHour).padStart(2, '0')}:00 IST
                  </div>
                </div>
                <select
                  aria-label={`Status for ${eq.name}`}
                  value={eq.status}
                  onChange={(e) => handleStatusChange(eq.id, e.target.value as EquipmentStatus)}
                  className="px-3 py-1.5 text-xs font-semibold bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
                >
                  <option value="AVAILABLE">AVAILABLE</option>
                  <option value="MAINTENANCE">MAINTENANCE</option>
                  <option value="OFFLINE">OFFLINE</option>
                </select>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <form
          onSubmit={handleScheduleMaintenance}
          className="lg:col-span-5 surface-card rounded-2xl p-5 sm:p-6 space-y-4 h-fit"
        >
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-[#B45309]" aria-hidden="true" />
            <h3 className="font-display text-base font-bold text-[#0F172A]">
              Schedule Maintenance Window
            </h3>
          </div>
          <div>
            <label htmlFor="mnt-eq" className="block text-xs font-medium text-[#334155] mb-1">
              Equipment
            </label>
            <select
              id="mnt-eq"
              value={maintEquipId}
              onChange={(e) => setMaintEquipId(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
            >
              {equipment.map((eq) => (
                <option key={eq.id} value={eq.id}>
                  {eq.name} ({eq.assetTag})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="mnt-start" className="block text-xs font-medium text-[#334155] mb-1">
                Start (IST)
              </label>
              <input
                id="mnt-start"
                type="datetime-local"
                required
                value={maintStartLocal}
                onChange={(e) => setMaintStartLocal(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="mnt-end" className="block text-xs font-medium text-[#334155] mb-1">
                End (IST)
              </label>
              <input
                id="mnt-end"
                type="datetime-local"
                required
                value={maintEndLocal}
                onChange={(e) => setMaintEndLocal(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
              />
            </div>
          </div>
          <div>
            <label htmlFor="mnt-reason" className="block text-xs font-medium text-[#334155] mb-1">
              Calibration / Maintenance Reason
            </label>
            <input
              id="mnt-reason"
              type="text"
              required
              minLength={5}
              value={maintReason}
              onChange={(e) => setMaintReason(e.target.value)}
              placeholder="e.g., Nozzle replacement & bed leveling"
              className="w-full px-3 py-2 text-xs bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg"
            />
          </div>
          <button
            type="submit"
            disabled={maintPending}
            className="w-full px-4 py-2.5 text-xs font-semibold text-white bg-[#0B132B] rounded-xl hover:bg-[#1E293B] disabled:opacity-50"
          >
            {maintPending ? 'Scheduling...' : 'Block Maintenance Window'}
          </button>

          {maintenance.length > 0 && (
            <div className="pt-3 border-t border-[#E2E8F0] space-y-2">
              <div className="text-xs font-semibold text-[#475569]">Scheduled Windows</div>
              {maintenance.slice(0, 4).map((m) => (
                <div key={m.id} className="text-xs text-[#475569]">
                  <span className="font-mono text-[#0F172A]">
                    {formatCampusSlotRange(m.startTime, m.endTime)}
                  </span>{' '}
                  — {m.reason}
                </div>
              ))}
            </div>
          )}
        </form>
      </section>

      {/* Approve / Override / Reject Modal */}
      {decisionTarget && (
        <div
          className="fixed inset-0 z-50 bg-[#0B132B]/55 backdrop-blur-[2px] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="decision-modal-title"
        >
          <form
            onSubmit={submitDecision}
            className="w-full max-w-lg bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden shadow-2xl"
          >
            <div className="bg-[#0B132B] text-white px-6 py-4 flex items-start justify-between gap-4">
              <div>
                <h3 id="decision-modal-title" className="font-display text-lg font-bold text-white">
                  {decisionTarget.mode === 'REJECT'
                    ? 'Reject Booking Request'
                    : decisionTarget.requiresOverride
                      ? 'Override SmartFair Recommendation'
                      : 'Approve SmartFair #1 Request'}
                </h3>
                <p className="text-xs text-[#CBD5E1] mt-0.5">
                  {decisionTarget.booking.projectTitle} · {decisionTarget.booking.studentName}
                </p>
              </div>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setDecisionTarget(null)}
                className="p-1.5 text-[#94A3B8] hover:text-white rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {decisionTarget.requiresOverride && (
                <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-4 space-y-3">
                  <div className="flex items-start gap-2 text-xs text-[#92400E]">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                    <span>
                      You are overriding the #1 SmartFair recommendation. A structured reason code and
                      detailed justification are mandatory and permanently recorded in audit logs.
                    </span>
                  </div>

                  <div>
                    <label htmlFor="ovr-code" className="block text-xs font-medium text-[#78350F] mb-1">
                      Structured Override Reason Code
                    </label>
                    <select
                      id="ovr-code"
                      value={overrideCode}
                      onChange={(e) => setOverrideCode(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-white border border-[#FCD34D] rounded-lg"
                    >
                      {OVERRIDE_CODES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="ovr-just" className="block text-xs font-medium text-[#78350F] mb-1">
                      Override Justification (minimum 15 characters)
                    </label>
                    <textarea
                      id="ovr-just"
                      required
                      minLength={15}
                      rows={3}
                      value={overrideJustification}
                      onChange={(e) => setOverrideJustification(e.target.value)}
                      placeholder="Explain why this project must take precedence over the higher SmartFair score..."
                      className="w-full px-3 py-2 text-xs bg-white border border-[#FCD34D] rounded-lg"
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="dec-reason" className="block text-xs font-medium text-[#334155] mb-1">
                  Decision Explanation (visible to student &amp; recorded in audit log)
                </label>
                <textarea
                  id="dec-reason"
                  required
                  minLength={5}
                  rows={2}
                  value={decisionReason}
                  onChange={(e) => setDecisionReason(e.target.value)}
                  placeholder="Provide clear explanation for approval or rejection..."
                  className="w-full px-3 py-2 text-xs bg-white border border-[#CBD5E1] rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDecisionTarget(null)}
                  className="px-4 py-2 text-xs font-medium text-[#475569] bg-white border border-[#CBD5E1] rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingDecision}
                  className={`px-4 py-2 text-xs font-semibold text-white rounded-xl disabled:opacity-50 ${
                    decisionTarget.mode === 'REJECT'
                      ? 'bg-[#DC2626] hover:bg-[#B91C1C]'
                      : decisionTarget.requiresOverride
                        ? 'bg-[#B45309] hover:bg-[#92400E]'
                        : 'bg-[#059669] hover:bg-[#047857]'
                  }`}
                >
                  {submittingDecision
                    ? 'Committing...'
                    : decisionTarget.mode === 'REJECT'
                      ? 'Confirm Rejection'
                      : decisionTarget.requiresOverride
                        ? 'Confirm Override & Lock Slot'
                        : 'Confirm Approval & Lock Slot'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      <EquipmentOnboardingModal
        open={onboardModalOpen}
        departments={departments}
        onClose={() => setOnboardModalOpen(false)}
        onCreated={async (eq) => {
          await Promise.all([loadFacultyAssets(), onRefresh()]);
          setFeedback({
            type: 'success',
            message: `Onboarded "${eq.name}" (${eq.assetTag}) with ${eq.capacity} bench(es).`,
          });
        }}
      />
    </div>
  );
}
