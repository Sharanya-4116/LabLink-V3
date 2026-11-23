import type { ReactNode } from 'react';

interface PageHeaderProps {
  kicker: string;
  title: string;
  description: string;
  contextLine?: ReactNode;
  actions?: ReactNode;
  rightSlot?: ReactNode;
  variant?: 'default' | 'hero';
}

export function PageHeader({
  kicker,
  title,
  description,
  contextLine,
  actions,
  rightSlot,
  variant = 'hero',
}: PageHeaderProps) {
  if (variant === 'hero') {
    return (
      <section className="surface-navy-featured rounded-2xl text-white p-6 sm:p-7">
        {/* Restrained geometric translucent ring accents (pointer-events: none) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-14 -top-16 w-64 h-64 rounded-full border border-[#38BDF8]/15"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-6 -top-8 w-44 h-44 rounded-full border border-white/10"
        />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2 min-w-0 max-w-3xl">
            <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-[#38BDF8]">
              {kicker}
            </div>
            <h2
              className="font-display text-2xl sm:text-[28px] font-bold tracking-tight text-white leading-tight"
              style={{ textWrap: 'balance' }}
            >
              {title}
            </h2>
            <p className="text-sm text-[#CBD5E1] leading-relaxed max-w-2xl">{description}</p>
            {contextLine && (
              <div className="text-xs text-[#94A3B8] pt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                {contextLine}
              </div>
            )}
          </div>

          {(actions || rightSlot) && (
            <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-start sm:items-center lg:items-end xl:items-center gap-3.5 shrink-0">
              {rightSlot}
              {actions && <div className="flex flex-wrap items-center gap-2.5">{actions}</div>}
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="surface-card rounded-2xl px-6 py-5 flex flex-wrap items-center justify-between gap-4">
      <div className="space-y-1 min-w-0 max-w-3xl">
        <div className="text-[11px] font-mono font-semibold uppercase tracking-[0.12em] text-[#2563EB]">
          {kicker}
        </div>
        <h2 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[#0F172A] leading-tight">
          {title}
        </h2>
        <p className="text-sm text-[#475569] leading-relaxed">{description}</p>
        {contextLine && (
          <div className="text-xs text-[#64748B] pt-0.5 flex flex-wrap items-center gap-2">
            {contextLine}
          </div>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5 shrink-0">{actions}</div>}
    </section>
  );
}
