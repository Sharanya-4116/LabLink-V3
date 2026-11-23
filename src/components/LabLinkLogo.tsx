interface LabLinkLogoProps {
  className?: string;
  showWordmark?: boolean;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'dark' | 'light';
}

export function LabLinkLogo({
  className = '',
  showWordmark = true,
  size = 'md',
  tone = 'dark',
}: LabLinkLogoProps) {
  const iconDims = size === 'sm' ? 'w-6 h-6' : size === 'lg' ? 'w-9 h-9' : 'w-8 h-8';
  const textSize =
    size === 'sm' ? 'text-base' : size === 'lg' ? 'text-xl' : 'text-[19px]';
  const textColor = tone === 'light' ? 'text-white' : 'text-[#0F172A]';

  return (
    <span className={`inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 ${className}`}>
      <svg
        viewBox="0 0 36 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${iconDims} shrink-0`}
        aria-hidden="true"
      >
        <rect x="1.5" y="1.5" width="33" height="33" rx="9" fill="#0F172A" stroke="#1E293B" strokeWidth="1" />
        <path
          d="M11 12.5V22.5C11 23.3284 11.6716 24 12.5 24H18.5"
          stroke="#FFFFFF"
          strokeWidth="2.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M25 23.5V13.5C25 12.6716 24.3284 12 23.5 12H17.5"
          stroke="#38BDF8"
          strokeWidth="2.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="11" cy="11.25" r="2.3" fill="#10B981" />
        <circle cx="25" cy="24.75" r="2.3" fill="#38BDF8" />
        <rect x="15.25" y="15.25" width="5.5" height="5.5" rx="1.4" fill="#2563EB" stroke="#FFFFFF" strokeWidth="1.2" />
      </svg>
      {showWordmark && (
        <span
          className={`font-display ${textSize} font-bold tracking-tight ${textColor} leading-none`}
        >
          LabLink
        </span>
      )}
    </span>
  );
}
