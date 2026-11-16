import { useState } from 'react';
import { ImageOff } from 'lucide-react';

interface SignatureImageProps {
  src?: string;
  alt?: string;
  className?: string;
  fallbackText?: string;
  fallbackClassName?: string;
}

// Renders a signature image from its stored `src` (base64 data URL or http(s) URL).
// Some older/corrupt rows hold a truncated or non-image string in `dataUrl`, which
// previously produced a broken-image icon. This component validates the URL, hides
// itself on load failure, and swaps in a small "signature unavailable" placeholder.
export function SignatureImage({
  src,
  alt = 'Signature',
  className,
  fallbackText = 'Signature unavailable',
  fallbackClassName = ''
}: SignatureImageProps) {
  const [failed, setFailed] = useState(false);

  const looksValid =
    !!src &&
    src.length > 16 &&
    (/^data:image\//i.test(src) || /^https?:\/\//i.test(src) || src.startsWith('/'));

  if (failed || !looksValid) {
    return (
      <div className={`inline-flex items-center justify-center gap-1.5 text-slate-400 text-[10px] font-semibold ${fallbackClassName}`}>
        <ImageOff className="w-3.5 h-3.5 shrink-0" />
        <span>{fallbackText}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}