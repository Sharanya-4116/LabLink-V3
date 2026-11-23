import { AlertCircle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import type { AlternativeSlot, SmartFairEvaluation } from '../../shared/types.ts';

interface SmartFairPanelProps {
  evaluation: SmartFairEvaluation;
  onSelectAlternativeSlot?: (slot: AlternativeSlot) => void;
  reschedulePending?: boolean;
}

const FACTOR_META = [
  { key: 'deadlineUrgency', label: 'Deadline Urgency', weightPct: 35, barColor: 'bg-[#1D4ED8]' },
  { key: 'capabilityMatch', label: 'Capability Fit', weightPct: 25, barColor: 'bg-[#2563EB]' },
  { key: 'waitingTime', label: 'Wait Time (Anti-Gaming)', weightPct: 20, barColor: 'bg-[#0F766E]' },
  { key: 'accessFairness', label: 'Access Fairness (30d)', weightPct: 10, barColor: 'bg-[#10B981]' },
  { key: 'utilizationEfficiency', label: 'Flush Utilization', weightPct: 10, barColor: 'bg-[#0F172A]' },
] as const;

const HARD_CONSTRAINTS = [
  { code: 'H1', label: 'Asset Available', match: 'EQUIPMENT_UNAVAILABLE' },
  { code: 'H2', label: 'Campus Hours & Cap', match: 'HOURS_OR_DURATION_VIOLATION' },
  { code: 'H3', label: 'Zero Overlap', match: 'SCHEDULE_CONFLICT' },
  { code: 'H4', label: 'Safety Certified', match: 'CERTIFICATION_REQUIRED' },
] as const;

export function SmartFairPanel({
  evaluation,
  onSelectAlternativeSlot,
  reschedulePending = false,
}: SmartFairPanelProps) {
  const scoreClamped = Math.max(0, Math.min(100, evaluation.score));
  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (scoreClamped / 100) * circumference;

  const ringStroke = !evaluation.eligible
    ? '#DC2626'
    : evaluation.isTopRecommended
      ? '#10B981'
      : '#2563EB';

  const violationSet = new Set(evaluation.violations.map((v) => v.code));

  return (
    <div className="border-t border-[#DCE4EE] pt-5 mt-5 space-y-5">
      {/* Midnight-Navy to Electric-Blue Score Gauge & Eligibility Banner */}
      <div className="surface-navy-featured text-white rounded-2xl p-5 flex flex-wrap items-center justify-between gap-5">
        <div className="relative z-10 flex items-center gap-5">
          <div className="relative w-22 h-22 shrink-0 flex items-center justify-center">
            <svg className="w-22 h-22 -rotate-90" viewBox="0 0 84 84" aria-hidden="true">
              <circle
                cx="42"
                cy="42"
                r={radius}
                fill="none"
                stroke="#1E293B"
                strokeWidth="6"
              />
              <circle
                cx="42"
                cy="42"
                r={radius}
                fill="none"
                stroke={ringStroke}
                strokeWidth="6"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
              />
            </svg>
            <div className="absolute flex flex-col items-center leading-none">
              <span className="font-mono text-lg font-bold text-white tabular-nums">
                {evaluation.score.toFixed(1)}
              </span>
              <span className="font-mono text-[10px] text-[#94A3B8] mt-0.5">/ 100</span>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-[#38BDF8]">
              SmartFair Composite Allocation Score
            </div>
            <h4 className="font-display text-base sm:text-lg font-bold text-white mt-0.5">
              {evaluation.eligible
                ? evaluation.isTopRecommended
                  ? 'Rank #1 Top Recommended Eligible Request'
                  : evaluation.recommendationRank
                    ? `Eligible Contender · Ranked #${evaluation.recommendationRank} in Cluster`
                    : 'Eligible · All Mandatory Hard Constraints Passed'
                : 'Ineligible · Blocked by Mandatory Hard Constraint'}
            </h4>
            <p className="text-xs text-[#CBD5E1] mt-1">
              {evaluation.eligible
                ? 'Weighted deterministically across 5 normalized fairness & engineering criteria.'
                : 'Hard safety and scheduling rules always override weighted ranking scores.'}
            </p>
          </div>
        </div>

        {/* H1–H4 Hard Constraint Gate Matrix */}
        <div className="relative z-10 grid grid-cols-2 gap-2 w-full lg:w-auto">
          {HARD_CONSTRAINTS.map((hc) => {
            const failed = violationSet.has(hc.match);
            return (
              <div
                key={hc.code}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs ${
                  failed
                    ? 'bg-[#7F1D1D]/40 border-[#F87171]/40 text-[#FCA5A5]'
                    : 'bg-[#1E293B] border-white/10 text-[#34D399]'
                }`}
              >
                {failed ? (
                  <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                )}
                <span className="font-mono font-bold">{hc.code}</span>
                <span className="text-[#E2E8F0] truncate">{hc.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detailed Hard Constraint Alert if any failed */}
      {evaluation.violations.length > 0 && (
        <div
          className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-4 space-y-1.5"
          role="alert"
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-[#B91C1C]">
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Hard Constraint Violations (Override Weighted Score)</span>
          </div>
          <ul className="space-y-1 text-xs text-[#7F1D1D] pl-5 list-disc">
            {evaluation.violations.map((v) => (
              <li key={v.code}>
                <span className="font-mono font-semibold">{v.code}:</span> {v.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Proportional Stacked Score Contribution Strip */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-[#0F172A]">Composite Point Contribution</span>
          <span className="font-mono text-[#475569] tabular-nums">
            {evaluation.score.toFixed(1)} / 100.0 pts earned
          </span>
        </div>
        <div className="h-3 w-full bg-[#E2E8F0] rounded-full overflow-hidden flex">
          {FACTOR_META.map((meta) => {
            const val = evaluation.factors[meta.key];
            const earnedPct = Math.max(0, val * meta.weightPct);
            return (
              <div
                key={meta.key}
                className={`h-full ${meta.barColor} border-r border-white/40 last:border-r-0 transition-[width] duration-300`}
                style={{ width: `${earnedPct}%` }}
                title={`${meta.label}: +${earnedPct.toFixed(1)}/${meta.weightPct} pts`}
              />
            );
          })}
        </div>
      </div>

      {/* 5 Weighted Factor Contribution Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {FACTOR_META.map((meta) => {
          const val = evaluation.factors[meta.key];
          const pct = Math.round(val * 100);
          const earnedPts = (val * meta.weightPct).toFixed(1);
          return (
            <div
              key={meta.key}
              className="surface-card rounded-xl p-3.5 space-y-2.5"
            >
              <div className="flex items-center justify-between gap-1 text-xs">
                <span className="font-semibold text-[#0F172A] truncate" title={meta.label}>
                  {meta.label}
                </span>
                <span className="font-mono text-[#64748B] tabular-nums shrink-0">
                  {meta.weightPct}%
                </span>
              </div>
              <div className="h-2 w-full bg-[#F1F5F9] rounded-full overflow-hidden">
                <div
                  className={`h-full ${meta.barColor} transition-[width] duration-200`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-baseline justify-between font-mono text-xs tabular-nums">
                <span className="font-bold text-[#0F172A]">{pct}%</span>
                <span className="text-[#475569]">
                  +{earnedPts}/{meta.weightPct} pts
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Explanation Sentences */}
      <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4 space-y-1.5">
        <div className="text-xs font-semibold text-[#0F172A]">Factor Reasoning</div>
        <ul className="space-y-1 text-xs text-[#475569] list-disc pl-4 leading-relaxed">
          {evaluation.explanation.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      </div>

      {/* Alternative Slots */}
      {evaluation.alternativeSlots.length > 0 && (
        <div className="border-t border-[#E2E8F0] pt-4">
          <div className="text-xs font-semibold text-[#0F172A] mb-2.5">
            Nearest Valid Alternative Slots (Asia/Kolkata)
          </div>
          <div className="flex flex-wrap gap-2.5">
            {evaluation.alternativeSlots.map((slot) =>
              onSelectAlternativeSlot ? (
                <button
                  key={slot.startTime}
                  type="button"
                  disabled={reschedulePending}
                  onClick={() => onSelectAlternativeSlot(slot)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-[#1D4ED8] bg-[#EFF6FF] border border-[#BFDBFE] rounded-xl hover:bg-[#1D4ED8] hover:text-white hover:border-[#1D4ED8] transition-colors whitespace-nowrap disabled:opacity-50"
                >
                  <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className="font-mono tabular-nums">{slot.campusLabel}</span>
                  <span>· Reschedule Here</span>
                </button>
              ) : (
                <span
                  key={slot.startTime}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono text-[#334155] bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg tabular-nums"
                >
                  <Clock className="w-3.5 h-3.5 text-[#64748B] shrink-0" aria-hidden="true" />
                  {slot.campusLabel}
                </span>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
