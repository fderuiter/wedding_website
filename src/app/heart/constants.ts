const HEART_FONT_PATH = '/fonts/noto-sans-latin-400-normal.woff';

export function resolveHeartFontUrl(
  rawBasePath: string | undefined = process.env.NEXT_PUBLIC_BASE_PATH,
): string {
  const trimmed = rawBasePath?.trim();
  const normalizedBasePath = trimmed
    ? (trimmed.startsWith('/') ? trimmed : `/${trimmed}`).replace(/\/+$/, '')
    : '';
  return `${normalizedBasePath}${HEART_FONT_PATH}`;
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
