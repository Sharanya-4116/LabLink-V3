import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DateTime } from 'luxon';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApiApp } from '../server/app.ts';
import { loadServerConfig } from '../server/config.ts';
import { SqliteRepository } from '../server/repositories/SqliteRepository.ts';

async function setupTestApp(
  mode: 'demo' | 'production' = 'demo',
  overrides: { internalSweepSecret?: string } = {}
) {
  const config = loadServerConfig({
    appMode: mode,
    allowDemoRoleSwitch: mode === 'demo',
    persistenceDriver: 'sqlite',
    sqliteDbPath: ':memory:',
    campusTimezone: 'Asia/Kolkata',
    internalSweepSecret: overrides.internalSweepSecret ?? '',
  });
  const repo = new SqliteRepository(':memory:', 'Asia/Kolkata');
  await repo.init();
  const app = createApiApp(repo, config);
  return { app, repo, config };
}

function nextWeekdayIso(hour: number, minute = 0, addDays = 3): string {
  let dt = DateTime.now().setZone('Asia/Kolkata').plus({ days: addDays }).startOf('day');
  while (dt.weekday === 6 || dt.weekday === 7) {
    dt = dt.plus({ days: 1 });
  }
  return dt.set({ hour, minute, second: 0, millisecond: 0 }).toUTC().toISO()!;
}

describe('LabLink V3 API Security, Validation, RBAC & Concurrency', () => {
  it('returns service health and real computed public overview', async () => {
    const { app } = await setupTestApp('demo');
    const health = await request(app).get('/api/healthz');
    expect(health.status).toBe(200);
    expect(health.body.status).toBe('ok');
    expect(health.body.campusTimezone).toBe('Asia/Kolkata');

    const overview = await request(app).get('/api/public/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.totalEquipment).toBeGreaterThanOrEqual(8);
    expect(overview.body.totalDepartments).toBe(4);
  });

  it('rejects unauthenticated protected requests with 401 and rejects demo headers in production mode', async () => {
    const { app: demoApp } = await setupTestApp('demo');
    const unauth = await request(demoApp).get('/api/bookings');
    expect(unauth.status).toBe(401);

    const { app: prodApp } = await setupTestApp('production');
    const demoHeaderAttempt = await request(prodApp)
      .get('/api/bookings')
      .set('x-demo-user-id', 'usr-adm-meera');
    expect(demoHeaderAttempt.status).toBe(401);

    const prodSession = await request(prodApp).get('/api/auth/session');
    expect(prodSession.status).toBe(200);
    expect(prodSession.body.allowDemoRoleSwitch).toBe(false);
    expect(prodSession.body.demoUsers).toEqual([]);
  });

  it('enforces server-side RBAC (403 Forbidden for STUDENT on faculty/admin routes)', async () => {
    const { app } = await setupTestApp('demo');

    const adminUsersRes = await request(app)
      .get('/api/users')
      .set('x-demo-user-id', 'usr-stu-aarav');
    expect(adminUsersRes.status).toBe(403);

    const facultyDecisionRes = await request(app)
      .post('/api/bookings/req-pending-osc-diya/decision')
      .set('x-demo-user-id', 'usr-stu-aarav')
      .send({ decision: 'APPROVE', reason: 'Self approval attempt', isOverride: false });
    expect(facultyDecisionRes.status).toBe(403);
  });

  it('validates booking request inputs with Zod (400 Bad Request)', async () => {
    const { app } = await setupTestApp('demo');
    const res = await request(app)
      .post('/api/bookings')
      .set('x-demo-user-id', 'usr-stu-aarav')
      .send({
        equipmentId: 'eq-polymax-3d',
        projectTitle: 'ab', // too short
        projectSummary: 'short',
        requiredCapabilities: [],
        justification: 'no',
        requestedStart: nextWeekdayIso(12),
        requestedEnd: nextWeekdayIso(10), // end before start
        projectDeadline: nextWeekdayIso(18, 0, 6),
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('prevents double-booking via atomic slot_locks (409 Conflict) and logs faculty override audit', async () => {
    const { app } = await setupTestApp('demo');

    const startIso = nextWeekdayIso(14, 0, 4);
    const endIso = nextWeekdayIso(16, 0, 4);
    const deadlineIso = nextWeekdayIso(18, 0, 8);

    // Two students submit overlapping requests on PolyMax 3D Printer (capacity = 1; both Aarav and Diya hold LAB_SAFETY_101 + FAB_3D_PRINTING)
    const r1 = await request(app)
      .post('/api/bookings')
      .set('x-demo-user-id', 'usr-stu-aarav')
      .send({
        equipmentId: 'eq-polymax-3d',
        projectTitle: 'Flight Controller Carbon Gimbal Shell',
        projectSummary: 'Printing rigid carbon-nylon gimbal shell on PolyMax i600.',
        requiredCapabilities: ['multi-material', 'carbon-fiber-nylon'],
        justification: 'Needs dual IDEX carbon-nylon fabrication before flight review.',
        requestedStart: startIso,
        requestedEnd: endIso,
        projectDeadline: deadlineIso,
      });
    expect(r1.status).toBe(201);

    const r2 = await request(app)
      .post('/api/bookings')
      .set('x-demo-user-id', 'usr-stu-diya')
      .send({
        equipmentId: 'eq-polymax-3d',
        projectTitle: 'Wearable ECG Multi-Material Enclosure',
        projectSummary: 'Printing dual-material TPU + PETG sensor housing on PolyMax i600.',
        requiredCapabilities: ['multi-material'],
        justification: 'Requires dual-extruder soluble support.',
        requestedStart: startIso,
        requestedEnd: endIso,
        projectDeadline: nextWeekdayIso(18, 0, 15),
      });
    expect(r2.status).toBe(201);
    expect(r2.body.booking.status).toBe('CONFLICT_REVIEW');

    const req1Id = r1.body.booking.id;
    const req2Id = r2.body.booking.id;

    // Faculty attempts to approve lower-ranked req2 WITHOUT override justification -> 400
    const missingOverride = await request(app)
      .post(`/api/bookings/${req2Id}/decision`)
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({
        decision: 'APPROVE',
        reason: 'Want to prioritize SerDes bench test.',
        isOverride: false,
      });
    expect(missingOverride.status).toBe(400);

    // Faculty approves req1 (top SmartFair pick) and simultaneously races req2 override -> exactly one succeeds, second gets 409 Conflict!
    const [dec1, dec2] = await Promise.all([
      request(app)
        .post(`/api/bookings/${req1Id}/decision`)
        .set('x-demo-user-id', 'usr-fac-ananya')
        .send({
          decision: 'APPROVE',
          reason: 'Top SmartFair ranked project with imminent deadline.',
          isOverride: false,
        }),
      request(app)
        .post(`/api/bookings/${req2Id}/decision`)
        .set('x-demo-user-id', 'usr-fac-ananya')
        .send({
          decision: 'APPROVE',
          reason: 'Overriding to run SerDes verification.',
          isOverride: true,
          overrideReasonCode: 'FACULTY_RESEARCH_GRANT',
          overrideJustification: 'Sponsored research milestone requires SerDes validation today.',
        }),
    ]);

    const statuses = [dec1.status, dec2.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Verify anti-gaming reschedule preserves originalCreatedAt on the non-winning request
    const losingId = dec1.status === 200 ? req2Id : req1Id;
    const losingStudent = dec1.status === 200 ? 'usr-stu-diya' : 'usr-stu-aarav';
    const originalAnchor =
      dec1.status === 200 ? r2.body.booking.originalCreatedAt : r1.body.booking.originalCreatedAt;

    const reschedule = await request(app)
      .post(`/api/bookings/${losingId}/reschedule`)
      .set('x-demo-user-id', losingStudent)
      .send({
        requestedStart: nextWeekdayIso(16, 0, 4),
        requestedEnd: nextWeekdayIso(18, 0, 4),
      });
    expect(reschedule.status).toBe(200);
    expect(reschedule.body.booking.originalCreatedAt).toBe(originalAnchor);

    // Verify P2 reservation checkout, return, and .ics export
    const winningResId = (dec1.status === 200 ? dec1 : dec2).body.reservation.id;
    const icsRes = await request(app)
      .get(`/api/reservations/${winningResId}/ics`)
      .set('x-demo-user-id', 'usr-fac-ananya');
    expect(icsRes.status).toBe(200);
    expect(icsRes.text).toContain('BEGIN:VCALENDAR');

    const checkoutRes = await request(app)
      .post(`/api/reservations/${winningResId}/checkout`)
      .set('x-demo-user-id', 'usr-fac-ananya');
    expect(checkoutRes.status).toBe(200);
    expect(checkoutRes.body.reservation.lifecycleStatus).toBe('CHECKED_OUT');

    const returnRes = await request(app)
      .post(`/api/reservations/${winningResId}/return`)
      .set('x-demo-user-id', 'usr-fac-ananya');
    expect(returnRes.status).toBe(200);
    expect(returnRes.body.reservation.lifecycleStatus).toBe('RETURNED');
  });

  it('handles X-Forwarded-For and Forwarded proxy headers cleanly without express-rate-limit errors', async () => {
    const { app } = await setupTestApp('demo');
    const res = await request(app)
      .get('/api/healthz')
      .set('X-Forwarded-For', '203.0.113.42')
      .set('Forwarded', 'for=203.0.113.42;proto=https');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.noShowGraceMinutes).toBe(20);
  });

  it('supports capacity = 2 overlapping approvals with deterministic benchNumbers and rejects 3rd with 409', async () => {
    const { app } = await setupTestApp('demo');

    // Grant Kabir ESD_PROTECTION so all 3 students are certified for eq-fpga-kintex (capacity = 2)
    const certRes = await request(app)
      .patch('/api/users/usr-stu-kabir')
      .set('x-demo-user-id', 'usr-adm-meera')
      .send({ certifications: ['LAB_SAFETY_101', 'GPU_CLUSTER_AUTH', 'ESD_PROTECTION'] });
    expect(certRes.status).toBe(200);

    const startIso = nextWeekdayIso(10, 0, 5);
    const endIso = nextWeekdayIso(12, 0, 5);

    const reqA = await request(app)
      .post('/api/bookings')
      .set('x-demo-user-id', 'usr-stu-aarav')
      .send({
        equipmentId: 'eq-fpga-kintex',
        projectTitle: 'FPGA Bench One DSP Pipeline',
        projectSummary: 'Testing real-time Kalman DSP implementation on Kintex-7 bench 1.',
        requiredCapabilities: ['verilog-synthesis', 'hardware-dsp'],
        justification: 'Requires Kintex-7 hardware DSP slices.',
        requestedStart: startIso,
        requestedEnd: endIso,
        projectDeadline: nextWeekdayIso(18, 0, 7),
      });
    const reqB = await request(app)
      .post('/api/bookings')
      .set('x-demo-user-id', 'usr-stu-diya')
      .send({
        equipmentId: 'eq-fpga-kintex',
        projectTitle: 'FPGA Bench Two SerDes Telemetry',
        projectSummary: 'Testing GTX 12.5 Gbps SerDes link integrity on Kintex-7 bench 2.',
        requiredCapabilities: ['high-speed-serdes'],
        justification: 'Needs high-speed GTX transceiver bench.',
        requestedStart: startIso,
        requestedEnd: endIso,
        projectDeadline: nextWeekdayIso(18, 0, 10),
      });
    const reqC = await request(app)
      .post('/api/bookings')
      .set('x-demo-user-id', 'usr-stu-kabir')
      .send({
        equipmentId: 'eq-fpga-kintex',
        projectTitle: 'FPGA Overflow Inference Core',
        projectSummary: 'Synthesizing quantized inference accelerator on Kintex-7 FPGA.',
        requiredCapabilities: ['verilog-synthesis'],
        justification: 'Needs Kintex-7 bitstream synthesis verification.',
        requestedStart: startIso,
        requestedEnd: endIso,
        projectDeadline: nextWeekdayIso(18, 0, 14),
      });

    expect(reqA.status).toBe(201);
    expect(reqB.status).toBe(201);
    expect(reqC.status).toBe(201);

    // Approve first two overlapping bookings sequentially -> Bench #1 and Bench #2 assigned
    const decA = await request(app)
      .post(`/api/bookings/${reqA.body.booking.id}/decision`)
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({ decision: 'APPROVE', reason: 'Bench 1 approved.', isOverride: false });
    expect(decA.status).toBe(200);
    expect(decA.body.reservation.benchNumber).toBe(1);

    const decB = await request(app)
      .post(`/api/bookings/${reqB.body.booking.id}/decision`)
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({ decision: 'APPROVE', reason: 'Bench 2 approved.', isOverride: false });
    expect(decB.status).toBe(200);
    expect(decB.body.reservation.benchNumber).toBe(2);

    // 3rd overlapping approval exceeds capacity=2 -> 409 Conflict
    const decC = await request(app)
      .post(`/api/bookings/${reqC.body.booking.id}/decision`)
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({ decision: 'APPROVE', reason: 'Attempt 3rd bench.', isOverride: false });
    expect(decC.status).toBe(409);
  });

  it('handles staggered overlapping intervals on capacity = 2 and enforces atomic Promise.all race', async () => {
    const { app } = await setupTestApp('demo');

    await request(app)
      .patch('/api/users/usr-stu-kabir')
      .set('x-demo-user-id', 'usr-adm-meera')
      .send({ certifications: ['LAB_SAFETY_101', 'GPU_CLUSTER_AUTH', 'ESD_PROTECTION'] });

    // 10-12, 11-13, 12-14 all fit within capacity=2 (peak 2 during 11-12 and 12-13, handoff at 12:00)
    const b10_12 = await request(app)
      .post('/api/bookings')
      .set('x-demo-user-id', 'usr-stu-aarav')
      .send({
        equipmentId: 'eq-fpga-kintex',
        projectTitle: 'Staggered FPGA 10-12',
        projectSummary: 'Staggered window 10:00-12:00 IST verification pass.',
        requiredCapabilities: ['verilog-synthesis'],
        justification: 'Capstone FPGA synthesis verification.',
        requestedStart: nextWeekdayIso(10, 0, 6),
        requestedEnd: nextWeekdayIso(12, 0, 6),
        projectDeadline: nextWeekdayIso(18, 0, 8),
      });
    const b11_13 = await request(app)
      .post('/api/bookings')
      .set('x-demo-user-id', 'usr-stu-diya')
      .send({
        equipmentId: 'eq-fpga-kintex',
        projectTitle: 'Staggered FPGA 11-13',
        projectSummary: 'Staggered window 11:00-13:00 IST verification pass.',
        requiredCapabilities: ['high-speed-serdes'],
        justification: 'SerDes eye characterization.',
        requestedStart: nextWeekdayIso(11, 0, 6),
        requestedEnd: nextWeekdayIso(13, 0, 6),
        projectDeadline: nextWeekdayIso(18, 0, 9),
      });
    const b12_14 = await request(app)
      .post('/api/bookings')
      .set('x-demo-user-id', 'usr-stu-kabir')
      .send({
        equipmentId: 'eq-fpga-kintex',
        projectTitle: 'Staggered FPGA 12-14',
        projectSummary: 'Staggered window 12:00-14:00 IST handoff on Bench 1.',
        requiredCapabilities: ['hardware-dsp'],
        justification: 'DSP pipeline benchmark.',
        requestedStart: nextWeekdayIso(12, 0, 6),
        requestedEnd: nextWeekdayIso(14, 0, 6),
        projectDeadline: nextWeekdayIso(18, 0, 10),
      });
    const b11_12_peak = await request(app)
      .post('/api/bookings')
      .set('x-demo-user-id', 'usr-stu-aarav')
      .send({
        equipmentId: 'eq-fpga-kintex',
        projectTitle: 'Staggered Peak Overflow 11-12',
        projectSummary: 'Fourth overlapping request during 11:00-12:00 IST peak.',
        requiredCapabilities: ['pcie-gen2'],
        justification: 'PCIe endpoint verification.',
        requestedStart: nextWeekdayIso(11, 0, 6),
        requestedEnd: nextWeekdayIso(12, 0, 6),
        projectDeadline: nextWeekdayIso(18, 0, 11),
      });

    const d1 = await request(app)
      .post(`/api/bookings/${b10_12.body.booking.id}/decision`)
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({ decision: 'APPROVE', reason: 'Approve 10-12', isOverride: false });
    const d2 = await request(app)
      .post(`/api/bookings/${b11_13.body.booking.id}/decision`)
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({
        decision: 'APPROVE',
        reason: 'Approve 11-13',
        isOverride: true,
        overrideReasonCode: 'CAPSTONE_DEMO_DEADLINE',
        overrideJustification: 'Staggered lab bench allocation for parallel demo.',
      });
    const d3 = await request(app)
      .post(`/api/bookings/${b12_14.body.booking.id}/decision`)
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({ decision: 'APPROVE', reason: 'Approve 12-14 handoff on bench 1', isOverride: false });
    const d4 = await request(app)
      .post(`/api/bookings/${b11_12_peak.body.booking.id}/decision`)
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({
        decision: 'APPROVE',
        reason: 'Attempt 4th during 11-12 peak',
        isOverride: true,
        overrideReasonCode: 'FACULTY_RESEARCH_GRANT',
        overrideJustification: 'Testing peak concurrency rejection above capacity.',
      });

    expect(d1.status).toBe(200);
    expect(d1.body.reservation.benchNumber).toBe(1);
    expect(d2.status).toBe(200);
    expect(d2.body.reservation.benchNumber).toBe(2);
    expect(d3.status).toBe(200);
    expect(d3.body.reservation.benchNumber).toBe(1);
    expect(d4.status).toBe(409);

    // Concurrent Promise.all race: 3 parallel approvals on capacity=2 day -> [200, 200, 409]
    const raceStart = nextWeekdayIso(14, 0, 7);
    const raceEnd = nextWeekdayIso(16, 0, 7);
    const [rA, rB, rC] = await Promise.all([
      request(app)
        .post('/api/bookings')
        .set('x-demo-user-id', 'usr-stu-aarav')
        .send({
          equipmentId: 'eq-fpga-kintex',
          projectTitle: 'Race FPGA Alpha',
          projectSummary: 'Concurrent race test A on Kintex-7 FPGA.',
          requiredCapabilities: ['verilog-synthesis'],
          justification: 'Concurrent capacity test.',
          requestedStart: raceStart,
          requestedEnd: raceEnd,
          projectDeadline: nextWeekdayIso(18, 0, 12),
        }),
      request(app)
        .post('/api/bookings')
        .set('x-demo-user-id', 'usr-stu-diya')
        .send({
          equipmentId: 'eq-fpga-kintex',
          projectTitle: 'Race FPGA Beta',
          projectSummary: 'Concurrent race test B on Kintex-7 FPGA.',
          requiredCapabilities: ['high-speed-serdes'],
          justification: 'Concurrent capacity test.',
          requestedStart: raceStart,
          requestedEnd: raceEnd,
          projectDeadline: nextWeekdayIso(18, 0, 12),
        }),
      request(app)
        .post('/api/bookings')
        .set('x-demo-user-id', 'usr-stu-kabir')
        .send({
          equipmentId: 'eq-fpga-kintex',
          projectTitle: 'Race FPGA Gamma',
          projectSummary: 'Concurrent race test C on Kintex-7 FPGA.',
          requiredCapabilities: ['hardware-dsp'],
          justification: 'Concurrent capacity test.',
          requestedStart: raceStart,
          requestedEnd: raceEnd,
          projectDeadline: nextWeekdayIso(18, 0, 12),
        }),
    ]);

    const raceDecisions = await Promise.all([
      request(app)
        .post(`/api/bookings/${rA.body.booking.id}/decision`)
        .set('x-demo-user-id', 'usr-fac-ananya')
        .send({
          decision: 'APPROVE',
          reason: 'Concurrent race approval A',
          isOverride: true,
          overrideReasonCode: 'CAPSTONE_DEMO_DEADLINE',
          overrideJustification: 'Parallel bench race verification.',
        }),
      request(app)
        .post(`/api/bookings/${rB.body.booking.id}/decision`)
        .set('x-demo-user-id', 'usr-fac-ananya')
        .send({
          decision: 'APPROVE',
          reason: 'Concurrent race approval B',
          isOverride: true,
          overrideReasonCode: 'CAPSTONE_DEMO_DEADLINE',
          overrideJustification: 'Parallel bench race verification.',
        }),
      request(app)
        .post(`/api/bookings/${rC.body.booking.id}/decision`)
        .set('x-demo-user-id', 'usr-fac-ananya')
        .send({
          decision: 'APPROVE',
          reason: 'Concurrent race approval C',
          isOverride: true,
          overrideReasonCode: 'CAPSTONE_DEMO_DEADLINE',
          overrideJustification: 'Parallel bench race verification.',
        }),
    ]);

    expect(raceDecisions.map((d) => d.status).sort()).toEqual([200, 200, 409]);
  });

  it('sweeps overdue NO_SHOWs idempotently, preserves shared bench locks, protects CHECKED_OUT/RETURNED, and enforces cron RBAC', async () => {
    const { app, repo } = await setupTestApp('demo');

    // Unauthorized student cannot run sweep or mark no-show
    const stuSweep = await request(app)
      .post('/api/reservations/sweep-no-shows')
      .set('x-demo-user-id', 'usr-stu-aarav')
      .send({});
    expect(stuSweep.status).toBe(403);

    // Book 2 concurrent reservations on capacity=2 eq-fpga-kintex (day+4 10:00-12:00)
    const slotStart = nextWeekdayIso(10, 0, 4);
    const slotEnd = nextWeekdayIso(12, 0, 4);

    const b1 = await request(app)
      .post('/api/bookings')
      .set('x-demo-user-id', 'usr-stu-aarav')
      .send({
        equipmentId: 'eq-fpga-kintex',
        projectTitle: 'NoShow Bench 1 Check-In',
        projectSummary: 'Will check out before sweep so it must be protected.',
        requiredCapabilities: ['verilog-synthesis'],
        justification: 'Testing CHECKED_OUT protection during NO_SHOW sweep.',
        requestedStart: slotStart,
        requestedEnd: slotEnd,
        projectDeadline: nextWeekdayIso(18, 0, 10),
      });
    const b2 = await request(app)
      .post('/api/bookings')
      .set('x-demo-user-id', 'usr-stu-diya')
      .send({
        equipmentId: 'eq-fpga-kintex',
        projectTitle: 'NoShow Bench 2 Overdue',
        projectSummary: 'Remains CONFIRMED and never checked out past grace period.',
        requiredCapabilities: ['high-speed-serdes'],
        justification: 'Testing shared bucket lock cleanup on NO_SHOW.',
        requestedStart: slotStart,
        requestedEnd: slotEnd,
        projectDeadline: nextWeekdayIso(18, 0, 10),
      });

    const app1 = await request(app)
      .post(`/api/bookings/${b1.body.booking.id}/decision`)
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({ decision: 'APPROVE', reason: 'Bench 1 approved.', isOverride: false });
    const app2 = await request(app)
      .post(`/api/bookings/${b2.body.booking.id}/decision`)
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({ decision: 'APPROVE', reason: 'Bench 2 approved.', isOverride: false });

    const res1Id = app1.body.reservation.id;
    const res2Id = app2.body.reservation.id;

    // Check out res1 -> must NEVER be marked NO_SHOW even far past grace
    await request(app)
      .post(`/api/reservations/${res1Id}/checkout`)
      .set('x-demo-user-id', 'usr-fac-ananya');

    // Manual mark NO_SHOW on CHECKED_OUT reservation -> 400
    const futureNowIso = new Date(Date.parse(slotStart) + 35 * 60_000).toISOString();
    const markCheckedOut = await request(app)
      .post(`/api/reservations/${res1Id}/no-show`)
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({ nowIso: futureNowIso });
    expect(markCheckedOut.status).toBe(400);

    // Concurrent & repeated NO_SHOW sweeps after grace window -> res2 released once, res1 protected
    const [s1, s2] = await Promise.all([
      request(app)
        .post('/api/reservations/sweep-no-shows')
        .set('x-demo-user-id', 'usr-fac-ananya')
        .send({ nowIso: futureNowIso }),
      request(app)
        .post('/api/reservations/sweep-no-shows')
        .set('x-demo-user-id', 'usr-fac-ananya')
        .send({ nowIso: futureNowIso }),
    ]);
    expect(s1.status).toBe(200);
    expect(s2.status).toBe(200);
    expect(s1.body.releasedCount + s2.body.releasedCount).toBeGreaterThanOrEqual(1);

    const res1After = await repo.getReservationById(res1Id);
    const res2After = await repo.getReservationById(res2Id);
    expect(res1After?.lifecycleStatus).toBe('CHECKED_OUT');
    expect(res2After?.lifecycleStatus).toBe('NO_SHOW');
    expect(res2After?.noShowMarkedAt).toBeTruthy();

    // Only ONE AUTO_RELEASE_NO_SHOW audit entry for res2
    const logs = await repo.listAuditLogs();
    const res2AutoLogs = logs.filter(
      (l) => l.action === 'AUTO_RELEASE_NO_SHOW' && l.targetEntityId === res2Id
    );
    expect(res2AutoLogs).toHaveLength(1);

    // Slot locks for eq-fpga-kintex still retain res1Id and removed res2Id
    const locks = await repo.listSlotLocks('eq-fpga-kintex');
    expect(locks.length).toBeGreaterThan(0);
    for (const lock of locks) {
      expect(lock.activeReservationIds).toContain(res1Id);
      expect(lock.activeReservationIds).not.toContain(res2Id);
    }

    // Returning res1 deletes empty slot_locks cleanly
    await request(app)
      .post(`/api/reservations/${res1Id}/return`)
      .set('x-demo-user-id', 'usr-fac-ananya');
    const locksAfterReturn = await repo.listSlotLocks('eq-fpga-kintex');
    expect(locksAfterReturn).toHaveLength(0);

    // RETURNED reservation cannot be marked NO_SHOW either
    const markReturned = await request(app)
      .post(`/api/reservations/${res1Id}/no-show`)
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({ nowIso: futureNowIso });
    expect(markReturned.status).toBe(400);
  });

  it('enforces Equipment Onboarding RBAC, duplicate assetTag 409 conflict, and validation', async () => {
    const { app } = await setupTestApp('demo');

    const validPayload = {
      assetTag: 'ECE-NEW-88',
      name: 'Keysight MSOX3024T Mixed-Signal Scope',
      category: 'Oscilloscopes',
      departmentId: 'dept-ece',
      labRoom: 'A-112 High-Speed Lab',
      description: '4-channel 200 MHz mixed-signal oscilloscope for embedded debug.',
      specs: { Bandwidth: '200 MHz', Channels: '4 + 16 Digital' },
      capabilities: ['protocol-decode', 'mixed-signal-logic'],
      requiredCertifications: ['LAB_SAFETY_101'],
      maxBookingHours: 4,
      operatingHours: { startHour: 8, endHour: 20, daysOfWeek: [1, 2, 3, 4, 5] },
      status: 'AVAILABLE',
      capacity: 2,
      imageUrl: '/src/assets/images/equip_oscilloscope_1795420979264.jpg',
    };

    // Student forbidden -> 403
    const stuAttempt = await request(app)
      .post('/api/equipment')
      .set('x-demo-user-id', 'usr-stu-aarav')
      .send(validPayload);
    expect(stuAttempt.status).toBe(403);

    // Invalid external imageUrl -> 400
    const badImg = await request(app)
      .post('/api/equipment')
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({ ...validPayload, imageUrl: 'https://example.com/hack.jpg' });
    expect(badImg.status).toBe(400);

    // Faculty creates equipment -> 201
    const facCreate = await request(app)
      .post('/api/equipment')
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send(validPayload);
    expect(facCreate.status).toBe(201);
    expect(facCreate.body.equipment.assetTag).toBe('ECE-NEW-88');
    expect(facCreate.body.equipment.capacity).toBe(2);

    // Discoverable in catalog API
    const catalog = await request(app)
      .get('/api/equipment')
      .set('x-demo-user-id', 'usr-stu-aarav');
    expect(catalog.status).toBe(200);
    expect(catalog.body.equipment.some((e: { assetTag: string }) => e.assetTag === 'ECE-NEW-88')).toBe(
      true
    );

    // Duplicate assetTag (even lowercase) -> 409 Conflict
    const dupCreate = await request(app)
      .post('/api/equipment')
      .set('x-demo-user-id', 'usr-adm-meera')
      .send({ ...validPayload, assetTag: 'ece-new-88', name: 'Duplicate Tag Scope' });
    expect(dupCreate.status).toBe(409);

    // Admin can onboard distinct asset -> 201
    const admCreate = await request(app)
      .post('/api/equipment')
      .set('x-demo-user-id', 'usr-adm-meera')
      .send({ ...validPayload, assetTag: 'CSAI-NEW-99', name: 'NVIDIA DGX Spark Node' });
    expect(admCreate.status).toBe(201);
  });

  it('authorizes x-lablink-cron-secret on sweep-no-shows, frees bench for re-booking after manual NO_SHOW, and excludes NO_SHOW from live analytics', async () => {
    const { app, repo } = await setupTestApp('production', {
      internalSweepSecret: 'wave1-cron-secret-token',
    });

    // Missing or invalid cron secret without session -> 401
    const badCron = await request(app)
      .post('/api/reservations/sweep-no-shows')
      .set('x-lablink-cron-secret', 'wrong-secret')
      .send({});
    expect(badCron.status).toBe(401);

    // Valid cron secret succeeds even in production mode without user session
    const goodCron = await request(app)
      .post('/api/reservations/sweep-no-shows')
      .set('x-lablink-cron-secret', 'wave1-cron-secret-token')
      .send({});
    expect(goodCron.status).toBe(200);
    expect(goodCron.body.releasedCount).toBe(0);

    // Now verify manual NO_SHOW frees Bench #1 on eq-polymax-3d (capacity=1) and excludes hours from /api/analytics + /api/public/overview
    const { app: demoApp } = await setupTestApp('demo');
    const baselineAnalytics = await request(demoApp)
      .get('/api/analytics')
      .set('x-demo-user-id', 'usr-fac-ananya');
    const baselineOverview = await request(demoApp).get('/api/public/overview');
    const baselineBookedHours = baselineAnalytics.body.analytics.departmentUtilization.reduce(
      (s: number, d: { bookedHours: number }) => s + d.bookedHours,
      0
    );
    const baselineTotalRes = baselineAnalytics.body.analytics.totalReservations;
    const baselinePublicRes = baselineOverview.body.totalBookingsCompletedOrActive;

    const slotStart = nextWeekdayIso(9, 0, 5);
    const slotEnd = nextWeekdayIso(11, 0, 5);

    const b1 = await request(demoApp)
      .post('/api/bookings')
      .set('x-demo-user-id', 'usr-stu-aarav')
      .send({
        equipmentId: 'eq-polymax-3d',
        projectTitle: 'NoShow Bench Release Alpha',
        projectSummary: 'Reserved for 2h then marked NO_SHOW so Diya can re-book Bench 1.',
        requiredCapabilities: ['multi-material'],
        justification: 'Testing NO_SHOW bench release and analytics exclusion.',
        requestedStart: slotStart,
        requestedEnd: slotEnd,
        projectDeadline: nextWeekdayIso(18, 0, 12),
      });
    const b2 = await request(demoApp)
      .post('/api/bookings')
      .set('x-demo-user-id', 'usr-stu-diya')
      .send({
        equipmentId: 'eq-polymax-3d',
        projectTitle: 'Rebook After NoShow Beta',
        projectSummary: 'Waiting to take Bench #1 once Aarav is marked NO_SHOW.',
        requiredCapabilities: ['multi-material'],
        justification: 'Needs freed Bench #1 slot.',
        requestedStart: slotStart,
        requestedEnd: slotEnd,
        projectDeadline: nextWeekdayIso(18, 0, 14),
      });

    const app1 = await request(demoApp)
      .post(`/api/bookings/${b1.body.booking.id}/decision`)
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({ decision: 'APPROVE', reason: 'Approve Aarav initially.', isOverride: false });
    expect(app1.status).toBe(200);
    expect(app1.body.reservation.benchNumber).toBe(1);

    // Confirm analytics incremented by 2h while CONFIRMED
    const midAnalytics = await request(demoApp)
      .get('/api/analytics')
      .set('x-demo-user-id', 'usr-fac-ananya');
    const midBookedHours = midAnalytics.body.analytics.departmentUtilization.reduce(
      (s: number, d: { bookedHours: number }) => s + d.bookedHours,
      0
    );
    expect(midBookedHours).toBeCloseTo(baselineBookedHours + 2, 1);

    // Mark res1 manually as NO_SHOW after grace window
    const overdueNowIso = new Date(Date.parse(slotStart) + 25 * 60_000).toISOString();
    const markRes = await request(demoApp)
      .post(`/api/reservations/${app1.body.reservation.id}/no-show`)
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({ reason: 'Student failed to arrive within grace window.', nowIso: overdueNowIso });
    expect(markRes.status).toBe(200);
    expect(markRes.body.reservation.lifecycleStatus).toBe('NO_SHOW');

    // Verify /api/analytics and /api/public/overview revert back to baseline (NO_SHOW excluded)
    const afterNoShowAnalytics = await request(demoApp)
      .get('/api/analytics')
      .set('x-demo-user-id', 'usr-fac-ananya');
    const afterNoShowOverview = await request(demoApp).get('/api/public/overview');
    const afterBookedHours = afterNoShowAnalytics.body.analytics.departmentUtilization.reduce(
      (s: number, d: { bookedHours: number }) => s + d.bookedHours,
      0
    );
    expect(afterBookedHours).toBeCloseTo(baselineBookedHours, 1);
    expect(afterNoShowAnalytics.body.analytics.totalReservations).toBe(baselineTotalRes);
    expect(afterNoShowOverview.body.totalBookingsCompletedOrActive).toBe(baselinePublicRes);

    // Re-book freed Bench #1 with Diya's request -> succeeds on Bench #1
    const rebookApp = await request(demoApp)
      .post(`/api/bookings/${b2.body.booking.id}/decision`)
      .set('x-demo-user-id', 'usr-fac-ananya')
      .send({
        decision: 'APPROVE',
        reason: 'Assigning freed Bench #1 after previous NO_SHOW release.',
        isOverride: true,
        overrideReasonCode: 'CAPSTONE_DEMO_DEADLINE',
        overrideJustification: 'Slot reopened after NO_SHOW auto/manual release.',
      });
    expect(rebookApp.status).toBe(200);
    expect(rebookApp.body.reservation.benchNumber).toBe(1);
    expect(repo).toBeDefined();
  });

  it('migrates a pre-Wave-1 SQLite schema idempotently without losing existing records', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lablink-mig-'));
    const dbPath = path.join(tmpDir, 'legacy.sqlite');

    // Create a pre-Wave-1 database missing equipment.description, reservations.benchNumber, reservations.noShowMarkedAt
    const rawDb = new Database(dbPath);
    rawDb.exec(`
      CREATE TABLE departments (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, building TEXT NOT NULL, contactEmail TEXT NOT NULL);
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL, departmentId TEXT NOT NULL, certifications TEXT NOT NULL, rolling30DayHoursUsed REAL NOT NULL DEFAULT 0, createdAt TEXT NOT NULL);
      CREATE TABLE equipment (id TEXT PRIMARY KEY, assetTag TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category TEXT NOT NULL, departmentId TEXT NOT NULL, labRoom TEXT NOT NULL, specs TEXT NOT NULL, capabilities TEXT NOT NULL, requiredCertifications TEXT NOT NULL, maxBookingHours REAL NOT NULL, operatingHours TEXT NOT NULL, status TEXT NOT NULL, capacity INTEGER NOT NULL DEFAULT 1, imageUrl TEXT NOT NULL);
      CREATE TABLE booking_requests (id TEXT PRIMARY KEY, studentId TEXT NOT NULL, equipmentId TEXT NOT NULL, projectTitle TEXT NOT NULL, projectSummary TEXT NOT NULL, requiredCapabilities TEXT NOT NULL, justification TEXT NOT NULL, requestedStart TEXT NOT NULL, requestedEnd TEXT NOT NULL, durationHours REAL NOT NULL, projectDeadline TEXT NOT NULL, status TEXT NOT NULL, originalCreatedAt TEXT NOT NULL, lastSubmittedAt TEXT NOT NULL, smartFairSnapshot TEXT, facultyDecisionReason TEXT, reviewedBy TEXT, createdAt TEXT NOT NULL);
      CREATE TABLE reservations (id TEXT PRIMARY KEY, requestId TEXT NOT NULL, equipmentId TEXT NOT NULL, studentId TEXT NOT NULL, startTime TEXT NOT NULL, endTime TEXT NOT NULL, lifecycleStatus TEXT NOT NULL, checkedOutAt TEXT, returnedAt TEXT);
      CREATE TABLE maintenance_windows (id TEXT PRIMARY KEY, equipmentId TEXT NOT NULL, startTime TEXT NOT NULL, endTime TEXT NOT NULL, reason TEXT NOT NULL, createdBy TEXT NOT NULL);
      CREATE TABLE slot_locks (id TEXT PRIMARY KEY, equipmentId TEXT NOT NULL, bucketKey TEXT NOT NULL, activeReservationIds TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE TABLE audit_logs (id TEXT PRIMARY KEY, actorId TEXT NOT NULL, actorRole TEXT NOT NULL, action TEXT NOT NULL, targetEntityId TEXT NOT NULL, metadata TEXT NOT NULL, timestamp TEXT NOT NULL);

      INSERT INTO departments VALUES ('dept-1', 'ECE', 'Electronics', 'Block A', 'ece@campus.edu');
      INSERT INTO users VALUES ('u-1', 'stu@campus.edu', 'Student One', 'STUDENT', 'dept-1', '["LAB_SAFETY_101"]', 2.0, '2026-01-01T00:00:00Z');
      INSERT INTO equipment VALUES ('eq-1', 'ECE-1', 'Legacy Scope', 'Oscilloscopes', 'dept-1', 'A-101', '{}', '["protocol-decode"]', '["LAB_SAFETY_101"]', 4, '{"startHour":8,"endHour":20,"daysOfWeek":[1,2,3,4,5]}', 'AVAILABLE', 1, '/src/assets/images/equip_oscilloscope_1795420979264.jpg');
      INSERT INTO reservations VALUES ('res-legacy', 'req-legacy', 'eq-1', 'u-1', '2026-11-25T04:30:00Z', '2026-11-25T06:30:00Z', 'CONFIRMED', NULL, NULL);
    `);
    rawDb.close();

    try {
      const migratedRepo = new SqliteRepository(dbPath, 'Asia/Kolkata');
      await migratedRepo.init();
      await migratedRepo.init(); // idempotent second call

      const eq = await migratedRepo.getEquipmentById('eq-1');
      const res = await migratedRepo.getReservationById('res-legacy');
      expect(eq?.description).toBe('');
      expect(res?.benchNumber).toBe(1);
      expect(res?.noShowMarkedAt).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});


