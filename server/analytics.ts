import { getCampusTimezone, splitIntervalByCampusDays, toEpochMs } from '../shared/timezone.ts';
import type {
  AnalyticsSummary,
  AuditLog,
  BookingRequest,
  Department,
  Equipment,
  MaintenanceWindow,
  PublicOverview,
  Reservation,
  User,
} from '../shared/types.ts';

function isUtilizedReservation(r: Reservation): boolean {
  return (
    r.lifecycleStatus === 'CONFIRMED' ||
    r.lifecycleStatus === 'CHECKED_OUT' ||
    r.lifecycleStatus === 'RETURNED'
  );
}

function mergeIntervals(intervals: Array<{ startMs: number; endMs: number }>): Array<{ startMs: number; endMs: number }> {
  if (intervals.length === 0) return [];
  const sorted = [...intervals]
    .filter((i) => i.endMs > i.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (sorted.length === 0) return [];

  const merged: Array<{ startMs: number; endMs: number }> = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = sorted[i];
    if (curr.startMs <= prev.endMs) {
      prev.endMs = Math.max(prev.endMs, curr.endMs);
    } else {
      merged.push({ ...curr });
    }
  }
  return merged;
}

export function computeEquipmentWeeklySupplyBenchHours(
  eq: Equipment,
  maintenanceWindows: MaintenanceWindow[],
  timezone: string = getCampusTimezone()
): {
  grossBenchHours: number;
  maintenanceBenchHours: number;
  netSupplyBenchHours: number;
} {
  const capacity = Math.max(1, Math.floor(eq.capacity || 1));
  const dailyHours = Math.max(0, eq.operatingHours.endHour - eq.operatingHours.startHour);
  const activeDays = Math.max(0, eq.operatingHours.daysOfWeek.length);
  const grossBenchHours = dailyHours * activeDays * capacity;

  const eqMaintIntervals = mergeIntervals(
    maintenanceWindows
      .filter((m) => m.equipmentId === eq.id)
      .map((m) => ({ startMs: toEpochMs(m.startTime), endMs: toEpochMs(m.endTime) }))
  );

  let maintOperatingHours = 0;
  for (const interval of eqMaintIntervals) {
    const segments = splitIntervalByCampusDays(
      new Date(interval.startMs).toISOString(),
      new Date(interval.endMs).toISOString(),
      timezone
    );
    for (const seg of segments) {
      if (!eq.operatingHours.daysOfWeek.includes(seg.dayOfWeek)) {
        continue;
      }
      const overlapStart = Math.max(seg.startHourDecimal, eq.operatingHours.startHour);
      const overlapEnd = Math.min(seg.endHourDecimal, eq.operatingHours.endHour);
      if (overlapEnd > overlapStart) {
        maintOperatingHours += overlapEnd - overlapStart;
      }
    }
  }

  const maintenanceBenchHours = Math.min(grossBenchHours, maintOperatingHours * capacity);
  const netSupplyBenchHours = Math.max(0, grossBenchHours - maintenanceBenchHours);

  return {
    grossBenchHours,
    maintenanceBenchHours,
    netSupplyBenchHours,
  };
}

export function computePublicOverview(params: {
  equipment: Equipment[];
  departments: Department[];
  bookingRequests: BookingRequest[];
  reservations: Reservation[];
  users: User[];
  maintenanceWindows?: MaintenanceWindow[];
  timezone?: string;
}): PublicOverview {
  const {
    equipment,
    departments,
    bookingRequests,
    reservations,
    users,
    maintenanceWindows = [],
    timezone = getCampusTimezone(),
  } = params;
  const equipById = new Map(equipment.map((e) => [e.id, e]));
  const userById = new Map(users.map((u) => [u.id, u]));

  const availableEquipment = equipment.filter((e) => e.status === 'AVAILABLE').length;
  const pendingConflictsCount = bookingRequests.filter(
    (b) => b.status === 'CONFLICT_REVIEW'
  ).length;

  const utilizedReservations = reservations.filter(isUtilizedReservation);

  let crossDeptCount = 0;
  let totalBookedBenchHours = 0;

  for (const r of utilizedReservations) {
    const eq = equipById.get(r.equipmentId);
    const stu = userById.get(r.studentId);
    if (eq && stu && eq.departmentId !== stu.departmentId) {
      crossDeptCount++;
    }
    totalBookedBenchHours += Math.max(0, (toEpochMs(r.endTime) - toEpochMs(r.startTime)) / 3_600_000);
  }

  let totalSupplyBenchHours = 0;
  for (const eq of equipment) {
    totalSupplyBenchHours += computeEquipmentWeeklySupplyBenchHours(
      eq,
      maintenanceWindows,
      timezone
    ).netSupplyBenchHours;
  }

  const crossDepartmentSharePercent =
    utilizedReservations.length > 0
      ? Math.round((crossDeptCount / utilizedReservations.length) * 1000) / 10
      : 0;

  const averageUtilizationPercent =
    totalSupplyBenchHours > 0
      ? Math.min(100, Math.round((totalBookedBenchHours / totalSupplyBenchHours) * 1000) / 10)
      : totalBookedBenchHours > 0
        ? 100
        : 0;

  return {
    totalEquipment: equipment.length,
    availableEquipment,
    totalDepartments: departments.length,
    totalBookingsCompletedOrActive: utilizedReservations.length,
    crossDepartmentSharePercent,
    pendingConflictsCount,
    averageUtilizationPercent,
    featuredEquipment: equipment.slice(0, 4),
    departments,
  };
}

export function computeAnalyticsSummary(params: {
  equipment: Equipment[];
  departments: Department[];
  bookingRequests: BookingRequest[];
  reservations: Reservation[];
  users: User[];
  auditLogs: AuditLog[];
  maintenanceWindows?: MaintenanceWindow[];
  timezone?: string;
}): AnalyticsSummary {
  const {
    equipment,
    departments,
    bookingRequests,
    reservations,
    users,
    auditLogs,
    maintenanceWindows = [],
    timezone = getCampusTimezone(),
  } = params;
  const equipById = new Map(equipment.map((e) => [e.id, e]));
  const userById = new Map(users.map((u) => [u.id, u]));

  const utilizedReservations = reservations.filter(isUtilizedReservation);

  let crossDepartmentBookingsCount = 0;
  for (const r of utilizedReservations) {
    const eq = equipById.get(r.equipmentId);
    const stu = userById.get(r.studentId);
    if (eq && stu && eq.departmentId !== stu.departmentId) {
      crossDepartmentBookingsCount++;
    }
  }

  const approvedRequests = bookingRequests.filter((b) => b.status === 'APPROVED').length;
  const overrideCount = auditLogs.filter((a) => a.action === 'OVERRIDE_RECOMMENDATION').length;
  const overrideRatePercent =
    approvedRequests > 0 ? Math.round((overrideCount / approvedRequests) * 1000) / 10 : 0;

  // Department breakdown (capacity-weighted & maintenance-adjusted bench-hours)
  const departmentUtilization = departments.map((dept) => {
    const deptEquip = equipment.filter((e) => e.departmentId === dept.id);
    const deptEquipIds = new Set(deptEquip.map((e) => e.id));
    const deptRes = utilizedReservations.filter((r) => deptEquipIds.has(r.equipmentId));
    const bookedHours = deptRes.reduce(
      (sum, r) => sum + Math.max(0, (toEpochMs(r.endTime) - toEpochMs(r.startTime)) / 3_600_000),
      0
    );
    const capacityHours = deptEquip.reduce(
      (sum, e) =>
        sum + computeEquipmentWeeklySupplyBenchHours(e, maintenanceWindows, timezone).netSupplyBenchHours,
      0
    );
    const utilizationPercent =
      capacityHours > 0
        ? Math.min(100, Math.round((bookedHours / capacityHours) * 1000) / 10)
        : bookedHours > 0
          ? 100
          : 0;

    const crossDepartmentInboundCount = deptRes.filter((r) => {
      const stu = userById.get(r.studentId);
      return stu && stu.departmentId !== dept.id;
    }).length;

    return {
      departmentId: dept.id,
      departmentCode: dept.code,
      departmentName: dept.name,
      equipmentCount: deptEquip.length,
      bookedHours: Math.round(bookedHours * 10) / 10,
      utilizationPercent,
      crossDepartmentInboundCount,
    };
  });

  const avgUtil =
    departmentUtilization.length > 0
      ? Math.round(
          (departmentUtilization.reduce((s, d) => s + d.utilizationPercent, 0) /
            departmentUtilization.length) *
            10
        ) / 10
      : 0;

  // Student usage distribution & Jain's fairness index: (sum x)^2 / (n * sum x^2) * 100
  const students = users.filter((u) => u.role === 'STUDENT');
  const studentUsageDistribution = students.map((s) => ({
    studentId: s.id,
    studentName: s.name,
    departmentId: s.departmentId,
    rolling30DayHoursUsed: Math.round(s.rolling30DayHoursUsed * 10) / 10,
    approvedCount: bookingRequests.filter((b) => b.studentId === s.id && b.status === 'APPROVED')
      .length,
  }));

  const sumHours = students.reduce((s, u) => s + u.rolling30DayHoursUsed, 0);
  const sumSqHours = students.reduce((s, u) => s + u.rolling30DayHoursUsed ** 2, 0);
  const fairnessIndex =
    students.length > 0 && sumSqHours > 0
      ? Math.round(((sumHours ** 2) / (students.length * sumSqHours)) * 1000) / 10
      : 100;

  return {
    totalEquipment: equipment.length,
    availableEquipment: equipment.filter((e) => e.status === 'AVAILABLE').length,
    maintenanceEquipment: equipment.filter((e) => e.status === 'MAINTENANCE').length,
    totalRequests: bookingRequests.length,
    pendingRequests: bookingRequests.filter((b) => b.status === 'PENDING').length,
    conflictReviewRequests: bookingRequests.filter((b) => b.status === 'CONFLICT_REVIEW').length,
    approvedRequests,
    rejectedRequests: bookingRequests.filter((b) => b.status === 'REJECTED').length,
    totalReservations: utilizedReservations.length,
    crossDepartmentBookingsCount,
    crossDepartmentSharePercent:
      utilizedReservations.length > 0
        ? Math.round((crossDepartmentBookingsCount / utilizedReservations.length) * 1000) / 10
        : 0,
    averageUtilizationPercent: avgUtil,
    overrideCount,
    overrideRatePercent,
    fairnessIndex,
    departmentUtilization,
    studentUsageDistribution,
  };
}
