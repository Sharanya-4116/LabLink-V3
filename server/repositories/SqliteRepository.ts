import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { evaluateIntervalCapacity } from '../../shared/concurrency.ts';
import {
  evaluateBookingRequest,
  findAlternativeSlots,
  rankCompetingRequests,
} from '../../shared/smartfair.ts';
import {
  computeSlotBucketIds,
  intervalsOverlap,
  toEpochMs,
} from '../../shared/timezone.ts';
import type {
  AuditAction,
  AuditLog,
  BookingRequest,
  BookingStatus,
  Department,
  Equipment,
  MaintenanceWindow,
  Reservation,
  Role,
  SlotLock,
  User,
} from '../../shared/types.ts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../errors.ts';
import { buildSeedData } from '../seedData.ts';
import type {
  CreateBookingInput,
  FacultyDecisionInput,
  IDataRepository,
} from './IDataRepository.ts';

export class SqliteRepository implements IDataRepository {
  private db: Database.Database;
  private campusTimezone: string;

  constructor(dbPath: string, campusTimezone = 'Asia/Kolkata') {
    this.campusTimezone = campusTimezone;
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
  }

  async init(): Promise<void> {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        building TEXT NOT NULL,
        contactEmail TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        departmentId TEXT NOT NULL REFERENCES departments(id),
        certifications TEXT NOT NULL,
        rolling30DayHoursUsed REAL NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS equipment (
        id TEXT PRIMARY KEY,
        assetTag TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        departmentId TEXT NOT NULL REFERENCES departments(id),
        labRoom TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        specs TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        requiredCertifications TEXT NOT NULL,
        maxBookingHours REAL NOT NULL,
        operatingHours TEXT NOT NULL,
        status TEXT NOT NULL,
        capacity INTEGER NOT NULL DEFAULT 1,
        imageUrl TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS booking_requests (
        id TEXT PRIMARY KEY,
        studentId TEXT NOT NULL REFERENCES users(id),
        equipmentId TEXT NOT NULL REFERENCES equipment(id),
        projectTitle TEXT NOT NULL,
        projectSummary TEXT NOT NULL,
        requiredCapabilities TEXT NOT NULL,
        justification TEXT NOT NULL,
        requestedStart TEXT NOT NULL,
        requestedEnd TEXT NOT NULL,
        durationHours REAL NOT NULL,
        projectDeadline TEXT NOT NULL,
        status TEXT NOT NULL,
        originalCreatedAt TEXT NOT NULL,
        lastSubmittedAt TEXT NOT NULL,
        smartFairSnapshot TEXT,
        facultyDecisionReason TEXT,
        reviewedBy TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY,
        requestId TEXT NOT NULL,
        equipmentId TEXT NOT NULL REFERENCES equipment(id),
        studentId TEXT NOT NULL REFERENCES users(id),
        startTime TEXT NOT NULL,
        endTime TEXT NOT NULL,
        benchNumber INTEGER NOT NULL DEFAULT 1,
        lifecycleStatus TEXT NOT NULL,
        checkedOutAt TEXT,
        returnedAt TEXT,
        noShowMarkedAt TEXT
      );

      CREATE TABLE IF NOT EXISTS maintenance_windows (
        id TEXT PRIMARY KEY,
        equipmentId TEXT NOT NULL REFERENCES equipment(id),
        startTime TEXT NOT NULL,
        endTime TEXT NOT NULL,
        reason TEXT NOT NULL,
        createdBy TEXT NOT NULL REFERENCES users(id)
      );

      CREATE TABLE IF NOT EXISTS slot_locks (
        id TEXT PRIMARY KEY,
        equipmentId TEXT NOT NULL REFERENCES equipment(id),
        bucketKey TEXT NOT NULL,
        activeReservationIds TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actorId TEXT NOT NULL,
        actorRole TEXT NOT NULL,
        action TEXT NOT NULL,
        targetEntityId TEXT NOT NULL,
        metadata TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_booking_equipment ON booking_requests(equipmentId, status);
      CREATE INDEX IF NOT EXISTS idx_reservation_equipment ON reservations(equipmentId, lifecycleStatus);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
    `);

    // Idempotent schema migrations for existing SQLite databases
    const equipCols = this.db.prepare('PRAGMA table_info(equipment)').all() as Array<{ name: string }>;
    if (!equipCols.some((c) => c.name === 'description')) {
      this.db.exec(`ALTER TABLE equipment ADD COLUMN description TEXT NOT NULL DEFAULT ''`);
    }

    const resCols = this.db.prepare('PRAGMA table_info(reservations)').all() as Array<{ name: string }>;
    if (!resCols.some((c) => c.name === 'benchNumber')) {
      this.db.exec(`ALTER TABLE reservations ADD COLUMN benchNumber INTEGER NOT NULL DEFAULT 1`);
    }
    if (!resCols.some((c) => c.name === 'noShowMarkedAt')) {
      this.db.exec(`ALTER TABLE reservations ADD COLUMN noShowMarkedAt TEXT`);
    }

    const countRow = this.db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
    if (countRow.cnt === 0) {
      this.seedDatabase();
    }
  }

  private seedDatabase(): void {
    const seed = buildSeedData(this.campusTimezone);
    const tx = this.db.transaction(() => {
      const insertDept = this.db.prepare(
        `INSERT INTO departments (id, code, name, building, contactEmail) VALUES (?, ?, ?, ?, ?)`
      );
      for (const d of seed.departments) {
        insertDept.run(d.id, d.code, d.name, d.building, d.contactEmail);
      }

      const insertUser = this.db.prepare(
        `INSERT INTO users (id, email, name, role, departmentId, certifications, rolling30DayHoursUsed, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const u of seed.users) {
        insertUser.run(
          u.id,
          u.email,
          u.name,
          u.role,
          u.departmentId,
          JSON.stringify(u.certifications),
          u.rolling30DayHoursUsed,
          u.createdAt
        );
      }

      const insertEquip = this.db.prepare(
        `INSERT INTO equipment (id, assetTag, name, category, departmentId, labRoom, description, specs, capabilities, requiredCertifications, maxBookingHours, operatingHours, status, capacity, imageUrl)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const e of seed.equipment) {
        insertEquip.run(
          e.id,
          e.assetTag,
          e.name,
          e.category,
          e.departmentId,
          e.labRoom,
          e.description ?? '',
          JSON.stringify(e.specs),
          JSON.stringify(e.capabilities),
          JSON.stringify(e.requiredCertifications),
          e.maxBookingHours,
          JSON.stringify(e.operatingHours),
          e.status,
          e.capacity,
          e.imageUrl
        );
      }

      const insertMaint = this.db.prepare(
        `INSERT INTO maintenance_windows (id, equipmentId, startTime, endTime, reason, createdBy)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const m of seed.maintenanceWindows) {
        insertMaint.run(m.id, m.equipmentId, m.startTime, m.endTime, m.reason, m.createdBy);
      }

      const insertRes = this.db.prepare(
        `INSERT INTO reservations (id, requestId, equipmentId, studentId, startTime, endTime, benchNumber, lifecycleStatus, checkedOutAt, returnedAt, noShowMarkedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const r of seed.reservations) {
        insertRes.run(
          r.id,
          r.requestId,
          r.equipmentId,
          r.studentId,
          r.startTime,
          r.endTime,
          r.benchNumber ?? 1,
          r.lifecycleStatus,
          r.checkedOutAt,
          r.returnedAt,
          r.noShowMarkedAt ?? null
        );
      }

      const insertLock = this.db.prepare(
        `INSERT INTO slot_locks (id, equipmentId, bucketKey, activeReservationIds, updatedAt)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const l of seed.slotLocks) {
        insertLock.run(
          l.id,
          l.equipmentId,
          l.bucketKey,
          JSON.stringify(l.activeReservationIds),
          l.updatedAt
        );
      }

      const insertReq = this.db.prepare(
        `INSERT INTO booking_requests (id, studentId, equipmentId, projectTitle, projectSummary, requiredCapabilities, justification, requestedStart, requestedEnd, durationHours, projectDeadline, status, originalCreatedAt, lastSubmittedAt, smartFairSnapshot, facultyDecisionReason, reviewedBy, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const b of seed.bookingRequests) {
        insertReq.run(
          b.id,
          b.studentId,
          b.equipmentId,
          b.projectTitle,
          b.projectSummary,
          JSON.stringify(b.requiredCapabilities),
          b.justification,
          b.requestedStart,
          b.requestedEnd,
          b.durationHours,
          b.projectDeadline,
          b.status,
          b.originalCreatedAt,
          b.lastSubmittedAt,
          b.smartFairSnapshot ? JSON.stringify(b.smartFairSnapshot) : null,
          b.facultyDecisionReason,
          b.reviewedBy,
          b.createdAt
        );
      }

      const insertAudit = this.db.prepare(
        `INSERT INTO audit_logs (id, actorId, actorRole, action, targetEntityId, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const a of seed.auditLogs) {
        insertAudit.run(
          a.id,
          a.actorId,
          a.actorRole,
          a.action,
          a.targetEntityId,
          JSON.stringify(a.metadata),
          a.timestamp
        );
      }
    });
    tx();
  }

  private mapUser(row: Record<string, unknown>): User {
    return {
      id: String(row.id),
      email: String(row.email),
      name: String(row.name),
      role: row.role as Role,
      departmentId: String(row.departmentId),
      certifications: JSON.parse(String(row.certifications)),
      rolling30DayHoursUsed: Number(row.rolling30DayHoursUsed),
      createdAt: String(row.createdAt),
    };
  }

  private mapEquipment(row: Record<string, unknown>): Equipment {
    return {
      id: String(row.id),
      assetTag: String(row.assetTag),
      name: String(row.name),
      category: String(row.category),
      departmentId: String(row.departmentId),
      labRoom: String(row.labRoom),
      description: row.description ? String(row.description) : '',
      specs: JSON.parse(String(row.specs)),
      capabilities: JSON.parse(String(row.capabilities)),
      requiredCertifications: JSON.parse(String(row.requiredCertifications)),
      maxBookingHours: Number(row.maxBookingHours),
      operatingHours: JSON.parse(String(row.operatingHours)),
      status: row.status as Equipment['status'],
      capacity: Number(row.capacity),
      imageUrl: String(row.imageUrl),
    };
  }

  private mapBooking(row: Record<string, unknown>): BookingRequest {
    return {
      id: String(row.id),
      studentId: String(row.studentId),
      equipmentId: String(row.equipmentId),
      projectTitle: String(row.projectTitle),
      projectSummary: String(row.projectSummary),
      requiredCapabilities: JSON.parse(String(row.requiredCapabilities)),
      justification: String(row.justification),
      requestedStart: String(row.requestedStart),
      requestedEnd: String(row.requestedEnd),
      durationHours: Number(row.durationHours),
      projectDeadline: String(row.projectDeadline),
      status: row.status as BookingStatus,
      originalCreatedAt: String(row.originalCreatedAt),
      lastSubmittedAt: String(row.lastSubmittedAt),
      smartFairSnapshot: row.smartFairSnapshot ? JSON.parse(String(row.smartFairSnapshot)) : null,
      facultyDecisionReason: row.facultyDecisionReason ? String(row.facultyDecisionReason) : null,
      reviewedBy: row.reviewedBy ? String(row.reviewedBy) : null,
      createdAt: String(row.createdAt),
    };
  }

  private mapReservation(row: Record<string, unknown>): Reservation {
    return {
      id: String(row.id),
      requestId: String(row.requestId),
      equipmentId: String(row.equipmentId),
      studentId: String(row.studentId),
      startTime: String(row.startTime),
      endTime: String(row.endTime),
      benchNumber: Number(row.benchNumber ?? 1),
      lifecycleStatus: row.lifecycleStatus as Reservation['lifecycleStatus'],
      checkedOutAt: row.checkedOutAt ? String(row.checkedOutAt) : null,
      returnedAt: row.returnedAt ? String(row.returnedAt) : null,
      noShowMarkedAt: row.noShowMarkedAt ? String(row.noShowMarkedAt) : null,
    };
  }

  private mapAudit(row: Record<string, unknown>): AuditLog {
    return {
      id: String(row.id),
      actorId: String(row.actorId),
      actorRole: row.actorRole as Role,
      action: row.action as AuditAction,
      targetEntityId: String(row.targetEntityId),
      metadata: JSON.parse(String(row.metadata)),
      timestamp: String(row.timestamp),
    };
  }

  private appendAuditSync(
    actorId: string,
    actorRole: Role,
    action: AuditAction,
    targetEntityId: string,
    metadata: Record<string, unknown>
  ): void {
    const id = `aud-${crypto.randomUUID().slice(0, 8)}`;
    this.db
      .prepare(
        `INSERT INTO audit_logs (id, actorId, actorRole, action, targetEntityId, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, actorId, actorRole, action, targetEntityId, JSON.stringify(metadata), new Date().toISOString());
  }

  async listUsers(): Promise<User[]> {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY name ASC').all() as Record<string, unknown>[];
    return rows.map((r) => this.mapUser(r));
  }

  async getUserById(id: string): Promise<User | null> {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapUser(row) : null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const row = this.db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email) as Record<string, unknown> | undefined;
    return row ? this.mapUser(row) : null;
  }

  async updateUser(
    id: string,
    patch: { role?: Role; departmentId?: string; certifications?: string[] }
  ): Promise<User> {
    const existing = await this.getUserById(id);
    if (!existing) throw new NotFoundError('User not found');

    const role = patch.role ?? existing.role;
    const departmentId = patch.departmentId ?? existing.departmentId;
    const certifications = patch.certifications ?? existing.certifications;

    this.db
      .prepare('UPDATE users SET role = ?, departmentId = ?, certifications = ? WHERE id = ?')
      .run(role, departmentId, JSON.stringify(certifications), id);

    return (await this.getUserById(id))!;
  }

  async listDepartments(): Promise<Department[]> {
    return this.db.prepare('SELECT * FROM departments ORDER BY code ASC').all() as Department[];
  }

  async createDepartment(input: Omit<Department, 'id'>): Promise<Department> {
    const id = `dept-${crypto.randomUUID().slice(0, 8)}`;
    this.db
      .prepare('INSERT INTO departments (id, code, name, building, contactEmail) VALUES (?, ?, ?, ?, ?)')
      .run(id, input.code, input.name, input.building, input.contactEmail);
    return { id, ...input };
  }

  async listEquipment(): Promise<Equipment[]> {
    const rows = this.db.prepare('SELECT * FROM equipment ORDER BY name ASC').all() as Record<string, unknown>[];
    return rows.map((r) => this.mapEquipment(r));
  }

  async getEquipmentById(id: string): Promise<Equipment | null> {
    const row = this.db.prepare('SELECT * FROM equipment WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.mapEquipment(row) : null;
  }

  async createEquipment(input: Omit<Equipment, 'id'>, actor?: User): Promise<Equipment> {
    const normalizedTag = input.assetTag.trim().toUpperCase();
    const tx = this.db.transaction(() => {
      const dept = this.db
        .prepare('SELECT id FROM departments WHERE id = ?')
        .get(input.departmentId) as { id: string } | undefined;
      if (!dept) {
        throw new NotFoundError('Department not found');
      }

      const dup = this.db
        .prepare('SELECT id FROM equipment WHERE upper(assetTag) = upper(?)')
        .get(normalizedTag) as { id: string } | undefined;
      if (dup) {
        throw new ConflictError(`Equipment with asset tag "${normalizedTag}" already exists.`);
      }

      const id = `eq-${crypto.randomUUID().slice(0, 8)}`;
      try {
        this.db
          .prepare(
            `INSERT INTO equipment (id, assetTag, name, category, departmentId, labRoom, description, specs, capabilities, requiredCertifications, maxBookingHours, operatingHours, status, capacity, imageUrl)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            normalizedTag,
            input.name,
            input.category,
            input.departmentId,
            input.labRoom,
            input.description ?? '',
            JSON.stringify(input.specs),
            JSON.stringify(input.capabilities),
            JSON.stringify(input.requiredCertifications),
            input.maxBookingHours,
            JSON.stringify(input.operatingHours),
            input.status,
            input.capacity,
            input.imageUrl
          );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (msg.includes('UNIQUE') && msg.includes('assetTag')) {
          throw new ConflictError(`Equipment with asset tag "${normalizedTag}" already exists.`);
        }
        throw err;
      }

      if (actor) {
        this.appendAuditSync(actor.id, actor.role, 'CREATE_EQUIPMENT', id, {
          assetTag: normalizedTag,
          name: input.name,
          departmentId: input.departmentId,
          capacity: input.capacity,
        });
      }

      const createdRow = this.db
        .prepare('SELECT * FROM equipment WHERE id = ?')
        .get(id) as Record<string, unknown>;
      return this.mapEquipment(createdRow);
    });

    return tx.immediate();
  }

  async updateEquipment(
    id: string,
    patch: Partial<
      Pick<
        Equipment,
        'status' | 'maxBookingHours' | 'operatingHours' | 'labRoom' | 'requiredCertifications'
      >
    >
  ): Promise<Equipment> {
    const existing = await this.getEquipmentById(id);
    if (!existing) throw new NotFoundError('Equipment not found');

    this.db
      .prepare(
        `UPDATE equipment SET status = ?, maxBookingHours = ?, operatingHours = ?, labRoom = ?, requiredCertifications = ? WHERE id = ?`
      )
      .run(
        patch.status ?? existing.status,
        patch.maxBookingHours ?? existing.maxBookingHours,
        JSON.stringify(patch.operatingHours ?? existing.operatingHours),
        patch.labRoom ?? existing.labRoom,
        JSON.stringify(patch.requiredCertifications ?? existing.requiredCertifications),
        id
      );

    return (await this.getEquipmentById(id))!;
  }

  async listBookingRequests(): Promise<BookingRequest[]> {
    const rows = this.db
      .prepare('SELECT * FROM booking_requests ORDER BY createdAt DESC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapBooking(r));
  }

  async getBookingRequestById(id: string): Promise<BookingRequest | null> {
    const row = this.db
      .prepare('SELECT * FROM booking_requests WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapBooking(row) : null;
  }

  async createBookingRequest(
    input: CreateBookingInput,
    campusTimezone: string
  ): Promise<BookingRequest> {
    const tx = this.db.transaction(() => {
      const equipRow = this.db
        .prepare('SELECT * FROM equipment WHERE id = ?')
        .get(input.equipmentId) as Record<string, unknown> | undefined;
      if (!equipRow) throw new NotFoundError('Equipment not found');
      const equipment = this.mapEquipment(equipRow);

      const userRow = this.db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(input.studentId) as Record<string, unknown> | undefined;
      if (!userRow) throw new NotFoundError('User not found');
      const student = this.mapUser(userRow);

      const activeResRows = this.db
        .prepare(
          `SELECT * FROM reservations WHERE equipmentId = ? AND lifecycleStatus IN ('CONFIRMED', 'CHECKED_OUT')`
        )
        .all(input.equipmentId) as Record<string, unknown>[];
      const activeReservations = activeResRows.map((r) => this.mapReservation(r));

      const maintWindows = this.db
        .prepare('SELECT * FROM maintenance_windows WHERE equipmentId = ?')
        .all(input.equipmentId) as MaintenanceWindow[];

      const nowIso = new Date().toISOString();
      const id = `req-${crypto.randomUUID().slice(0, 8)}`;

      const draftRequest: BookingRequest = {
        id,
        studentId: input.studentId,
        equipmentId: input.equipmentId,
        projectTitle: input.projectTitle,
        projectSummary: input.projectSummary,
        requiredCapabilities: input.requiredCapabilities,
        justification: input.justification,
        requestedStart: input.requestedStart,
        requestedEnd: input.requestedEnd,
        durationHours: input.durationHours,
        projectDeadline: input.projectDeadline,
        status: 'PENDING',
        originalCreatedAt: nowIso,
        lastSubmittedAt: nowIso,
        smartFairSnapshot: null,
        facultyDecisionReason: null,
        reviewedBy: null,
        createdAt: nowIso,
      };

      const evaluation = evaluateBookingRequest(draftRequest, {
        equipment,
        student,
        activeReservations,
        maintenanceWindows: maintWindows,
        nowIso,
        timezone: campusTimezone,
      });

      // Check overlapping pending/conflict_review requests on same equipment
      const peerRows = this.db
        .prepare(
          `SELECT * FROM booking_requests WHERE equipmentId = ? AND status IN ('PENDING', 'CONFLICT_REVIEW')`
        )
        .all(input.equipmentId) as Record<string, unknown>[];
      const peers = peerRows.map((r) => this.mapBooking(r));

      const reqStartMs = toEpochMs(input.requestedStart);
      const reqEndMs = toEpochMs(input.requestedEnd);
      const overlappingPeers = peers.filter((p) =>
        intervalsOverlap(reqStartMs, reqEndMs, toEpochMs(p.requestedStart), toEpochMs(p.requestedEnd))
      );

      const hasConflict = !evaluation.eligible || overlappingPeers.length > 0;
      const status: BookingStatus = hasConflict ? 'CONFLICT_REVIEW' : 'PENDING';

      draftRequest.status = status;
      draftRequest.smartFairSnapshot = evaluation;

      this.db
        .prepare(
          `INSERT INTO booking_requests (id, studentId, equipmentId, projectTitle, projectSummary, requiredCapabilities, justification, requestedStart, requestedEnd, durationHours, projectDeadline, status, originalCreatedAt, lastSubmittedAt, smartFairSnapshot, facultyDecisionReason, reviewedBy, createdAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          draftRequest.id,
          draftRequest.studentId,
          draftRequest.equipmentId,
          draftRequest.projectTitle,
          draftRequest.projectSummary,
          JSON.stringify(draftRequest.requiredCapabilities),
          draftRequest.justification,
          draftRequest.requestedStart,
          draftRequest.requestedEnd,
          draftRequest.durationHours,
          draftRequest.projectDeadline,
          draftRequest.status,
          draftRequest.originalCreatedAt,
          draftRequest.lastSubmittedAt,
          JSON.stringify(draftRequest.smartFairSnapshot),
          null,
          null,
          draftRequest.createdAt
        );

      // Mark any overlapping PENDING peers as CONFLICT_REVIEW
      for (const peer of overlappingPeers) {
        if (peer.status === 'PENDING') {
          this.db
            .prepare(`UPDATE booking_requests SET status = 'CONFLICT_REVIEW' WHERE id = ?`)
            .run(peer.id);
        }
      }

      this.appendAuditSync(student.id, student.role, 'SUBMIT_REQUEST', draftRequest.id, {
        equipmentId: equipment.id,
        status: draftRequest.status,
        smartFairScore: evaluation.score,
        eligible: evaluation.eligible,
      });

      return draftRequest;
    });

    return tx.immediate();
  }

  async rescheduleBookingRequest(
    id: string,
    studentId: string,
    requestedStart: string,
    requestedEnd: string,
    campusTimezone: string
  ): Promise<BookingRequest> {
    const tx = this.db.transaction(() => {
      const existingRow = this.db
        .prepare('SELECT * FROM booking_requests WHERE id = ?')
        .get(id) as Record<string, unknown> | undefined;
      if (!existingRow) throw new NotFoundError('Booking request not found');
      const existing = this.mapBooking(existingRow);

      if (existing.studentId !== studentId) {
        throw new ForbiddenError('You can only reschedule your own requests');
      }
      if (existing.status === 'APPROVED' || existing.status === 'CANCELLED') {
        throw new ValidationError(`Cannot reschedule a request in ${existing.status} state`);
      }

      const equipRow = this.db
        .prepare('SELECT * FROM equipment WHERE id = ?')
        .get(existing.equipmentId) as Record<string, unknown>;
      const equipment = this.mapEquipment(equipRow);
      const userRow = this.db
        .prepare('SELECT * FROM users WHERE id = ?')
        .get(studentId) as Record<string, unknown>;
      const student = this.mapUser(userRow);

      const activeReservations = (
        this.db
          .prepare(
            `SELECT * FROM reservations WHERE equipmentId = ? AND lifecycleStatus IN ('CONFIRMED', 'CHECKED_OUT')`
          )
          .all(existing.equipmentId) as Record<string, unknown>[]
      ).map((r) => this.mapReservation(r));

      const maintWindows = this.db
        .prepare('SELECT * FROM maintenance_windows WHERE equipmentId = ?')
        .all(existing.equipmentId) as MaintenanceWindow[];

      const nowIso = new Date().toISOString();
      const durationHours = (toEpochMs(requestedEnd) - toEpochMs(requestedStart)) / 3_600_000;

      // ANTI-GAMING: preserve originalCreatedAt strictly!
      const updated: BookingRequest = {
        ...existing,
        requestedStart,
        requestedEnd,
        durationHours,
        lastSubmittedAt: nowIso,
      };

      const evaluation = evaluateBookingRequest(updated, {
        equipment,
        student,
        activeReservations,
        maintenanceWindows: maintWindows,
        nowIso,
        timezone: campusTimezone,
      });

      const peers = (
        this.db
          .prepare(
            `SELECT * FROM booking_requests WHERE equipmentId = ? AND id != ? AND status IN ('PENDING', 'CONFLICT_REVIEW')`
          )
          .all(existing.equipmentId, id) as Record<string, unknown>[]
      ).map((r) => this.mapBooking(r));

      const reqStartMs = toEpochMs(requestedStart);
      const reqEndMs = toEpochMs(requestedEnd);
      const overlappingPeers = peers.filter((p) =>
        intervalsOverlap(reqStartMs, reqEndMs, toEpochMs(p.requestedStart), toEpochMs(p.requestedEnd))
      );

      updated.status = !evaluation.eligible || overlappingPeers.length > 0 ? 'CONFLICT_REVIEW' : 'PENDING';
      updated.smartFairSnapshot = evaluation;

      this.db
        .prepare(
          `UPDATE booking_requests
           SET requestedStart = ?, requestedEnd = ?, durationHours = ?, lastSubmittedAt = ?, status = ?, smartFairSnapshot = ?
           WHERE id = ?`
        )
        .run(
          updated.requestedStart,
          updated.requestedEnd,
          updated.durationHours,
          updated.lastSubmittedAt,
          updated.status,
          JSON.stringify(updated.smartFairSnapshot),
          id
        );

      this.appendAuditSync(student.id, student.role, 'RESCHEDULE_REQUEST', id, {
        equipmentId: equipment.id,
        originalCreatedAtPreserved: existing.originalCreatedAt,
        newStatus: updated.status,
      });

      return updated;
    });

    return tx.immediate();
  }

  async cancelBookingRequest(id: string, actor: User): Promise<BookingRequest> {
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT * FROM booking_requests WHERE id = ?')
        .get(id) as Record<string, unknown> | undefined;
      if (!row) throw new NotFoundError('Booking request not found');
      const existing = this.mapBooking(row);

      if (actor.role === 'STUDENT' && existing.studentId !== actor.id) {
        throw new ForbiddenError('Cannot cancel another student request');
      }
      if (existing.status === 'APPROVED' || existing.status === 'CANCELLED') {
        throw new ValidationError(`Request is already ${existing.status}`);
      }

      this.db
        .prepare(`UPDATE booking_requests SET status = 'CANCELLED' WHERE id = ?`)
        .run(id);

      this.appendAuditSync(actor.id, actor.role, 'CANCEL_REQUEST', id, {
        equipmentId: existing.equipmentId,
      });

      return { ...existing, status: 'CANCELLED' as const };
    });

    return tx.immediate();
  }

  async processFacultyDecision(input: FacultyDecisionInput): Promise<{
    request: BookingRequest;
    reservation: Reservation | null;
    conflictedRequestIds: string[];
  }> {
    const tx = this.db.transaction(() => {
      const targetRow = this.db
        .prepare('SELECT * FROM booking_requests WHERE id = ?')
        .get(input.requestId) as Record<string, unknown> | undefined;
      if (!targetRow) throw new NotFoundError('Booking request not found');
      const target = this.mapBooking(targetRow);

      if (target.status !== 'PENDING' && target.status !== 'CONFLICT_REVIEW') {
        throw new ConflictError(`Request ${target.id} has already been processed (${target.status}).`);
      }

      const equipRow = this.db
        .prepare('SELECT * FROM equipment WHERE id = ?')
        .get(target.equipmentId) as Record<string, unknown> | undefined;
      if (!equipRow) throw new NotFoundError('Equipment not found');
      const equipment = this.mapEquipment(equipRow);

      const allUsers = (
        this.db.prepare('SELECT * FROM users').all() as Record<string, unknown>[]
      ).map((r) => this.mapUser(r));
      const usersById = new Map(allUsers.map((u) => [u.id, u]));

      const student = usersById.get(target.studentId);
      if (!student) throw new NotFoundError('Student not found');

      if (input.decision === 'REJECT') {
        this.db
          .prepare(
            `UPDATE booking_requests SET status = 'REJECTED', facultyDecisionReason = ?, reviewedBy = ? WHERE id = ?`
          )
          .run(input.reason, input.facultyUser.id, target.id);

        this.appendAuditSync(input.facultyUser.id, input.facultyUser.role, 'REJECT', target.id, {
          equipmentId: equipment.id,
          studentId: target.studentId,
          reason: input.reason,
        });

        return {
          request: {
            ...target,
            status: 'REJECTED' as const,
            facultyDecisionReason: input.reason,
            reviewedBy: input.facultyUser.id,
          },
          reservation: null,
          conflictedRequestIds: [],
        };
      }

      // --- ATOMIC APPROVAL WITH SLOT-BUCKET LOCKS & EXACT INTERVAL OVERLAP CHECK ---
      const reqStartMs = toEpochMs(target.requestedStart);
      const reqEndMs = toEpochMs(target.requestedEnd);
      const nowIso = new Date().toISOString();

      // 1. Read all deterministic slot_locks touched by [startMs, endMs)
      const touchedBuckets = computeSlotBucketIds(
        equipment.id,
        target.requestedStart,
        target.requestedEnd,
        input.campusTimezone
      );

      const existingLocksById = new Map<string, SlotLock>();
      const getLockStmt = this.db.prepare('SELECT * FROM slot_locks WHERE id = ?');
      for (const b of touchedBuckets) {
        const lockRow = getLockStmt.get(b.lockId) as Record<string, unknown> | undefined;
        if (lockRow) {
          existingLocksById.set(b.lockId, {
            id: String(lockRow.id),
            equipmentId: String(lockRow.equipmentId),
            bucketKey: String(lockRow.bucketKey),
            activeReservationIds: JSON.parse(String(lockRow.activeReservationIds)),
            updatedAt: String(lockRow.updatedAt),
          });
        }
      }

      // 2. Read active CONFIRMED / CHECKED_OUT reservations & maintenance_windows
      const activeReservations = (
        this.db
          .prepare(
            `SELECT * FROM reservations WHERE equipmentId = ? AND lifecycleStatus IN ('CONFIRMED', 'CHECKED_OUT')`
          )
          .all(equipment.id) as Record<string, unknown>[]
      ).map((r) => this.mapReservation(r));

      const maintWindows = this.db
        .prepare('SELECT * FROM maintenance_windows WHERE equipmentId = ?')
        .all(equipment.id) as MaintenanceWindow[];

      // 3. Evaluate SmartFair hard constraints & competing cluster
      const evaluation = evaluateBookingRequest(target, {
        equipment,
        student,
        activeReservations,
        maintenanceWindows: maintWindows,
        nowIso,
        timezone: input.campusTimezone,
      });

      if (!evaluation.eligible) {
        const scheduleViolations = evaluation.violations.filter((v) => v.code === 'SCHEDULE_CONFLICT');
        if (scheduleViolations.length > 0) {
          throw new ConflictError(
            `Slot collision detected during atomic lock check: ${scheduleViolations[0].message}`,
            { violations: evaluation.violations }
          );
        }
        throw new ValidationError(
          `Cannot approve request violating hard constraints: ${evaluation.violations
            .map((v) => `${v.code}: ${v.message}`)
            .join('; ')}`,
          { violations: evaluation.violations }
        );
      }

      // Check overlapping pending/conflict_review requests to verify SmartFair recommendation vs override
      const peerPending = (
        this.db
          .prepare(
            `SELECT * FROM booking_requests WHERE equipmentId = ? AND status IN ('PENDING', 'CONFLICT_REVIEW')`
          )
          .all(equipment.id) as Record<string, unknown>[]
      ).map((r) => this.mapBooking(r));

      const overlappingCluster = peerPending.filter((p) =>
        intervalsOverlap(reqStartMs, reqEndMs, toEpochMs(p.requestedStart), toEpochMs(p.requestedEnd))
      );

      const ranked = rankCompetingRequests(overlappingCluster, {
        equipment,
        usersById,
        activeReservations,
        maintenanceWindows: maintWindows,
        nowIso,
        timezone: input.campusTimezone,
      });

      const topRecommended = ranked.find((r) => r.evaluation.isTopRecommended);
      const isOverridingSmartFair =
        Boolean(topRecommended && topRecommended.request.id !== target.id);

      if (isOverridingSmartFair && !input.isOverride) {
        throw new ValidationError(
          `Request "${target.projectTitle}" is not the #1 SmartFair recommendation (top recommended: "${topRecommended!.request.projectTitle}"). An explicit override reason code and justification are required.`,
          {
            topRecommendedRequestId: topRecommended!.request.id,
            topRecommendedScore: topRecommended!.evaluation.score,
          }
        );
      }

      // Capacity-aware sweep-line peak concurrency & lowest-available bench assignment
      const capacityEval = evaluateIntervalCapacity(
        activeReservations,
        reqStartMs,
        reqEndMs,
        equipment.capacity
      );
      if (!capacityEval.allowed || capacityEval.assignedBenchNumber === null) {
        throw new ConflictError(
          capacityEval.reason ??
            `Equipment ${equipment.assetTag} has reached full capacity (${capacityEval.peakConcurrentUsage}/${equipment.capacity} benches occupied).`
        );
      }

      // 4. Persist reservation with deterministic benchNumber
      const reservationId = `res-${crypto.randomUUID().slice(0, 8)}`;
      const reservation: Reservation = {
        id: reservationId,
        requestId: target.id,
        equipmentId: equipment.id,
        studentId: target.studentId,
        startTime: target.requestedStart,
        endTime: target.requestedEnd,
        benchNumber: capacityEval.assignedBenchNumber,
        lifecycleStatus: 'CONFIRMED',
        checkedOutAt: null,
        returnedAt: null,
        noShowMarkedAt: null,
      };

      this.db
        .prepare(
          `INSERT INTO reservations (id, requestId, equipmentId, studentId, startTime, endTime, benchNumber, lifecycleStatus, checkedOutAt, returnedAt, noShowMarkedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`
        )
        .run(
          reservation.id,
          reservation.requestId,
          reservation.equipmentId,
          reservation.studentId,
          reservation.startTime,
          reservation.endTime,
          reservation.benchNumber,
          reservation.lifecycleStatus
        );

      // 5. Upsert touched slot_locks (preserving concurrent bench reservations)
      const upsertLockStmt = this.db.prepare(
        `INSERT INTO slot_locks (id, equipmentId, bucketKey, activeReservationIds, updatedAt)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET activeReservationIds = excluded.activeReservationIds, updatedAt = excluded.updatedAt`
      );
      for (const b of touchedBuckets) {
        const prev = existingLocksById.get(b.lockId);
        const ids = prev ? Array.from(new Set([...prev.activeReservationIds, reservation.id])) : [reservation.id];
        upsertLockStmt.run(b.lockId, equipment.id, b.bucketKey, JSON.stringify(ids), nowIso);
      }

      // 6. Mark target request APPROVED & update student's rolling30DayHoursUsed
      this.db
        .prepare(
          `UPDATE booking_requests
           SET status = 'APPROVED', facultyDecisionReason = ?, reviewedBy = ?, smartFairSnapshot = ?
           WHERE id = ?`
        )
        .run(input.reason, input.facultyUser.id, JSON.stringify(evaluation), target.id);

      this.db
        .prepare(
          `UPDATE users SET rolling30DayHoursUsed = rolling30DayHoursUsed + ? WHERE id = ?`
        )
        .run(target.durationHours, student.id);

      // 7. Mark overlapping PENDING / CONFLICT_REVIEW requests as CONFLICT_REVIEW with recomputed alternative slots
      const updatedActiveReservations = [...activeReservations, reservation];
      const conflictedRequestIds: string[] = [];

      for (const peer of overlappingCluster) {
        if (peer.id === target.id) continue;
        const peerStudent = usersById.get(peer.studentId);
        const peerEval = peerStudent
          ? evaluateBookingRequest(peer, {
              equipment,
              student: peerStudent,
              activeReservations: updatedActiveReservations,
              maintenanceWindows: maintWindows,
              nowIso,
              timezone: input.campusTimezone,
            })
          : null;

        this.db
          .prepare(
            `UPDATE booking_requests SET status = 'CONFLICT_REVIEW', smartFairSnapshot = ? WHERE id = ?`
          )
          .run(peerEval ? JSON.stringify(peerEval) : null, peer.id);
        conflictedRequestIds.push(peer.id);
      }

      // 8. Append immutable audit logs
      this.appendAuditSync(input.facultyUser.id, input.facultyUser.role, 'APPROVE', target.id, {
        equipmentId: equipment.id,
        reservationId: reservation.id,
        benchNumber: reservation.benchNumber,
        studentId: target.studentId,
        reason: input.reason,
        smartFairScore: evaluation.score,
      });

      if (isOverridingSmartFair || input.isOverride) {
        this.appendAuditSync(
          input.facultyUser.id,
          input.facultyUser.role,
          'OVERRIDE_RECOMMENDATION',
          target.id,
          {
            equipmentId: equipment.id,
            chosenRequestId: target.id,
            chosenScore: evaluation.score,
            overriddenTopRequestId: topRecommended?.request.id ?? null,
            overriddenTopScore: topRecommended?.evaluation.score ?? null,
            overrideReasonCode: input.overrideReasonCode,
            overrideJustification: input.overrideJustification,
          }
        );
      }

      return {
        request: {
          ...target,
          status: 'APPROVED' as const,
          facultyDecisionReason: input.reason,
          reviewedBy: input.facultyUser.id,
          smartFairSnapshot: evaluation,
        },
        reservation,
        conflictedRequestIds,
      };
    });

    return tx.immediate();
  }

  async listReservations(): Promise<Reservation[]> {
    const rows = this.db
      .prepare('SELECT * FROM reservations ORDER BY startTime DESC')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapReservation(r));
  }

  async getReservationById(id: string): Promise<Reservation | null> {
    const row = this.db
      .prepare('SELECT * FROM reservations WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    return row ? this.mapReservation(row) : null;
  }

  async checkoutReservation(reservationId: string, actor: User): Promise<Reservation> {
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT * FROM reservations WHERE id = ?')
        .get(reservationId) as Record<string, unknown> | undefined;
      if (!row) throw new NotFoundError('Reservation not found');
      const existing = this.mapReservation(row);
      if (existing.lifecycleStatus !== 'CONFIRMED') {
        throw new ValidationError(`Cannot check out reservation in ${existing.lifecycleStatus} state`);
      }

      const nowIso = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE reservations SET lifecycleStatus = 'CHECKED_OUT', checkedOutAt = ? WHERE id = ?`
        )
        .run(nowIso, reservationId);

      this.appendAuditSync(actor.id, actor.role, 'CHECK_OUT', reservationId, {
        equipmentId: existing.equipmentId,
        studentId: existing.studentId,
      });

      return {
        ...existing,
        lifecycleStatus: 'CHECKED_OUT' as const,
        checkedOutAt: nowIso,
      };
    });
    return tx.immediate();
  }

  async returnReservation(reservationId: string, actor: User): Promise<Reservation> {
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT * FROM reservations WHERE id = ?')
        .get(reservationId) as Record<string, unknown> | undefined;
      if (!row) throw new NotFoundError('Reservation not found');
      const existing = this.mapReservation(row);
      if (existing.lifecycleStatus !== 'CHECKED_OUT' && existing.lifecycleStatus !== 'CONFIRMED') {
        throw new ValidationError(`Cannot return reservation in ${existing.lifecycleStatus} state`);
      }

      const nowIso = new Date().toISOString();
      this.db
        .prepare(
          `UPDATE reservations SET lifecycleStatus = 'RETURNED', returnedAt = ? WHERE id = ?`
        )
        .run(nowIso, reservationId);

      // Remove reservationId from slot_locks (deleting empty locks cleanly)
      this.pruneReservationFromSlotLocksSync(existing, nowIso);

      this.appendAuditSync(actor.id, actor.role, 'RETURN', reservationId, {
        equipmentId: existing.equipmentId,
        studentId: existing.studentId,
        benchNumber: existing.benchNumber,
      });

      return {
        ...existing,
        lifecycleStatus: 'RETURNED' as const,
        returnedAt: nowIso,
      };
    });
    return tx.immediate();
  }

  private pruneReservationFromSlotLocksSync(reservation: Reservation, nowIso: string): void {
    const buckets = computeSlotBucketIds(
      reservation.equipmentId,
      reservation.startTime,
      reservation.endTime,
      this.campusTimezone
    );
    for (const b of buckets) {
      const lockRow = this.db
        .prepare('SELECT * FROM slot_locks WHERE id = ?')
        .get(b.lockId) as Record<string, unknown> | undefined;
      if (lockRow) {
        const ids = (JSON.parse(String(lockRow.activeReservationIds)) as string[]).filter(
          (id) => id !== reservation.id
        );
        if (ids.length === 0) {
          this.db.prepare('DELETE FROM slot_locks WHERE id = ?').run(b.lockId);
        } else {
          this.db
            .prepare('UPDATE slot_locks SET activeReservationIds = ?, updatedAt = ? WHERE id = ?')
            .run(JSON.stringify(ids), nowIso, b.lockId);
        }
      }
    }
  }

  async markReservationNoShow(params: {
    reservationId: string;
    actor: User;
    reason?: string;
    graceMinutes: number;
    nowIso?: string;
  }): Promise<Reservation> {
    const tx = this.db.transaction(() => {
      const row = this.db
        .prepare('SELECT * FROM reservations WHERE id = ?')
        .get(params.reservationId) as Record<string, unknown> | undefined;
      if (!row) throw new NotFoundError('Reservation not found');
      const existing = this.mapReservation(row);

      if (existing.lifecycleStatus === 'NO_SHOW') {
        return existing;
      }
      if (existing.lifecycleStatus !== 'CONFIRMED' || existing.checkedOutAt !== null) {
        throw new ValidationError(
          `Cannot mark reservation in ${existing.lifecycleStatus} state as NO_SHOW.`
        );
      }

      const nowIso = params.nowIso ?? new Date().toISOString();
      const nowMs = toEpochMs(nowIso);
      const startMs = toEpochMs(existing.startTime);
      const cutoffMs = startMs + params.graceMinutes * 60_000;
      if (nowMs <= cutoffMs) {
        throw new ValidationError(
          `Reservation cannot be marked NO_SHOW before the ${params.graceMinutes}-minute check-in grace window expires.`
        );
      }

      this.db
        .prepare(
          `UPDATE reservations SET lifecycleStatus = 'NO_SHOW', noShowMarkedAt = ? WHERE id = ?`
        )
        .run(nowIso, existing.id);

      this.pruneReservationFromSlotLocksSync(existing, nowIso);

      this.appendAuditSync(params.actor.id, params.actor.role, 'MARK_NO_SHOW', existing.id, {
        equipmentId: existing.equipmentId,
        studentId: existing.studentId,
        benchNumber: existing.benchNumber,
        noShowMarkedAt: nowIso,
        reason:
          params.reason?.trim() ||
          `Manually marked NO_SHOW after ${params.graceMinutes}m check-in grace period.`,
      });

      return {
        ...existing,
        lifecycleStatus: 'NO_SHOW' as const,
        noShowMarkedAt: nowIso,
      };
    });

    return tx.immediate();
  }

  async sweepNoShowReservations(params: {
    actor: User;
    graceMinutes: number;
    nowIso?: string;
  }): Promise<{ releasedReservations: Reservation[]; releasedCount: number }> {
    const tx = this.db.transaction(() => {
      const nowIso = params.nowIso ?? new Date().toISOString();
      const nowMs = toEpochMs(nowIso);

      const candidateRows = this.db
        .prepare(
          `SELECT * FROM reservations WHERE lifecycleStatus = 'CONFIRMED' AND checkedOutAt IS NULL ORDER BY startTime ASC`
        )
        .all() as Record<string, unknown>[];

      const releasedReservations: Reservation[] = [];

      for (const row of candidateRows) {
        const res = this.mapReservation(row);
        const startMs = toEpochMs(res.startTime);
        if (nowMs <= startMs + params.graceMinutes * 60_000) {
          continue;
        }

        const updateResult = this.db
          .prepare(
            `UPDATE reservations SET lifecycleStatus = 'NO_SHOW', noShowMarkedAt = ? WHERE id = ? AND lifecycleStatus = 'CONFIRMED' AND checkedOutAt IS NULL`
          )
          .run(nowIso, res.id);

        if (updateResult.changes === 0) {
          continue;
        }

        this.pruneReservationFromSlotLocksSync(res, nowIso);

        this.appendAuditSync(params.actor.id, params.actor.role, 'AUTO_RELEASE_NO_SHOW', res.id, {
          equipmentId: res.equipmentId,
          studentId: res.studentId,
          benchNumber: res.benchNumber,
          noShowMarkedAt: nowIso,
          graceMinutes: params.graceMinutes,
          reason: `Auto-released NO_SHOW after ${params.graceMinutes}m grace period elapsed.`,
        });

        releasedReservations.push({
          ...res,
          lifecycleStatus: 'NO_SHOW',
          noShowMarkedAt: nowIso,
        });
      }

      return {
        releasedReservations,
        releasedCount: releasedReservations.length,
      };
    });

    return tx.immediate();
  }

  async listMaintenanceWindows(): Promise<MaintenanceWindow[]> {
    return this.db
      .prepare('SELECT * FROM maintenance_windows ORDER BY startTime ASC')
      .all() as MaintenanceWindow[];
  }

  async createMaintenanceWindow(
    input: Omit<MaintenanceWindow, 'id'>,
    actor: User,
    campusTimezone: string
  ): Promise<{ window: MaintenanceWindow; impactedRequestIds: string[] }> {
    const tx = this.db.transaction(() => {
      const equipRow = this.db
        .prepare('SELECT * FROM equipment WHERE id = ?')
        .get(input.equipmentId) as Record<string, unknown> | undefined;
      if (!equipRow) throw new NotFoundError('Equipment not found');
      const equipment = this.mapEquipment(equipRow);

      const id = `mnt-${crypto.randomUUID().slice(0, 8)}`;
      const window: MaintenanceWindow = { id, ...input };

      this.db
        .prepare(
          `INSERT INTO maintenance_windows (id, equipmentId, startTime, endTime, reason, createdBy)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(window.id, window.equipmentId, window.startTime, window.endTime, window.reason, window.createdBy);

      // Recompute impacted pending requests
      const mStart = toEpochMs(window.startTime);
      const mEnd = toEpochMs(window.endTime);

      const activeReservations = (
        this.db
          .prepare(
            `SELECT * FROM reservations WHERE equipmentId = ? AND lifecycleStatus IN ('CONFIRMED', 'CHECKED_OUT')`
          )
          .all(equipment.id) as Record<string, unknown>[]
      ).map((r) => this.mapReservation(r));

      const maintWindows = this.db
        .prepare('SELECT * FROM maintenance_windows WHERE equipmentId = ?')
        .all(equipment.id) as MaintenanceWindow[];

      const pendingRows = (
        this.db
          .prepare(
            `SELECT * FROM booking_requests WHERE equipmentId = ? AND status IN ('PENDING', 'CONFLICT_REVIEW')`
          )
          .all(equipment.id) as Record<string, unknown>[]
      ).map((r) => this.mapBooking(r));

      const impactedRequestIds: string[] = [];
      for (const req of pendingRows) {
        if (intervalsOverlap(mStart, mEnd, toEpochMs(req.requestedStart), toEpochMs(req.requestedEnd))) {
          const userRow = this.db
            .prepare('SELECT * FROM users WHERE id = ?')
            .get(req.studentId) as Record<string, unknown>;
          const student = this.mapUser(userRow);
          const evalSnap = evaluateBookingRequest(req, {
            equipment,
            student,
            activeReservations,
            maintenanceWindows: maintWindows,
            timezone: campusTimezone,
          });
          this.db
            .prepare(
              `UPDATE booking_requests SET status = 'CONFLICT_REVIEW', smartFairSnapshot = ? WHERE id = ?`
            )
            .run(JSON.stringify(evalSnap), req.id);
          impactedRequestIds.push(req.id);
        }
      }

      this.appendAuditSync(actor.id, actor.role, 'MAINTENANCE_BLOCK', window.id, {
        equipmentId: equipment.id,
        startTime: window.startTime,
        endTime: window.endTime,
        reason: window.reason,
        impactedRequestIds,
      });

      return { window, impactedRequestIds };
    });

    return tx.immediate();
  }

  async listSlotLocks(equipmentId?: string): Promise<SlotLock[]> {
    const rows = equipmentId
      ? (this.db
          .prepare('SELECT * FROM slot_locks WHERE equipmentId = ? ORDER BY bucketKey ASC')
          .all(equipmentId) as Record<string, unknown>[])
      : (this.db.prepare('SELECT * FROM slot_locks ORDER BY bucketKey ASC').all() as Record<
          string,
          unknown
        >[]);

    return rows.map((r) => ({
      id: String(r.id),
      equipmentId: String(r.equipmentId),
      bucketKey: String(r.bucketKey),
      activeReservationIds: JSON.parse(String(r.activeReservationIds)),
      updatedAt: String(r.updatedAt),
    }));
  }

  async listAuditLogs(): Promise<AuditLog[]> {
    const rows = this.db
      .prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 250')
      .all() as Record<string, unknown>[];
    return rows.map((r) => this.mapAudit(r));
  }
}

export { findAlternativeSlots };
