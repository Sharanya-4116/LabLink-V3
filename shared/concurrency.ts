import { intervalsOverlap, toEpochMs } from './timezone.ts';

export interface TimeInterval {
  startMs: number;
  endMs: number;
}

export interface BenchInterval {
  startTime: string;
  endTime: string;
  benchNumber?: number;
}

/**
 * Computes the maximum number of simultaneously active intervals at any instant
 * inside [candidateStartMs, candidateEndMs) using an exact sweep-line algorithm.
 *
 * At identical timestamps, ending events (-1) are processed before starting events (+1)
 * so exact back-to-back handoffs (e.g. 10:00–12:00 followed by 12:00–14:00)
 * do not artificially inflate peak concurrency.
 */
export function computePeakConcurrentUsage(
  existingIntervals: TimeInterval[],
  candidateStartMs: number,
  candidateEndMs: number
): number {
  if (candidateEndMs <= candidateStartMs) {
    return 0;
  }

  const events: Array<{ time: number; delta: -1 | 1 }> = [];

  for (const existing of existingIntervals) {
    if (!intervalsOverlap(existing.startMs, existing.endMs, candidateStartMs, candidateEndMs)) {
      continue;
    }
    const clippedStart = Math.max(existing.startMs, candidateStartMs);
    const clippedEnd = Math.min(existing.endMs, candidateEndMs);
    if (clippedEnd > clippedStart) {
      events.push({ time: clippedStart, delta: 1 });
      events.push({ time: clippedEnd, delta: -1 });
    }
  }

  if (events.length === 0) {
    return 0;
  }

  events.sort((a, b) => a.time - b.time || a.delta - b.delta);

  let current = 0;
  let peak = 0;
  for (const evt of events) {
    current += evt.delta;
    if (current > peak) {
      peak = current;
    }
  }

  return peak;
}

/**
 * Finds the lowest physical bench number (1..capacity) that has zero overlap
 * with any existing reservation across the entire [candidateStartMs, candidateEndMs) interval.
 * Returns null if all benches are occupied for at least part of the requested interval.
 */
export function assignLowestAvailableBench(
  existingReservations: BenchInterval[],
  candidateStartMs: number,
  candidateEndMs: number,
  capacity: number
): number | null {
  const safeCapacity = Math.max(1, Math.floor(capacity));
  if (candidateEndMs <= candidateStartMs) {
    return null;
  }

  const overlapping = existingReservations.filter((r) =>
    intervalsOverlap(candidateStartMs, candidateEndMs, toEpochMs(r.startTime), toEpochMs(r.endTime))
  );

  for (let bench = 1; bench <= safeCapacity; bench++) {
    const isBenchOccupied = overlapping.some((r) => (r.benchNumber ?? 1) === bench);
    if (!isBenchOccupied) {
      return bench;
    }
  }

  return null;
}

export interface CapacityEvaluationResult {
  allowed: boolean;
  peakConcurrentUsage: number;
  assignedBenchNumber: number | null;
  reason?: string;
}

/**
 * Evaluates whether a candidate booking interval fits within equipment.capacity
 * using both sweep-line peak concurrency and contiguous single-bench assignment.
 */
export function evaluateIntervalCapacity(
  existingReservations: BenchInterval[],
  candidateStartMs: number,
  candidateEndMs: number,
  capacity: number
): CapacityEvaluationResult {
  const safeCapacity = Math.max(1, Math.floor(capacity));
  const intervals: TimeInterval[] = existingReservations.map((r) => ({
    startMs: toEpochMs(r.startTime),
    endMs: toEpochMs(r.endTime),
  }));

  const peakConcurrentUsage = computePeakConcurrentUsage(
    intervals,
    candidateStartMs,
    candidateEndMs
  );

  if (peakConcurrentUsage + 1 > safeCapacity) {
    return {
      allowed: false,
      peakConcurrentUsage,
      assignedBenchNumber: null,
      reason: `Peak concurrent occupancy (${peakConcurrentUsage}/${safeCapacity} benches) leaves no capacity for an additional reservation.`,
    };
  }

  const assignedBenchNumber = assignLowestAvailableBench(
    existingReservations,
    candidateStartMs,
    candidateEndMs,
    safeCapacity
  );

  if (assignedBenchNumber === null) {
    return {
      allowed: false,
      peakConcurrentUsage,
      assignedBenchNumber: null,
      reason: `All ${safeCapacity} bench(es) have overlapping reservations during part of the requested window.`,
    };
  }

  return {
    allowed: true,
    peakConcurrentUsage,
    assignedBenchNumber,
  };
}
