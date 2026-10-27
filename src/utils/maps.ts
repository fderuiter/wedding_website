import { sanitizeUrl } from './validation';

export interface LocationDirectionsInput {
  directions?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/**
 * Resolves a directions URL for a location/attraction.
 * Uses the custom directions URL if available and safe.
 * Otherwise, falls back to a Google Maps directions URL if valid coordinates exist.
 *
 * @param location Object containing optional directions, latitude, and longitude
 * @returns A safe directions URL string, or undefined if unavailable/invalid
 */
export function resolveDirectionsUrl(
  location?: LocationDirectionsInput | null
): string | undefined {
  if (!location) return undefined;

  const rawDirections = location.directions?.trim();
  if (rawDirections) {
    const customDirections = sanitizeUrl(rawDirections);
    if (customDirections) {
      return customDirections;
    }

    const lower = rawDirections.toLowerCase();
    if (
      !lower.startsWith('javascript:') &&
      !lower.startsWith('data:') &&
      !lower.startsWith('vbscript:') &&
      !rawDirections.startsWith('//')
    ) {
      return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(rawDirections)}`;
    }
  }

  const { latitude, longitude } = location;

  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    isNaN(latitude) ||
    isNaN(longitude) ||
    !isFinite(latitude) ||
    !isFinite(longitude)
  ) {
    return undefined;
  }

  // Treat (0, 0) as unset / invalid coordinates
  if (latitude === 0 && longitude === 0) {
    return undefined;
  }

  // Validate geographic coordinate boundaries
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return undefined;
  }

  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
}
