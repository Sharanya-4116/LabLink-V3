export type Role = 'STUDENT' | 'FACULTY' | 'ADMIN';

export type EquipmentStatus = 'AVAILABLE' | 'MAINTENANCE' | 'OFFLINE';

export type BookingStatus =
  | 'PENDING'
  | 'CONFLICT_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

export type ReservationLifecycleStatus =
  | 'CONFIRMED'
  | 'CHECKED_OUT'
  | 'RETURNED'
  | 'NO_SHOW';

export type AuditAction =
  | 'APPROVE'
  | 'REJECT'
  | 'OVERRIDE_RECOMMENDATION'
  | 'MAINTENANCE_BLOCK'
  | 'CHECK_OUT'
  | 'RETURN'
  | 'AUTO_RELEASE_NO_SHOW'
  | 'MARK_NO_SHOW'
  | 'CREATE_EQUIPMENT'
  | 'SUBMIT_REQUEST'
  | 'CANCEL_REQUEST'
  | 'RESCHEDULE_REQUEST';

export interface OperatingHours {
  startHour: number; // 0..23 in campus timezone
  endHour: number; // 1..24 in campus timezone
  daysOfWeek: number[]; // 0=Sun .. 6=Sat
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  departmentId: string;
  certifications: string[];
  rolling30DayHoursUsed: number;
  createdAt: string;
}

export interface Department {
  id: string;
  code: string;
  name: string;
  building: string;
  contactEmail: string;
}

export interface Equipment {
  id: string;
  assetTag: string;
  name: string;
  category: string;
  departmentId: string;
  labRoom: string;
  description?: string;
  specs: Record<string, string>;
  capabilities: string[];
  requiredCertifications: string[];
  maxBookingHours: number;
  operatingHours: OperatingHours;
  status: EquipmentStatus;
  capacity: number;
  imageUrl: string;
}

export type HardConstraintCode =
  | 'EQUIPMENT_UNAVAILABLE'
  | 'HOURS_OR_DURATION_VIOLATION'
  | 'SCHEDULE_CONFLICT'
  | 'CERTIFICATION_REQUIRED';

export interface HardConstraintViolation {
  code: HardConstraintCode;
  message: string;
}

export interface SmartFairFactorBreakdown {
  deadlineUrgency: number; // 0..1 (35%)
  capabilityMatch: number; // 0..1 (25%)
  waitingTime: number; // 0..1 (20%)
  accessFairness: number; // 0..1 (10%)
  utilizationEfficiency: number; // 0..1 (10%)
}

export interface AlternativeSlot {
  startTime: string; // ISO UTC
  endTime: string; // ISO UTC
  campusLabel: string;
}

export interface SmartFairEvaluation {
  eligible: boolean;
  violations: HardConstraintViolation[];
  score: number; // 0..100 rounded to 1 decimal place
  factors: SmartFairFactorBreakdown;
  recommendationRank: number | null;
  isTopRecommended: boolean;
  explanation: string[];
  alternativeSlots: AlternativeSlot[];
  evaluatedAt: string;
}

export interface BookingRequest {
  id: string;
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
  status: BookingStatus;
  originalCreatedAt: string;
  lastSubmittedAt: string;
  smartFairSnapshot: SmartFairEvaluation | null;
  facultyDecisionReason: string | null;
  reviewedBy: string | null;
  createdAt: string;
}

export interface Reservation {
  id: string;
  requestId: string;
  equipmentId: string;
  studentId: string;
  startTime: string;
  endTime: string;
  benchNumber: number;
  lifecycleStatus: ReservationLifecycleStatus;
  checkedOutAt: string | null;
  returnedAt: string | null;
  noShowMarkedAt?: string | null;
}

export interface MaintenanceWindow {
  id: string;
  equipmentId: string;
  startTime: string;
  endTime: string;
  reason: string;
  createdBy: string;
}

export interface SlotLock {
  id: string;
  equipmentId: string;
  bucketKey: string;
  activeReservationIds: string[];
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  actorId: string;
  actorRole: Role;
  action: AuditAction;
  targetEntityId: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface PublicOverview {
  totalEquipment: number;
  availableEquipment: number;
  totalDepartments: number;
  totalBookingsCompletedOrActive: number;
  crossDepartmentSharePercent: number;
  pendingConflictsCount: number;
  averageUtilizationPercent: number;
  featuredEquipment: Equipment[];
  departments: Department[];
}

export interface AnalyticsSummary {
  totalEquipment: number;
  availableEquipment: number;
  maintenanceEquipment: number;
  totalRequests: number;
  pendingRequests: number;
  conflictReviewRequests: number;
  approvedRequests: number;
  rejectedRequests: number;
  totalReservations: number;
  crossDepartmentBookingsCount: number;
  crossDepartmentSharePercent: number;
  averageUtilizationPercent: number;
  overrideCount: number;
  overrideRatePercent: number;
  fairnessIndex: number; // 0..100 (100 = perfectly equal hours across active students)
  departmentUtilization: Array<{
    departmentId: string;
    departmentCode: string;
    departmentName: string;
    equipmentCount: number;
    bookedHours: number;
    utilizationPercent: number;
    crossDepartmentInboundCount: number;
  }>;
  studentUsageDistribution: Array<{
    studentId: string;
    studentName: string;
    departmentId: string;
    rolling30DayHoursUsed: number;
    approvedCount: number;
  }>;
}
