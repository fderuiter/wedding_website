import { sanitizeUrl } from './validation';

export interface LocationDirectionsInput {
  directions?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface VenueAddressParts {
  venueName?: string | null;
  venueAddress?: string | null;
  venueCity?: string | null;
  venueState?: string | null;
  venueZip?: string | null;
}

export interface LatLonCoordinates {
  latitude?: number | null;
  longitude?: number | null;
}

const VENUE_PLACEHOLDERS = new Set([
  'tbd',
  'tba',
  'n/a',
  'na',
  'none',
  'pending',
  'tbd venue',
  'unknown',
  '00000',
]);

/**
 * Checks whether geographic coordinates are finite, within valid WGS84 bounds,
 * and not equal to the default unconfigured (0, 0) Null Island origin.
 */
export function hasValidCoordinates(
  latitude?: number | null,
  longitude?: number | null
): boolean {
  return (
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    !Number.isNaN(latitude) &&
    !Number.isNaN(longitude) &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    !(latitude === 0 && longitude === 0) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

/**
 * Returns true when a venue or location text value is non-empty and not a placeholder
 * such as "TBD", "N/A", or "TBD Venue".
 */
export function isNonPlaceholderVenueText(value?: string | null): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !VENUE_PLACEHOLDERS.has(trimmed.toLowerCase());
}

/**
 * Formats non-placeholder street, city, state, and postal code values into a single
 * guest-readable address string (e.g. "123 Main St, Seattle, WA 98101").
 */
export function formatVenueStreetAddress(parts?: VenueAddressParts | null): string {
  if (!parts) return '';
  const street = isNonPlaceholderVenueText(parts.venueAddress) ? parts.venueAddress!.trim() : '';
  const city = isNonPlaceholderVenueText(parts.venueCity) ? parts.venueCity!.trim() : '';
  const state = isNonPlaceholderVenueText(parts.venueState) ? parts.venueState!.trim() : '';
  const zip = isNonPlaceholderVenueText(parts.venueZip) ? parts.venueZip!.trim() : '';

  const stateZip = [state, zip].filter(Boolean).join(' ');
  const cityStateZip = [city, stateZip].filter(Boolean).join(', ');
  return [street, cityStateZip].filter(Boolean).join(', ');
}

/**
 * Formats the complete venue location string combining non-placeholder venue name
 * and street/city/state/postal address for calendar exports and directions queries.
 */
export function formatFullVenueLocation(parts?: VenueAddressParts | null): string {
  if (!parts) return '';
  const name = isNonPlaceholderVenueText(parts.venueName) ? parts.venueName!.trim() : '';
  const address = formatVenueStreetAddress(parts);
  if (name && address) {
    if (address.toLowerCase().startsWith(name.toLowerCase())) {
      return address;
    }
    return `${name}, ${address}`;
  }
  return name || address;
}

/**
 * Joins a sub-event location name (e.g. "Sunset Terrace") and street address
 * (e.g. "450 Harbor Blvd, Seattle, WA") without duplicating identical prefixes.
 */
export function joinEventLocations(
  locationName?: string | null,
  location?: string | null
): string {
  const trimmedName = isNonPlaceholderVenueText(locationName) ? locationName.trim() : '';
  const trimmedLoc = isNonPlaceholderVenueText(location) ? location.trim() : '';
  if (trimmedName && trimmedLoc) {
    const lowerName = trimmedName.toLowerCase();
    const lowerLoc = trimmedLoc.toLowerCase();
    if (lowerName === lowerLoc || lowerName.includes(lowerLoc)) {
      return trimmedName;
    }
    if (lowerLoc.startsWith(lowerName) || lowerLoc.includes(lowerName)) {
      return trimmedLoc;
    }
    return `${trimmedName}, ${trimmedLoc}`;
  }
  return trimmedName || trimmedLoc;
}

/**
 * Computes great-circle distance in statute miles between two WGS84 coordinate pairs.
 */
export function calculateDistanceMiles(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRadians = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

/**
 * Formats the distance from the wedding venue to a hotel or attraction when both
 * coordinate pairs are valid and non-zero.
 */
export function formatDistanceFromVenue(
  venueCoords?: LatLonCoordinates | null,
  itemCoords?: LatLonCoordinates | null
): string | null {
  if (
    !venueCoords ||
    !itemCoords ||
    !hasValidCoordinates(venueCoords.latitude, venueCoords.longitude) ||
    !hasValidCoordinates(itemCoords.latitude, itemCoords.longitude)
  ) {
    return null;
  }

  const miles = calculateDistanceMiles(
    venueCoords.latitude as number,
    venueCoords.longitude as number,
    itemCoords.latitude as number,
    itemCoords.longitude as number
  );

  if (!Number.isFinite(miles)) {
    return null;
  }

  if (miles < 0.1) {
    return '< 0.1 mi from venue';
  }

  return `${miles.toFixed(1)} mi from venue`;
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

  if (
    rawDirections &&
    (rawDirections.startsWith('http://') ||
      rawDirections.startsWith('https://') ||
      rawDirections.startsWith('//') ||
      rawDirections.startsWith('/'))
  ) {
    const customDirections = sanitizeUrl(rawDirections);
    if (customDirections) {
      return customDirections;
    }
  }

  const { latitude, longitude } = location;

  if (hasValidCoordinates(latitude, longitude)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;
  }

  if (rawDirections && isNonPlaceholderVenueText(rawDirections)) {
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

  return undefined;
}
