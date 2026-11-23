import { z } from 'zod';

export const RoleSchema = z.enum(['STUDENT', 'FACULTY', 'ADMIN']);
export const EquipmentStatusSchema = z.enum(['AVAILABLE', 'MAINTENANCE', 'OFFLINE']);

export const OperatingHoursSchema = z
  .object({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(1).max(24),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
  })
  .refine((v) => v.endHour > v.startHour, {
    message: 'endHour must be greater than startHour',
  });

export const IsoTimestampSchema = z.string().refine(
  (val) => !Number.isNaN(Date.parse(val)),
  { message: 'Invalid ISO-8601 timestamp' }
);

export const CreateBookingRequestSchema = z
  .object({
    equipmentId: z.string().min(1, 'Equipment is required'),
    projectTitle: z.string().trim().min(4, 'Project title must be at least 4 characters').max(140),
    projectSummary: z.string().trim().min(10, 'Project summary must be at least 10 characters').max(1200),
    requiredCapabilities: z.array(z.string().trim().min(1)).min(1, 'Select at least one capability'),
    justification: z.string().trim().min(10, 'Justification must be at least 10 characters').max(1000),
    requestedStart: IsoTimestampSchema,
    requestedEnd: IsoTimestampSchema,
    projectDeadline: IsoTimestampSchema,
  })
  .refine((data) => Date.parse(data.requestedEnd) > Date.parse(data.requestedStart), {
    message: 'Requested end time must be after start time',
    path: ['requestedEnd'],
  });

export const RescheduleBookingRequestSchema = z
  .object({
    requestedStart: IsoTimestampSchema,
    requestedEnd: IsoTimestampSchema,
  })
  .refine((data) => Date.parse(data.requestedEnd) > Date.parse(data.requestedStart), {
    message: 'Requested end time must be after start time',
    path: ['requestedEnd'],
  });

export const OverrideReasonCodeSchema = z.enum([
  'SAFETY_CRITICAL_PRIORITY',
  'CAPSTONE_DEMO_DEADLINE',
  'EQUIPMENT_CALIBRATION_BATCH',
  'FACULTY_RESEARCH_GRANT',
  'CROSS_DEPT_EMERGENCY',
]);

export const FacultyDecisionSchema = z
  .object({
    decision: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().trim().min(5, 'Decision explanation is required (min 5 characters)').max(800),
    isOverride: z.boolean().default(false),
    overrideReasonCode: OverrideReasonCodeSchema.optional(),
    overrideJustification: z.string().trim().max(1000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.isOverride) {
      if (!data.overrideReasonCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Override reason code is required when overriding SmartFair recommendation',
          path: ['overrideReasonCode'],
        });
      }
      if (!data.overrideJustification || data.overrideJustification.trim().length < 15) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Override justification must be at least 15 characters',
          path: ['overrideJustification'],
        });
      }
    }
  });

export const CreateMaintenanceWindowSchema = z
  .object({
    equipmentId: z.string().min(1),
    startTime: IsoTimestampSchema,
    endTime: IsoTimestampSchema,
    reason: z.string().trim().min(5, 'Maintenance reason is required').max(500),
  })
  .refine((data) => Date.parse(data.endTime) > Date.parse(data.startTime), {
    message: 'Maintenance end time must be after start time',
    path: ['endTime'],
  });

export const CreateEquipmentSchema = z.object({
  assetTag: z.string().trim().min(3, 'Asset tag must be at least 3 characters').max(40).toUpperCase(),
  name: z.string().trim().min(3, 'Equipment name must be at least 3 characters').max(120),
  category: z.string().trim().min(2, 'Category is required').max(60),
  departmentId: z.string().min(1, 'Department is required'),
  labRoom: z.string().trim().min(2, 'Lab room is required').max(80),
  description: z.string().trim().max(600).optional().default(''),
  specs: z.record(z.string(), z.string()).default({}),
  capabilities: z.array(z.string().trim().min(1)).min(1, 'Provide at least one capability tag'),
  requiredCertifications: z.array(z.string().trim().min(1)).default([]),
  maxBookingHours: z.number().min(0.5).max(24),
  operatingHours: OperatingHoursSchema,
  status: EquipmentStatusSchema.default('AVAILABLE'),
  capacity: z.number().int().min(1).max(20).default(1),
  imageUrl: z
    .string()
    .trim()
    .min(1)
    .refine((val) => val.startsWith('/') && !val.startsWith('//'), {
      message: 'Image must reference a curated local equipment asset path',
    }),
});

export const UpdateEquipmentSchema = z.object({
  status: EquipmentStatusSchema.optional(),
  maxBookingHours: z.number().min(0.5).max(24).optional(),
  operatingHours: OperatingHoursSchema.optional(),
  labRoom: z.string().trim().min(2).max(80).optional(),
  requiredCertifications: z.array(z.string().trim().min(1)).optional(),
});

export const UpdateUserSchema = z.object({
  role: RoleSchema.optional(),
  departmentId: z.string().min(1).optional(),
  certifications: z.array(z.string().trim().min(1)).optional(),
});

export const CreateDepartmentSchema = z.object({
  code: z.string().trim().min(2).max(10).toUpperCase(),
  name: z.string().trim().min(3).max(100),
  building: z.string().trim().min(2).max(100),
  contactEmail: z.string().email(),
});

export const SweepNoShowsSchema = z.object({
  nowIso: IsoTimestampSchema.optional(),
});

export const MarkNoShowSchema = z.object({
  reason: z.string().trim().max(400).optional(),
  nowIso: IsoTimestampSchema.optional(),
});
