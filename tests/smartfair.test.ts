import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { computeAnalyticsSummary, computeEquipmentWeeklySupplyBenchHours } from '../server/analytics.ts';
import {
  assignLowestAvailableBench,
  computePeakConcurrentUsage,
  evaluateIntervalCapacity,
} from '../shared/concurrency.ts';
import {
  compareSmartFairEntries,
  evaluateBookingRequest,
  findAlternativeSlots,
} from '../shared/smartfair.ts';
import {
  computeSlotBucketIds,
  intervalsOverlap,
  splitIntervalByCampusDays,
  validateOperatingHoursAndDuration,
} from '../shared/timezone.ts';
import type {
  BookingRequest,
  Department,
  Equipment,
  MaintenanceWindow,
  Reservation,
  User,
} from '../shared/types.ts';

const baseEquipment: Equipment = {
  id: 'eq-test-1',
  assetTag: 'ECE-TEST-01',
  name: 'Test Precision CNC',
  category: 'CNC Machines',
  departmentId: 'dept-mech',
  labRoom: 'C-101',
  specs: { Axes: '5-Axis' },
  capabilities: ['5-axis', 'aluminum', 'micro-tolerance', 'coolant'],
  requiredCertifications: ['LAB_SAFETY_101', 'CNC_L1'],
  maxBookingHours: 6,
  operatingHours: { startHour: 8, endHour: 20, daysOfWeek: [1, 2, 3, 4, 5] },
  status: 'AVAILABLE',
  capacity: 1,
  imageUrl: '/img.jpg',
};

const baseStudent: User = {
  id: 'stu-1',
  email: 'stu1@campus.edu',
  name: 'Student One',
  role: 'STUDENT',
  departmentId: 'dept-robo',
  certifications: ['LAB_SAFETY_101', 'CNC_L1'],
  rolling30DayHoursUsed: 4,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function makeIstIso(year: number, month: number, day: number, hour: number, minute = 0): string {
  return DateTime.fromObject({ year, month, day, hour, minute }, { zone: 'Asia/Kolkata' })
    .toUTC()
    .toISO()!;
}

describe('Campus Timezone (Asia/Kolkata) & Slot-Bucket Locks', () => {
  it('detects partial, containment, and back-to-back intervals accurately', () => {
    const t10 = Date.parse(makeIstIso(2026, 11, 25, 10, 0));
    const t11 = Date.parse(makeIstIso(2026, 11, 25, 11, 0));
    const t12 = Date.parse(makeIstIso(2026, 11, 25, 12, 0));
    const t13 = Date.parse(makeIstIso(2026, 11, 25, 13, 0));
    const t09 = Date.parse(makeIstIso(2026, 11, 25, 9, 0));
    const t15 = Date.parse(makeIstIso(2026, 11, 25, 15, 0));

    expect(intervalsOverlap(t10, t12, t11, t13)).toBe(true); // partial overlap
    expect(intervalsOverlap(t09, t15, t10, t12)).toBe(true); // containment
    expect(intervalsOverlap(t10, t11, t11, t12)).toBe(false); // back-to-back allowed
  });

  it('computes deterministic 60-min slot buckets across Asia/Kolkata hours and cross-midnight', () => {
    const start = makeIstIso(2026, 11, 25, 22, 30);
    const end = makeIstIso(2026, 11, 26, 1, 0);

    const segments = splitIntervalByCampusDays(start, end, 'Asia/Kolkata');
    expect(segments).toHaveLength(2);
    expect(segments[0].dateKey).toBe('2026-11-25');
    expect(segments[0].startHourDecimal).toBeCloseTo(22.5, 5);
    expect(segments[0].endHourDecimal).toBeCloseTo(24, 5);
    expect(segments[1].dateKey).toBe('2026-11-26');
    expect(segments[1].startHourDecimal).toBeCloseTo(0, 5);
    expect(segments[1].endHourDecimal).toBeCloseTo(1, 5);

    const buckets = computeSlotBucketIds('eq-1', start, end, 'Asia/Kolkata');
    expect(buckets.map((b) => b.lockId)).toEqual([
      'eq-1_2026-11-25_H22',
      'eq-1_2026-11-25_H23',
      'eq-1_2026-11-26_H0',
    ]);
  });

  it('validates cross-midnight bookings when 24h operating hours apply and rejects closed weekends', () => {
    const overnightEquip: Equipment = {
      ...baseEquipment,
      operatingHours: { startHour: 0, endHour: 24, daysOfWeek: [1, 2, 3, 4, 5] },
    };
    // Wednesday 2026-11-25 22:00 IST -> Thursday 2026-11-26 02:00 IST
    const ok = validateOperatingHoursAndDuration(
      makeIstIso(2026, 11, 25, 22, 0),
      makeIstIso(2026, 11, 26, 2, 0),
      overnightEquip.operatingHours,
      overnightEquip.maxBookingHours,
      'Asia/Kolkata'
    );
    expect(ok.valid).toBe(true);
    expect(ok.durationHours).toBeCloseTo(4, 5);

    // Saturday 2026-11-28 is closed for daysOfWeek [1..5]
    const weekend = validateOperatingHoursAndDuration(
      makeIstIso(2026, 11, 28, 10, 0),
      makeIstIso(2026, 11, 28, 12, 0),
      baseEquipment.operatingHours,
      baseEquipment.maxBookingHours,
      'Asia/Kolkata'
    );
    expect(weekend.valid).toBe(false);
  });
});

describe('SmartFair Allocation Engine', () => {
  const baseReq: BookingRequest = {
    id: 'req-a',
    studentId: baseStudent.id,
    equipmentId: baseEquipment.id,
    projectTitle: 'Drone Gimbal Milling',
    projectSummary: 'Precision milling of aluminum housing.',
    requiredCapabilities: ['5-axis', 'aluminum'],
    justification: 'Capstone structural assembly.',
    requestedStart: makeIstIso(2026, 11, 25, 8, 0),
    requestedEnd: makeIstIso(2026, 11, 25, 11, 0),
    durationHours: 3,
    projectDeadline: makeIstIso(2026, 11, 30, 18, 0),
    status: 'PENDING',
    originalCreatedAt: makeIstIso(2026, 11, 23, 8, 0),
    lastSubmittedAt: makeIstIso(2026, 11, 23, 8, 0),
    smartFairSnapshot: null,
    facultyDecisionReason: null,
    reviewedBy: null,
    createdAt: makeIstIso(2026, 11, 23, 8, 0),
  };

  it('enforces all 4 hard constraints H1–H4', () => {
    const nowIso = makeIstIso(2026, 11, 24, 8, 0);

    // H1: EQUIPMENT_UNAVAILABLE
    const h1 = evaluateBookingRequest(baseReq, {
      equipment: { ...baseEquipment, status: 'MAINTENANCE' },
      student: baseStudent,
      activeReservations: [],
      maintenanceWindows: [],
      nowIso,
    });
    expect(h1.eligible).toBe(false);
    expect(h1.violations.some((v) => v.code === 'EQUIPMENT_UNAVAILABLE')).toBe(true);

    // H2: HOURS_OR_DURATION_VIOLATION
    const h2 = evaluateBookingRequest(
      { ...baseReq, requestedEnd: makeIstIso(2026, 11, 25, 22, 0), durationHours: 14 },
      {
        equipment: baseEquipment,
        student: baseStudent,
        activeReservations: [],
        maintenanceWindows: [],
        nowIso,
      }
    );
    expect(h2.eligible).toBe(false);
    expect(h2.violations.some((v) => v.code === 'HOURS_OR_DURATION_VIOLATION')).toBe(true);

    // H3: SCHEDULE_CONFLICT (Reservation & Maintenance)
    const activeRes: Reservation[] = [
      {
        id: 'res-1',
        requestId: 'req-old',
        equipmentId: baseEquipment.id,
        studentId: 'other',
        startTime: makeIstIso(2026, 11, 25, 10, 0),
        endTime: makeIstIso(2026, 11, 25, 12, 0),
        benchNumber: 1,
        lifecycleStatus: 'CONFIRMED',
        checkedOutAt: null,
        returnedAt: null,
        noShowMarkedAt: null,
      },
    ];
    const maint: MaintenanceWindow[] = [
      {
        id: 'mnt-1',
        equipmentId: baseEquipment.id,
        startTime: makeIstIso(2026, 11, 25, 9, 0),
        endTime: makeIstIso(2026, 11, 25, 10, 0),
        reason: 'Spindle calibration',
        createdBy: 'fac-1',
      },
    ];
    const h3 = evaluateBookingRequest(baseReq, {
      equipment: baseEquipment,
      student: baseStudent,
      activeReservations: activeRes,
      maintenanceWindows: maint,
      nowIso,
    });
    expect(h3.eligible).toBe(false);
    expect(h3.violations.some((v) => v.code === 'SCHEDULE_CONFLICT')).toBe(true);

    // H4: CERTIFICATION_REQUIRED
    const h4 = evaluateBookingRequest(baseReq, {
      equipment: baseEquipment,
      student: { ...baseStudent, certifications: ['LAB_SAFETY_101'] },
      activeReservations: [],
      maintenanceWindows: [],
      nowIso,
    });
    expect(h4.eligible).toBe(false);
    expect(h4.violations.some((v) => v.code === 'CERTIFICATION_REQUIRED')).toBe(true);
  });

  it('computes exact weighted score and preserves anti-gaming originalCreatedAt waiting time', () => {
    const nowIso = makeIstIso(2026, 11, 24, 8, 0); // 24h after originalCreatedAt -> W = 24/72 = 0.333
    const eval1 = evaluateBookingRequest(baseReq, {
      equipment: baseEquipment,
      student: baseStudent,
      activeReservations: [],
      maintenanceWindows: [],
      nowIso,
    });

    expect(eval1.eligible).toBe(true);
    expect(eval1.factors.utilizationEfficiency).toBe(1.0); // flush with 08:00 startHour
    expect(eval1.factors.waitingTime).toBeCloseTo(24 / 72, 2);

    // Simulate editing/resubmitting lastSubmittedAt without altering originalCreatedAt
    const resubmitted = { ...baseReq, lastSubmittedAt: makeIstIso(2026, 11, 24, 7, 55) };
    const eval2 = evaluateBookingRequest(resubmitted, {
      equipment: baseEquipment,
      student: baseStudent,
      activeReservations: [],
      maintenanceWindows: [],
      nowIso,
    });
    expect(eval2.factors.waitingTime).toBe(eval1.factors.waitingTime);
    expect(eval2.score).toBe(eval1.score);
  });

  it('applies deterministic tie-breakers (Score -> Deadline -> originalCreatedAt -> ID)', () => {
    const nowIso = makeIstIso(2026, 11, 24, 8, 0);
    const req1 = { ...baseReq, id: 'req-z', projectDeadline: makeIstIso(2026, 11, 28, 12, 0) };
    const req2 = { ...baseReq, id: 'req-a', projectDeadline: makeIstIso(2026, 11, 28, 12, 0) };

    const e1 = evaluateBookingRequest(req1, {
      equipment: baseEquipment,
      student: baseStudent,
      activeReservations: [],
      maintenanceWindows: [],
      nowIso,
    });
    const e2 = evaluateBookingRequest(req2, {
      equipment: baseEquipment,
      student: baseStudent,
      activeReservations: [],
      maintenanceWindows: [],
      nowIso,
    });

    // Exact same score, deadline, and originalCreatedAt -> lexicographical ID ('req-a' < 'req-z')
    expect(e1.score).toBe(e2.score);
    const sorted = [
      { request: req1, evaluation: e1 },
      { request: req2, evaluation: e2 },
    ].sort(compareSmartFairEntries);

    expect(sorted[0].request.id).toBe('req-a');
  });

  it('finds up to 3 valid alternative slots avoiding active reservations', () => {
    const nowIso = makeIstIso(2026, 11, 25, 7, 0);
    const activeRes: Reservation[] = [
      {
        id: 'res-block',
        requestId: 'req-x',
        equipmentId: baseEquipment.id,
        studentId: 'other',
        startTime: makeIstIso(2026, 11, 25, 8, 0),
        endTime: makeIstIso(2026, 11, 25, 11, 0),
        benchNumber: 1,
        lifecycleStatus: 'CONFIRMED',
        checkedOutAt: null,
        returnedAt: null,
        noShowMarkedAt: null,
      },
    ];
    const slots = findAlternativeSlots({
      equipment: baseEquipment,
      requestedStart: makeIstIso(2026, 11, 25, 8, 0),
      durationHours: 2,
      activeReservations: activeRes,
      maintenanceWindows: [],
      nowIso,
      timezone: 'Asia/Kolkata',
      limit: 3,
    });

    expect(slots).toHaveLength(3);
    // First valid slot on 2026-11-25 starts at 11:00 IST (immediately after 08:00-11:00 block)
    expect(DateTime.fromISO(slots[0].startTime).setZone('Asia/Kolkata').hour).toBe(11);
  });
});

describe('Wave 1: Sweep-Line Multi-Bench Concurrency & Capacity-Weighted Analytics', () => {
  it('computes exact peak concurrent usage with back-to-back handoff (-1 before +1)', () => {
    const t10 = Date.parse(makeIstIso(2026, 11, 25, 10, 0));
    const t11 = Date.parse(makeIstIso(2026, 11, 25, 11, 0));
    const t12 = Date.parse(makeIstIso(2026, 11, 25, 12, 0));
    const t13 = Date.parse(makeIstIso(2026, 11, 25, 13, 0));
    const t14 = Date.parse(makeIstIso(2026, 11, 25, 14, 0));

    // Back-to-back 10-12 and 12-14 on the same bench -> peak concurrency is 1, not 2
    const peakHandoff = computePeakConcurrentUsage(
      [
        { startMs: t10, endMs: t12 },
        { startMs: t12, endMs: t14 },
      ],
      t10,
      t14
    );
    expect(peakHandoff).toBe(1);

    // Overlapping 10-12 and 11-13 -> peak concurrency is 2 during 11-12
    const peakOverlap = computePeakConcurrentUsage(
      [
        { startMs: t10, endMs: t12 },
        { startMs: t11, endMs: t13 },
      ],
      t11,
      t13
    );
    expect(peakOverlap).toBe(2);
  });

  it('assigns lowest available bench deterministically for staggered intervals', () => {
    const existing = [
      {
        startTime: makeIstIso(2026, 11, 25, 10, 0),
        endTime: makeIstIso(2026, 11, 25, 12, 0),
        benchNumber: 1,
      },
      {
        startTime: makeIstIso(2026, 11, 25, 11, 0),
        endTime: makeIstIso(2026, 11, 25, 13, 0),
        benchNumber: 2,
      },
    ];

    // 12:00-14:00 overlaps bench 2 (11-13), free on bench 1 (10-12 ended at 12:00)
    const bench = assignLowestAvailableBench(
      existing,
      Date.parse(makeIstIso(2026, 11, 25, 12, 0)),
      Date.parse(makeIstIso(2026, 11, 25, 14, 0)),
      2
    );
    expect(bench).toBe(1);

    // 11:30-12:30 hits peak 2/2 -> rejected
    const evalFull = evaluateIntervalCapacity(
      existing,
      Date.parse(makeIstIso(2026, 11, 25, 11, 30)),
      Date.parse(makeIstIso(2026, 11, 25, 12, 30)),
      2
    );
    expect(evalFull.allowed).toBe(false);
    expect(evalFull.peakConcurrentUsage).toBe(2);
    expect(evalFull.assignedBenchNumber).toBeNull();
  });

  it('computes capacity-weighted utilization excluding NO_SHOW and deducting maintenance', () => {
    const dept: Department = {
      id: 'dept-ece',
      code: 'ECE',
      name: 'Electronics',
      building: 'Block A',
      contactEmail: 'ece@campus.edu',
    };
    const multiBenchEquip: Equipment = {
      ...baseEquipment,
      id: 'eq-multi',
      departmentId: 'dept-ece',
      operatingHours: { startHour: 8, endHour: 18, daysOfWeek: [1, 2, 3, 4, 5] }, // 10h * 5d * 2 = 100 bench-hours
      capacity: 2,
    };
    const maint: MaintenanceWindow[] = [
      {
        id: 'mnt-cap',
        equipmentId: 'eq-multi',
        startTime: makeIstIso(2026, 11, 25, 10, 0), // Wednesday 10:00-15:00 = 5h * 2 benches = 10 bench-hours
        endTime: makeIstIso(2026, 11, 25, 15, 0),
        reason: 'Calibration',
        createdBy: 'fac-1',
      },
    ];
    const supply = computeEquipmentWeeklySupplyBenchHours(multiBenchEquip, maint, 'Asia/Kolkata');
    expect(supply.grossBenchHours).toBe(100);
    expect(supply.maintenanceBenchHours).toBe(10);
    expect(supply.netSupplyBenchHours).toBe(90);

    const reservations: Reservation[] = [
      {
        id: 'res-conf',
        requestId: 'req-1',
        equipmentId: 'eq-multi',
        studentId: baseStudent.id,
        startTime: makeIstIso(2026, 11, 26, 9, 0),
        endTime: makeIstIso(2026, 11, 26, 18, 0), // 9h counted
        benchNumber: 1,
        lifecycleStatus: 'CONFIRMED',
        checkedOutAt: null,
        returnedAt: null,
        noShowMarkedAt: null,
      },
      {
        id: 'res-noshow',
        requestId: 'req-2',
        equipmentId: 'eq-multi',
        studentId: baseStudent.id,
        startTime: makeIstIso(2026, 11, 26, 9, 0),
        endTime: makeIstIso(2026, 11, 26, 15, 0), // 6h must NOT be counted
        benchNumber: 2,
        lifecycleStatus: 'NO_SHOW',
        checkedOutAt: null,
        returnedAt: null,
        noShowMarkedAt: makeIstIso(2026, 11, 26, 9, 25),
      },
    ];

    const summary = computeAnalyticsSummary({
      equipment: [multiBenchEquip],
      departments: [dept],
      bookingRequests: [],
      reservations,
      users: [baseStudent],
      auditLogs: [],
      maintenanceWindows: maint,
      timezone: 'Asia/Kolkata',
    });

    // 9h utilized / 90 net supply bench-hours = 10.0%
    expect(summary.totalReservations).toBe(1);
    expect(summary.departmentUtilization[0].bookedHours).toBe(9);
    expect(summary.departmentUtilization[0].utilizationPercent).toBe(10);
    expect(summary.averageUtilizationPercent).toBe(10);
  });
});
