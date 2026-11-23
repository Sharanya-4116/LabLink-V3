import { DateTime } from 'luxon';
import type { OperatingHours } from './types.ts';

export const DEFAULT_CAMPUS_TIMEZONE = 'Asia/Kolkata';

export function getCampusTimezone(): string {
  if (typeof process !== 'undefined' && process.env && process.env.CAMPUS_TIMEZONE) {
    return process.env.CAMPUS_TIMEZONE;
  }
  return DEFAULT_CAMPUS_TIMEZONE;
}

export function toEpochMs(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid ISO timestamp: ${iso}`);
  }
  return ms;
}

export function intervalsOverlap(
  startA: number,
  endA: number,
  startB: number,
  endB: number
): boolean {
  return startA < endB && startB < endA;
}

export interface CampusDaySegment {
  dateKey: string; // YYYY-MM-DD in campus timezone
  dayOfWeek: number; // 0=Sun .. 6=Sat
  startHourDecimal: number; // 0..24
  endHourDecimal: number; // 0..24
  startMs: number;
  endMs: number;
  dayStartMs: number;
}

/**
 * Splits an arbitrary UTC interval [startIso, endIso) along local midnight boundaries
 * in the configured campus timezone (default Asia/Kolkata), safely handling any
 * timezone transitions without off-by-one-hour drift.
 */
export function splitIntervalByCampusDays(
  startIso: string,
  endIso: string,
  timezone: string = getCampusTimezone()
): CampusDaySegment[] {
  const startMs = toEpochMs(startIso);
  const endMs = toEpochMs(endIso);
  if (endMs <= startMs) {
    return [];
  }

  const segments: CampusDaySegment[] = [];
  let cursor = DateTime.fromMillis(startMs, { zone: timezone });
  const endDt = DateTime.fromMillis(endMs, { zone: timezone });

  while (cursor.toMillis() < endDt.toMillis()) {
    const dayStart = cursor.startOf('day');
    const nextDayStart = dayStart.plus({ days: 1 });
    const segEnd = endDt.toMillis() < nextDayStart.toMillis() ? endDt : nextDayStart;

    const dayStartMs = dayStart.toMillis();
    const segStartMs = cursor.toMillis();
    const segEndMs = segEnd.toMillis();

    // Compute exact fractional hours using Luxon diff in hours to respect DST/offset transitions cleanly
    const startHourDecimal = cursor.diff(dayStart, 'hours').hours;
    const endHourDecimal = segEnd.diff(dayStart, 'hours').hours;

    // Luxon weekday: 1=Mon..7=Sun -> convert to JS 0=Sun..6=Sat
    const dayOfWeek = dayStart.weekday === 7 ? 0 : dayStart.weekday;
    const dateKey = dayStart.toFormat('yyyy-MM-dd');

    segments.push({
      dateKey,
      dayOfWeek,
      startHourDecimal,
      endHourDecimal,
      startMs: segStartMs,
      endMs: segEndMs,
      dayStartMs,
    });

    cursor = nextDayStart;
  }

  return segments;
}

export interface SlotBucketRef {
  lockId: string;
  bucketKey: string;
}

/**
 * Partitions each operating day in Asia/Kolkata into 60-minute buckets (0..23)
 * and returns deterministic slot-bucket lock IDs for every touched hour bucket.
 */
export function computeSlotBucketIds(
  equipmentId: string,
  startIso: string,
  endIso: string,
  timezone: string = getCampusTimezone()
): SlotBucketRef[] {
  const segments = splitIntervalByCampusDays(startIso, endIso, timezone);
  const refs: SlotBucketRef[] = [];
  const seen = new Set<string>();

  for (const seg of segments) {
    const startBucket = Math.max(0, Math.floor(seg.startHourDecimal));
    // Subtract tiny epsilon so exact end-of-hour (e.g. 11:00:00.000) does not lock bucket 11
    const endBucket = Math.min(23, Math.floor(Math.max(seg.startHourDecimal, seg.endHourDecimal - 1e-9)));

    for (let h = startBucket; h <= endBucket; h++) {
      const bucketKey = `${seg.dateKey}_H${h}`;
      const lockId = `${equipmentId}_${bucketKey}`;
      if (!seen.has(lockId)) {
        seen.add(lockId);
        refs.push({ lockId, bucketKey });
      }
    }
  }

  return refs;
}

export interface OperatingHoursValidationResult {
  valid: boolean;
  reason?: string;
  durationHours: number;
  segments: CampusDaySegment[];
}

export function validateOperatingHoursAndDuration(
  startIso: string,
  endIso: string,
  operatingHours: OperatingHours,
  maxBookingHours: number,
  timezone: string = getCampusTimezone()
): OperatingHoursValidationResult {
  const startMs = toEpochMs(startIso);
  const endMs = toEpochMs(endIso);
  const durationHours = (endMs - startMs) / 3_600_000;

  if (endMs <= startMs) {
    return {
      valid: false,
      reason: 'End time must be strictly after start time.',
      durationHours: 0,
      segments: [],
    };
  }

  if (durationHours > maxBookingHours + 1e-9) {
    return {
      valid: false,
      reason: `Requested duration (${durationHours.toFixed(1)}h) exceeds equipment limit (${maxBookingHours}h).`,
      durationHours,
      segments: [],
    };
  }

  const segments = splitIntervalByCampusDays(startIso, endIso, timezone);

  for (const seg of segments) {
    if (!operatingHours.daysOfWeek.includes(seg.dayOfWeek)) {
      const dayName = DateTime.fromMillis(seg.dayStartMs, { zone: timezone }).toFormat('ccc');
      return {
        valid: false,
        reason: `Laboratory is closed on ${dayName} (${seg.dateKey} ${timezone}).`,
        durationHours,
        segments,
      };
    }

    if (
      seg.startHourDecimal < operatingHours.startHour - 1e-6 ||
      seg.endHourDecimal > operatingHours.endHour + 1e-6
    ) {
      return {
        valid: false,
        reason: `Segment on ${seg.dateKey} (${seg.startHourDecimal.toFixed(2)}h–${seg.endHourDecimal.toFixed(2)}h) falls outside operating hours (${String(operatingHours.startHour).padStart(2, '0')}:00–${String(operatingHours.endHour).padStart(2, '0')}:00 ${timezone}).`,
        durationHours,
        segments,
      };
    }
  }

  return {
    valid: true,
    durationHours,
    segments,
  };
}

export function formatCampusDateTime(
  iso: string,
  timezone: string = getCampusTimezone()
): string {
  return DateTime.fromISO(iso, { zone: 'utc' })
    .setZone(timezone)
    .toFormat('dd LLL yyyy, HH:mm');
}

export function formatCampusSlotRange(
  startIso: string,
  endIso: string,
  timezone: string = getCampusTimezone()
): string {
  const start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(timezone);
  const end = DateTime.fromISO(endIso, { zone: 'utc' }).setZone(timezone);
  if (start.hasSame(end, 'day')) {
    return `${start.toFormat('dd LLL yyyy · HH:mm')}–${end.toFormat('HH:mm')} IST`;
  }
  return `${start.toFormat('dd LLL HH:mm')} – ${end.toFormat('dd LLL HH:mm')} IST`;
}

export function toCampusDatetimeLocalValue(
  iso: string,
  timezone: string = getCampusTimezone()
): string {
  return DateTime.fromISO(iso, { zone: 'utc' })
    .setZone(timezone)
    .toFormat("yyyy-MM-dd'T'HH:mm");
}

export function fromCampusDatetimeLocalValue(
  localValue: string,
  timezone: string = getCampusTimezone()
): string {
  const dt = DateTime.fromFormat(localValue, "yyyy-MM-dd'T'HH:mm", { zone: timezone });
  if (!dt.isValid) {
    throw new Error(`Invalid campus local datetime: ${localValue}`);
  }
  return dt.toUTC().toISO() ?? new Date(dt.toMillis()).toISOString();
}

export function buildIcsCalendarInvite(params: {
  reservationId: string;
  equipmentName: string;
  labRoom: string;
  projectTitle: string;
  startTime: string;
  endTime: string;
  studentEmail: string;
}): string {
  const formatIcsUtc = (iso: string) =>
    DateTime.fromISO(iso, { zone: 'utc' }).toFormat("yyyyMMdd'T'HHmmss'Z'");

  const nowStamp = DateTime.utc().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const escapeText = (value: string) =>
    value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LabLink V3//Campus Laboratory Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:lablink-${params.reservationId}@campus.edu`,
    `DTSTAMP:${nowStamp}`,
    `DTSTART:${formatIcsUtc(params.startTime)}`,
    `DTEND:${formatIcsUtc(params.endTime)}`,
    `SUMMARY:${escapeText(`LabLink: ${params.equipmentName} — ${params.projectTitle}`)}`,
    `LOCATION:${escapeText(params.labRoom)}`,
    `DESCRIPTION:${escapeText(`Confirmed laboratory reservation for ${params.projectTitle}. Attendee: ${params.studentEmail}.`)}`,
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
