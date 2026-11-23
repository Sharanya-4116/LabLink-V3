import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="surface-card rounded-2xl p-10 text-center flex flex-col items-center">
      <div className="w-11 h-11 rounded-xl bg-[#F1F5F9] border border-[#E2E8F0] text-[#475569] flex items-center justify-center mb-3.5">
        <Icon className="w-5 h-5" aria-hidden="true" />
      </div>
      <h4 className="font-display text-sm sm:text-base font-bold text-[#0F172A]">{title}</h4>
      <p className="text-xs sm:text-sm text-[#64748B] mt-1 max-w-md leading-relaxed">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
