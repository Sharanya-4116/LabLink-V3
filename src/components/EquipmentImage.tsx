import { useState } from 'react';
import { Cpu } from 'lucide-react';

interface EquipmentImageProps {
  src: string;
  alt: string;
  title: string;
  className?: string;
}

export function EquipmentImage({ src, alt, title, className = '' }: EquipmentImageProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-[#EFF6FF] text-[#1E3A8A] p-4 ${className}`}
        role="img"
        aria-label={alt}
      >
        <Cpu className="w-8 h-8 text-[#1D4ED8] mb-2" aria-hidden="true" />
        <span className="text-xs font-medium text-center line-clamp-2">{title}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={className}
    />
  );
}
