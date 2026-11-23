import type {
  AnalyticsSummary,
  AuditLog,
  BookingRequest,
  Department,
  Equipment,
  MaintenanceWindow,
  PublicOverview,
  Reservation,
  Role,
  SlotLock,
  User,
} from '../../shared/types.ts';

export interface SessionInfo {
  appMode: 'demo' | 'production';
  allowDemoRoleSwitch: boolean;
  campusTimezone: string;
  noShowGraceMinutes?: number;
  user: User | null;
  demoUsers: User[];
}

export interface EnrichedBookingRequest extends BookingRequest {
  studentName: string;
  studentDepartmentId: string;
  equipmentName: string;
  equipmentDepartmentId: string;
}

export interface EnrichedReservation extends Reservation {
  equipmentName: string;
  labRoom: string;
  studentName: string;
  projectTitle: string;
}

export interface EnrichedAuditLog extends AuditLog {
  actorName: string;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let activeDemoUserId: string | null = null;
let activeBearerToken: string | null = null;

export function setAuthHeadersContext(opts: {
  demoUserId?: string | null;
  bearerToken?: string | null;
}) {
  if (opts.demoUserId !== undefined) activeDemoUserId = opts.demoUserId;
  if (opts.bearerToken !== undefined) activeBearerToken = opts.bearerToken;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (activeBearerToken) {
    headers.set('Authorization', `Bearer ${activeBearerToken}`);
  } else if (activeDemoUserId) {
    headers.set('x-demo-user-id', activeDemoUserId);
  }

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new ApiClientError(
      res.status,
      payload.error || 'REQUEST_FAILED',
      payload.message || `Request failed with status ${res.status}`,
      payload.details
    );
  }
  return res.json() as Promise<T>;
}

export const api = {
  getPublicOverview: () => apiFetch<PublicOverview>('/api/public/overview'),

  getSession: () => apiFetch<SessionInfo>('/api/auth/session'),

  getDepartments: () => apiFetch<{ departments: Department[] }>('/api/departments'),

  createDepartment: (body: Omit<Department, 'id'>) =>
    apiFetch<{ department: Department }>('/api/departments', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getEquipment: (params?: {
    departmentId?: string;
    category?: string;
    status?: string;
    search?: string;
    certifiedOnly?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params?.departmentId) qs.set('departmentId', params.departmentId);
    if (params?.category) qs.set('category', params.category);
    if (params?.status) qs.set('status', params.status);
    if (params?.search) qs.set('search', params.search);
    if (params?.certifiedOnly) qs.set('certifiedOnly', 'true');
    const query = qs.toString();
    return apiFetch<{ equipment: Equipment[] }>(`/api/equipment${query ? `?${query}` : ''}`);
  },

  createEquipment: (body: Omit<Equipment, 'id'>) =>
    apiFetch<{ equipment: Equipment }>('/api/equipment', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateEquipment: (
    id: string,
    body: Partial<Pick<Equipment, 'status' | 'maxBookingHours' | 'operatingHours' | 'labRoom'>>
  ) =>
    apiFetch<{ equipment: Equipment }>(`/api/equipment/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  getEquipmentSchedule: (id: string, requestedStart?: string, durationHours?: number) => {
    const qs = new URLSearchParams();
    if (requestedStart) qs.set('requestedStart', requestedStart);
    if (durationHours) qs.set('durationHours', String(durationHours));
    const q = qs.toString();
    return apiFetch<{
      equipment: Equipment;
      reservations: Reservation[];
      maintenanceWindows: MaintenanceWindow[];
      slotLocks: SlotLock[];
      alternativeSlots: Array<{ startTime: string; endTime: string; campusLabel: string }>;
    }>(`/api/equipment/${id}/schedule${q ? `?${q}` : ''}`);
  },

  getBookings: () => apiFetch<{ bookings: EnrichedBookingRequest[] }>('/api/bookings'),

  createBooking: (body: {
    equipmentId: string;
    projectTitle: string;
    projectSummary: string;
    requiredCapabilities: string[];
    justification: string;
    requestedStart: string;
    requestedEnd: string;
    projectDeadline: string;
  }) =>
    apiFetch<{ booking: BookingRequest }>('/api/bookings', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  rescheduleBooking: (id: string, body: { requestedStart: string; requestedEnd: string }) =>
    apiFetch<{ booking: BookingRequest }>(`/api/bookings/${id}/reschedule`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  cancelBooking: (id: string) =>
    apiFetch<{ booking: BookingRequest }>(`/api/bookings/${id}/cancel`, {
      method: 'POST',
    }),

  submitFacultyDecision: (
    id: string,
    body: {
      decision: 'APPROVE' | 'REJECT';
      reason: string;
      isOverride: boolean;
      overrideReasonCode?: string;
      overrideJustification?: string;
    }
  ) =>
    apiFetch<{
      request: BookingRequest;
      reservation: Reservation | null;
      conflictedRequestIds: string[];
    }>(`/api/bookings/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getReservations: () => apiFetch<{ reservations: EnrichedReservation[] }>('/api/reservations'),

  checkoutReservation: (id: string) =>
    apiFetch<{ reservation: Reservation }>(`/api/reservations/${id}/checkout`, { method: 'POST' }),

  returnReservation: (id: string) =>
    apiFetch<{ reservation: Reservation }>(`/api/reservations/${id}/return`, { method: 'POST' }),

  sweepNoShows: (nowIso?: string) =>
    apiFetch<{ releasedReservations: Reservation[]; releasedCount: number }>(
      '/api/reservations/sweep-no-shows',
      {
        method: 'POST',
        body: JSON.stringify(nowIso ? { nowIso } : {}),
      }
    ),

  markReservationNoShow: (id: string, body?: { reason?: string; nowIso?: string }) =>
    apiFetch<{ reservation: Reservation }>(`/api/reservations/${id}/no-show`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
    }),

  downloadIcsUrl: async (reservationId: string) => {
    const headers = new Headers();
    if (activeBearerToken) headers.set('Authorization', `Bearer ${activeBearerToken}`);
    else if (activeDemoUserId) headers.set('x-demo-user-id', activeDemoUserId);

    const res = await fetch(`/api/reservations/${reservationId}/ics`, { headers });
    if (!res.ok) throw new Error('Unable to download calendar invite');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lablink-${reservationId}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  getMaintenanceWindows: () =>
    apiFetch<{ maintenanceWindows: MaintenanceWindow[] }>('/api/maintenance'),

  createMaintenanceWindow: (body: {
    equipmentId: string;
    startTime: string;
    endTime: string;
    reason: string;
  }) =>
    apiFetch<{ window: MaintenanceWindow; impactedRequestIds: string[] }>('/api/maintenance', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getAnalytics: () => apiFetch<{ analytics: AnalyticsSummary }>('/api/analytics'),

  getAuditLogs: () => apiFetch<{ auditLogs: EnrichedAuditLog[] }>('/api/audit-logs'),

  getUsers: () => apiFetch<{ users: User[] }>('/api/users'),

  updateUser: (
    id: string,
    body: { role?: Role; departmentId?: string; certifications?: string[] }
  ) =>
    apiFetch<{ user: User }>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};
