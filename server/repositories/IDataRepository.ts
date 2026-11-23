import type {
  AuditLog,
  BookingRequest,
  Department,
  Equipment,
  MaintenanceWindow,
  Reservation,
  Role,
  SlotLock,
  User,
} from '../../shared/types.ts';

export interface CreateBookingInput {
  studentId: string;
  equipmentId: string;
  projectTitle: string;
  projectSummary: string;
  requiredCapabilities: string[];
  justification: string;
  requestedStart: string;
  requestedEnd: string;
  durationHours: number;
  projectDeadline: string;
}

export interface FacultyDecisionInput {
  requestId: string;
  facultyUser: User;
  decision: 'APPROVE' | 'REJECT';
  reason: string;
  isOverride: boolean;
  overrideReasonCode?: string;
  overrideJustification?: string;
  campusTimezone: string;
}

export interface IDataRepository {
  init(): Promise<void>;

  // Users & Departments
  listUsers(): Promise<User[]>;
  getUserById(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  updateUser(
    id: string,
    patch: { role?: Role; departmentId?: string; certifications?: string[] }
  ): Promise<User>;

  listDepartments(): Promise<Department[]>;
  createDepartment(input: Omit<Department, 'id'>): Promise<Department>;

  // Equipment
  listEquipment(): Promise<Equipment[]>;
  getEquipmentById(id: string): Promise<Equipment | null>;
  createEquipment(input: Omit<Equipment, 'id'>, actor?: User): Promise<Equipment>;
  updateEquipment(
    id: string,
    patch: Partial<
      Pick<
        Equipment,
        'status' | 'maxBookingHours' | 'operatingHours' | 'labRoom' | 'requiredCertifications'
      >
    >
  ): Promise<Equipment>;

  // Booking Requests
  listBookingRequests(): Promise<BookingRequest[]>;
  getBookingRequestById(id: string): Promise<BookingRequest | null>;
  createBookingRequest(
    input: CreateBookingInput,
    campusTimezone: string
  ): Promise<BookingRequest>;
  rescheduleBookingRequest(
    id: string,
    studentId: string,
    requestedStart: string,
    requestedEnd: string,
    campusTimezone: string
  ): Promise<BookingRequest>;
  cancelBookingRequest(id: string, actor: User): Promise<BookingRequest>;

  // Atomic Faculty Decision & Slot-Lock Reservation Commit
  processFacultyDecision(input: FacultyDecisionInput): Promise<{
    request: BookingRequest;
    reservation: Reservation | null;
    conflictedRequestIds: string[];
  }>;

  // Reservations & Lifecycle
  listReservations(): Promise<Reservation[]>;
  getReservationById(id: string): Promise<Reservation | null>;
  checkoutReservation(reservationId: string, actor: User): Promise<Reservation>;
  returnReservation(reservationId: string, actor: User): Promise<Reservation>;
  markReservationNoShow(params: {
    reservationId: string;
    actor: User;
    reason?: string;
    graceMinutes: number;
    nowIso?: string;
  }): Promise<Reservation>;
  sweepNoShowReservations(params: {
    actor: User;
    graceMinutes: number;
    nowIso?: string;
  }): Promise<{ releasedReservations: Reservation[]; releasedCount: number }>;

  // Maintenance & Slot Locks
  listMaintenanceWindows(): Promise<MaintenanceWindow[]>;
  createMaintenanceWindow(
    input: Omit<MaintenanceWindow, 'id'>,
    actor: User,
    campusTimezone: string
  ): Promise<{ window: MaintenanceWindow; impactedRequestIds: string[] }>;

  listSlotLocks(equipmentId?: string): Promise<SlotLock[]>;

  // Audit Logs
  listAuditLogs(): Promise<AuditLog[]>;
}
