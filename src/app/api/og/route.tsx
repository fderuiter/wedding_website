import { ImageResponse } from 'next/og';
import { getAppConfig } from '@/lib/config';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

let fontRegularBuffer: ArrayBuffer | null = null;
let fontBoldBuffer: ArrayBuffer | null = null;

function getFontBuffers() {
  if (!fontRegularBuffer || !fontBoldBuffer) {
    try {
      const regPath = path.join(process.cwd(), 'assets', 'fonts', 'LiberationSans-Regular.ttf');
      if (fs.existsSync(regPath)) {
        const regFile = fs.readFileSync(regPath);
        fontRegularBuffer = regFile.buffer.slice(regFile.byteOffset, regFile.byteOffset + regFile.byteLength);
      }

      const boldPath = path.join(process.cwd(), 'assets', 'fonts', 'LiberationSans-Bold.ttf');
      if (fs.existsSync(boldPath)) {
        const boldFile = fs.readFileSync(boldPath);
        fontBoldBuffer = boldFile.buffer.slice(boldFile.byteOffset, boldFile.byteOffset + boldFile.byteLength);
      }
    } catch {
      // Fallback if fonts cannot be read
    }
  }
  return { fontRegularBuffer, fontBoldBuffer };
}

export async function GET(request: Request) {
  let config;
  try {
    config = await getAppConfig();
  } catch {
    config = null;
  }

  const { searchParams } = new URL(request.url);

  const p1 = searchParams.get('p1') || config?.partner1Name || config?.brideName || '';
  const p2 = searchParams.get('p2') || config?.partner2Name || config?.groomName || '';

  let couplesNames = '';
  if (p1 && p2) {
    couplesNames = `${p1} & ${p2}`;
  } else if (p1) {
    couplesNames = p1;
  } else if (p2) {
    couplesNames = p2;
  } else {
    couplesNames = 'Wedding Celebration';
  }

  const title = searchParams.get('title') || config?.seoTitle || (p1 && p2 ? `${p1} & ${p2}'s Wedding` : couplesNames);
  const colorPrimary = searchParams.get('primary') || config?.colorPrimary || '#B91C1C';
  const colorSecondary = searchParams.get('secondary') || config?.colorSecondary || '#B45309';

  let dateStr = '';
  if (config?.weddingDate) {
    try {
      const d = new Date(config.weddingDate);
      if (!isNaN(d.getTime())) {
        dateStr = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
      }
    } catch {
      // ignore
    }
  }

  const venueParts = [config?.venueName, config?.venueCity, config?.venueState].filter(Boolean);
  const venueStr = venueParts.join(' • ');

  const { fontRegularBuffer, fontBoldBuffer } = getFontBuffers();
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
          backgroundColor: '#ffffff',
          backgroundImage: `linear-gradient(135deg, ${colorPrimary}15 0%, ${colorSecondary}25 100%)`,
          fontFamily: 'LiberationSans, sans-serif',
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
            border: `3px solid ${colorPrimary}`,
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
            backgroundColor: '#ffffff',
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
            {couplesNames}
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
                color: '#4B5563',
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
        'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
      },
    }
  );
}
