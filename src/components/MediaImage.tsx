import React from 'react';

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

export function MediaImage({ media, fallbackUrl, fallbackAlt, alt, src, ...props }: MediaImageProps) {
  const url = media?.url || fallbackUrl || src;
  
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
  
  return <img src={url} alt={finalAlt} {...props} />;
}
