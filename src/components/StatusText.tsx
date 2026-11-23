import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldAlert,
  Wrench,
  XCircle,
} from 'lucide-react';

interface StatusTextProps {
  status: string;
}

export function StatusText({ status }: StatusTextProps) {
  switch (status) {
    case 'AVAILABLE':
    case 'APPROVED':
    case 'CONFIRMED':
    case 'RETURNED':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#059669] whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{formatStatusLabel(status)}</span>
        </span>
      );
    case 'CHECKED_OUT':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1D4ED8] whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Checked Out</span>
        </span>
      );
    case 'PENDING':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1D4ED8] whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Pending Review</span>
        </span>
      );
    case 'CONFLICT_REVIEW':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#B45309] whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Conflict Review</span>
        </span>
      );
    case 'MAINTENANCE':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#B45309] whitespace-nowrap">
          <Wrench className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Maintenance</span>
        </span>
      );
    case 'REJECTED':
    case 'OFFLINE':
    case 'NO_SHOW':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#DC2626] whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{formatStatusLabel(status)}</span>
        </span>
      );
    case 'CANCELLED':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#64748B] whitespace-nowrap">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Cancelled</span>
        </span>
      );
    default:
      return (
        <span className="text-xs font-medium text-[#475569] whitespace-nowrap">
          {formatStatusLabel(status)}
        </span>
      );
  }
}

function formatStatusLabel(status: string): string {
  return status
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
