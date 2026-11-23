import { DateTime } from 'luxon';
import { evaluateIntervalCapacity } from './concurrency.ts';
import {
  formatCampusSlotRange,
  getCampusTimezone,
  intervalsOverlap,
  splitIntervalByCampusDays,
  toEpochMs,
  validateOperatingHoursAndDuration,
} from './timezone.ts';
import type {
  AlternativeSlot,
  BookingRequest,
  Equipment,
  HardConstraintViolation,
  MaintenanceWindow,
  Reservation,
  SmartFairEvaluation,
  SmartFairFactorBreakdown,
  User,
} from './types.ts';

export interface SmartFairEvaluationContext {
  equipment: Equipment;
  student: User;
  activeReservations: Reservation[];
  maintenanceWindows: MaintenanceWindow[];
  nowIso?: string;
  timezone?: string;
}

const FLUSH_BOUNDARY_TOLERANCE_MS = 30 * 60 * 1000; // 30 minutes
const MAX_WAITING_HOURS = 72;
const MAX_DEADLINE_DAYS = 30;
const MAX_FAIRNESS_HOURS = 40;

export function findAlternativeSlots(params: {
  equipment: Equipment;
  requestedStart: string;
  durationHours: number;
  activeReservations: Reservation[];
  maintenanceWindows: MaintenanceWindow[];
  nowIso?: string;
  timezone?: string;
  limit?: number;
}): AlternativeSlot[] {
  const {
    equipment,
    requestedStart,
    durationHours,
    activeReservations,
    maintenanceWindows,
    nowIso = new Date().toISOString(),
    timezone = getCampusTimezone(),
    limit = 3,
  } = params;

  if (equipment.status !== 'AVAILABLE' || durationHours <= 0 || durationHours > equipment.maxBookingHours) {
    return [];
  }

  const nowMs = toEpochMs(nowIso);
  const requestedStartMs = toEpochMs(requestedStart);
  const durationMs = Math.round(durationHours * 3_600_000);

  const activeForEquip = activeReservations.filter(
    (r) =>
      r.equipmentId === equipment.id &&
      (r.lifecycleStatus === 'CONFIRMED' || r.lifecycleStatus === 'CHECKED_OUT')
  );
  const maintenanceForEquip = maintenanceWindows
    .filter((m) => m.equipmentId === equipment.id)
    .map((m) => ({ startMs: toEpochMs(m.startTime), endMs: toEpochMs(m.endTime) }));

  // Search from today's start in campus timezone through next 7 days in 30-min steps
  const anchorDt = DateTime.fromMillis(Math.max(nowMs, DateTime.fromMillis(nowMs, { zone: timezone }).startOf('day').toMillis()), {
    zone: timezone,
  });
  const searchStartDay = anchorDt.startOf('day');

  const candidates: Array<{ startMs: number; endMs: number; distanceMs: number }> = [];

  for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
    const dayDt = searchStartDay.plus({ days: dayOffset });
    const dayOfWeek = dayDt.weekday === 7 ? 0 : dayDt.weekday;
    if (!equipment.operatingHours.daysOfWeek.includes(dayOfWeek)) {
      continue;
    }

    const startMinute = equipment.operatingHours.startHour * 60;
    const endMinute = equipment.operatingHours.endHour * 60;

    for (let min = startMinute; min + durationHours * 60 <= endMinute; min += 30) {
      const candidateStartDt = dayDt.plus({ minutes: min });
      const candidateStartMs = candidateStartDt.toMillis();
      const candidateEndMs = candidateStartMs + durationMs;

      if (candidateStartMs < nowMs + 15 * 60 * 1000) {
        continue;
      }

      const startIso = candidateStartDt.toUTC().toISO()!;
      const endIso = DateTime.fromMillis(candidateEndMs, { zone: 'utc' }).toISO()!;

      const hoursCheck = validateOperatingHoursAndDuration(
        startIso,
        endIso,
        equipment.operatingHours,
        equipment.maxBookingHours,
        timezone
      );
      if (!hoursCheck.valid) {
        continue;
      }

      const hasMaintOverlap = maintenanceForEquip.some((b) =>
        intervalsOverlap(candidateStartMs, candidateEndMs, b.startMs, b.endMs)
      );
      if (hasMaintOverlap) {
        continue;
      }

      const capacityResult = evaluateIntervalCapacity(
        activeForEquip,
        candidateStartMs,
        candidateEndMs,
        equipment.capacity
      );
      if (capacityResult.allowed) {
        candidates.push({
          startMs: candidateStartMs,
          endMs: candidateEndMs,
          distanceMs: Math.abs(candidateStartMs - requestedStartMs),
        });
      }
    }
  }

  candidates.sort((a, b) => a.distanceMs - b.distanceMs || a.startMs - b.startMs);

  const selected: AlternativeSlot[] = [];
  for (const cand of candidates) {
    // Spread recommendations slightly if overlapping on exact 30-min steps? Keep nearest valid distinct slots
    const startTime = new Date(cand.startMs).toISOString();
    const endTime = new Date(cand.endMs).toISOString();
    selected.push({
      startTime,
      endTime,
      campusLabel: formatCampusSlotRange(startTime, endTime, timezone),
    });
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
}

export function evaluateBookingRequest(
  request: BookingRequest,
  context: SmartFairEvaluationContext
): SmartFairEvaluation {
  const timezone = context.timezone ?? getCampusTimezone();
  const nowIso = context.nowIso ?? new Date().toISOString();
  const nowMs = toEpochMs(nowIso);

  const { equipment, student, activeReservations, maintenanceWindows } = context;
  const violations: HardConstraintViolation[] = [];

  // H1: EQUIPMENT_UNAVAILABLE
  if (equipment.status !== 'AVAILABLE') {
    violations.push({
      code: 'EQUIPMENT_UNAVAILABLE',
      message: `${equipment.name} is currently ${equipment.status}.`,
    });
  }

  // H2: HOURS_OR_DURATION_VIOLATION
  const hoursValidation = validateOperatingHoursAndDuration(
    request.requestedStart,
    request.requestedEnd,
    equipment.operatingHours,
    equipment.maxBookingHours,
    timezone
  );
  if (!hoursValidation.valid) {
    violations.push({
      code: 'HOURS_OR_DURATION_VIOLATION',
      message: hoursValidation.reason ?? 'Outside campus operating hours or duration limit.',
    });
  }

  // H3: SCHEDULE_CONFLICT (capacity-aware multi-bench peak concurrency + maintenance)
  const reqStartMs = toEpochMs(request.requestedStart);
  const reqEndMs = toEpochMs(request.requestedEnd);

  const equipmentActiveReservations = activeReservations.filter(
    (r) =>
      r.equipmentId === equipment.id &&
      (r.lifecycleStatus === 'CONFIRMED' || r.lifecycleStatus === 'CHECKED_OUT')
  );

  const capacityEval = evaluateIntervalCapacity(
    equipmentActiveReservations,
    reqStartMs,
    reqEndMs,
    equipment.capacity
  );

  const overlappingMaintenance = maintenanceWindows.filter(
    (m) =>
      m.equipmentId === equipment.id &&
      intervalsOverlap(reqStartMs, reqEndMs, toEpochMs(m.startTime), toEpochMs(m.endTime))
  );

  if (!capacityEval.allowed || overlappingMaintenance.length > 0) {
    const reasons: string[] = [];
    if (!capacityEval.allowed) {
      reasons.push(
        capacityEval.reason ??
          `reaches full capacity (${capacityEval.peakConcurrentUsage}/${equipment.capacity} benches occupied)`
      );
    }
    if (overlappingMaintenance.length > 0) {
      reasons.push(`overlaps maintenance window (${overlappingMaintenance[0].reason})`);
    }
    violations.push({
      code: 'SCHEDULE_CONFLICT',
      message: `Requested interval ${reasons.join(' and ')}.`,
    });
  }

  // H4: CERTIFICATION_REQUIRED
  const missingCerts = equipment.requiredCertifications.filter(
    (cert) => !student.certifications.includes(cert)
  );
  if (missingCerts.length > 0) {
    violations.push({
      code: 'CERTIFICATION_REQUIRED',
      message: `Missing required certification(s): ${missingCerts.join(', ')}.`,
    });
  }

  // Compute Weighted Factors (0..1)
  // 1. Deadline Urgency (35%)
  const daysUntilDeadline = (toEpochMs(request.projectDeadline) - reqStartMs) / 86_400_000;
  const deadlineUrgency =
    1 - Math.min(Math.max(daysUntilDeadline, 0), MAX_DEADLINE_DAYS) / MAX_DEADLINE_DAYS;

  // 2. Equipment Requirement Compatibility (25%)
  const reqSet = new Set(request.requiredCapabilities);
  const capSet = new Set(equipment.capabilities);
  let matchedCount = 0;
  for (const r of reqSet) {
    if (capSet.has(r)) {
      matchedCount++;
    }
  }
  const unusedCount = Math.max(0, capSet.size - matchedCount);
  const baseMatch = matchedCount / Math.max(reqSet.size, 1);
  const overProvisionPenalty = 1 - 0.2 * (unusedCount / Math.max(capSet.size, 1));
  const capabilityMatch = Math.max(0, Math.min(1, baseMatch * overProvisionPenalty));

  // 3. Waiting Time (20%) — strictly anchored to immutable originalCreatedAt (anti-gaming)
  const hoursSinceOriginal = (nowMs - toEpochMs(request.originalCreatedAt)) / 3_600_000;
  const waitingTime = Math.min(Math.max(hoursSinceOriginal, 0), MAX_WAITING_HOURS) / MAX_WAITING_HOURS;

  // 4. Previous Access Fairness (10%)
  const accessFairness =
    1 - Math.min(Math.max(student.rolling30DayHoursUsed, 0), MAX_FAIRNESS_HOURS) / MAX_FAIRNESS_HOURS;

  // 5. Resource Utilization Efficiency (10%)
  const segments = splitIntervalByCampusDays(request.requestedStart, request.requestedEnd, timezone);
  let isFlush = false;

  if (segments.length > 0) {
    const firstSeg = segments[0];
    const lastSeg = segments[segments.length - 1];
    const flushWithOpen =
      Math.abs(firstSeg.startHourDecimal - equipment.operatingHours.startHour) * 60 <= 30;
    const flushWithClose =
      Math.abs(equipment.operatingHours.endHour - lastSeg.endHourDecimal) * 60 <= 30;
    if (flushWithOpen || flushWithClose) {
      isFlush = true;
    }
  }

  if (!isFlush) {
    isFlush = activeReservations.some((r) => {
      if (r.equipmentId !== equipment.id) return false;
      if (r.lifecycleStatus !== 'CONFIRMED' && r.lifecycleStatus !== 'CHECKED_OUT') return false;
      const rStart = toEpochMs(r.startTime);
      const rEnd = toEpochMs(r.endTime);
      return (
        Math.abs(reqStartMs - rEnd) <= FLUSH_BOUNDARY_TOLERANCE_MS ||
        Math.abs(rStart - reqEndMs) <= FLUSH_BOUNDARY_TOLERANCE_MS
      );
    });
  }

  const utilizationEfficiency = isFlush ? 1.0 : 0.5;

  const factors: SmartFairFactorBreakdown = {
    deadlineUrgency: round3(deadlineUrgency),
    capabilityMatch: round3(capabilityMatch),
    waitingTime: round3(waitingTime),
    accessFairness: round3(accessFairness),
    utilizationEfficiency: round3(utilizationEfficiency),
  };

  const rawScore =
    (0.35 * factors.deadlineUrgency +
      0.25 * factors.capabilityMatch +
      0.2 * factors.waitingTime +
      0.1 * factors.accessFairness +
      0.1 * factors.utilizationEfficiency) *
    100;

  const score = Math.round(rawScore * 10) / 10;
  const eligible = violations.length === 0;

  const alternativeSlots =
    !eligible || true
      ? findAlternativeSlots({
          equipment,
          requestedStart: request.requestedStart,
          durationHours: request.durationHours,
          activeReservations,
          maintenanceWindows,
          nowIso,
          timezone,
          limit: 3,
        })
      : [];

  const explanation: string[] = [];
  if (!eligible) {
    explanation.push(
      `Marked INELIGIBLE due to ${violations.length} hard constraint violation(s): ${violations
        .map((v) => v.code)
        .join(', ')}.`
    );
  } else {
    explanation.push(
      `Passes all 4 hard safety and scheduling constraints (H1–H4) with SmartFair composite score ${score.toFixed(1)}/100.`
    );
  }
  explanation.push(
    `Deadline urgency (${Math.round(factors.deadlineUrgency * 100)}%): project deadline in ${Math.max(0, Math.round(daysUntilDeadline))} day(s).`
  );
  explanation.push(
    `Capability compatibility (${Math.round(factors.capabilityMatch * 100)}%): ${matchedCount}/${Math.max(reqSet.size, 1)} requested capabilities matched (${unusedCount} unused asset capabilities).`
  );
  explanation.push(
    `Anti-gaming wait credit (${Math.round(factors.waitingTime * 100)}%): ${Math.max(0, Math.round(hoursSinceOriginal))}h elapsed since immutable originalCreatedAt.`
  );
  explanation.push(
    `Access fairness (${Math.round(factors.accessFairness * 100)}%): ${student.rolling30DayHoursUsed.toFixed(1)}h used over rolling 30 days; utilization efficiency ${isFlush ? 'flush (100%)' : 'non-flush (50%)'}.`
  );

  return {
    eligible,
    violations,
    score,
    factors,
    recommendationRank: null,
    isTopRecommended: false,
    explanation,
    alternativeSlots,
    evaluatedAt: nowIso,
  };
}

export interface EvaluatedRequestEntry {
  request: BookingRequest;
  evaluation: SmartFairEvaluation;
}

/**
 * Deterministic comparator for eligible SmartFair contenders:
 * Higher Score -> Earlier projectDeadline -> Earlier originalCreatedAt -> Lexicographical request.id
 */
export function compareSmartFairEntries(
  a: EvaluatedRequestEntry,
  b: EvaluatedRequestEntry
): number {
  if (a.evaluation.eligible !== b.evaluation.eligible) {
    return a.evaluation.eligible ? -1 : 1;
  }
  if (b.evaluation.score !== a.evaluation.score) {
    return b.evaluation.score - a.evaluation.score;
  }
  const deadlineDiff =
    toEpochMs(a.request.projectDeadline) - toEpochMs(b.request.projectDeadline);
  if (deadlineDiff !== 0) {
    return deadlineDiff;
  }
  const createdDiff =
    toEpochMs(a.request.originalCreatedAt) - toEpochMs(b.request.originalCreatedAt);
  if (createdDiff !== 0) {
    return createdDiff;
  }
  return a.request.id.localeCompare(b.request.id);
}

/**
 * Ranks a set of competing overlapping pending/conflict_review requests on the same equipment.
 */
export function rankCompetingRequests(
  requests: BookingRequest[],
  params: {
    equipment: Equipment;
    usersById: Map<string, User>;
    activeReservations: Reservation[];
    maintenanceWindows: MaintenanceWindow[];
    nowIso?: string;
    timezone?: string;
  }
): EvaluatedRequestEntry[] {
  const entries: EvaluatedRequestEntry[] = [];
  for (const req of requests) {
    const student = params.usersById.get(req.studentId);
    if (!student) continue;
    const evaluation = evaluateBookingRequest(req, {
      equipment: params.equipment,
      student,
      activeReservations: params.activeReservations,
      maintenanceWindows: params.maintenanceWindows,
      nowIso: params.nowIso,
      timezone: params.timezone,
    });
    entries.push({ request: req, evaluation });
  }

  entries.sort(compareSmartFairEntries);

  let rankCounter = 1;
  for (const entry of entries) {
    if (entry.evaluation.eligible) {
      entry.evaluation.recommendationRank = rankCounter;
      entry.evaluation.isTopRecommended = rankCounter === 1;
      rankCounter++;
    } else {
      entry.evaluation.recommendationRank = null;
      entry.evaluation.isTopRecommended = false;
    }
  }

  return entries;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
