import { useEffect, useRef, useState } from 'react';
import { ImageOff, RotateCcw } from 'lucide-react';

interface SignatureImageProps {
  src?: string;
  alt?: string;
  className?: string;
  fallbackText?: string;
  fallbackClassName?: string;
}

// Renders a signature image from its stored `src` (base64 data URL or http(s) URL).
// Some older/corrupt rows hold a truncated or non-image string in `dataUrl`, which
// previously produced a broken-image icon. This component validates the URL and swaps
// in a small "signature unavailable" placeholder — but only after a few timed retries,
// because a single transient 404 (object written a moment ago, backend restarting,
// proxy hiccup) must not latch the placeholder while the image is actually available.
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [800, 1600]; // ms before attempts 2 and 3
const DATA_URL_RE = /^data:/i;

function retrySrc(src: string, attempt: number) {
  if (attempt === 0 || DATA_URL_RE.test(src)) return src;
  return `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}`;
}

export function SignatureImage({
  src,
  alt = 'Signature',
  className,
  fallbackText = 'Signature unavailable',
  fallbackClassName = ''
}: SignatureImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A new/changed source starts a fresh retry budget.
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [src]);

  const handleError = () => {
    // Base64 payloads cannot appear/disappear — fail straight away.
    if (src && DATA_URL_RE.test(src)) {
      setFailed(true);
      return;
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setAttempt((a) => a + 1), RETRY_DELAYS[attempt] ?? 1200);
    } else {
      setFailed(true);
    }
  };

  const handleRetryNow = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setFailed(false);
    setAttempt((a) => a + 1);
  };

  const looksValid =
    !!src &&
    src.length > 16 &&
    (/^data:image\//i.test(src) || /^https?:\/\//i.test(src) || src.startsWith('/'));

  if (!looksValid) {
    return (
      <div className={`inline-flex items-center justify-center gap-1.5 text-slate-400 text-[10px] font-semibold ${fallbackClassName}`}>
        <ImageOff className="w-3.5 h-3.5 shrink-0" />
        <span>{fallbackText}</span>
      </div>
    );
  }

  if (failed) {
    return (
      <div className={`inline-flex items-center justify-center gap-1.5 text-slate-400 text-[10px] font-semibold ${fallbackClassName}`}>
        <ImageOff className="w-3.5 h-3.5 shrink-0" />
        <span>{fallbackText}</span>
        <button
          type="button"
          onClick={handleRetryNow}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Retry loading signature image"
        >
          <RotateCcw className="w-3 h-3" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <img
      src={retrySrc(src!, attempt)}
      alt={alt}
      className={className}
      onError={handleError}
    />
  );
}
