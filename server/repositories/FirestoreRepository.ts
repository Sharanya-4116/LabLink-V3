import crypto from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { evaluateIntervalCapacity } from '../../shared/concurrency.ts';
import {
  evaluateBookingRequest,
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

/**
 * Production Google Cloud Firestore repository using db.runTransaction(...)
 * and deterministic slot_locks/{equipmentId}_{YYYY-MM-DD_H{bucketIndex}} documents
 * for multi-instance Cloud Run concurrency safety.
 */
export class FirestoreRepository implements IDataRepository {
  private db: Firestore;
  private campusTimezone: string;

  constructor(db: Firestore, campusTimezone = 'Asia/Kolkata') {
    this.db = db;
    this.campusTimezone = campusTimezone;
  }

  async init(): Promise<void> {
    const usersSnap = await this.db.collection('users').limit(1).get();
    if (!usersSnap.empty) return;

    const seed = buildSeedData(this.campusTimezone);
    const batch = this.db.batch();

    for (const d of seed.departments) {
      batch.set(this.db.collection('departments').doc(d.id), d);
    }
    for (const u of seed.users) {
      batch.set(this.db.collection('users').doc(u.id), u);
    }
    for (const e of seed.equipment) {
      batch.set(this.db.collection('equipment').doc(e.id), e);
    }
    for (const m of seed.maintenanceWindows) {
      batch.set(this.db.collection('maintenance_windows').doc(m.id), m);
    }
    for (const r of seed.reservations) {
      batch.set(this.db.collection('reservations').doc(r.id), r);
    }
    for (const l of seed.slotLocks) {
      batch.set(this.db.collection('slot_locks').doc(l.id), l);
    }
    for (const b of seed.bookingRequests) {
      batch.set(this.db.collection('booking_requests').doc(b.id), b);
    }
    for (const a of seed.auditLogs) {
      batch.set(this.db.collection('audit_logs').doc(a.id), a);
    }

    await batch.commit();
  }

  private async appendAudit(
    actorId: string,
    actorRole: Role,
    action: AuditAction,
    targetEntityId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    const id = `aud-${crypto.randomUUID().slice(0, 8)}`;
    const record: AuditLog = {
      id,
      actorId,
      actorRole,
      action,
      targetEntityId,
      metadata,
      timestamp: new Date().toISOString(),
    };
    await this.db.collection('audit_logs').doc(id).set(record);
  }

  async listUsers(): Promise<User[]> {
    const snap = await this.db.collection('users').get();
    return snap.docs.map((d) => d.data() as User).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getUserById(id: string): Promise<User | null> {
    const doc = await this.db.collection('users').doc(id).get();
    return doc.exists ? (doc.data() as User) : null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const snap = await this.db
      .collection('users')
      .where('email', '==', email.toLowerCase())
      .limit(1)
      .get();
    if (!snap.empty) return snap.docs[0].data() as User;
    const all = await this.listUsers();
    return all.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async updateUser(
    id: string,
    patch: { role?: Role; departmentId?: string; certifications?: string[] }
  ): Promise<User> {
    const ref = this.db.collection('users').doc(id);
    const doc = await ref.get();
    if (!doc.exists) throw new NotFoundError('User not found');
    const existing = doc.data() as User;
    const updated: User = {
      ...existing,
      role: patch.role ?? existing.role,
      departmentId: patch.departmentId ?? existing.departmentId,
      certifications: patch.certifications ?? existing.certifications,
    };
    await ref.set(updated);
    return updated;
  }

  async listDepartments(): Promise<Department[]> {
    const snap = await this.db.collection('departments').get();
    return snap.docs.map((d) => d.data() as Department).sort((a, b) => a.code.localeCompare(b.code));
  }

  async createDepartment(input: Omit<Department, 'id'>): Promise<Department> {
    const id = `dept-${crypto.randomUUID().slice(0, 8)}`;
    const dept: Department = { id, ...input };
    await this.db.collection('departments').doc(id).set(dept);
    return dept;
  }

  async listEquipment(): Promise<Equipment[]> {
    const snap = await this.db.collection('equipment').get();
    return snap.docs.map((d) => d.data() as Equipment).sort((a, b) => a.name.localeCompare(b.name));
  }

  async getEquipmentById(id: string): Promise<Equipment | null> {
    const doc = await this.db.collection('equipment').doc(id).get();
    return doc.exists ? (doc.data() as Equipment) : null;
  }

  private normalizeReservation(raw: Reservation): Reservation {
    return {
      ...raw,
      benchNumber: raw.benchNumber ?? 1,
      noShowMarkedAt: raw.noShowMarkedAt ?? null,
    };
  }

  async createEquipment(input: Omit<Equipment, 'id'>, actor?: User): Promise<Equipment> {
    const normalizedTag = input.assetTag.trim().toUpperCase();
    return this.db.runTransaction(async (tx) => {
      const deptDoc = await tx.get(this.db.collection('departments').doc(input.departmentId));
      if (!deptDoc.exists) {
        throw new NotFoundError('Department not found');
      }

      const equipSnap = await tx.get(this.db.collection('equipment'));
      const duplicate = equipSnap.docs.some(
        (d) => ((d.data() as Equipment).assetTag || '').trim().toUpperCase() === normalizedTag
      );
      if (duplicate) {
        throw new ConflictError(`Equipment with asset tag "${normalizedTag}" already exists.`);
      }

      const id = `eq-${crypto.randomUUID().slice(0, 8)}`;
      const equip: Equipment = {
        ...input,
        id,
        assetTag: normalizedTag,
        description: input.description ?? '',
      };
      tx.set(this.db.collection('equipment').doc(id), equip);

      if (actor) {
        const auditId = `aud-${crypto.randomUUID().slice(0, 8)}`;
        tx.set(this.db.collection('audit_logs').doc(auditId), {
          id: auditId,
          actorId: actor.id,
          actorRole: actor.role,
          action: 'CREATE_EQUIPMENT',
          targetEntityId: id,
          metadata: {
            assetTag: normalizedTag,
            name: equip.name,
            departmentId: equip.departmentId,
            capacity: equip.capacity,
          },
          timestamp: new Date().toISOString(),
        });
      }

      return equip;
    });
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
    const ref = this.db.collection('equipment').doc(id);
    const doc = await ref.get();
    if (!doc.exists) throw new NotFoundError('Equipment not found');
    const existing = doc.data() as Equipment;
    const updated: Equipment = {
      ...existing,
      ...patch,
    };
    await ref.set(updated);
    return updated;
  }

  async listBookingRequests(): Promise<BookingRequest[]> {
    const snap = await this.db.collection('booking_requests').get();
    return snap.docs
      .map((d) => d.data() as BookingRequest)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getBookingRequestById(id: string): Promise<BookingRequest | null> {
    const doc = await this.db.collection('booking_requests').doc(id).get();
    return doc.exists ? (doc.data() as BookingRequest) : null;
  }

  async createBookingRequest(
    input: CreateBookingInput,
    campusTimezone: string
  ): Promise<BookingRequest> {
    return this.db.runTransaction(async (tx) => {
      const equipDoc = await tx.get(this.db.collection('equipment').doc(input.equipmentId));
      if (!equipDoc.exists) throw new NotFoundError('Equipment not found');
      const equipment = equipDoc.data() as Equipment;

      const userDoc = await tx.get(this.db.collection('users').doc(input.studentId));
      if (!userDoc.exists) throw new NotFoundError('User not found');
      const student = userDoc.data() as User;

      const resSnap = await tx.get(
        this.db
          .collection('reservations')
          .where('equipmentId', '==', input.equipmentId)
          .where('lifecycleStatus', 'in', ['CONFIRMED', 'CHECKED_OUT'])
      );
      const activeReservations = resSnap.docs.map((d) => d.data() as Reservation);

      const maintSnap = await tx.get(
        this.db.collection('maintenance_windows').where('equipmentId', '==', input.equipmentId)
      );
      const maintWindows = maintSnap.docs.map((d) => d.data() as MaintenanceWindow);

      const peerSnap = await tx.get(
        this.db
          .collection('booking_requests')
          .where('equipmentId', '==', input.equipmentId)
          .where('status', 'in', ['PENDING', 'CONFLICT_REVIEW'])
      );
      const peers = peerSnap.docs.map((d) => d.data() as BookingRequest);

      const nowIso = new Date().toISOString();
      const id = `req-${crypto.randomUUID().slice(0, 8)}`;

      const draft: BookingRequest = {
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

      const evaluation = evaluateBookingRequest(draft, {
        equipment,
        student,
        activeReservations,
        maintenanceWindows: maintWindows,
        nowIso,
        timezone: campusTimezone,
      });

      const reqStartMs = toEpochMs(input.requestedStart);
      const reqEndMs = toEpochMs(input.requestedEnd);
      const overlappingPeers = peers.filter((p) =>
        intervalsOverlap(reqStartMs, reqEndMs, toEpochMs(p.requestedStart), toEpochMs(p.requestedEnd))
      );

      draft.status = !evaluation.eligible || overlappingPeers.length > 0 ? 'CONFLICT_REVIEW' : 'PENDING';
      draft.smartFairSnapshot = evaluation;

      tx.set(this.db.collection('booking_requests').doc(draft.id), draft);

      for (const peer of overlappingPeers) {
        if (peer.status === 'PENDING') {
          tx.update(this.db.collection('booking_requests').doc(peer.id), {
            status: 'CONFLICT_REVIEW',
          });
        }
      }

      const auditId = `aud-${crypto.randomUUID().slice(0, 8)}`;
      tx.set(this.db.collection('audit_logs').doc(auditId), {
        id: auditId,
        actorId: student.id,
        actorRole: student.role,
        action: 'SUBMIT_REQUEST',
        targetEntityId: draft.id,
        metadata: {
          equipmentId: equipment.id,
          status: draft.status,
          smartFairScore: evaluation.score,
        },
        timestamp: nowIso,
      });

      return draft;
    });
  }

  async rescheduleBookingRequest(
    id: string,
    studentId: string,
    requestedStart: string,
    requestedEnd: string,
    campusTimezone: string
  ): Promise<BookingRequest> {
    return this.db.runTransaction(async (tx) => {
      const reqRef = this.db.collection('booking_requests').doc(id);
      const reqDoc = await tx.get(reqRef);
      if (!reqDoc.exists) throw new NotFoundError('Booking request not found');
      const existing = reqDoc.data() as BookingRequest;

      if (existing.studentId !== studentId) {
        throw new ForbiddenError('You can only reschedule your own requests');
      }
      if (existing.status === 'APPROVED' || existing.status === 'CANCELLED') {
        throw new ValidationError(`Cannot reschedule request in ${existing.status} state`);
      }

      const equipDoc = await tx.get(this.db.collection('equipment').doc(existing.equipmentId));
      const equipment = equipDoc.data() as Equipment;
      const userDoc = await tx.get(this.db.collection('users').doc(studentId));
      const student = userDoc.data() as User;

      const resSnap = await tx.get(
        this.db
          .collection('reservations')
          .where('equipmentId', '==', existing.equipmentId)
          .where('lifecycleStatus', 'in', ['CONFIRMED', 'CHECKED_OUT'])
      );
      const activeReservations = resSnap.docs.map((d) => d.data() as Reservation);

      const maintSnap = await tx.get(
        this.db.collection('maintenance_windows').where('equipmentId', '==', existing.equipmentId)
      );
      const maintWindows = maintSnap.docs.map((d) => d.data() as MaintenanceWindow);

      const peerSnap = await tx.get(
        this.db
          .collection('booking_requests')
          .where('equipmentId', '==', existing.equipmentId)
          .where('status', 'in', ['PENDING', 'CONFLICT_REVIEW'])
      );
      const peers = peerSnap.docs.map((d) => d.data() as BookingRequest).filter((p) => p.id !== id);

      const nowIso = new Date().toISOString();
      const durationHours = (toEpochMs(requestedEnd) - toEpochMs(requestedStart)) / 3_600_000;

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

      const reqStartMs = toEpochMs(requestedStart);
      const reqEndMs = toEpochMs(requestedEnd);
      const overlappingPeers = peers.filter((p) =>
        intervalsOverlap(reqStartMs, reqEndMs, toEpochMs(p.requestedStart), toEpochMs(p.requestedEnd))
      );

      updated.status = !evaluation.eligible || overlappingPeers.length > 0 ? 'CONFLICT_REVIEW' : 'PENDING';
      updated.smartFairSnapshot = evaluation;

      tx.set(reqRef, updated);

      const auditId = `aud-${crypto.randomUUID().slice(0, 8)}`;
      tx.set(this.db.collection('audit_logs').doc(auditId), {
        id: auditId,
        actorId: student.id,
        actorRole: student.role,
        action: 'RESCHEDULE_REQUEST',
        targetEntityId: id,
        metadata: {
          equipmentId: equipment.id,
          originalCreatedAtPreserved: existing.originalCreatedAt,
          newStatus: updated.status,
        },
        timestamp: nowIso,
      });

      return updated;
    });
  }

  async cancelBookingRequest(id: string, actor: User): Promise<BookingRequest> {
    const reqRef = this.db.collection('booking_requests').doc(id);
    const doc = await reqRef.get();
    if (!doc.exists) throw new NotFoundError('Booking request not found');
    const existing = doc.data() as BookingRequest;
    if (actor.role === 'STUDENT' && existing.studentId !== actor.id) {
      throw new ForbiddenError('Cannot cancel another student request');
    }
    if (existing.status === 'APPROVED' || existing.status === 'CANCELLED') {
      throw new ValidationError(`Request is already ${existing.status}`);
    }
    const updated: BookingRequest = { ...existing, status: 'CANCELLED' };
    await reqRef.set(updated);
    await this.appendAudit(actor.id, actor.role, 'CANCEL_REQUEST', id, {
      equipmentId: existing.equipmentId,
    });
    return updated;
  }

  async processFacultyDecision(input: FacultyDecisionInput): Promise<{
    request: BookingRequest;
    reservation: Reservation | null;
    conflictedRequestIds: string[];
  }> {
    return this.db.runTransaction(async (tx) => {
      const reqRef = this.db.collection('booking_requests').doc(input.requestId);
      const reqDoc = await tx.get(reqRef);
      if (!reqDoc.exists) throw new NotFoundError('Booking request not found');
      const target = reqDoc.data() as BookingRequest;

      if (target.status !== 'PENDING' && target.status !== 'CONFLICT_REVIEW') {
        throw new ConflictError(`Request ${target.id} has already been processed (${target.status}).`);
      }

      const equipRef = this.db.collection('equipment').doc(target.equipmentId);
      const equipDoc = await tx.get(equipRef);
      if (!equipDoc.exists) throw new NotFoundError('Equipment not found');
      const equipment = equipDoc.data() as Equipment;

      const usersSnap = await tx.get(this.db.collection('users'));
      const usersById = new Map<string, User>(
        usersSnap.docs.map((d) => [d.id, d.data() as User])
      );
      const student = usersById.get(target.studentId);
      if (!student) throw new NotFoundError('Student not found');

      const nowIso = new Date().toISOString();

      if (input.decision === 'REJECT') {
        const rejected: BookingRequest = {
          ...target,
          status: 'REJECTED',
          facultyDecisionReason: input.reason,
          reviewedBy: input.facultyUser.id,
        };
        tx.set(reqRef, rejected);
        const auditId = `aud-${crypto.randomUUID().slice(0, 8)}`;
        tx.set(this.db.collection('audit_logs').doc(auditId), {
          id: auditId,
          actorId: input.facultyUser.id,
          actorRole: input.facultyUser.role,
          action: 'REJECT',
          targetEntityId: target.id,
          metadata: { equipmentId: equipment.id, studentId: target.studentId, reason: input.reason },
          timestamp: nowIso,
        });
        return { request: rejected, reservation: null, conflictedRequestIds: [] };
      }

      // 1. Deterministic slot-bucket locks touched by [startMs, endMs)
      const touchedBuckets = computeSlotBucketIds(
        equipment.id,
        target.requestedStart,
        target.requestedEnd,
        input.campusTimezone
      );
      const lockRefs = touchedBuckets.map((b) => this.db.collection('slot_locks').doc(b.lockId));
      const lockDocs = await Promise.all(lockRefs.map((ref) => tx.get(ref)));
      const existingLocksById = new Map<string, SlotLock>();
      lockDocs.forEach((doc) => {
        if (doc.exists) {
          existingLocksById.set(doc.id, doc.data() as SlotLock);
        }
      });

      // 2. Active reservations & maintenance windows
      const resSnap = await tx.get(
        this.db
          .collection('reservations')
          .where('equipmentId', '==', equipment.id)
          .where('lifecycleStatus', 'in', ['CONFIRMED', 'CHECKED_OUT'])
      );
      const activeReservations = resSnap.docs.map((d) =>
        this.normalizeReservation(d.data() as Reservation)
      );

      const maintSnap = await tx.get(
        this.db.collection('maintenance_windows').where('equipmentId', '==', equipment.id)
      );
      const maintWindows = maintSnap.docs.map((d) => d.data() as MaintenanceWindow);

      // 3. Peer pending/conflict requests
      const peerSnap = await tx.get(
        this.db
          .collection('booking_requests')
          .where('equipmentId', '==', equipment.id)
          .where('status', 'in', ['PENDING', 'CONFLICT_REVIEW'])
      );
      const peerPending = peerSnap.docs.map((d) => d.data() as BookingRequest);

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
            `Slot collision detected during atomic Firestore lock check: ${scheduleViolations[0].message}`,
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

      const reqStartMs = toEpochMs(target.requestedStart);
      const reqEndMs = toEpochMs(target.requestedEnd);
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
      const isOverridingSmartFair = Boolean(topRecommended && topRecommended.request.id !== target.id);

      if (isOverridingSmartFair && !input.isOverride) {
        throw new ValidationError(
          `Request "${target.projectTitle}" is not the #1 SmartFair recommendation. Override reason code and justification are required.`
        );
      }

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
      tx.set(this.db.collection('reservations').doc(reservation.id), reservation);

      for (const b of touchedBuckets) {
        const prev = existingLocksById.get(b.lockId);
        const ids = prev
          ? Array.from(new Set([...prev.activeReservationIds, reservation.id]))
          : [reservation.id];
        tx.set(this.db.collection('slot_locks').doc(b.lockId), {
          id: b.lockId,
          equipmentId: equipment.id,
          bucketKey: b.bucketKey,
          activeReservationIds: ids,
          updatedAt: nowIso,
        });
      }

      const approved: BookingRequest = {
        ...target,
        status: 'APPROVED',
        facultyDecisionReason: input.reason,
        reviewedBy: input.facultyUser.id,
        smartFairSnapshot: evaluation,
      };
      tx.set(reqRef, approved);

      tx.update(this.db.collection('users').doc(student.id), {
        rolling30DayHoursUsed: student.rolling30DayHoursUsed + target.durationHours,
      });

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

        tx.update(this.db.collection('booking_requests').doc(peer.id), {
          status: 'CONFLICT_REVIEW',
          smartFairSnapshot: peerEval,
        });
        conflictedRequestIds.push(peer.id);
      }

      const approveAuditId = `aud-${crypto.randomUUID().slice(0, 8)}`;
      tx.set(this.db.collection('audit_logs').doc(approveAuditId), {
        id: approveAuditId,
        actorId: input.facultyUser.id,
        actorRole: input.facultyUser.role,
        action: 'APPROVE',
        targetEntityId: target.id,
        metadata: {
          equipmentId: equipment.id,
          reservationId: reservation.id,
          benchNumber: reservation.benchNumber,
          studentId: target.studentId,
          reason: input.reason,
          smartFairScore: evaluation.score,
        },
        timestamp: nowIso,
      });

      if (isOverridingSmartFair || input.isOverride) {
        const overrideAuditId = `aud-${crypto.randomUUID().slice(0, 8)}`;
        tx.set(this.db.collection('audit_logs').doc(overrideAuditId), {
          id: overrideAuditId,
          actorId: input.facultyUser.id,
          actorRole: input.facultyUser.role,
          action: 'OVERRIDE_RECOMMENDATION',
          targetEntityId: target.id,
          metadata: {
            equipmentId: equipment.id,
            chosenRequestId: target.id,
            chosenScore: evaluation.score,
            overriddenTopRequestId: topRecommended?.request.id ?? null,
            overrideReasonCode: input.overrideReasonCode,
            overrideJustification: input.overrideJustification,
          },
          timestamp: nowIso,
        });
      }

      return { request: approved, reservation, conflictedRequestIds };
    });
  }

  async listReservations(): Promise<Reservation[]> {
    const snap = await this.db.collection('reservations').get();
    return snap.docs
      .map((d) => this.normalizeReservation(d.data() as Reservation))
      .sort((a, b) => b.startTime.localeCompare(a.startTime));
  }

  async getReservationById(id: string): Promise<Reservation | null> {
    const doc = await this.db.collection('reservations').doc(id).get();
    return doc.exists ? this.normalizeReservation(doc.data() as Reservation) : null;
  }

  async checkoutReservation(reservationId: string, actor: User): Promise<Reservation> {
    const ref = this.db.collection('reservations').doc(reservationId);
    const doc = await ref.get();
    if (!doc.exists) throw new NotFoundError('Reservation not found');
    const existing = this.normalizeReservation(doc.data() as Reservation);
    if (existing.lifecycleStatus !== 'CONFIRMED') {
      throw new ValidationError(`Cannot check out reservation in ${existing.lifecycleStatus} state`);
    }
    const nowIso = new Date().toISOString();
    const updated: Reservation = {
      ...existing,
      lifecycleStatus: 'CHECKED_OUT',
      checkedOutAt: nowIso,
    };
    await ref.set(updated);
    await this.appendAudit(actor.id, actor.role, 'CHECK_OUT', reservationId, {
      equipmentId: existing.equipmentId,
      studentId: existing.studentId,
      benchNumber: existing.benchNumber,
    });
    return updated;
  }

  async returnReservation(reservationId: string, actor: User): Promise<Reservation> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.db.collection('reservations').doc(reservationId);
      const doc = await tx.get(ref);
      if (!doc.exists) throw new NotFoundError('Reservation not found');
      const existing = this.normalizeReservation(doc.data() as Reservation);
      if (existing.lifecycleStatus !== 'CHECKED_OUT' && existing.lifecycleStatus !== 'CONFIRMED') {
        throw new ValidationError(`Cannot return reservation in ${existing.lifecycleStatus} state`);
      }

      const nowIso = new Date().toISOString();
      const buckets = computeSlotBucketIds(
        existing.equipmentId,
        existing.startTime,
        existing.endTime,
        this.campusTimezone
      );
      const lockRefs = buckets.map((b) => this.db.collection('slot_locks').doc(b.lockId));
      const lockDocs = await Promise.all(lockRefs.map((r) => tx.get(r)));

      const updated: Reservation = {
        ...existing,
        lifecycleStatus: 'RETURNED',
        returnedAt: nowIso,
      };
      tx.set(ref, updated);

      for (const lockDoc of lockDocs) {
        if (lockDoc.exists) {
          const lockData = lockDoc.data() as SlotLock;
          const remaining = lockData.activeReservationIds.filter((id) => id !== reservationId);
          if (remaining.length === 0) {
            tx.delete(lockDoc.ref);
          } else {
            tx.update(lockDoc.ref, {
              activeReservationIds: remaining,
              updatedAt: nowIso,
            });
          }
        }
      }

      const auditId = `aud-${crypto.randomUUID().slice(0, 8)}`;
      tx.set(this.db.collection('audit_logs').doc(auditId), {
        id: auditId,
        actorId: actor.id,
        actorRole: actor.role,
        action: 'RETURN',
        targetEntityId: reservationId,
        metadata: {
          equipmentId: existing.equipmentId,
          studentId: existing.studentId,
          benchNumber: existing.benchNumber,
        },
        timestamp: nowIso,
      });

      return updated;
    });
  }

  async markReservationNoShow(params: {
    reservationId: string;
    actor: User;
    reason?: string;
    graceMinutes: number;
    nowIso?: string;
  }): Promise<Reservation> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.db.collection('reservations').doc(params.reservationId);
      const doc = await tx.get(ref);
      if (!doc.exists) throw new NotFoundError('Reservation not found');
      const existing = this.normalizeReservation(doc.data() as Reservation);

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
      const cutoffMs = toEpochMs(existing.startTime) + params.graceMinutes * 60_000;
      if (nowMs <= cutoffMs) {
        throw new ValidationError(
          `Reservation cannot be marked NO_SHOW before the ${params.graceMinutes}-minute check-in grace window expires.`
        );
      }

      // Strictly read all touched slot_locks before performing any writes
      const buckets = computeSlotBucketIds(
        existing.equipmentId,
        existing.startTime,
        existing.endTime,
        this.campusTimezone
      );
      const lockRefs = buckets.map((b) => this.db.collection('slot_locks').doc(b.lockId));
      const lockDocs = await Promise.all(lockRefs.map((r) => tx.get(r)));

      const updated: Reservation = {
        ...existing,
        lifecycleStatus: 'NO_SHOW',
        noShowMarkedAt: nowIso,
      };
      tx.set(ref, updated);

      for (const lockDoc of lockDocs) {
        if (lockDoc.exists) {
          const lockData = lockDoc.data() as SlotLock;
          const remaining = lockData.activeReservationIds.filter((id) => id !== existing.id);
          if (remaining.length === 0) {
            tx.delete(lockDoc.ref);
          } else {
            tx.update(lockDoc.ref, {
              activeReservationIds: remaining,
              updatedAt: nowIso,
            });
          }
        }
      }

      const auditId = `aud-${crypto.randomUUID().slice(0, 8)}`;
      tx.set(this.db.collection('audit_logs').doc(auditId), {
        id: auditId,
        actorId: params.actor.id,
        actorRole: params.actor.role,
        action: 'MARK_NO_SHOW',
        targetEntityId: existing.id,
        metadata: {
          equipmentId: existing.equipmentId,
          studentId: existing.studentId,
          benchNumber: existing.benchNumber,
          noShowMarkedAt: nowIso,
          reason:
            params.reason?.trim() ||
            `Manually marked NO_SHOW after ${params.graceMinutes}m check-in grace period.`,
        },
        timestamp: nowIso,
      });

      return updated;
    });
  }

  async sweepNoShowReservations(params: {
    actor: User;
    graceMinutes: number;
    nowIso?: string;
  }): Promise<{ releasedReservations: Reservation[]; releasedCount: number }> {
    return this.db.runTransaction(async (tx) => {
      const nowIso = params.nowIso ?? new Date().toISOString();
      const nowMs = toEpochMs(nowIso);

      // Read candidate CONFIRMED reservations before any writes
      const confirmedSnap = await tx.get(
        this.db.collection('reservations').where('lifecycleStatus', '==', 'CONFIRMED')
      );

      const eligible = confirmedSnap.docs
        .map((d) => this.normalizeReservation(d.data() as Reservation))
        .filter(
          (r) =>
            r.checkedOutAt === null &&
            nowMs > toEpochMs(r.startTime) + params.graceMinutes * 60_000
        );

      if (eligible.length === 0) {
        return { releasedReservations: [], releasedCount: 0 };
      }

      // Collect and read every touched slot_lock document BEFORE any write
      const lockIdToRemovedIds = new Map<string, Set<string>>();
      for (const res of eligible) {
        const buckets = computeSlotBucketIds(
          res.equipmentId,
          res.startTime,
          res.endTime,
          this.campusTimezone
        );
        for (const b of buckets) {
          const set = lockIdToRemovedIds.get(b.lockId) ?? new Set<string>();
          set.add(res.id);
          lockIdToRemovedIds.set(b.lockId, set);
        }
      }

      const uniqueLockIds = Array.from(lockIdToRemovedIds.keys());
      const lockDocs = await Promise.all(
        uniqueLockIds.map((lockId) => tx.get(this.db.collection('slot_locks').doc(lockId)))
      );

      // Perform all writes now that every read is complete
      const releasedReservations: Reservation[] = [];
      for (const res of eligible) {
        const updated: Reservation = {
          ...res,
          lifecycleStatus: 'NO_SHOW',
          noShowMarkedAt: nowIso,
        };
        tx.set(this.db.collection('reservations').doc(res.id), updated);

        const auditId = `aud-${crypto.randomUUID().slice(0, 8)}`;
        tx.set(this.db.collection('audit_logs').doc(auditId), {
          id: auditId,
          actorId: params.actor.id,
          actorRole: params.actor.role,
          action: 'AUTO_RELEASE_NO_SHOW',
          targetEntityId: res.id,
          metadata: {
            equipmentId: res.equipmentId,
            studentId: res.studentId,
            benchNumber: res.benchNumber,
            noShowMarkedAt: nowIso,
            graceMinutes: params.graceMinutes,
            reason: `Auto-released NO_SHOW after ${params.graceMinutes}m grace period elapsed.`,
          },
          timestamp: nowIso,
        });

        releasedReservations.push(updated);
      }

      for (const lockDoc of lockDocs) {
        if (!lockDoc.exists) continue;
        const lockData = lockDoc.data() as SlotLock;
        const removedIds = lockIdToRemovedIds.get(lockDoc.id);
        if (!removedIds) continue;
        const remaining = lockData.activeReservationIds.filter((id) => !removedIds.has(id));
        if (remaining.length === 0) {
          tx.delete(lockDoc.ref);
        } else {
          tx.update(lockDoc.ref, {
            activeReservationIds: remaining,
            updatedAt: nowIso,
          });
        }
      }

      return {
        releasedReservations,
        releasedCount: releasedReservations.length,
      };
    });
  }

  async listMaintenanceWindows(): Promise<MaintenanceWindow[]> {
    const snap = await this.db.collection('maintenance_windows').get();
    return snap.docs
      .map((d) => d.data() as MaintenanceWindow)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  async createMaintenanceWindow(
    input: Omit<MaintenanceWindow, 'id'>,
    actor: User,
    campusTimezone: string
  ): Promise<{ window: MaintenanceWindow; impactedRequestIds: string[] }> {
    const equip = await this.getEquipmentById(input.equipmentId);
    if (!equip) throw new NotFoundError('Equipment not found');

    const id = `mnt-${crypto.randomUUID().slice(0, 8)}`;
    const window: MaintenanceWindow = { id, ...input };
    await this.db.collection('maintenance_windows').doc(id).set(window);

    const pendingSnap = await this.db
      .collection('booking_requests')
      .where('equipmentId', '==', input.equipmentId)
      .where('status', 'in', ['PENDING', 'CONFLICT_REVIEW'])
      .get();

    const mStart = toEpochMs(window.startTime);
    const mEnd = toEpochMs(window.endTime);
    const impactedRequestIds: string[] = [];

    for (const d of pendingSnap.docs) {
      const req = d.data() as BookingRequest;
      if (intervalsOverlap(mStart, mEnd, toEpochMs(req.requestedStart), toEpochMs(req.requestedEnd))) {
        await d.ref.update({ status: 'CONFLICT_REVIEW' });
        impactedRequestIds.push(req.id);
      }
    }

    await this.appendAudit(actor.id, actor.role, 'MAINTENANCE_BLOCK', id, {
      equipmentId: input.equipmentId,
      reason: input.reason,
      impactedRequestIds,
    });

    return { window, impactedRequestIds };
  }

  async listSlotLocks(equipmentId?: string): Promise<SlotLock[]> {
    const snap = equipmentId
      ? await this.db.collection('slot_locks').where('equipmentId', '==', equipmentId).get()
      : await this.db.collection('slot_locks').get();
    return snap.docs.map((d) => d.data() as SlotLock);
  }

  async listAuditLogs(): Promise<AuditLog[]> {
    const snap = await this.db
      .collection('audit_logs')
      .orderBy('timestamp', 'desc')
      .limit(250)
      .get();
    return snap.docs.map((d) => d.data() as AuditLog);
  }
}
