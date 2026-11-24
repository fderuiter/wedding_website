import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';
import { getAppConfig, toUnauthenticatedAppConfig } from '@/lib/config';
import { deriveBrandMonogram } from '@/features/content';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isGuestRequest } from '@/core/auth/guest.server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { getServerExportTokens } from '@/lib/theme/presets';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { readFile } from 'fs/promises';
import path from 'path';

export const runtime = 'nodejs';

interface FontBuffers {
  fontRegularBuffer: ArrayBuffer | null;
  fontBoldBuffer: ArrayBuffer | null;
}

let fontBuffersPromise: Promise<FontBuffers> | null = null;

function getFontBuffers(): Promise<FontBuffers> {
  if (!fontBuffersPromise) {
    fontBuffersPromise = (async () => {
      let fontRegularBuffer: ArrayBuffer | null = null;
      let fontBoldBuffer: ArrayBuffer | null = null;

      try {
        const regPath = path.join(process.cwd(), 'assets', 'fonts', 'LiberationSans-Regular.ttf');
        const boldPath = path.join(process.cwd(), 'assets', 'fonts', 'LiberationSans-Bold.ttf');

        const [regResult, boldResult] = await Promise.allSettled([
          readFile(regPath),
          readFile(boldPath),
        ]);

        if (regResult.status === 'fulfilled') {
          const regFile = regResult.value;
          fontRegularBuffer = regFile.buffer.slice(regFile.byteOffset, regFile.byteOffset + regFile.byteLength);
        }

        if (boldResult.status === 'fulfilled') {
          const boldFile = boldResult.value;
          fontBoldBuffer = boldFile.buffer.slice(boldFile.byteOffset, boldFile.byteOffset + boldFile.byteLength);
        }
      } catch {
        // Fallback if fonts cannot be read
      }

      return { fontRegularBuffer, fontBoldBuffer };
    })();
  }
  return fontBuffersPromise;
}

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const isStaticExport =
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export';

  let isAuthenticated = isStaticExport;
  if (!isStaticExport) {
    try {
      const [adminAuth, guestAuth, inviteSession] = await Promise.all([
        isAdminRequest(request),
        isGuestRequest(request),
        getGuestInviteSession(request),
      ]);
      isAuthenticated = Boolean(adminAuth || guestAuth || inviteSession);
    } catch {
      isAuthenticated = false;
    }
  }

  let rawConfig;
  try {
    rawConfig = await getAppConfig();
  } catch {
    rawConfig = null;
  }

  const config =
    rawConfig && !isAuthenticated ? toUnauthenticatedAppConfig(rawConfig) : rawConfig;

  const { searchParams } = new URL(request.url, 'http://localhost');

  const p1Override = isAuthenticated ? searchParams.get('p1') : null;
  const p2Override = isAuthenticated ? searchParams.get('p2') : null;
  const titleOverride = isAuthenticated ? searchParams.get('title') : null;
  const primaryParam = isAuthenticated ? searchParams.get('primary') || undefined : undefined;
  const secondaryParam = isAuthenticated ? searchParams.get('secondary') || undefined : undefined;

  const p1 = p1Override || config?.partner1Name || config?.brideName || '';
  const p2 = p2Override || config?.partner2Name || config?.groomName || '';

  let badgeLabel = '';
  if (!isAuthenticated) {
    badgeLabel = config?.brandMonogram?.trim() || deriveBrandMonogram(config);
  } else if (p1 && p2) {
    badgeLabel = `${p1} & ${p2}`;
  } else if (p1) {
    badgeLabel = p1;
  } else if (p2) {
    badgeLabel = p2;
  } else {
    badgeLabel = 'Wedding Celebration';
  }

  const title = isAuthenticated
    ? titleOverride || config?.seoTitle || (p1 && p2 ? `${p1} & ${p2}'s Wedding` : badgeLabel)
    : 'Wedding Website';

  const exportTokens = getServerExportTokens(
    config?.themePreset,
    config?.themeTokens,
    {
      primary: primaryParam || config?.colorPrimary,
      secondary: secondaryParam || config?.colorSecondary,
    }
  );

  const colorPrimary = exportTokens.colorPrimary;
  const colorSecondary = exportTokens.colorSecondary;

  let dateStr = '';
  if (isAuthenticated && config?.weddingDate) {
    try {
      const d = new Date(config.weddingDate);
      if (!isNaN(d.getTime())) {
        dateStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      }
    } catch {
      // ignore
    }
  }

  const venueParts = isAuthenticated
    ? [config?.venueName, config?.venueCity, config?.venueState].filter(Boolean)
    : [];
  const venueStr = venueParts.join(' • ');

  const { fontRegularBuffer, fontBoldBuffer } = await getFontBuffers();
  const fonts: any[] = [];

  if (fontRegularBuffer) {
    fonts.push({
      name: 'LiberationSans',
      data: fontRegularBuffer,
      style: 'normal',
      weight: 400,
    });
  }
  if (fontBoldBuffer) {
    fonts.push({
      name: 'LiberationSans',
      data: fontBoldBuffer,
      style: 'normal',
      weight: 700,
    });
  }

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: exportTokens.canvasBg,
          backgroundImage: `linear-gradient(135deg, ${colorPrimary}15 0%, ${colorSecondary}25 100%)`,
          fontFamily: `${exportTokens.fontHeading}, ${exportTokens.fontBody}, LiberationSans, sans-serif`,
          padding: '60px 80px',
          boxSizing: 'border-box',
          position: 'relative',
        }}
      >
        {/* Outer decorative border */}
        <div
          style={{
            position: 'absolute',
            top: '24px',
            bottom: '24px',
            left: '24px',
            right: '24px',
            border: `3px solid ${exportTokens.borderAccent || colorPrimary}`,
            borderRadius: '16px',
            display: 'flex',
            opacity: 0.8,
          }}
        />

        {/* Inner Content Card */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: exportTokens.cardBg,
            borderRadius: '12px',
            padding: '48px 64px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            borderTop: `8px solid ${colorPrimary}`,
            borderBottom: `4px solid ${colorSecondary}`,
            maxWidth: '1000px',
            width: '100%',
            textAlign: 'center',
          }}
        >
          {/* Subtle Top Badge */}
          <div
            style={{
              fontSize: '20px',
              fontWeight: 700,
              color: colorSecondary,
              textTransform: 'uppercase',
              letterSpacing: '3px',
              marginBottom: '16px',
              display: 'flex',
            }}
          >
            {badgeLabel}
          </div>

          {/* Main Title */}
          <div
            style={{
              fontSize: '52px',
              fontWeight: 700,
              color: colorPrimary,
              lineHeight: 1.2,
              marginBottom: '24px',
              display: 'flex',
              textAlign: 'center',
            }}
          >
            {title}
          </div>

          {/* Subtitle / Venue & Date */}
          {(dateStr || venueStr) && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                color: exportTokens.textMuted,
                marginTop: '12px',
                gap: '16px',
              }}
            >
              {dateStr && <span style={{ fontWeight: 600 }}>{dateStr}</span>}
              {dateStr && venueStr && <span style={{ color: colorSecondary }}>•</span>}
              {venueStr && <span>{venueStr}</span>}
            </div>
          )}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: fonts.length > 0 ? fonts : undefined,
      headers: {
        'Cache-Control': isAuthenticated ? 'private, max-age=3600' : 'private, no-cache',
        Vary: 'Cookie',
      },
    }
  );
});
