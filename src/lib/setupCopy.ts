import { formatDate } from '@/utils/intl';

const PLACEHOLDER_VENUE_VALUES = new Set([
  'tbd',
  'tba',
  'n/a',
  'na',
  'none',
  'pending',
  'tbd venue',
  'unknown',
  '00000',
  'venue description...',
  'travel advice...',
]);

const PLACEHOLDER_STORY_VALUES = new Set([
  'tbd',
  'our story...',
  'welcome to the wedding showcase. replace these details in the admin dashboard once your database is connected.',
]);

const LEGACY_HERO_TITLE_PLACEHOLDERS = new Set(['we tied the knot!']);
const LEGACY_HERO_SUBTITLE_PLACEHOLDERS = new Set([
  'thank you for celebrating with us!',
  'thank you for celebrating with us on our special day!',
]);

export function cleanOptionalSetupText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_VENUE_VALUES.has(lower) || lower === 'our story...') {
    return '';
  }
  return trimmed;
}

export function isUpcomingWeddingDate(
  weddingDate: Date | string | number | null | undefined,
  referenceDate: Date = new Date()
): boolean {
  if (weddingDate === null || weddingDate === undefined || weddingDate === '') {
    return true;
  }

  if (typeof weddingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(weddingDate.trim())) {
    const endOfDayUtc = new Date(`${weddingDate.trim()}T23:59:59.999Z`);
    if (!Number.isNaN(endOfDayUtc.getTime())) {
      return endOfDayUtc.getTime() >= referenceDate.getTime();
    }
  }

  const parsed = weddingDate instanceof Date ? weddingDate : new Date(weddingDate);
  if (Number.isNaN(parsed.getTime())) {
    return true;
  }

  const endOfDayUtc = Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
    23,
    59,
    59,
    999
  );
  return endOfDayUtc >= referenceDate.getTime();
}

export interface CleanVenueParts {
  venueName: string;
  venueAddress: string;
  venueCity: string;
  venueState: string;
  venueZip: string;
  cityState: string;
  venueWithAddress: string;
  shortLocation: string;
  fullLocation: string;
}

export function formatCleanVenueParts(input: {
  venueName?: string | null;
  venueAddress?: string | null;
  venueCity?: string | null;
  venueState?: string | null;
  venueZip?: string | null;
}): CleanVenueParts {
  const venueName = cleanOptionalSetupText(input.venueName);
  const venueAddress = cleanOptionalSetupText(input.venueAddress);
  const venueCity = cleanOptionalSetupText(input.venueCity);
  const venueState = cleanOptionalSetupText(input.venueState);
  const venueZip = cleanOptionalSetupText(input.venueZip);

  const cityState = [venueCity, venueState].filter(Boolean).join(', ');
  const venueWithAddress = [venueName, venueAddress].filter(Boolean).join(' · ');
  const shortLocation = cityState || venueName;
  const cityStateZip = [cityState, venueZip].filter(Boolean).join(' ');
  const fullLocation = [venueName, venueAddress, cityStateZip].filter(Boolean).join(', ');

  return {
    venueName,
    venueAddress,
    venueCity,
    venueState,
    venueZip,
    cityState,
    venueWithAddress,
    shortLocation,
    fullLocation,
  };
}

function formatWeddingDateDisplay(
  weddingDate: Date | string | null | undefined,
  timezone?: string | null
): string {
  if (!weddingDate) return '';
  let normalizedInput: Date | string = weddingDate;
  if (typeof weddingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(weddingDate.trim())) {
    normalizedInput = `${weddingDate.trim()}T12:00:00.000Z`;
  }
  const parsed = normalizedInput instanceof Date ? normalizedInput : new Date(normalizedInput);
  if (Number.isNaN(parsed.getTime())) return '';

  const resolvedTz =
    typeof weddingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(weddingDate.trim())
      ? 'UTC'
      : timezone?.trim() || 'UTC';

  try {
    return formatDate(parsed, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: resolvedTz,
    });
  } catch {
    return formatDate(parsed, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }
}

export interface SetupStarterCopyInput {
  partner1Name?: string | null;
  partner2Name?: string | null;
  weddingDate?: Date | string | null;
  timezone?: string | null;
  venueName?: string | null;
  venueCity?: string | null;
  venueState?: string | null;
  referenceDate?: Date;
}

export interface SynthesizedSetupCopy {
  isUpcoming: boolean;
  formattedDate: string;
  heroTitle: string;
  heroSubtitle: string;
  storyText: string;
  seoTitle: string;
  seoDescription: string;
}

export function synthesizeSetupStarterCopy(input: SetupStarterCopyInput): SynthesizedSetupCopy {
  const p1 = cleanOptionalSetupText(input.partner1Name);
  const p2 = cleanOptionalSetupText(input.partner2Name);
  const coupleHeadline = p1 && p2 ? `${p1} & ${p2}` : p1 || p2;
  const venue = formatCleanVenueParts({
    venueName: input.venueName,
    venueCity: input.venueCity,
    venueState: input.venueState,
  });

  const formattedDate = formatWeddingDateDisplay(input.weddingDate, input.timezone);
  const isUpcoming = isUpcomingWeddingDate(input.weddingDate, input.referenceDate);

  const locationClause =
    venue.venueName && venue.cityState
      ? ` at ${venue.venueName} in ${venue.cityState}`
      : venue.cityState
        ? ` in ${venue.cityState}`
        : venue.venueName
          ? ` at ${venue.venueName}`
          : '';

  const pastLocationClause = venue.cityState
    ? `, in ${venue.cityState}`
    : venue.venueName
      ? ` at ${venue.venueName}`
      : '';

  const seoTitle = coupleHeadline
    ? `${coupleHeadline}'s Wedding`
    : 'Wedding Celebration';

  if (isUpcoming) {
    const heroTitle = coupleHeadline || 'Celebrating Our Wedding';
    const heroSubtitle = formattedDate
      ? `Join us to celebrate our wedding on ${formattedDate}${locationClause}.`
      : `Join us to celebrate our upcoming wedding${locationClause}.`;
    const storyText =
      p1 && p2
        ? `Welcome to our wedding website! ${p1} and ${p2} cannot wait to celebrate with family and friends${formattedDate ? ` on ${formattedDate}` : ''}${locationClause}. Check back soon as we share our story, weekend schedule, and travel details.`
        : `Welcome to our wedding website! We cannot wait to celebrate with family and friends${formattedDate ? ` on ${formattedDate}` : ''}${locationClause}.`;
    const seoDescription =
      p1 && p2
        ? `Join ${p1} and ${p2} for their wedding celebration${locationClause}.`
        : `Join us for our wedding celebration${locationClause}.`;

    return {
      isUpcoming,
      formattedDate,
      heroTitle,
      heroSubtitle,
      storyText,
      seoTitle,
      seoDescription,
    };
  }

  const heroTitle = 'We Tied the Knot!';
  const heroSubtitle = formattedDate
    ? `Thank you for celebrating with us on ${formattedDate}${pastLocationClause}. We're so grateful for all the love and support from our family and friends.`
    : 'Thank you for celebrating with us on our special day!';
  const seoDescription =
    p1 && p2
      ? `Celebrating the marriage of ${p1} and ${p2}${locationClause}.`
      : 'Thank you for celebrating our wedding with us.';

  return {
    isUpcoming,
    formattedDate,
    heroTitle,
    heroSubtitle,
    storyText: '',
    seoTitle,
    seoDescription,
  };
}

export function resolveSetupCopyField(
  incomingValue: unknown,
  synthesizedFallback: string,
  kind: 'heroTitle' | 'heroSubtitle' | 'storyText' | 'seo'
): string {
  if (typeof incomingValue !== 'string') {
    return synthesizedFallback;
  }
  const trimmed = incomingValue.trim();
  if (!trimmed) {
    return synthesizedFallback;
  }
  const lower = trimmed.toLowerCase();
  if (kind === 'heroTitle' && LEGACY_HERO_TITLE_PLACEHOLDERS.has(lower)) {
    return synthesizedFallback;
  }
  if (kind === 'heroSubtitle' && LEGACY_HERO_SUBTITLE_PLACEHOLDERS.has(lower)) {
    return synthesizedFallback;
  }
  if (kind === 'storyText' && PLACEHOLDER_STORY_VALUES.has(lower)) {
    return synthesizedFallback;
  }
  return trimmed;
}

export function hasNonPlaceholderVenueDetails(
  config:
    | {
      venueName?: string | null;
      venueCity?: string | null;
      venueState?: string | null;
    }
    | null
    | undefined
): boolean {
  if (!config) return false;
  const venue = formatCleanVenueParts({
    venueName: config.venueName,
    venueCity: config.venueCity,
    venueState: config.venueState,
  });
  return Boolean(venue.venueName && venue.venueCity && venue.venueState);
}

export function hasCustomStoryText(
  config:
    | {
      partner1Name?: string | null;
      partner2Name?: string | null;
      brideName?: string | null;
      groomName?: string | null;
      weddingDate?: Date | string | null;
      timezone?: string | null;
      venueName?: string | null;
      venueCity?: string | null;
      venueState?: string | null;
      storyText?: string | null;
    }
    | null
    | undefined
): boolean {
  if (!config || typeof config.storyText !== 'string') return false;
  const trimmed = config.storyText.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();
  if (PLACEHOLDER_STORY_VALUES.has(lower)) {
    return false;
  }

  // Recognize auto-synthesized starter copy (with or without venue details) as starter text
  const p1 = config.partner1Name || config.brideName || '';
  const p2 = config.partner2Name || config.groomName || '';
  const synthesizedCurrent = synthesizeSetupStarterCopy({
    partner1Name: p1,
    partner2Name: p2,
    weddingDate: config.weddingDate,
    timezone: config.timezone,
    venueName: config.venueName,
    venueCity: config.venueCity,
    venueState: config.venueState,
    referenceDate: new Date(0),
  }).storyText;
  const synthesizedBlankVenue = synthesizeSetupStarterCopy({
    partner1Name: p1,
    partner2Name: p2,
    weddingDate: config.weddingDate,
    timezone: config.timezone,
    referenceDate: new Date(0),
  }).storyText;
  const synthesizedUtc = synthesizeSetupStarterCopy({
    partner1Name: p1,
    partner2Name: p2,
    weddingDate: config.weddingDate,
    timezone: 'UTC',
    referenceDate: new Date(0),
  }).storyText;

  if (
    trimmed === synthesizedCurrent ||
    trimmed === synthesizedBlankVenue ||
    trimmed === synthesizedUtc ||
    /^welcome to our wedding website!\s+.+\s+cannot wait to celebrate with family and friends[\s\S]*check back soon as we share our story, weekend schedule, and travel details\.$/i.test(
      trimmed
    ) ||
    /^welcome to our wedding website!\s+we cannot wait to celebrate with family and friends/i.test(
      trimmed
    )
  ) {
    return false;
  }

  return true;
}
