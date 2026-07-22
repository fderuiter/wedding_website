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

export function MediaImage({ media, fallbackUrl, fallbackAlt, alt, src, onError, ...props }: MediaImageProps) {
  const [hasError, setHasError] = useState(false);
  
  const originalUrl = media?.url || fallbackUrl || src as string | undefined;
  
  let safeOriginalUrl: string | undefined = undefined;
  if (originalUrl) {
    const trimmed = originalUrl.trim();
    
    // Check for safe relative URLs first
    if (trimmed.startsWith('/') && !trimmed.startsWith('//') && !trimmed.startsWith('/\\')) {
      safeOriginalUrl = trimmed;
    } else {
      // Parse absolute URLs and explicitly check the protocol
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || (parsed.protocol === 'data:' && trimmed.startsWith('data:image/'))) {
          safeOriginalUrl = trimmed;
        }
      } catch (e) {
        // Invalid URL, do nothing
      }
    }
  }

  const url = hasError ? '/images/placeholder.png' : (safeOriginalUrl || '/images/placeholder.png');
  
  if (!url) {
    return null; // Nothing to render
  }
  
  let finalAlt = '';
  if (media) {
    if (!media.isDecorative) {
      finalAlt = media.altText || fallbackAlt || '';
    }
  } else {
    finalAlt = alt || fallbackAlt || '';
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
