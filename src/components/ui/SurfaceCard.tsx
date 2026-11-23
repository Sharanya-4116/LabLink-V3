import type { ReactNode } from 'react';

interface SurfaceCardProps {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
  tone?: 'elevated' | 'tinted';
}

export function SurfaceCard({
  children,
  className = '',
  interactive = false,
  tone = 'elevated',
}: SurfaceCardProps) {
  const toneClass =
    tone === 'tinted'
      ? 'surface-tinted border'
      : interactive
        ? 'surface-card-interactive'
        : 'surface-card';

  return <div className={`${toneClass} rounded-2xl ${className}`}>{children}</div>;
}

interface SurfaceCardHeaderProps {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  dark?: boolean;
  headingId?: string;
}

export function SurfaceCardHeader({
  title,
  subtitle,
  action,
  dark = false,
  headingId,
}: SurfaceCardHeaderProps) {
  return (
    <div
      className={`px-5 py-4 border-b flex flex-wrap items-center justify-between gap-3 ${
        dark
          ? 'bg-gradient-to-r from-[#0B132B] via-[#0F1B3D] to-[#132656] text-white border-[#1E293B]'
          : 'bg-[#F3F6FA]/85 text-[#0F172A] border-[#DCE4EE]'
      }`}
    >
      <div className="min-w-0">
        <h3
          id={headingId}
          className={`font-display text-sm sm:text-base font-bold truncate ${
            dark ? 'text-white' : 'text-[#0F172A]'
          }`}
        >
          {title}
        </h3>
        {subtitle && (
          <p className={`text-xs mt-0.5 ${dark ? 'text-[#CBD5E1]' : 'text-[#64748B]'}`}>
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
