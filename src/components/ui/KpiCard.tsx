import type { LucideIcon } from 'lucide-react';

export type KpiTone = 'navy' | 'blue' | 'teal' | 'emerald' | 'amber';

interface KpiCardProps {
  label: string;
  value: string | number;
  subtext: string;
  icon: LucideIcon;
  tone?: KpiTone;
  progressPercent?: number;
  rightMeta?: string;
}

const TONE_MAP: Record<
  KpiTone,
  { valueClass: string; iconWrapClass: string; barClass: string; topAccentClass: string }
> = {
  navy: {
    valueClass: 'text-[#0F172A]',
    iconWrapClass: 'bg-[#0B132B] text-white border-[#1E293B]',
    barClass: 'bg-[#0F172A]',
    topAccentClass: 'bg-[#0B132B]',
  },
  blue: {
    valueClass: 'text-[#1D4ED8]',
    iconWrapClass: 'bg-[#EFF6FF] text-[#2563EB] border-[#BFDBFE]',
    barClass: 'bg-[#2563EB]',
    topAccentClass: 'bg-[#2563EB]',
  },
  teal: {
    valueClass: 'text-[#0D9488]',
    iconWrapClass: 'bg-[#F0FDFA] text-[#0D9488] border-[#99F6E4]',
    barClass: 'bg-[#0D9488]',
    topAccentClass: 'bg-[#0D9488]',
  },
  emerald: {
    valueClass: 'text-[#059669]',
    iconWrapClass: 'bg-[#ECFDF5] text-[#059669] border-[#A7F3D0]',
    barClass: 'bg-[#059669]',
    topAccentClass: 'bg-[#059669]',
  },
  amber: {
    valueClass: 'text-[#B45309]',
    iconWrapClass: 'bg-[#FFFBEB] text-[#B45309] border-[#FDE68A]',
    barClass: 'bg-[#B45309]',
    topAccentClass: 'bg-[#D97706]',
  },
};

export function KpiCard({
  label,
  value,
  subtext,
  icon: Icon,
  tone = 'navy',
  progressPercent,
  rightMeta,
}: KpiCardProps) {
  const styles = TONE_MAP[tone];

  return (
    <div className="surface-card-interactive rounded-2xl overflow-hidden flex flex-col justify-between">
      <div className={`h-1 w-full ${styles.topAccentClass}`} aria-hidden="true" />
      <div className="p-5 flex-1 flex flex-col justify-between gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium text-[#64748B]">
              <span className="truncate">{label}</span>
              {rightMeta && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono text-[11px] font-semibold text-[#475569] shrink-0">
                    {rightMeta}
                  </span>
                </>
              )}
            </div>
            <div
              className={`font-mono text-2xl sm:text-[30px] font-bold tabular-nums mt-1.5 leading-none tracking-tight ${styles.valueClass}`}
            >
              {value}
            </div>
          </div>
          <div
            className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${styles.iconWrapClass}`}
          >
            <Icon className="w-5 h-5" aria-hidden="true" />
          </div>
        </div>

        {typeof progressPercent === 'number' && (
          <div className="h-2 w-full bg-[#E2E8F0] rounded-full overflow-hidden">
            <div
              className={`h-full ${styles.barClass} transition-[width] duration-300`}
              style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
            />
          </div>
        )}

        <div className="text-xs text-[#475569] truncate pt-0.5">{subtext}</div>
      </div>
    </div>
  );
}
