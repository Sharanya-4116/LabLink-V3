import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import { ZodError } from 'zod';
import {
  CreateBookingRequestSchema,
  CreateDepartmentSchema,
  CreateEquipmentSchema,
  CreateMaintenanceWindowSchema,
  FacultyDecisionSchema,
  MarkNoShowSchema,
  RescheduleBookingRequestSchema,
  SweepNoShowsSchema,
  UpdateEquipmentSchema,
  UpdateUserSchema,
} from '../shared/schemas.ts';
import {
  evaluateBookingRequest,
  findAlternativeSlots,
  rankCompetingRequests,
} from '../shared/smartfair.ts';
import { buildIcsCalendarInvite, intervalsOverlap, toEpochMs } from '../shared/timezone.ts';
import type { BookingRequest, User } from '../shared/types.ts';
import { computeAnalyticsSummary, computePublicOverview } from './analytics.ts';
import type { ServerConfig } from './config.ts';
import { AppError, ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from './errors.ts';
import {
  createRequireAuth,
  requireRole,
  resolveRequestUser,
  type AuthenticatedRequest,
} from './middleware/auth.ts';
import type { IDataRepository } from './repositories/IDataRepository.ts';

function extractClientIp(req: express.Request): string {
  const forwarded = req.headers.forwarded;
  const headerVal = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof headerVal === 'string') {
    const match = headerVal.match(/for="?(\[[^\]]+\]|[^;,\s"]+)"?/i);
    if (match?.[1]) {
      let addr = match[1];
      if (addr.startsWith('[')) {
        const endBracket = addr.indexOf(']');
        if (endBracket !== -1) addr = addr.slice(1, endBracket);
      } else if (addr.includes(':') && !addr.includes('::')) {
        // IPv4 with port (e.g. 203.0.113.1:4321)
        addr = addr.split(':')[0];
      }
      if (addr) return addr;
    }
  }
  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

export function createApiApp(repo: IDataRepository, config: ServerConfig): express.Express {
  const app = express();

  // Trust single reverse proxy hop (Cloud Run / AI Studio ingress) for accurate client IP & rate limiting
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: config.nodeEnv === 'production' ? undefined : false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(express.json({ limit: '1mb' }));

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(extractClientIp(req)),
  });
  app.use('/api', apiLimiter);

  const requireAuth = createRequireAuth(repo, config);

  // Health Check
  app.get('/api/healthz', (_req, res) => {
    res.json({
      status: 'ok',
      appMode: config.appMode,
      allowDemoRoleSwitch: config.allowDemoRoleSwitch,
      persistenceDriver: config.persistenceDriver,
      campusTimezone: config.campusTimezone,
      noShowGraceMinutes: config.noShowGraceMinutes,
      timestamp: new Date().toISOString(),
    });
  });

  // Public Overview for Landing Page (all metrics computed from live DB)
  app.get('/api/public/overview', async (_req, res, next) => {
    try {
      const [equipment, departments, bookingRequests, reservations, users, maintenanceWindows] =
        await Promise.all([
          repo.listEquipment(),
          repo.listDepartments(),
          repo.listBookingRequests(),
          repo.listReservations(),
          repo.listUsers(),
          repo.listMaintenanceWindows(),
        ]);
      res.json(
        computePublicOverview({
          equipment,
          departments,
          bookingRequests,
          reservations,
          users,
          maintenanceWindows,
          timezone: config.campusTimezone,
        })
      );
    } catch (err) {
      next(err);
    }
  });

  // Session & Demo Directory Discovery
  app.get('/api/auth/session', async (req, res, next) => {
    try {
      const user = await resolveRequestUser(req, repo, config);
      const demoUsers =
        config.appMode === 'demo' && config.allowDemoRoleSwitch ? await repo.listUsers() : [];
      res.json({
        appMode: config.appMode,
        allowDemoRoleSwitch: config.allowDemoRoleSwitch,
        campusTimezone: config.campusTimezone,
        noShowGraceMinutes: config.noShowGraceMinutes,
        user,
        demoUsers,
      });
    } catch (err) {
      next(err);
    }
  });

  // Departments (Read requires auth; Create requires ADMIN)
  app.get('/api/departments', requireAuth, async (_req, res, next) => {
    try {
      const departments = await repo.listDepartments();
      res.json({ departments });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/departments', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
    try {
      const parsed = CreateDepartmentSchema.parse(req.body);
      const department = await repo.createDepartment(parsed);
      res.status(201).json({ department });
    } catch (err) {
      next(err);
    }
  });

  // Equipment Catalog & Schedule
  app.get('/api/equipment', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const allEquipment = await repo.listEquipment();
      const { departmentId, category, status, search, certifiedOnly } = req.query;

      const filtered = allEquipment.filter((eq) => {
        if (typeof departmentId === 'string' && departmentId && eq.departmentId !== departmentId) {
          return false;
        }
        if (typeof category === 'string' && category && eq.category !== category) {
          return false;
        }
        if (typeof status === 'string' && status && eq.status !== status) {
          return false;
        }
        if (certifiedOnly === 'true' && req.user) {
          const hasAll = eq.requiredCertifications.every((c: string) =>
            req.user!.certifications.includes(c)
          );
          if (!hasAll) return false;
        }
        if (typeof search === 'string' && search.trim().length > 0) {
          const q = search.trim().toLowerCase();
          const haystack = [
            eq.name,
            eq.assetTag,
            eq.category,
            eq.labRoom,
            ...eq.capabilities,
            ...Object.values(eq.specs),
          ]
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });

      res.json({ equipment: filtered });
    } catch (err) {
      next(err);
    }
  });

  app.post(
    '/api/equipment',
    requireAuth,
    requireRole('FACULTY', 'ADMIN'),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const parsed = CreateEquipmentSchema.parse(req.body);
        const equipment = await repo.createEquipment(parsed, req.user!);
        res.status(201).json({ equipment });
      } catch (err) {
        next(err);
      }
    }
  );

  app.patch(
    '/api/equipment/:id',
    requireAuth,
    requireRole('FACULTY', 'ADMIN'),
    async (req, res, next) => {
      try {
        const parsed = UpdateEquipmentSchema.parse(req.body);
        const equipment = await repo.updateEquipment(String(req.params.id), parsed);
        res.json({ equipment });
      } catch (err) {
        next(err);
      }
    }
  );

  app.get('/api/equipment/:id/schedule', requireAuth, async (req, res, next) => {
    try {
      const equipId = String(req.params.id);
      const equipment = await repo.getEquipmentById(equipId);
      if (!equipment) throw new NotFoundError('Equipment not found');

      const [allRes, allMaint, slotLocks] = await Promise.all([
        repo.listReservations(),
        repo.listMaintenanceWindows(),
        repo.listSlotLocks(equipId),
      ]);

      const activeReservations = allRes.filter(
        (r) =>
          r.equipmentId === equipId &&
          (r.lifecycleStatus === 'CONFIRMED' || r.lifecycleStatus === 'CHECKED_OUT')
      );
      const maintenanceWindows = allMaint.filter((m) => m.equipmentId === equipId);

      let alternativeSlots: ReturnType<typeof findAlternativeSlots> = [];
      const reqStart = typeof req.query.requestedStart === 'string' ? req.query.requestedStart : '';
      const durationHours = Number(req.query.durationHours) || 2;
      if (reqStart && !Number.isNaN(Date.parse(reqStart))) {
        alternativeSlots = findAlternativeSlots({
          equipment,
          requestedStart: reqStart,
          durationHours,
          activeReservations,
          maintenanceWindows,
          timezone: config.campusTimezone,
        });
      }

      res.json({
        equipment,
        reservations: activeReservations,
        maintenanceWindows,
        slotLocks,
        alternativeSlots,
      });
    } catch (err) {
      next(err);
    }
  });

  // Booking Requests + Live SmartFair Ranking
  app.get('/api/bookings', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const [allRequests, equipmentList, usersList, reservations, maintenanceWindows] =
        await Promise.all([
          repo.listBookingRequests(),
          repo.listEquipment(),
          repo.listUsers(),
          repo.listReservations(),
          repo.listMaintenanceWindows(),
        ]);

      const equipById = new Map(equipmentList.map((e) => [e.id, e]));
      const usersById = new Map(usersList.map((u) => [u.id, u]));

      // Compute live SmartFair evaluations and conflict rankings across active PENDING/CONFLICT_REVIEW requests per equipment
      const activeByEquip = new Map<string, BookingRequest[]>();
      for (const b of allRequests) {
        if (b.status === 'PENDING' || b.status === 'CONFLICT_REVIEW') {
          const arr = activeByEquip.get(b.equipmentId) ?? [];
          arr.push(b);
          activeByEquip.set(b.equipmentId, arr);
        }
      }

      const liveEvalById = new Map<string, ReturnType<typeof evaluateBookingRequest>>();
      for (const [equipId, equipRequests] of activeByEquip.entries()) {
        const equipment = equipById.get(equipId);
        if (!equipment) continue;

        const ranked = rankCompetingRequests(equipRequests, {
          equipment,
          usersById,
          activeReservations: reservations.filter((r) => r.equipmentId === equipId),
          maintenanceWindows: maintenanceWindows.filter((m) => m.equipmentId === equipId),
          timezone: config.campusTimezone,
        });

        // Scope recommendationRank accurately per overlapping cluster
        for (const entry of ranked) {
          const overlappingRanked = ranked.filter(
            (other) =>
              other.request.id === entry.request.id ||
              intervalsOverlap(
                toEpochMs(entry.request.requestedStart),
                toEpochMs(entry.request.requestedEnd),
                toEpochMs(other.request.requestedStart),
                toEpochMs(other.request.requestedEnd)
              )
          );
          const eligibleInCluster = overlappingRanked.filter((o) => o.evaluation.eligible);
          const clusterIdx = eligibleInCluster.findIndex(
            (o) => o.request.id === entry.request.id
          );
          entry.evaluation.recommendationRank = clusterIdx >= 0 ? clusterIdx + 1 : null;
          entry.evaluation.isTopRecommended = clusterIdx === 0;
          liveEvalById.set(entry.request.id, entry.evaluation);
        }
      }

      const enriched = allRequests.map((b) => ({
        ...b,
        smartFairSnapshot: liveEvalById.get(b.id) ?? b.smartFairSnapshot,
        studentName: usersById.get(b.studentId)?.name ?? 'Unknown Student',
        studentDepartmentId: usersById.get(b.studentId)?.departmentId ?? '',
        equipmentName: equipById.get(b.equipmentId)?.name ?? 'Unknown Equipment',
        equipmentDepartmentId: equipById.get(b.equipmentId)?.departmentId ?? '',
      }));

      // Role scoping: STUDENT sees own requests
      const visible =
        req.user?.role === 'STUDENT'
          ? enriched.filter((b) => b.studentId === req.user!.id)
          : enriched;

      res.json({ bookings: visible });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/bookings', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const parsed = CreateBookingRequestSchema.parse(req.body);
      const durationHours =
        (toEpochMs(parsed.requestedEnd) - toEpochMs(parsed.requestedStart)) / 3_600_000;

      const created = await repo.createBookingRequest(
        {
          studentId: req.user!.id,
          equipmentId: parsed.equipmentId,
          projectTitle: parsed.projectTitle,
          projectSummary: parsed.projectSummary,
          requiredCapabilities: parsed.requiredCapabilities,
          justification: parsed.justification,
          requestedStart: parsed.requestedStart,
          requestedEnd: parsed.requestedEnd,
          durationHours,
          projectDeadline: parsed.projectDeadline,
        },
        config.campusTimezone
      );

      res.status(201).json({ booking: created });
    } catch (err) {
      next(err);
    }
  });

  app.post(
    '/api/bookings/:id/reschedule',
    requireAuth,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const parsed = RescheduleBookingRequestSchema.parse(req.body);
        const updated = await repo.rescheduleBookingRequest(
          String(req.params.id),
          req.user!.id,
          parsed.requestedStart,
          parsed.requestedEnd,
          config.campusTimezone
        );
        res.json({ booking: updated });
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/bookings/:id/cancel',
    requireAuth,
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const updated = await repo.cancelBookingRequest(String(req.params.id), req.user!);
        res.json({ booking: updated });
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/bookings/:id/decision',
    requireAuth,
    requireRole('FACULTY', 'ADMIN'),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const parsed = FacultyDecisionSchema.parse(req.body);
        const result = await repo.processFacultyDecision({
          requestId: String(req.params.id),
          facultyUser: req.user!,
          decision: parsed.decision,
          reason: parsed.reason,
          isOverride: parsed.isOverride,
          overrideReasonCode: parsed.overrideReasonCode,
          overrideJustification: parsed.overrideJustification,
          campusTimezone: config.campusTimezone,
        });
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // Reservations & P2 Check-In/Out + ICS Export
  app.get('/api/reservations', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const [reservations, equipmentList, usersList, bookings] = await Promise.all([
        repo.listReservations(),
        repo.listEquipment(),
        repo.listUsers(),
        repo.listBookingRequests(),
      ]);

      const equipById = new Map(equipmentList.map((e) => [e.id, e]));
      const usersById = new Map(usersList.map((u) => [u.id, u]));
      const bookingById = new Map(bookings.map((b) => [b.id, b]));

      const enriched = reservations.map((r) => ({
        ...r,
        equipmentName: equipById.get(r.equipmentId)?.name ?? 'Equipment',
        labRoom: equipById.get(r.equipmentId)?.labRoom ?? '',
        studentName: usersById.get(r.studentId)?.name ?? 'Student',
        projectTitle: bookingById.get(r.requestId)?.projectTitle ?? 'Lab Session',
      }));

      const visible =
        req.user?.role === 'STUDENT'
          ? enriched.filter((r) => r.studentId === req.user!.id)
          : enriched;

      res.json({ reservations: visible });
    } catch (err) {
      next(err);
    }
  });

  app.post(
    '/api/reservations/:id/checkout',
    requireAuth,
    requireRole('FACULTY', 'ADMIN'),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const reservation = await repo.checkoutReservation(String(req.params.id), req.user!);
        res.json({ reservation });
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/reservations/:id/return',
    requireAuth,
    requireRole('FACULTY', 'ADMIN'),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const reservation = await repo.returnReservation(String(req.params.id), req.user!);
        res.json({ reservation });
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/reservations/sweep-no-shows',
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const cronHeader = req.headers['x-lablink-cron-secret'];
        const cronSecret = Array.isArray(cronHeader) ? cronHeader[0] : cronHeader;
        let actor: User | null = null;

        if (
          typeof cronSecret === 'string' &&
          cronSecret.length > 0 &&
          config.internalSweepSecret.length > 0 &&
          cronSecret === config.internalSweepSecret
        ) {
          actor = {
            id: 'system-cron-sweep',
            email: 'cron@lablink.internal',
            name: 'Scheduled No-Show Sweep',
            role: 'ADMIN',
            departmentId: 'dept-csai',
            certifications: [],
            rolling30DayHoursUsed: 0,
            createdAt: new Date(0).toISOString(),
          };
        } else {
          const resolved = await resolveRequestUser(req, repo, config);
          if (!resolved) {
            throw new UnauthorizedError('Authentication required to run no-show sweep.');
          }
          if (resolved.role !== 'FACULTY' && resolved.role !== 'ADMIN') {
            throw new ForbiddenError('Insufficient permissions for no-show sweep.');
          }
          actor = resolved;
        }

        const parsed = SweepNoShowsSchema.parse(req.body ?? {});
        const result = await repo.sweepNoShowReservations({
          actor,
          graceMinutes: config.noShowGraceMinutes,
          nowIso: parsed.nowIso,
        });
        res.json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  app.post(
    '/api/reservations/:id/no-show',
    requireAuth,
    requireRole('FACULTY', 'ADMIN'),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const parsed = MarkNoShowSchema.parse(req.body ?? {});
        const reservation = await repo.markReservationNoShow({
          reservationId: String(req.params.id),
          actor: req.user!,
          reason: parsed.reason,
          graceMinutes: config.noShowGraceMinutes,
          nowIso: parsed.nowIso,
        });
        res.json({ reservation });
      } catch (err) {
        next(err);
      }
    }
  );

  app.get('/api/reservations/:id/ics', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const reservation = await repo.getReservationById(String(req.params.id));
      if (!reservation) throw new NotFoundError('Reservation not found');
      if (req.user?.role === 'STUDENT' && reservation.studentId !== req.user.id) {
        throw new ValidationError('Cannot export another student reservation');
      }

      const [equipment, student, booking] = await Promise.all([
        repo.getEquipmentById(reservation.equipmentId),
        repo.getUserById(reservation.studentId),
        repo.getBookingRequestById(reservation.requestId),
      ]);

      const ics = buildIcsCalendarInvite({
        reservationId: reservation.id,
        equipmentName: equipment?.name ?? 'Lab Equipment',
        labRoom: equipment?.labRoom ?? 'Campus Laboratory',
        projectTitle: booking?.projectTitle ?? 'Laboratory Reservation',
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        studentEmail: student?.email ?? 'student@campus.edu',
      });

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="lablink-${reservation.id}.ics"`
      );
      res.send(ics);
    } catch (err) {
      next(err);
    }
  });

  // Maintenance Windows
  app.get('/api/maintenance', requireAuth, async (_req, res, next) => {
    try {
      const maintenanceWindows = await repo.listMaintenanceWindows();
      res.json({ maintenanceWindows });
    } catch (err) {
      next(err);
    }
  });

  app.post(
    '/api/maintenance',
    requireAuth,
    requireRole('FACULTY', 'ADMIN'),
    async (req: AuthenticatedRequest, res, next) => {
      try {
        const parsed = CreateMaintenanceWindowSchema.parse(req.body);
        const result = await repo.createMaintenanceWindow(
          {
            equipmentId: parsed.equipmentId,
            startTime: parsed.startTime,
            endTime: parsed.endTime,
            reason: parsed.reason,
            createdBy: req.user!.id,
          },
          req.user!,
          config.campusTimezone
        );
        res.status(201).json(result);
      } catch (err) {
        next(err);
      }
    }
  );

  // Analytics & Immutable Audit Logs
  app.get(
    '/api/analytics',
    requireAuth,
    requireRole('FACULTY', 'ADMIN'),
    async (_req, res, next) => {
      try {
        const [
          equipment,
          departments,
          bookingRequests,
          reservations,
          users,
          auditLogs,
          maintenanceWindows,
        ] = await Promise.all([
          repo.listEquipment(),
          repo.listDepartments(),
          repo.listBookingRequests(),
          repo.listReservations(),
          repo.listUsers(),
          repo.listAuditLogs(),
          repo.listMaintenanceWindows(),
        ]);

        res.json({
          analytics: computeAnalyticsSummary({
            equipment,
            departments,
            bookingRequests,
            reservations,
            users,
            auditLogs,
            maintenanceWindows,
            timezone: config.campusTimezone,
          }),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  app.get(
    '/api/audit-logs',
    requireAuth,
    requireRole('FACULTY', 'ADMIN'),
    async (_req, res, next) => {
      try {
        const [auditLogs, users] = await Promise.all([repo.listAuditLogs(), repo.listUsers()]);
        const userById = new Map(users.map((u) => [u.id, u]));
        res.json({
          auditLogs: auditLogs.map((a) => ({
            ...a,
            actorName: userById.get(a.actorId)?.name ?? a.actorId,
          })),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // Admin User Management
  app.get('/api/users', requireAuth, requireRole('ADMIN'), async (_req, res, next) => {
    try {
      const users = await repo.listUsers();
      res.json({ users });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/users/:id', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
    try {
      const parsed = UpdateUserSchema.parse(req.body);
      const user = await repo.updateUser(String(req.params.id), parsed);
      res.json({ user });
    } catch (err) {
      next(err);
    }
  });

  // Centralized Error Handler
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      if (err instanceof ZodError) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          issues: err.issues,
        });
        return;
      }

      if (err instanceof AppError) {
        res.status(err.statusCode).json({
          error: err.code,
          message: err.message,
          details: err.details,
        });
        return;
      }

      console.error('Unhandled server error:', err);
      res.status(500).json({
        error: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected server error occurred.',
      });
    }
  );

  return app;
}
