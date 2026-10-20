'use client';
import React, { useState } from 'react';

interface MediaData {
  id: string;
  url: string;
  altText?: string | null;
  isDecorative?: boolean;
}

interface MediaImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  media?: MediaData | null;
  fallbackUrl?: string; // Optional fallback if media is not provided or missing URL
  fallbackAlt?: string; // Optional fallback alt if not decorative and no altText
}

export function extractFilenameAsAlt(url?: string): string | undefined {
  if (!url || typeof url !== 'string') return undefined;

  const trimmed = url.trim();
  if (trimmed.startsWith('data:')) return undefined;

  try {
    const cleanUrl = trimmed.split('?')[0].split('#')[0];
    const lastSegment = cleanUrl.split('/').pop();
    if (!lastSegment || lastSegment.trim() === '') return undefined;

    let decoded = lastSegment;
    try {
      decoded = decodeURIComponent(lastSegment);
    } catch {
      // ignore decode error
    }

    const dotIndex = decoded.lastIndexOf('.');
    let nameWithoutExt = decoded;
    if (dotIndex > 0) {
      nameWithoutExt = decoded.substring(0, dotIndex);
    }

    if (!nameWithoutExt || nameWithoutExt.trim() === '') return undefined;

    const humanized = nameWithoutExt.replace(/[-_]+/g, ' ').trim();
    return humanized || undefined;
  } catch {
    return undefined;
  }
}

export function MediaImage({ media, fallbackUrl, fallbackAlt, alt, src, onError, ...props }: MediaImageProps) {
  const [hasError, setHasError] = useState(false);
  
  const originalUrl = media?.url || fallbackUrl || (typeof src === 'string' ? src : undefined);
  
  let safeOriginalUrl: string | undefined = undefined;
  if (originalUrl) {
    const trimmed = originalUrl.trim();
    
    // Strict allowlist validation
    const isHttp = trimmed.startsWith('http://') || trimmed.startsWith('https://');
    const isSafeRelative = trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\');
    const isDataImage = trimmed.startsWith('data:image/');
    
    if (isHttp || isSafeRelative || isDataImage) {
      safeOriginalUrl = trimmed;
    }
  }

  const url = hasError ? '/images/placeholder.png' : (safeOriginalUrl || '/images/placeholder.png');
  
  if (!url) {
    return null; // Nothing to render
  }
  
  let finalAlt = '';
  if (media?.isDecorative) {
    finalAlt = '';
  } else {
    const extractedFilenameAlt = extractFilenameAsAlt(originalUrl);

    if (media) {
      finalAlt = (media.altText && media.altText.trim() !== '')
        ? media.altText
        : (alt !== undefined)
          ? alt
          : (fallbackAlt && fallbackAlt.trim() !== '')
            ? fallbackAlt
            : (extractedFilenameAlt || 'Unlabelled image');
    } else {
      if (alt !== undefined) {
        finalAlt = alt;
      } else if (fallbackAlt && fallbackAlt.trim() !== '') {
        finalAlt = fallbackAlt;
      } else {
        finalAlt = extractedFilenameAlt || 'Unlabelled image';
      }
    }
  }
  
  const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    if (!hasError) {
      setHasError(true);
    }
    if (onError) {
      onError(e);
    }
  };
  
  return <img src={url} alt={finalAlt} onError={handleError} {...props} />;
}
