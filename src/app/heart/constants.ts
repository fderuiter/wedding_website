const HEART_FONT_PATH = '/fonts/noto-sans-latin-400-normal.woff';

function normalizeShowcaseBasePath(rawBasePath?: string | null): string {
  const trimmed = rawBasePath?.trim();
  if (!trimmed || trimmed === '/') {
    return '';
  }
  return (trimmed.startsWith('/') ? trimmed : `/${trimmed}`).replace(/\/+$/, '');
}

function inferShowcaseBasePathFromPathname(pathname?: string | null): string {
  if (!pathname) {
    return '';
  }
  const cleanPathname = pathname.split(/[?#]/)[0] ?? '';
  if (cleanPathname.endsWith('/iframe.html')) {
    return normalizeShowcaseBasePath(cleanPathname.slice(0, -'/iframe.html'.length));
  }
  const showcaseMatch = cleanPathname.match(/^(.*?\/(?:storybook|demo))(?=\/|$)/);
  if (showcaseMatch?.[1]) {
    return normalizeShowcaseBasePath(showcaseMatch[1]);
  }
  return '';
}

export function resolveHeartFontUrl(
  rawBasePath?: string,
  runtimePathname?: string,
): string {
  const explicitOrEnvBasePath =
    rawBasePath !== undefined ? rawBasePath : process.env.NEXT_PUBLIC_BASE_PATH;
  const configuredBasePath = normalizeShowcaseBasePath(explicitOrEnvBasePath);
  if (configuredBasePath) {
    return `${configuredBasePath}${HEART_FONT_PATH}`;
  }

  if (rawBasePath !== undefined && runtimePathname === undefined) {
    return HEART_FONT_PATH;
  }

  const effectivePathname =
    runtimePathname !== undefined
      ? runtimePathname
      : typeof window !== 'undefined'
        ? window.location?.pathname
        : undefined;
  const inferredBasePath = inferShowcaseBasePathFromPathname(effectivePathname);
  return `${inferredBasePath}${HEART_FONT_PATH}`;
}

export const HEART_FONT_URL = resolveHeartFontUrl();

export const PHYSICS_CONSTANTS = {
  ACCESSIBILITY_IMPULSE: 20,
  DRAG_VELOCITY_MULTIPLIER: 20,
  BUMP_IMPULSE_Y: 10,
  BUMP_IMPULSE_RANDOM_MULTIPLIER: 10,
  BREAK_FORCE_THRESHOLD: 200,
  EXPLOSION_IMPULSE_LEFT: { x: 20, y: 15, z: 5 },
  EXPLOSION_IMPULSE_RIGHT: { x: -20, y: 15, z: -5 },
  EXPLOSION_TORQUE_STRENGTH: 40,
  RETURN_FORCE_MULTIPLIER: 15,
  PULSE_SPEED_DRAGGING: 5,
  PULSE_SPEED_IDLE: 1,
  PULSE_SCALE_MULTIPLIER: 0.05,
  IDLE_ROTATION_SPEED: 0.002,
};
