import { safeFetch } from '@/utils/safeFetch';
import { hasValidCoordinates, isNonPlaceholderVenueText } from '@/utils/maps';
import { logger } from '@/lib/logger';

export interface GeocodeCandidate {
  displayName: string;
  name: string;
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  latitude: number;
  longitude: number;
}

interface NominatimAddress {
  house_number?: string;
  road?: string;
  pedestrian?: string;
  footway?: string;
  street?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  suburb?: string;
  hamlet?: string;
  county?: string;
  state?: string;
  region?: string;
  province?: string;
  state_district?: string;
  postcode?: string;
  country?: string;
  amenity?: string;
  building?: string;
  hotel?: string;
  tourism?: string;
}

interface NominatimRawItem {
  name?: string;
  display_name?: string;
  lat?: string | number;
  lon?: string | number;
  address?: NominatimAddress;
}

interface CacheEntry {
  candidates: GeocodeCandidate[];
  expiresAt: number;
}

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';
const GEOCODE_TIMEOUT_MS = 5000;
const MAX_LRU_ENTRIES = 250;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const OUTBOUND_WINDOW_MS = 60 * 1000;
const MAX_OUTBOUND_PER_WINDOW = 30;

const geocodeLruCache = new Map<string, CacheEntry>();
let outboundTimestamps: number[] = [];

function getFromLruCache(key: string, now: number): GeocodeCandidate[] | null {
  const entry = geocodeLruCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    geocodeLruCache.delete(key);
    return null;
  }
  // Refresh insertion order for LRU eviction
  geocodeLruCache.delete(key);
  geocodeLruCache.set(key, entry);
  return entry.candidates.map((item) => ({ ...item }));
}

function setInLruCache(key: string, candidates: GeocodeCandidate[], now: number): void {
  if (geocodeLruCache.has(key)) {
    geocodeLruCache.delete(key);
  } else if (geocodeLruCache.size >= MAX_LRU_ENTRIES) {
    const oldestKey = geocodeLruCache.keys().next().value;
    if (oldestKey !== undefined) {
      geocodeLruCache.delete(oldestKey);
    }
  }
  geocodeLruCache.set(key, {
    candidates: candidates.map((item) => ({ ...item })),
    expiresAt: now + CACHE_TTL_MS,
  });
}

function consumeOutboundQuota(now: number): boolean {
  outboundTimestamps = outboundTimestamps.filter((ts) => now - ts < OUTBOUND_WINDOW_MS);
  if (outboundTimestamps.length >= MAX_OUTBOUND_PER_WINDOW) {
    return false;
  }
  outboundTimestamps.push(now);
  return true;
}

function normalizeNominatimItem(raw: NominatimRawItem): GeocodeCandidate | null {
  const latitude = typeof raw.lat === 'number' ? raw.lat : Number(raw.lat);
  const longitude = typeof raw.lon === 'number' ? raw.lon : Number(raw.lon);
  if (!hasValidCoordinates(latitude, longitude)) {
    return null;
  }

  const addr = raw.address || {};
  const streetRoad = addr.road || addr.pedestrian || addr.footway || addr.street || '';
  const streetAddress = [addr.house_number, streetRoad]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(' ');
  const city =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.municipality ||
    addr.suburb ||
    addr.hamlet ||
    addr.county ||
    '';
  const state = addr.state || addr.region || addr.province || addr.state_district || '';
  const zip = addr.postcode || '';
  const country = addr.country || '';

  const firstDisplaySegment = raw.display_name ? raw.display_name.split(',')[0]?.trim() || '' : '';
  const name =
    (raw.name || addr.hotel || addr.tourism || addr.amenity || addr.building || firstDisplaySegment).trim();
  const displayName =
    (raw.display_name || [name, streetAddress, city, state, zip, country].filter(Boolean).join(', ')).trim();

  if (!displayName) {
    return null;
  }

  return {
    displayName,
    name,
    streetAddress,
    city: city.trim(),
    state: state.trim(),
    zip: zip.trim(),
    country: country.trim(),
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
  };
}

/**
 * Clears the in-memory geocoding LRU cache and outbound rate-limit window for deterministic unit testing.
 */
export function resetGeocodeStateForTesting(): void {
  geocodeLruCache.clear();
  outboundTimestamps = [];
}

/**
 * Searches a key-free public geocoding provider (OpenStreetMap Nominatim) via SSRF-hardened `safeFetch`
 * with a 5-second timeout, bounded LRU response caching, and outbound rate limiting.
 */
export async function geocodeSearch(
  rawQuery: string,
  limit = 5
): Promise<GeocodeCandidate[]> {
  if (typeof rawQuery !== 'string') return [];
  const normalizedQuery = rawQuery.replace(/\s+/g, ' ').trim();
  if (normalizedQuery.length < 2 || !isNonPlaceholderVenueText(normalizedQuery)) {
    return [];
  }

  const clampedLimit = Math.min(10, Math.max(1, Math.trunc(limit) || 5));
  const cacheKey = `${normalizedQuery.toLowerCase()}::${clampedLimit}`;
  const now = Date.now();

  const cached = getFromLruCache(cacheKey, now);
  if (cached !== null) {
    return cached;
  }

  // Prevent unmocked unit tests from making live DNS/HTTPS requests to external services
  const isSafeFetchMocked = Boolean(
    (safeFetch as unknown as { _isMockFunction?: boolean })._isMockFunction
  );
  if (process.env.NODE_ENV === 'test' && !isSafeFetchMocked) {
    return [];
  }

  if (!consumeOutboundQuota(now)) {
    logger.warn('Outbound geocoding rate limit reached; skipping external lookup');
    return [];
  }

  const url = `${NOMINATIM_SEARCH_URL}?format=jsonv2&addressdetails=1&limit=${clampedLimit}&q=${encodeURIComponent(normalizedQuery)}`;

  try {
    const response = await safeFetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'en',
        'User-Agent': 'SelfHostedWeddingWebsite/1.0 (+https://github.com/fderuiter/wedding_website)',
      },
    });

    if (!response.ok) {
      logger.warn(`Geocoding provider returned HTTP ${response.status}`);
      return [];
    }

    const payload = await response.json();
    if (!Array.isArray(payload)) {
      return [];
    }

    const candidates = payload
      .map((item) => normalizeNominatimItem(item as NominatimRawItem))
      .filter((item): item is GeocodeCandidate => item !== null)
      .slice(0, clampedLimit);

    setInLruCache(cacheKey, candidates, Date.now());
    return candidates;
  } catch (err) {
    logger.warn('Geocoding lookup failed or timed out:', err instanceof Error ? err.message : String(err));
    return [];
  }
}

/**
 * Resolves the best-matching verified coordinate pair from non-placeholder address segments.
 * Tries the full address query first and falls back to broader city/state segments if needed.
 */
export async function geocodeBestMatch(
  parts: Array<string | null | undefined>
): Promise<GeocodeCandidate | null> {
  const cleanParts = parts
    .filter((part): part is string => isNonPlaceholderVenueText(part))
    .map((part) => part.trim())
    .filter((part) => !/^https?:\/\//i.test(part) && !part.startsWith('/'));

  if (cleanParts.length === 0) {
    return null;
  }

  const fullQuery = cleanParts.join(', ');
  const primaryMatches = await geocodeSearch(fullQuery, 1);
  if (primaryMatches.length > 0) {
    return primaryMatches[0];
  }

  // If the first part was a custom venue name (e.g. "Sunset Barn") and remaining street/city parts exist,
  // retry without the venue name so street/city coordinates still resolve.
  if (cleanParts.length >= 2) {
    const fallbackQuery = cleanParts.slice(1).join(', ');
    if (fallbackQuery.length >= 2 && fallbackQuery !== fullQuery) {
      const secondaryMatches = await geocodeSearch(fallbackQuery, 1);
      if (secondaryMatches.length > 0) {
        return secondaryMatches[0];
      }
    }
  }

  return null;
}
