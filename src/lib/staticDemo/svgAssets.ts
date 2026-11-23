function toBase64Utf8(svg: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(svg, 'utf8').toString('base64');
  }
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .slice(0, 36);
}

interface SvgCardPalette {
  bgStart: string;
  bgEnd: string;
  accent: string;
  fg?: string;
}

const PALETTES: Record<string, SvgCardPalette> = {
  classic: { bgStart: '#7f1d1d', bgEnd: '#b45309', accent: '#fde68a', fg: '#ffffff' },
  destination: { bgStart: '#0f766e', bgEnd: '#0369a1', accent: '#bae6fd', fg: '#ffffff' },
  romantic: { bgStart: '#831843', bgEnd: '#6d28d9', accent: '#fbcfe8', fg: '#ffffff' },
  neutral: { bgStart: '#334155', bgEnd: '#1e293b', accent: '#cbd5e1', fg: '#ffffff' },
};

/**
 * Generates a compact (< 1,200 chars) base64 SVG data URL compliant with
 * `isSafeMediaOrPhotoUrl` (`^data:image/...;base64,...$`), `MediaCreateSchema` (< 2,000 chars),
 * and `MediaImage.tsx`, eliminating broken relative image requests under subpath deployments.
 */
export function createDemoSvgDataUrl(
  label: string,
  subtitle = '',
  themeKey: 'classic' | 'destination' | 'romantic' | 'neutral' = 'classic',
): string {
  const palette = PALETTES[themeKey] ?? PALETTES.classic;
  const safeLabel = escapeXml(label.trim() || 'Wedding Showcase');
  const safeSub = escapeXml(subtitle.trim());
  const fg = palette.fg ?? '#ffffff';

  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    `<stop offset="0%" stop-color="${palette.bgStart}"/>` +
    `<stop offset="100%" stop-color="${palette.bgEnd}"/>` +
    '</linearGradient></defs>' +
    '<rect width="640" height="420" fill="url(#g)"/>' +
    `<circle cx="540" cy="80" r="110" fill="${palette.accent}" fill-opacity="0.14"/>` +
    `<circle cx="90" cy="350" r="130" fill="${palette.accent}" fill-opacity="0.1"/>` +
    `<rect x="36" y="36" width="568" height="348" rx="20" fill="none" stroke="${palette.accent}" stroke-opacity="0.35" stroke-width="2"/>` +
    `<text x="320" y="${safeSub ? '200' : '218'}" text-anchor="middle" font-family="Georgia,serif" font-size="28" font-weight="bold" fill="${fg}">${safeLabel}</text>` +
    (safeSub
      ? `<text x="320" y="242" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" fill="${palette.accent}">${safeSub}</text>`
      : '') +
    '</svg>';

  return `data:image/svg+xml;base64,${toBase64Utf8(svg)}`;
}

/**
 * Generates a compact thumbnail data URL (< 1,900 chars) for uploaded File/Blob objects
 * in static demo mode so guest photo uploads stay well beneath the 2 MB localStorage budget
 * and satisfy the 2,000-char Media URL schema limit.
 */
export async function createCompactUploadThumbnail(
  file: { name?: string; type?: string; size?: number } | Blob,
  fallbackTitle = 'Uploaded Photo',
): Promise<string> {
  const fileName =
    typeof (file as { name?: unknown }).name === 'string'
      ? ((file as { name: string }).name || fallbackTitle)
      : fallbackTitle;

  if (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof createImageBitmap === 'function' &&
    file instanceof Blob &&
    file.size > 0 &&
    file.type.startsWith('image/') &&
    !file.type.includes('heic') &&
    !file.type.includes('heif')
  ) {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const maxDim = 96;
        const scale = Math.min(1, maxDim / Math.max(bitmap.width || 1, bitmap.height || 1));
        const width = Math.max(1, Math.round((bitmap.width || 64) * scale));
        const height = Math.max(1, Math.round((bitmap.height || 64) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, width, height);
          for (const quality of [0.5, 0.35, 0.22]) {
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            if (
              dataUrl.startsWith('data:image/jpeg;base64,') &&
              dataUrl.length > 32 &&
              dataUrl.length <= 1900
            ) {
              return dataUrl;
            }
          }
        }
      } finally {
        if (typeof bitmap.close === 'function') {
          bitmap.close();
        }
      }
    } catch {
      // Fall back to deterministic compact SVG thumbnail
    }
  }

  const cleanLabel = fileName.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
  return createDemoSvgDataUrl(cleanLabel || fallbackTitle, 'Shared Moment', 'romantic');
}
