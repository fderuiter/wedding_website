import { z } from 'zod';
import { ARCHETYPE_PRESETS, type ArchetypeId } from '@/lib/sampleData/archetypes';
import {
  buildArchetypeSeedData,
  findSeededRegistryItemById,
} from '@/lib/sampleData/builder';
import { buildSimplePdfBytes } from '@/lib/staticDemo/exporters';
import { THEME_PRESET_KEYS, type ThemePreset } from '@/lib/theme/presets';
import type { PublicAppConfig } from '@/lib/config';
import {
  cleanOptionalSetupText,
  hasCustomStoryText,
  hasNonPlaceholderVenueDetails,
} from '@/lib/setupCopy';
import { createIcsFile, formatScheduleEventToCalendarEvent } from '@/utils/calendar';
import { resolveModuleConfig } from '@/lib/modules';
import type {
  ContributorRecord,
  InvitationCodeDTO,
  RegistryItem,
  ThankYouTemplateTokens,
} from '@/features/registry';
import type { SeatingTableDTO } from '@/features/seating';
import type { WeddingPartyMemberDTO, WeddingPartySide } from '@/features/wedding-party';
import type { AttractionDTO } from '@/features/attractions';
import { stripBasePath, withBasePath } from '@/lib/basePath';
import { formatCurrency } from '@/utils/intl';
import { DEFAULT_RSVP_CLOSED_MESSAGE, resolveValidTimezone } from '@/utils/rsvpDeadline';
import {
  normalizeCustomAnswers,
  normalizeCustomQuestions,
  normalizeMealOptions,
  normalizeMealSelections,
  normalizePlusOneNames,
} from '@/utils/rsvpPrompts';
import {
  computeLiveForecastAvailableDate,
  formatForecastDateInTimezone,
  getLocalizedClimateFallback,
} from '@/utils/climateFallback';
import {
  ADDRESS_LINE_MAX_LENGTH,
  CITY_MAX_LENGTH,
  COUNTRY_MAX_LENGTH,
  GUEST_NAME_MAX_LENGTH,
  HOUSEHOLD_NAME_MAX_LENGTH,
  normalizePartyTags,
  PHONE_MAX_LENGTH,
  STATE_MAX_LENGTH,
  ZIP_CODE_MAX_LENGTH,
} from '@/utils/invitationValidation';
import { DEMO_SHIPPING_ADDRESS } from './demoSeed';
import {
  applyDemoSampleSelection,
  findDemoGuestByCode,
  getActiveArchetypeDataset,
  getDemoState,
  isDemoAdminSession,
  isDemoRuntimeActive,
  mutateActiveDataset,
  previewDemoClaimToken,
  processDemoClaimToken,
  purgeDemoSampleData,
  recordDemoContribution,
  setDemoGuestSession,
  setDemoPersona,
  setDemoSetupAuthenticated,
  updateDemoConfigOverrides,
  updateDemoGuestAddress,
  upsertDemoSubEventRsvp,
} from './demoStore';

const DEMO_LANDMARK_SHAPES = new Set<string>(['dance-floor', 'bar', 'dj', 'buffet', 'cake']);
let demoAutoApproveGuestPhotos = false;
let demoPhotoQrTokenVersion = 1;

function isDemoLandmarkShape(shape?: string): boolean {
  return Boolean(shape && DEMO_LANDMARK_SHAPES.has(shape));
}

let demoIdSequence = 0;
function nextDemoId(prefix: string): string {
  demoIdSequence += 1;
  return `${prefix}-${Date.now()}-${demoIdSequence}`;
}

const DISALLOWED_DEMO_PUBLIC_TEXT_PATTERN = /[<>]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const DEMO_PHONE_PATTERN = /^\+?[\d\s()./-]{7,30}$/;
const DEMO_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateDemoInvitationCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += DEMO_CODE_CHARS[Math.floor(Math.random() * DEMO_CODE_CHARS.length)];
  }
  return code;
}

function createRequiredDemoPostalField(max: number, label: string) {
  return z
    .string({ message: `${label} is required.` })
    .refine((val) => !DISALLOWED_DEMO_PUBLIC_TEXT_PATTERN.test(val), {
      message: `${label} cannot contain HTML brackets or control characters.`,
    })
    .trim()
    .min(1, `${label} is required and must be under ${max} characters.`)
    .max(max, `${label} is required and must be under ${max} characters.`);
}

function createOptionalDemoPostalField(max: number, label: string) {
  return z
    .string()
    .refine((val) => !DISALLOWED_DEMO_PUBLIC_TEXT_PATTERN.test(val), {
      message: `${label} cannot contain HTML brackets or control characters.`,
    })
    .trim()
    .max(max, `${label} must be under ${max} characters.`)
    .optional()
    .or(z.literal(''))
    .nullable();
}

const DemoPublicAddressCollectSchema = z.object({
  guestName: createRequiredDemoPostalField(GUEST_NAME_MAX_LENGTH, 'Guest name'),
  email: z.string().trim().email('Invalid email address.').optional().or(z.literal('')).nullable(),
  phone: z
    .string()
    .trim()
    .max(PHONE_MAX_LENGTH, `Phone number must be under ${PHONE_MAX_LENGTH} characters.`)
    .refine(
      (val) => {
        if (!val) return true;
        if (!DEMO_PHONE_PATTERN.test(val)) return false;
        return val.replace(/\D/g, '').length >= 7;
      },
      { message: 'Invalid phone number format.' }
    )
    .optional()
    .nullable(),
  addressLine1: createRequiredDemoPostalField(ADDRESS_LINE_MAX_LENGTH, 'Street address'),
  addressLine2: createOptionalDemoPostalField(ADDRESS_LINE_MAX_LENGTH, 'Address Line 2'),
  city: createRequiredDemoPostalField(CITY_MAX_LENGTH, 'City'),
  state: createRequiredDemoPostalField(STATE_MAX_LENGTH, 'State / Province'),
  zipCode: createRequiredDemoPostalField(ZIP_CODE_MAX_LENGTH, 'ZIP / Postal code'),
  country: createOptionalDemoPostalField(COUNTRY_MAX_LENGTH, 'Country'),
  householdName: createOptionalDemoPostalField(HOUSEHOLD_NAME_MAX_LENGTH, 'Household name'),
  notes: z.string().trim().max(1000, 'Notes must be under 1000 characters.').optional().or(z.literal('')).nullable(),
});

function isDemoAddressCollectionOnly(partyTags: unknown): boolean {
  return normalizePartyTags(partyTags).includes('address-collection');
}

function escapeDemoHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDemoThankYouText(
  template: string,
  tokens: ThankYouTemplateTokens
): string {
  const guestName = tokens.guestName?.trim() || 'Friend';
  const giftName = tokens.giftName?.trim() || 'wedding gift';
  const formattedAmount =
    typeof tokens.amount === 'number'
      ? formatCurrency(tokens.amount)
      : tokens.amount?.trim() || '$0.00';

  return template
    .replace(/\{\{\s*guestName\s*\}\}/g, guestName)
    .replace(/\{\{\s*giftName\s*\}\}/g, giftName)
    .replace(/\{\{\s*amount\s*\}\}/g, formattedAmount);
}

function formatDemoEmailHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;">${escapeDemoHtml(p).replace(/\n/g, '<br />')}</p>`)
    .join('');
  return `<div style="font-family:Georgia,serif;color:#1f2937;line-height:1.6;">${paragraphs}</div>`;
}

function jsonResponse(
  payload: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

function binaryDemoResponse(
  body: Uint8Array | string,
  contentType: string,
  filename: string
): Response {
  return new Response(body instanceof Uint8Array ? (body as unknown as BodyInit) : body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

function escapeDemoCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  const formulaSafe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  if (/[",\r\n]/.test(formulaSafe)) {
    return `"${formulaSafe.replace(/"/g, '""')}"`;
  }
  return formulaSafe;
}

function buildDemoCsv(headers: string[], rows: Array<Array<unknown>>): string {
  return [
    headers.map(escapeDemoCsvCell).join(','),
    ...rows.map((row) => row.map(escapeDemoCsvCell).join(',')),
  ].join('\r\n');
}

function resolveDemoRegistryItemTarget(
  currentItems: RegistryItem[],
  rawItemId: string
): { item: RegistryItem; matchedActiveId: string | null } | null {
  const trimmed = rawItemId.trim();
  if (!trimmed) return null;

  const exact = currentItems.find((i) => i.id === trimmed);
  if (exact) {
    return { item: exact, matchedActiveId: exact.id };
  }

  if (trimmed === '1' && currentItems.length > 0) {
    return { item: currentItems[0], matchedActiveId: currentItems[0].id };
  }

  const sampleMatch = /^sample-registry-(classic|destination|romantic)-(\d+)$/.exec(trimmed);
  if (sampleMatch) {
    const mappedId = `demo-${sampleMatch[1]}-item-${sampleMatch[2]}`;
    const mapped = currentItems.find((i) => i.id === mappedId);
    if (mapped) {
      return { item: mapped, matchedActiveId: mapped.id };
    }
  }

  const seeded = findSeededRegistryItemById(trimmed, { includeContributors: true });
  if (seeded) {
    return { item: seeded, matchedActiveId: null };
  }

  return null;
}

function applyDemoRegistryItemPatch(
  target: RegistryItem,
  body: Record<string, unknown>,
  overrideId?: string
): RegistryItem {
  const nextId = overrideId ?? target.id;
  const nextItemType =
    body.itemType === 'PHYSICAL' ||
    body.itemType === 'CASH_FUND' ||
    body.itemType === 'EXPERIENCE_FUND'
      ? body.itemType
      : (target.itemType ?? 'PHYSICAL');
  const nextImageUrl =
    typeof body.imageUrl === 'string'
      ? body.imageUrl.trim()
      : undefined;
  const nextImageAlt =
    typeof body.imageAlt === 'string'
      ? body.imageAlt
      : undefined;
  const nextImageDecorative =
    typeof body.imageDecorative === 'boolean'
      ? body.imageDecorative
      : undefined;

  let nextImage = target.image;
  let nextImageId = target.imageId;
  if (nextImageUrl !== undefined) {
    if (!nextImageUrl) {
      nextImage = null;
      nextImageId = null;
    } else {
      const resolvedImgId = target.image?.id || `${nextId}-img`;
      nextImageId = resolvedImgId;
      nextImage = {
        id: resolvedImgId,
        url: nextImageUrl,
        altText: nextImageAlt ?? target.image?.altText ?? target.name,
        isDecorative: nextImageDecorative ?? target.image?.isDecorative ?? false,
        isSample: target.image?.isSample ?? false,
      };
    }
  } else if (nextImage && (nextImageAlt !== undefined || nextImageDecorative !== undefined)) {
    nextImage = {
      ...nextImage,
      ...(nextImageAlt !== undefined ? { altText: nextImageAlt } : {}),
      ...(nextImageDecorative !== undefined ? { isDecorative: nextImageDecorative } : {}),
    };
  }

  return {
    ...target,
    id: nextId,
    ...(typeof body.name === 'string' ? { name: body.name } : {}),
    ...(body.description === null
      ? { description: undefined }
      : typeof body.description === 'string'
        ? { description: body.description }
        : {}),
    ...(typeof body.category === 'string' ? { category: body.category } : {}),
    ...(typeof body.price === 'number' && Number.isFinite(body.price)
      ? { price: body.price }
      : {}),
    ...(typeof body.quantity === 'number' && Number.isFinite(body.quantity)
      ? { quantity: Math.max(1, Math.round(body.quantity)) }
      : {}),
    itemType: nextItemType,
    ...(typeof body.isGroupGift === 'boolean' ? { isGroupGift: body.isGroupGift } : {}),
    ...(typeof body.isMostWanted === 'boolean' ? { isMostWanted: body.isMostWanted } : {}),
    ...(typeof body.displayOrder === 'number' && Number.isFinite(body.displayOrder)
      ? { displayOrder: body.displayOrder }
      : {}),
    ...(body.vendorUrl === null || typeof body.vendorUrl === 'string'
      ? { vendorUrl: body.vendorUrl || null }
      : {}),
    ...(body.paymentHandleType === null || typeof body.paymentHandleType === 'string'
      ? { paymentHandleType: body.paymentHandleType || null }
      : {}),
    ...(body.paymentHandle === null || typeof body.paymentHandle === 'string'
      ? { paymentHandle: body.paymentHandle || null }
      : {}),
    ...(typeof body.purchased === 'boolean' ? { purchased: body.purchased } : {}),
    imageId: nextImageId,
    image: nextImage,
  };
}

async function parseJsonBody(init?: RequestInit): Promise<Record<string, unknown>> {
  if (!init?.body) return {};
  if (typeof init.body === 'string') {
    try {
      const parsed: unknown = JSON.parse(init.body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function resolveApiPathname(input: RequestInfo | URL): URL | null {
  if (typeof window === 'undefined') return null;
  let rawUrl = '';
  if (typeof input === 'string') {
    rawUrl = input;
  } else if (input instanceof URL) {
    rawUrl = input.toString();
  } else if (typeof Request !== 'undefined' && input instanceof Request) {
    rawUrl = input.url;
  }
  if (!rawUrl) return null;

  try {
    const url = new URL(rawUrl, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    let path = stripBasePath(url.pathname);
    if (!path.startsWith('/api/')) {
      const apiIdx = path.indexOf('/api/');
      if (apiIdx > 0) {
        path = path.slice(apiIdx);
      }
    }
    if (!path.startsWith('/api/')) return null;
    if (path.length > 1 && path.endsWith('/')) {
      path = path.replace(/\/+$/, '');
    }
    const normalized = new URL(url.toString());
    normalized.pathname = path;
    return normalized;
  } catch {
    return null;
  }
}

type StaticDemoRouteRequestFn = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response | null>;

function getStaticDemoRouteRequest(): StaticDemoRouteRequestFn | null {
  if (typeof window === 'undefined') return null;
  const installed = (
    window as Window & {
      __STATIC_DEMO_INSTALLED__?: { routeRequest?: StaticDemoRouteRequestFn };
    }
  ).__STATIC_DEMO_INSTALLED__;
  return typeof installed?.routeRequest === 'function' ? installed.routeRequest : null;
}

function upsertInvitationsIntoStaticDemoStore(records: InvitationCodeDTO[]): void {
  if (typeof window === 'undefined' || records.length === 0) return;
  const store = (
    window as Window & {
      __STATIC_DEMO_INSTALLED__?: {
        store?: {
          mutate?: (
            mutator: (draft: {
              invitationCode: Array<Record<string, unknown>>;
            }) => void
          ) => void;
        };
      };
    }
  ).__STATIC_DEMO_INSTALLED__?.store;
  if (typeof store?.mutate !== 'function') return;
  const nowIso = new Date().toISOString();
  store.mutate((draft) => {
    for (const dto of records) {
      const existing = draft.invitationCode.find(
        (inv) => inv.id === dto.id || String(inv.code || '').toUpperCase() === dto.code.toUpperCase()
      );
      if (existing) {
        existing.guestName = dto.guestName;
        existing.householdName = dto.householdName ?? '';
        existing.email = dto.email ?? null;
        existing.addressLine1 = dto.addressLine1 ?? null;
        existing.addressLine2 = dto.addressLine2 ?? null;
        existing.city = dto.city ?? null;
        existing.state = dto.state ?? null;
        existing.zipCode = dto.zipCode ?? null;
        existing.country = dto.country ?? null;
        existing.dietaryNotes = dto.dietaryNotes ?? null;
        existing.partyGroup = dto.partyGroup ?? '';
        existing.partyTags = [...(dto.partyTags ?? [])];
        existing.plusOneAllocations = dto.plusOneAllocations ?? 0;
        if (dto.extraFields !== undefined) {
          existing.extraFields = dto.extraFields;
        }
        existing.updatedAt = nowIso;
      } else {
        draft.invitationCode.push({
          id: dto.id,
          code: dto.code,
          guestName: dto.guestName,
          householdName: dto.householdName ?? '',
          email: dto.email ?? null,
          addressLine1: dto.addressLine1 ?? null,
          addressLine2: dto.addressLine2 ?? null,
          city: dto.city ?? null,
          state: dto.state ?? null,
          zipCode: dto.zipCode ?? null,
          country: dto.country ?? null,
          dietaryNotes: dto.dietaryNotes ?? null,
          plusOneAllocations: dto.plusOneAllocations ?? 0,
          plusOneFirstName: null,
          plusOneLastName: null,
          partyGroup: dto.partyGroup ?? '',
          partyTags: [...(dto.partyTags ?? [])],
          extraFields: dto.extraFields ?? null,
          used: Boolean(dto.used),
          usedAt: null,
          tableId: dto.tableId ?? null,
          seatNumber: dto.seatNumber ?? null,
          plusOneSeatNumbers: dto.plusOneSeatNumbers ?? [],
          isSample: Boolean(dto.isSample),
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    }
  });
}

async function delegateToStaticDemoRouter(
  input: RequestInfo | URL | undefined,
  init: RequestInit | undefined,
  method: string,
  path: string
): Promise<Response | null> {
  const staticRouteRequest = getStaticDemoRouteRequest();
  if (!staticRouteRequest || !input) return null;
  const delegated = await staticRouteRequest(input, init);
  if (!delegated) return null;

  if (path === '/api/guest/login' && method === 'POST' && delegated.ok) {
    const body = await parseJsonBody(init);
    const matched = typeof body.code === 'string' ? findDemoGuestByCode(body.code) : null;
    if (matched) {
      setDemoGuestSession({ invitationCode: matched.code, guestName: matched.guestName });
    }
  } else if (path === '/api/guest/logout' && method === 'POST') {
    setDemoGuestSession(null);
  }

  return delegated;
}

async function handleDemoApi(
  url: URL,
  init?: RequestInit,
  rawInput?: RequestInfo | URL
): Promise<Response> {
  const method = (init?.method || 'GET').toUpperCase();
  const path = url.pathname;

  // 1. Admin auth & setup
  if (path === '/api/admin/me' && method === 'GET') {
    return jsonResponse({ isAdmin: isDemoAdminSession() });
  }

  if (path === '/api/admin/logout' && method === 'POST') {
    setDemoPersona('guest');
    return jsonResponse({ success: true });
  }

  if (path === '/api/admin/setup' && method === 'GET') {
    const isSetup = getDemoState().persona === 'setup';
    return jsonResponse({
      success: true,
      initialized: true,
      setupCompleted: !isSetup,
      requiresSetup: isSetup,
    });
  }

  if (path === '/api/admin/setup' && method === 'POST') {
    const body = await parseJsonBody(init);
    const bodyKeys = Object.keys(body);
    if (bodyKeys.length === 0) {
      const isSetup = getDemoState().persona === 'setup' && !getDemoState().setupAuthenticated;
      return jsonResponse({
        success: true,
        initialized: true,
        setupCompleted: !isSetup,
        requiresSetup: isSetup,
      });
    }
    if ('password' in body && bodyKeys.length === 1) {
      setDemoSetupAuthenticated(true);
      return jsonResponse({ success: true });
    }
    if ('setupCompleted' in body && typeof body.setupCompleted === 'boolean' && bodyKeys.length === 1) {
      if (body.setupCompleted) {
        setDemoSetupAuthenticated(true);
        if (getDemoState().persona === 'setup') {
          setDemoPersona('admin');
        }
      }
      return jsonResponse({
        success: true,
        initialized: true,
        setupCompleted: body.setupCompleted,
        requiresSetup: !body.setupCompleted,
      });
    }
    const overrides: Partial<PublicAppConfig> = {};
    if (typeof body.partner1Name === 'string') overrides.partner1Name = body.partner1Name;
    if (typeof body.partner2Name === 'string') overrides.partner2Name = body.partner2Name;
    if (typeof body.weddingDate === 'string' && body.weddingDate) {
      overrides.weddingDate = new Date(
        body.weddingDate.includes('T') ? body.weddingDate : `${body.weddingDate}T16:00:00Z`
      );
    }
    if (typeof body.venueName === 'string') {
      overrides.venueName = cleanOptionalSetupText(body.venueName);
    }
    if (typeof body.venueAddress === 'string') {
      overrides.venueAddress = cleanOptionalSetupText(body.venueAddress);
    }
    if (typeof body.venueCity === 'string') {
      overrides.venueCity = cleanOptionalSetupText(body.venueCity);
    }
    if (typeof body.venueState === 'string') {
      overrides.venueState = cleanOptionalSetupText(body.venueState);
    }
    if (typeof body.venueZip === 'string') {
      overrides.venueZip = cleanOptionalSetupText(body.venueZip);
    }
    if (typeof body.latitude === 'number' && Number.isFinite(body.latitude)) {
      overrides.latitude = body.latitude;
    }
    if (typeof body.longitude === 'number' && Number.isFinite(body.longitude)) {
      overrides.longitude = body.longitude;
    }
    if (typeof body.timezone === 'string') overrides.timezone = body.timezone;
    if (typeof body.contactEmail === 'string') overrides.contactEmail = body.contactEmail;
    if (typeof body.heroTitle === 'string') overrides.heroTitle = body.heroTitle;
    if (typeof body.heroSubtitle === 'string') overrides.heroSubtitle = body.heroSubtitle;
    if (typeof body.storyText === 'string') {
      overrides.storyText = cleanOptionalSetupText(body.storyText);
    }
    if (typeof body.venueDescription === 'string') {
      overrides.venueDescription = cleanOptionalSetupText(body.venueDescription);
    }
    if (typeof body.travelAdvice === 'string') {
      overrides.travelAdvice = cleanOptionalSetupText(body.travelAdvice);
    }
    if (typeof body.seoTitle === 'string') overrides.seoTitle = body.seoTitle;
    if (typeof body.seoDescription === 'string') overrides.seoDescription = body.seoDescription;
    if (
      typeof body.themePreset === 'string' &&
      THEME_PRESET_KEYS.includes(body.themePreset as ThemePreset)
    ) {
      overrides.themePreset = body.themePreset as ThemePreset;
    }
    if (typeof body.colorPrimary === 'string') overrides.colorPrimary = body.colorPrimary;
    if (typeof body.colorSecondary === 'string') overrides.colorSecondary = body.colorSecondary;
    if (body.modules && typeof body.modules === 'object' && !Array.isArray(body.modules)) {
      const currentModules = getDemoState().configOverrides.modules;
      overrides.modules = resolveModuleConfig({
        ...(currentModules ?? {}),
        ...(body.modules as Record<string, unknown>),
      });
    }
    updateDemoConfigOverrides(overrides);
    setDemoSetupAuthenticated(true);
    return jsonResponse({ success: true, modules: overrides.modules });
  }

  if (path === '/api/admin/geocode' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) {
      return jsonResponse({ success: false, error: 'Search query is required.' }, 400);
    }
    const archetype = getDemoState().archetype;
    const region =
      archetype === 'destination'
        ? {
          streetAddress: '450 Ocean Drive',
          city: 'Miami Beach',
          state: 'FL',
          zip: '33139',
          latitude: 25.7743,
          longitude: -80.1304,
        }
        : archetype === 'romantic'
          ? {
            streetAddress: '1120 Silverado Trail',
            city: 'Napa',
            state: 'CA',
            zip: '94558',
            latitude: 38.2975,
            longitude: -122.2869,
          }
          : {
            streetAddress: '123 Oak Ave',
            city: 'Chicago',
            state: 'IL',
            zip: '60601',
            latitude: 41.8842,
            longitude: -87.6324,
          };
    return jsonResponse({
      success: true,
      data: [
        {
          displayName: `${q}, ${region.streetAddress}, ${region.city}, ${region.state} ${region.zip}, United States`,
          name: q,
          streetAddress: region.streetAddress,
          city: region.city,
          state: region.state,
          zip: region.zip,
          country: 'United States',
          latitude: region.latitude,
          longitude: region.longitude,
        },
      ],
    });
  }

  // 2. Sample data status, seed, and purge
  if (path === '/api/admin/sample-data') {
    if (method === 'GET') {
      const dataset = getActiveArchetypeDataset();
      const counts = {
        registry: dataset.registryItems.filter((i) => i.isSample).length,
        guests: dataset.guests.filter((g) => g.isSample).length,
        seating: dataset.seatingTables.filter((t) => t.isSample).length,
        weddingParty: dataset.weddingParty.filter((m) => m.isSample).length,
        attractions: dataset.attractions.filter((a) => a.isSample).length,
        faqs: dataset.faqs.length,
      };
      const total =
        counts.registry +
        counts.guests +
        counts.seating +
        counts.weddingParty +
        counts.attractions +
        counts.faqs;
      return jsonResponse({
        success: true,
        hasSampleData: total > 0,
        counts,
      });
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init);
      const rawArch = typeof body.archetype === 'string' ? body.archetype : 'classic';
      const archetype: ArchetypeId =
        rawArch in ARCHETYPE_PRESETS ? (rawArch as ArchetypeId) : 'classic';
      const modules = Array.isArray(body.modules)
        ? body.modules.filter((m): m is string => typeof m === 'string')
        : ['registry', 'guests', 'seating', 'weddingParty', 'attractions', 'faqs'];
      applyDemoSampleSelection(archetype, modules);
      return jsonResponse({ success: true });
    }
    if (method === 'DELETE') {
      purgeDemoSampleData();
      return jsonResponse({ success: true });
    }
  }

  // 3. Registry capabilities, items, contribution, claims, and guest sessions
  if (path === '/api/registry/capabilities' && method === 'GET') {
    return jsonResponse({
      cardCheckoutEnabled: true,
      stripePublishableKey: null,
      defaultPaymentHandleType: 'Venmo',
      defaultPaymentHandle: '@alex-and-taylor',
      shippingAddress: DEMO_SHIPPING_ADDRESS,
    });
  }

  if (path === '/api/registry/items') {
    if (method === 'GET') {
      const items = getActiveArchetypeDataset().registryItems;
      const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
      const limit = Math.max(1, Number(url.searchParams.get('limit') || '100'));
      return jsonResponse({
        items,
        total: items.length,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(items.length / limit)),
      });
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init);
      const id = nextDemoId('demo-custom-item');
      const baseNewItem: RegistryItem = {
        id,
        name: String(body.name || 'Custom Gift'),
        description: String(body.description || ''),
        category: String(body.category || 'Home'),
        price: Number(body.price || 50),
        quantity: Number(body.quantity || 1),
        itemType:
          body.itemType === 'CASH_FUND' || body.itemType === 'EXPERIENCE_FUND'
            ? body.itemType
            : 'PHYSICAL',
        isGroupGift: Boolean(body.isGroupGift),
        isMostWanted: Boolean(body.isMostWanted),
        displayOrder: Number(body.displayOrder || 0),
        vendorUrl: typeof body.vendorUrl === 'string' ? body.vendorUrl : null,
        paymentHandleType:
          typeof body.paymentHandleType === 'string' && body.paymentHandleType
            ? body.paymentHandleType
            : 'Venmo',
        paymentHandle:
          typeof body.paymentHandle === 'string' && body.paymentHandle
            ? body.paymentHandle
            : '@alex-and-taylor',
        purchased: false,
        purchaserName: null,
        amountContributed: 0,
        isSample: false,
        imageId: null,
        image: null,
        contributors: [],
      };
      const newItem = applyDemoRegistryItemPatch(baseNewItem, body, id);
      mutateActiveDataset((current) => ({
        ...current,
        registryItems: [newItem, ...current.registryItems],
      }));
      return jsonResponse(newItem, 201);
    }
  }

  if (path === '/api/admin/registry-items' && method === 'PUT') {
    const body = await parseJsonBody(init);
    if (body.action === 'reorder' && Array.isArray(body.orderedIds)) {
      const orderedIds = body.orderedIds.filter((id): id is string => typeof id === 'string');
      mutateActiveDataset((current) => {
        const byId = new Map(current.registryItems.map((item) => [item.id, item]));
        const reordered: RegistryItem[] = [];
        for (const id of orderedIds) {
          const matched = byId.get(id);
          if (matched) {
            reordered.push({ ...matched, displayOrder: reordered.length });
            byId.delete(id);
          }
        }
        for (const remaining of byId.values()) {
          reordered.push({ ...remaining, displayOrder: reordered.length });
        }
        return { ...current, registryItems: reordered };
      });
      return jsonResponse({ success: true });
    }
  }

  if (path.startsWith('/api/registry/items/') || path.startsWith('/api/admin/registry-items/')) {
    const prefix = path.startsWith('/api/admin/registry-items/')
      ? '/api/admin/registry-items/'
      : '/api/registry/items/';
    const itemId = decodeURIComponent(path.slice(prefix.length));
    const currentItems = getActiveArchetypeDataset().registryItems;
    const resolved = resolveDemoRegistryItemTarget(currentItems, itemId);

    if (method === 'GET') {
      if (!resolved) {
        return jsonResponse({ error: 'Item not found' }, 404);
      }
      return jsonResponse(resolved.item);
    }
    if (method === 'DELETE') {
      if (!resolved?.matchedActiveId) return jsonResponse({ error: 'Item not found' }, 404);
      mutateActiveDataset((current) => ({
        ...current,
        registryItems: current.registryItems.filter((i) => i.id !== resolved.matchedActiveId),
      }));
      return jsonResponse(resolved.item);
    }
    if (method === 'PUT' || method === 'PATCH') {
      if (!resolved) return jsonResponse({ error: 'Item not found' }, 404);
      const body = await parseJsonBody(init);
      const persistedId = resolved.matchedActiveId ?? itemId;
      const updated = applyDemoRegistryItemPatch(resolved.item, body, persistedId);
      mutateActiveDataset((current) => ({
        ...current,
        registryItems: resolved.matchedActiveId
          ? current.registryItems.map((i) => (i.id === resolved.matchedActiveId ? updated : i))
          : [updated, ...current.registryItems],
      }));
      return jsonResponse(updated);
    }
  }

  if (path === '/api/registry/contribute' && method === 'POST') {
    const body = await parseJsonBody(init);
    const itemId = String(body.itemId || '');
    const purchaserName = String(body.purchaserName || body.name || '').trim();
    const amount = Number(body.amount || 0);
    if (!itemId || !purchaserName || !(amount > 0)) {
      return jsonResponse({ error: 'Missing contribution details.' }, 400);
    }
    const updated = recordDemoContribution({
      itemId,
      purchaserName,
      amount,
      code: typeof body.code === 'string' ? body.code : undefined,
      message: typeof body.message === 'string' ? body.message : null,
      coverFee: Boolean(body.coverFee),
      email: typeof body.email === 'string' ? body.email : null,
      paymentIntentId:
        typeof body.paymentIntentId === 'string' && body.paymentIntentId
          ? body.paymentIntentId
          : undefined,
      retailerOrderNumber:
        typeof body.retailerOrderNumber === 'string' ? body.retailerOrderNumber : undefined,
      carrier: typeof body.carrier === 'string' ? body.carrier : undefined,
      trackingNumber:
        typeof body.trackingNumber === 'string' ? body.trackingNumber : undefined,
      addressLine1: typeof body.addressLine1 === 'string' ? body.addressLine1 : undefined,
      addressLine2: typeof body.addressLine2 === 'string' ? body.addressLine2 : undefined,
      city: typeof body.city === 'string' ? body.city : undefined,
      state: typeof body.state === 'string' ? body.state : undefined,
      zipCode: typeof body.zipCode === 'string' ? body.zipCode : undefined,
      country: typeof body.country === 'string' ? body.country : undefined,
    });
    if (!updated) {
      return jsonResponse({ error: 'Registry item not found.' }, 404);
    }
    return jsonResponse(updated);
  }

  if (path === '/api/registry/claim') {
    if (method === 'GET') {
      const token = (url.searchParams.get('token') || '').trim();
      if (!token) {
        return jsonResponse({ error: 'Missing claim token.' }, 400);
      }
      const preview = previewDemoClaimToken(token);
      if (!preview) {
        return jsonResponse({ error: 'Invalid or expired reservation token.' }, 404);
      }
      return jsonResponse(preview);
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init);
      const token = String(body.token || '').trim();
      if (!token) {
        return jsonResponse({ error: 'Missing claim token.' }, 400);
      }
      const result = processDemoClaimToken(token);
      if (!result) {
        return jsonResponse({ error: 'Invalid or expired reservation token.' }, 404);
      }
      return jsonResponse(result);
    }
  }

  if (path === '/api/registry/payment-intent' && method === 'POST') {
    const body = await parseJsonBody(init);
    const amount = Math.max(1, Number(body.amount ?? 50) || 50);
    const piId = nextDemoId('pi_demo');
    return jsonResponse({
      clientSecret: `${piId}_secret_demo`,
      paymentIntentId: piId,
      amount: Math.round(amount * 100),
    });
  }

  if (path === '/api/registry/payment-intent/reconcile' && method === 'POST') {
    const body = await parseJsonBody(init);
    const paymentIntentId =
      typeof body.paymentIntentId === 'string' ? body.paymentIntentId.trim() : '';
    const clientSecret =
      typeof body.clientSecret === 'string' ? body.clientSecret.trim() : '';
    const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
    if (!paymentIntentId || !clientSecret) {
      return jsonResponse({ error: 'Missing or invalid paymentIntentId.' }, 400);
    }
    const items = getActiveArchetypeDataset().registryItems;
    const target = itemId
      ? resolveDemoRegistryItemTarget(items, itemId)?.item
      : items[0];
    if (!target) {
      return jsonResponse({ error: 'Item not found' }, 404);
    }
    const session = getDemoState().guestSession;
    const activeGuest = session ? findDemoGuestByCode(session.invitationCode) : null;
    const resolvedEmail =
      activeGuest && typeof activeGuest.email === 'string' && activeGuest.email.trim().length > 0
        ? activeGuest.email.trim()
        : null;
    return jsonResponse({
      reconciled: true,
      status: 'succeeded',
      itemId: target.id,
      item: target,
      receipt: {
        itemId: target.id,
        paymentIntentId,
        contributorName: activeGuest?.guestName || session?.guestName || 'Demo Guest',
        contributorEmail: resolvedEmail,
        baseAmount: target.price,
        feeAmount: 0,
        coverFee: false,
        totalChargeAmount: target.price,
        message: null,
      },
    });
  }

  if (path === '/api/registry/validate-code' && method === 'GET') {
    const rawCode = url.searchParams.get('code') || '';
    const matched = findDemoGuestByCode(rawCode);
    if (!matched) {
      const trimmedUpper = rawCode.trim().toUpperCase();
      const envPasscode =
        typeof process !== 'undefined' && typeof process.env?.GUEST_PASSCODE === 'string'
          ? process.env.GUEST_PASSCODE.trim().toUpperCase()
          : '';
      if (trimmedUpper === 'WEDDING2026' || (envPasscode && trimmedUpper === envPasscode)) {
        const guidanceError =
          'That is the shared website passcode. Please enter the personal household invitation code printed on your invitation.';
        return jsonResponse({
          valid: false,
          success: true,
          reason: 'shared_passcode',
          error: guidanceError,
          data: {
            valid: false,
            reason: 'shared_passcode',
            error: guidanceError,
          },
        });
      }
      return jsonResponse(
        {
          valid: false,
          success: false,
          error: 'Invalid invitation code for the active wedding archetype.',
        },
        404
      );
    }
    const resolvedEmail =
      typeof matched.email === 'string' && matched.email.trim().length > 0
        ? matched.email.trim()
        : null;
    setDemoGuestSession({
      invitationCode: matched.code,
      guestName: matched.guestName,
    });
    return jsonResponse({
      valid: true,
      success: true,
      code: matched.code,
      guestName: matched.guestName,
      email: resolvedEmail,
      data: {
        valid: true,
        code: matched.code,
        guestName: matched.guestName,
        email: resolvedEmail,
      },
    });
  }

  if (path === '/api/registry/session') {
    if (method === 'GET') {
      const session = getDemoState().guestSession;
      const activeGuest = session ? findDemoGuestByCode(session.invitationCode) : null;
      if (!session || !activeGuest) {
        return jsonResponse({
          isVerified: false,
          invitationCode: '',
          guestName: '',
          email: null,
        });
      }
      const resolvedEmail =
        typeof activeGuest.email === 'string' && activeGuest.email.trim().length > 0
          ? activeGuest.email.trim()
          : null;
      return jsonResponse({
        isVerified: true,
        invitationCode: activeGuest.code,
        code: activeGuest.code,
        guestName: activeGuest.guestName,
        email: resolvedEmail,
      });
    }
    if (method === 'DELETE') {
      setDemoGuestSession(null);
      return jsonResponse({ success: true, email: null });
    }
  }

  if (path === '/api/guest/session') {
    if (method === 'GET') {
      const session = getDemoState().guestSession;
      const activeGuest = session ? findDemoGuestByCode(session.invitationCode) : null;
      if (!session || !activeGuest) {
        return jsonResponse({
          status: 'none',
          isVerified: false,
          invitationCode: null,
          code: null,
          guestName: null,
          hasPasscodeSession: false,
        });
      }
      return jsonResponse({
        status: 'invitation',
        isVerified: true,
        invitationCode: activeGuest.code,
        code: activeGuest.code,
        guestName: activeGuest.guestName,
        hasPasscodeSession: false,
      });
    }
    if (method === 'DELETE') {
      setDemoGuestSession(null);
      return jsonResponse({
        status: 'none',
        isVerified: false,
        invitationCode: null,
        code: null,
        guestName: null,
        hasPasscodeSession: false,
      });
    }
  }

  if (path === '/api/schedule' && method === 'GET') {
    const demoState = getDemoState();
    const seed = buildArchetypeSeedData(demoState.archetype);
    const rawSession = demoState.guestSession;
    const normalizedCode = rawSession?.invitationCode?.trim().toUpperCase() || '';
    const matchedGuest = normalizedCode ? findDemoGuestByCode(normalizedCode) : null;
    const session = rawSession && matchedGuest ? rawSession : null;
    const activeCode = session ? matchedGuest!.code.toUpperCase() : '';
    const seedGuest = activeCode
      ? seed.guests.find((g) => g.code.toUpperCase() === activeCode)
      : undefined;
    const guestDietaryNotes = (
      matchedGuest?.dietaryNotes ||
      seedGuest?.dietaryNotes ||
      ''
    ).trim();

    const savedPlusOneNameSet = new Set<string>();
    const schedule = seed.subEvents
      .filter((evt) => {
        if (!evt.isPrivate) return true;
        if (!seedGuest) return false;
        return evt.accesses.some((acc) => acc.invitationCodeId === seedGuest.id);
      })
      .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
      .map((evt) => {
        const override = activeCode
          ? demoState.rsvpOverrides[`${demoState.archetype}:${activeCode}:${evt.id}`]
          : undefined;
        const seededRsvp = seedGuest
          ? evt.rsvps.find((entry) => entry.invitationCodeId === seedGuest.id) ?? null
          : null;
        const resolvedRsvp = override ?? seededRsvp;
        if (resolvedRsvp) {
          for (const name of normalizePlusOneNames(resolvedRsvp.plusOneNames)) {
            if (name) savedPlusOneNameSet.add(name);
          }
        }
        return {
          id: evt.id,
          title: evt.title,
          description: evt.description || '',
          startTime: evt.startTime.toISOString(),
          endTime: evt.endTime.toISOString(),
          locationName: evt.locationName || '',
          location: evt.location || '',
          category: evt.category || '',
          isPrivate: evt.isPrivate,
          isReadOnly: false,
          attireRules: evt.attireRules || null,
          mealOptions: normalizeMealOptions(evt.mealOptions),
          customQuestions: normalizeCustomQuestions(evt.customQuestions),
          userRsvp: session
            ? resolvedRsvp
              ? {
                status: resolvedRsvp.status,
                plusOneCount: resolvedRsvp.plusOneCount,
                dietaryNotes: resolvedRsvp.dietaryNotes || '',
                mealSelections: normalizeMealSelections(resolvedRsvp.mealSelections),
                customAnswers: normalizeCustomAnswers(resolvedRsvp.customAnswers),
                plusOneNames: normalizePlusOneNames(resolvedRsvp.plusOneNames),
              }
              : guestDietaryNotes
                ? {
                  status: 'pending' as const,
                  plusOneCount: 0,
                  dietaryNotes: guestDietaryNotes,
                }
                : null
            : null,
        };
      });

    const timezone = resolveValidTimezone(
      demoState.configOverrides.timezone || seed.config.timezone
    );

    return jsonResponse({
      success: true,
      data: schedule,
      isGuest: Boolean(session),
      guestName: matchedGuest?.guestName || session?.guestName || null,
      plusOneAllocations: session
        ? (matchedGuest?.plusOneAllocations ?? seedGuest?.plusOneAllocations ?? 0)
        : null,
      savedPlusOneNames: session ? Array.from(savedPlusOneNameSet) : [],
      rsvpOpen: demoState.configOverrides.rsvpOpen !== false,
      rsvpDeadlineDate: null,
      rsvpFormattedDeadline: null,
      timezone,
      rsvpClosedMessage: DEFAULT_RSVP_CLOSED_MESSAGE,
    });
  }

  if (path === '/api/rsvp' && method === 'POST') {
    const demoState = getDemoState();
    const session = demoState.guestSession;
    const matchedGuest = session?.invitationCode
      ? findDemoGuestByCode(session.invitationCode)
      : null;
    if (!session || !session.invitationCode || !matchedGuest) {
      return jsonResponse(
        { error: 'Unauthorized: Please log in with your invitation code to submit RSVPs.' },
        401
      );
    }
    const body = await parseJsonBody(init);
    const rawList = Array.isArray(body.rsvps)
      ? (body.rsvps as Array<Record<string, unknown>>)
      : typeof body.subEventId === 'string'
        ? [body]
        : null;
    if (!rawList || rawList.length === 0) {
      return jsonResponse(
        { error: 'Invalid RSVP payload format. Expected { subEventId, status } or { rsvps: [...] }.' },
        400
      );
    }

    const hasInvalidStatus = rawList.some(
      (entry) => entry.status !== 'attending' && entry.status !== 'declined'
    );
    if (hasInvalidStatus) {
      return jsonResponse({ error: 'Please select Attending or Declined.' }, 400);
    }

    const seed = buildArchetypeSeedData(demoState.archetype);
    const normalizedCode = matchedGuest.code.trim().toUpperCase();
    const seedGuest = seed.guests.find((g) => g.code.toUpperCase() === normalizedCode);
    const fallbackDietary = (
      matchedGuest.dietaryNotes ||
      seedGuest?.dietaryNotes ||
      ''
    ).trim();

    const updatedRsvps = rawList.map((entry) => {
      const subEventId = String(entry.subEventId || '').trim();
      const status: 'attending' | 'declined' =
        entry.status === 'declined' ? 'declined' : 'attending';
      const plusOneCount =
        status === 'declined' ? 0 : Math.max(0, Number(entry.plusOneCount || 0));
      const existingOverride =
        demoState.rsvpOverrides[`${demoState.archetype}:${normalizedCode}:${subEventId}`];
      const seededRsvp = seedGuest
        ? seed.subEvents
          .find((evt) => evt.id === subEventId)
          ?.rsvps.find((r) => r.invitationCodeId === seedGuest.id)
        : undefined;
      const rawDietary = entry.dietaryNotes;
      const hasExplicitDietaryString = typeof rawDietary === 'string';
      const incomingDietary = hasExplicitDietaryString ? rawDietary.trim() : '';
      const hadExistingEventNote = Boolean(
        existingOverride?.dietaryNotes?.trim() || seededRsvp?.dietaryNotes?.trim()
      );
      const shouldClearDietary =
        entry.clearDietaryNotes === true ||
        (status !== 'declined' && hasExplicitDietaryString && incomingDietary === '' && hadExistingEventNote);
      const resolvedDietary = shouldClearDietary
        ? ''
        : incomingDietary ||
          existingOverride?.dietaryNotes ||
          seededRsvp?.dietaryNotes ||
          fallbackDietary;

      const record = {
        status,
        plusOneCount,
        dietaryNotes: resolvedDietary,
        mealSelections:
          status === 'declined' ? [] : normalizeMealSelections(entry.mealSelections),
        customAnswers:
          status === 'declined' ? {} : normalizeCustomAnswers(entry.customAnswers),
        plusOneNames:
          status === 'declined' ? [] : normalizePlusOneNames(entry.plusOneNames),
      };
      upsertDemoSubEventRsvp(normalizedCode, subEventId, record);
      return {
        subEventId,
        ...record,
      };
    });

    return jsonResponse({
      success: true,
      data: updatedRsvps,
    });
  }

  // 4. Guest Address Portal & Public Address Collection
  if (path === '/api/guest/address/public' && method === 'POST') {
    const body = await parseJsonBody(init);
    if (!body.guestName && typeof body.name === 'string') body.guestName = body.name;
    if (!body.addressLine1 && typeof body.streetAddress === 'string') {
      body.addressLine1 = body.streetAddress;
    }
    if (!body.zipCode && typeof body.postalCode === 'string') body.zipCode = body.postalCode;
    if (!body.notes && typeof body.householdNotes === 'string') body.notes = body.householdNotes;
    if (!body.phone && typeof body.mobile === 'string') body.phone = body.mobile;
    if (!body.phone && typeof body.phoneNumber === 'string') body.phone = body.phoneNumber;

    const honeypotVal = body.website || body.honeypot || body.hp_field || body.confirm_email;
    if (typeof honeypotVal === 'string' && honeypotVal.trim().length > 0) {
      return jsonResponse({ success: true, message: 'Address submitted successfully.' });
    }

    const parseResult = DemoPublicAddressCollectSchema.safeParse(body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.issues[0]?.message || 'Invalid address input.';
      return jsonResponse(
        { success: false, error: errorMsg, details: z.formatError(parseResult.error) },
        400
      );
    }

    const payload = parseResult.data;
    const existingCodes = new Set(
      getActiveArchetypeDataset().guests.map((g) => g.code.toUpperCase())
    );
    let uniqueCode = generateDemoInvitationCode();
    let attempts = 0;
    while (existingCodes.has(uniqueCode.toUpperCase()) && attempts < 10) {
      uniqueCode = generateDemoInvitationCode();
      attempts += 1;
    }

    const extraFields: Record<string, string> = {};
    if (payload.phone?.trim()) {
      extraFields.phone = payload.phone.trim();
      extraFields.mobile = payload.phone.trim();
    }
    if (payload.notes?.trim()) {
      extraFields.householdNotes = payload.notes.trim();
    }

    const createdGuest: InvitationCodeDTO = {
      id: nextDemoId('demo-collect'),
      code: uniqueCode,
      guestName: payload.guestName.trim(),
      email: payload.email?.trim() || null,
      addressLine1: payload.addressLine1 || null,
      addressLine2: payload.addressLine2 || null,
      city: payload.city || null,
      state: payload.state || null,
      zipCode: payload.zipCode || null,
      country: payload.country || null,
      householdName: payload.householdName || '',
      dietaryNotes: null,
      ...(Object.keys(extraFields).length > 0 ? { extraFields } : {}),
      partyGroup: '',
      partyTags: ['address-collection'],
      plusOneAllocations: 0,
      used: false,
      isSample: false,
    };

    mutateActiveDataset((current) => ({
      ...current,
      guests: [...current.guests, createdGuest],
    }));
    upsertInvitationsIntoStaticDemoStore([createdGuest]);

    return jsonResponse({
      success: true,
      message: 'Address submitted successfully.',
    });
  }

  if (path === '/api/guest/address') {
    const session = getDemoState().guestSession;
    const guest = session ? findDemoGuestByCode(session.invitationCode) : null;
    if (!session || !guest) {
      return jsonResponse({ success: false, error: 'Authentication required.' }, 401);
    }
    if (method === 'GET') {
      return jsonResponse({
        success: true,
        data: {
          guestName: guest?.guestName || session.guestName,
          code: session.invitationCode,
          addressLine1: guest?.addressLine1 || '',
          addressLine2: guest?.addressLine2 || '',
          city: guest?.city || '',
          state: guest?.state || '',
          zipCode: guest?.zipCode || '',
          country: guest?.country || '',
        },
      });
    }
    if (method === 'PUT' || method === 'POST') {
      const body = await parseJsonBody(init);
      const updated = updateDemoGuestAddress(session.invitationCode, {
        addressLine1: typeof body.addressLine1 === 'string' ? body.addressLine1 : '',
        addressLine2: typeof body.addressLine2 === 'string' ? body.addressLine2 : '',
        city: typeof body.city === 'string' ? body.city : '',
        state: typeof body.state === 'string' ? body.state : '',
        zipCode: typeof body.zipCode === 'string' ? body.zipCode : '',
        country: typeof body.country === 'string' ? body.country : '',
      });
      return jsonResponse({
        success: true,
        data: {
          guestName: updated?.guestName || session.guestName,
          code: session.invitationCode,
          addressLine1: updated?.addressLine1 || '',
          addressLine2: updated?.addressLine2 || '',
          city: updated?.city || '',
          state: updated?.state || '',
          zipCode: updated?.zipCode || '',
          country: updated?.country || '',
        },
      });
    }
  }

  // 5. Admin Seating, Guests, Wedding Party, and Attractions
  if (path === '/api/admin/seating-tables') {
    if (method === 'GET') {
      return jsonResponse({
        success: true,
        data: getActiveArchetypeDataset().seatingTables,
      });
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init);
      const validShapes: ReadonlyArray<SeatingTableDTO['shape']> = [
        'round',
        'rectangular',
        'square',
        'head',
        'sweetheart',
        'dance-floor',
        'bar',
        'dj',
        'buffet',
        'cake',
      ];
      const resolvedShape: SeatingTableDTO['shape'] =
        typeof body.shape === 'string' &&
        validShapes.includes(body.shape as SeatingTableDTO['shape'])
          ? (body.shape as SeatingTableDTO['shape'])
          : 'round';
      const isLandmark = isDemoLandmarkShape(resolvedShape);
      const newTable: SeatingTableDTO = {
        id: nextDemoId('demo-table'),
        name: String(body.name || (isLandmark ? 'Landmark' : 'New Table')),
        shape: resolvedShape,
        capacity: isLandmark ? 0 : typeof body.capacity === 'number' ? body.capacity : 8,
        x: typeof body.x === 'number' ? body.x : 200,
        y: typeof body.y === 'number' ? body.y : 200,
        width: typeof body.width === 'number' ? body.width : 120,
        height: typeof body.height === 'number' ? body.height : 120,
        rotation: typeof body.rotation === 'number' ? body.rotation : 0,
        isSample: false,
        invitationCodes: [],
      };
      mutateActiveDataset((current) => ({
        ...current,
        seatingTables: [...current.seatingTables, newTable],
      }));
      return jsonResponse({ success: true, data: newTable }, 201);
    }
  }

  if (path.startsWith('/api/admin/seating-tables/')) {
    const tableId = decodeURIComponent(path.slice('/api/admin/seating-tables/'.length));
    const existing = getActiveArchetypeDataset().seatingTables.find((t) => t.id === tableId);
    if (!existing) return jsonResponse({ error: 'Table not found' }, 404);

    if (method === 'PUT' || method === 'PATCH') {
      const body = await parseJsonBody(init);
      const nextShape =
        typeof body.shape === 'string' ? (body.shape as SeatingTableDTO['shape']) : existing.shape;
      const isLandmark = isDemoLandmarkShape(nextShape);
      const updated: SeatingTableDTO = {
        ...existing,
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        shape: nextShape,
        capacity: isLandmark
          ? 0
          : typeof body.capacity === 'number'
            ? body.capacity
            : existing.capacity,
        ...(typeof body.x === 'number' ? { x: body.x } : {}),
        ...(typeof body.y === 'number' ? { y: body.y } : {}),
        ...(typeof body.width === 'number' ? { width: body.width } : {}),
        ...(typeof body.height === 'number' ? { height: body.height } : {}),
        ...(typeof body.rotation === 'number' ? { rotation: body.rotation } : {}),
      };
      mutateActiveDataset((current) => ({
        ...current,
        seatingTables: current.seatingTables.map((t) => (t.id === tableId ? updated : t)),
      }));
      return jsonResponse({ success: true, data: updated });
    }
    if (method === 'DELETE') {
      mutateActiveDataset((current) => ({
        ...current,
        seatingTables: current.seatingTables.filter((t) => t.id !== tableId),
        guests: current.guests.map((g) =>
          g.tableId === tableId
            ? { ...g, tableId: null, seatNumber: null, plusOneSeatNumbers: [] }
            : g
        ),
      }));
      return jsonResponse({ success: true });
    }
  }

  if (path === '/api/admin/seating/assign' && method === 'POST') {
    const body = await parseJsonBody(init);
    if (Array.isArray(body.invitationCodeIds)) {
      const targetIds = new Set(
        body.invitationCodeIds.filter((id): id is string => typeof id === 'string')
      );
      const targetTableId = typeof body.tableId === 'string' ? body.tableId : null;
      const updatedGuests: InvitationCodeDTO[] = [];
      mutateActiveDataset((current) => {
        const occupiedOnTable = new Set<number>(
          targetTableId
            ? current.guests
              .filter((g) => g.tableId === targetTableId && !targetIds.has(g.id))
              .flatMap((g) => [
                ...(typeof g.seatNumber === 'number' ? [g.seatNumber] : []),
                ...(Array.isArray(g.plusOneSeatNumbers) ? g.plusOneSeatNumbers : []),
              ])
            : []
        );
        let nextSeat = 1;
        const claimSeat = () => {
          while (occupiedOnTable.has(nextSeat)) nextSeat += 1;
          occupiedOnTable.add(nextSeat);
          return nextSeat;
        };
        const nextGuests = current.guests.map((g) => {
          if (!targetIds.has(g.id)) return g;
          if (!targetTableId) {
            const cleared: InvitationCodeDTO = {
              ...g,
              tableId: null,
              seatNumber: null,
              plusOneSeatNumbers: [],
            };
            updatedGuests.push(cleared);
            return cleared;
          }
          const primarySeat = claimSeat();
          const plusOneCount = Math.max(0, g.plusOneAllocations ?? 0);
          const plusOneSeatNumbers = Array.from({ length: plusOneCount }, () => claimSeat());
          const assigned: InvitationCodeDTO = {
            ...g,
            tableId: targetTableId,
            seatNumber: primarySeat,
            plusOneSeatNumbers,
          };
          updatedGuests.push(assigned);
          return assigned;
        });
        return { ...current, guests: nextGuests };
      });
      return jsonResponse({ success: true, data: { updatedGuests } });
    }
    if (Array.isArray(body.assignments)) {
      const updates = body.assignments as Array<{
        invitationCodeId?: string;
        tableId?: string | null;
        seatNumber?: number | null;
        plusOneSeatNumbers?: number[];
      }>;
      const updateMap = new Map(
        updates
          .filter((u) => typeof u.invitationCodeId === 'string')
          .map((u) => [u.invitationCodeId as string, u])
      );
      const updatedGuests: InvitationCodeDTO[] = [];
      mutateActiveDataset((current) => {
        const nextGuests = current.guests.map((g) => {
          const match = updateMap.get(g.id);
          if (!match) return g;
          const nextTableId = match.tableId ?? null;
          const next: InvitationCodeDTO = {
            ...g,
            tableId: nextTableId,
            seatNumber: nextTableId ? (match.seatNumber ?? null) : null,
            plusOneSeatNumbers:
              nextTableId && Array.isArray(match.plusOneSeatNumbers)
                ? match.plusOneSeatNumbers.filter((n): n is number => typeof n === 'number')
                : [],
          };
          updatedGuests.push(next);
          return next;
        });
        return { ...current, guests: nextGuests };
      });
      return jsonResponse({ success: true, data: { updatedGuests } });
    }
    const guestId = String(body.invitationCodeId || '');
    const tableId = typeof body.tableId === 'string' ? body.tableId : null;
    const seatNumber = tableId && typeof body.seatNumber === 'number' ? body.seatNumber : null;
    const plusOneSeatNumbers =
      tableId && Array.isArray(body.plusOneSeatNumbers)
        ? body.plusOneSeatNumbers.filter((n): n is number => typeof n === 'number')
        : [];
    let updatedGuest: InvitationCodeDTO | null = null;
    mutateActiveDataset((current) => {
      const nextGuests = current.guests.map((g) => {
        if (g.id !== guestId) return g;
        const next: InvitationCodeDTO = { ...g, tableId, seatNumber, plusOneSeatNumbers };
        updatedGuest = next;
        return next;
      });
      return { ...current, guests: nextGuests };
    });
    if (!updatedGuest) return jsonResponse({ error: 'Guest not found' }, 404);
    return jsonResponse({ success: true, data: updatedGuest });
  }

  if (path === '/api/admin/seating/auto-assign' && method === 'POST') {
    const assignedGuests: InvitationCodeDTO[] = [];
    let unassignedCount = 0;
    mutateActiveDataset((current) => {
      const guestTables = current.seatingTables.filter((t) => !isDemoLandmarkShape(t.shape));
      const occupiedByTable = new Map<string, Set<number>>();
      for (const table of guestTables) {
        occupiedByTable.set(table.id, new Set<number>());
      }
      for (const g of current.guests) {
        if (g.tableId && occupiedByTable.has(g.tableId)) {
          const set = occupiedByTable.get(g.tableId)!;
          if (typeof g.seatNumber === 'number') set.add(g.seatNumber);
          if (Array.isArray(g.plusOneSeatNumbers)) {
            for (const ps of g.plusOneSeatNumbers) set.add(ps);
          }
        }
      }
      const nextGuests = current.guests.map((g) => {
        if (g.tableId) return g;
        const needed = 1 + Math.max(0, g.plusOneAllocations ?? 0);
        const targetTable = guestTables.find((t) => {
          const occupied = occupiedByTable.get(t.id)!;
          return t.capacity - occupied.size >= needed;
        });
        if (!targetTable) {
          unassignedCount += 1;
          return g;
        }
        const occupied = occupiedByTable.get(targetTable.id)!;
        const claim = () => {
          let s = 1;
          while (occupied.has(s)) s += 1;
          occupied.add(s);
          return s;
        };
        const seatNumber = claim();
        const plusOneSeatNumbers = Array.from({ length: needed - 1 }, () => claim());
        const updated: InvitationCodeDTO = {
          ...g,
          tableId: targetTable.id,
          seatNumber,
          plusOneSeatNumbers,
        };
        assignedGuests.push(updated);
        return updated;
      });
      return { ...current, guests: nextGuests };
    });
    return jsonResponse({
      assignedCount: assignedGuests.length,
      unassignedCount,
      assignedGuests,
    });
  }

  if (path === '/api/admin/seating/export' && method === 'GET') {
    const dataset = getActiveArchetypeDataset();
    const format = (url.searchParams.get('format') || 'csv').toLowerCase();
    const guestTables = dataset.seatingTables.filter(
      (t) => !isDemoLandmarkShape(t.shape) && t.capacity > 0
    );
    const dateStamp = new Date().toISOString().slice(0, 10);

    if (format === 'pdf') {
      const lines = guestTables.flatMap((t) => {
        const seated = dataset.guests.filter((g) => g.tableId === t.id);
        return [
          `${t.name} (${seated.length}/${t.capacity} seated):`,
          ...seated.map((g) => {
            const po =
              Array.isArray(g.plusOneSeatNumbers) && g.plusOneSeatNumbers.length > 0
                ? ` (+1 seats: ${g.plusOneSeatNumbers.join(', ')})`
                : '';
            return `  Seat ${g.seatNumber ?? '-'}: ${g.guestName}${po}`;
          }),
        ];
      });
      const pdf = buildSimplePdfBytes('Reception Seating Chart', lines);
      return binaryDemoResponse(pdf, 'application/pdf', 'seating-chart.pdf');
    }

    if (format === 'place-cards' || format === 'escort-cards') {
      const cardTitle =
        format === 'place-cards' ? 'Reception Place Cards' : 'Reception Escort Cards';
      const filename =
        format === 'place-cards' ? 'seating-place-cards.pdf' : 'seating-escort-cards.pdf';
      const lines = guestTables.flatMap((t) => {
        const seated = dataset.guests.filter((g) => g.tableId === t.id);
        return seated.flatMap((g) => {
          const baseLine = `${g.guestName} - ${t.name}, Seat ${g.seatNumber ?? '-'}`;
          const companionSeats = Array.isArray(g.plusOneSeatNumbers)
            ? g.plusOneSeatNumbers
            : [];
          const companionName =
            [g.plusOneFirstName, g.plusOneLastName].filter(Boolean).join(' ') ||
            `${g.guestName} Guest`;
          return [
            baseLine,
            ...companionSeats.map((s) => `${companionName} - ${t.name}, Seat ${s}`),
          ];
        });
      });
      const pdf = buildSimplePdfBytes(cardTitle, lines);
      return binaryDemoResponse(pdf, 'application/pdf', filename);
    }

    if (format === 'meals' || format === 'meal-counts') {
      const headers = [
        'Table Name',
        'Table Shape',
        'Capacity',
        'Seated Guests',
        'Entree Counts',
        'Dietary Counts',
      ];
      const rows: Array<Array<unknown>> = [];
      let totalCapacity = 0;
      let totalSeated = 0;
      const globalDietary = new Map<string, number>();

      for (const table of guestTables) {
        totalCapacity += table.capacity;
        const seated = dataset.guests.filter((g) => g.tableId === table.id);
        const headcount = seated.reduce(
          (sum, g) => sum + 1 + Math.max(0, g.plusOneAllocations ?? 0),
          0
        );
        totalSeated += seated.length === 0 ? 0 : headcount;
        const tableDietary = new Map<string, number>();
        for (const g of seated) {
          const notes = (g.dietaryNotes ?? '').trim();
          if (notes) {
            for (const token of notes.split(/[,;]/).map((s) => s.trim()).filter(Boolean)) {
              tableDietary.set(token, (tableDietary.get(token) ?? 0) + 1);
              globalDietary.set(token, (globalDietary.get(token) ?? 0) + 1);
            }
          }
        }
        const dietarySummary =
          Array.from(tableDietary.entries())
            .map(([k, v]) => `${k}: ${v}`)
            .join('; ') || 'None';
        rows.push([
          table.name,
          table.shape,
          String(table.capacity),
          String(seated.length === 0 ? 0 : headcount),
          seated.length === 0 ? 'None specified' : `Unspecified: ${headcount}`,
          seated.length === 0 ? 'None' : dietarySummary,
        ]);
      }

      if (guestTables.length > 0) {
        const totalDietary =
          Array.from(globalDietary.entries())
            .map(([k, v]) => `${k}: ${v}`)
            .join('; ') || 'None';
        rows.push([
          'TOTAL',
          '',
          String(totalCapacity),
          String(totalSeated),
          totalSeated === 0 ? 'None specified' : `Unspecified: ${totalSeated}`,
          totalDietary,
        ]);
      }

      return binaryDemoResponse(
        buildDemoCsv(headers, rows),
        'text/csv; charset=utf-8',
        `seating-meal-counts-${dateStamp}.csv`
      );
    }

    const headers = [
      'Table Name',
      'Table Shape',
      'Capacity',
      'Seat Number',
      'Guest Name',
      'Dietary Notes',
      'Plus-One Name',
      'Plus-One Seats',
      'Attendance',
      'Meal Selections',
      'Table Meal Counts',
      'Custom Answers',
    ];
    const rows: Array<Array<unknown>> = [];
    for (const table of guestTables) {
      const seated = dataset.guests
        .filter((g) => g.tableId === table.id)
        .sort((a, b) => (a.seatNumber ?? 999) - (b.seatNumber ?? 999));
      if (seated.length === 0) {
        rows.push([
          table.name,
          table.shape,
          String(table.capacity),
          '',
          '(Unassigned Table)',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ]);
        continue;
      }
      for (const g of seated) {
        const plusOneName = [g.plusOneFirstName, g.plusOneLastName]
          .filter(Boolean)
          .join(' ');
        const plusOneSeats = Array.isArray(g.plusOneSeatNumbers)
          ? [...g.plusOneSeatNumbers].sort((a, b) => a - b).join(', ')
          : '';
        rows.push([
          table.name,
          table.shape,
          String(table.capacity),
          g.seatNumber ?? '',
          g.guestName,
          g.dietaryNotes ?? '',
          plusOneName,
          plusOneSeats,
          g.used ? 'Attending' : 'Pending',
          '',
          '',
          '',
        ]);
      }
    }
    for (const g of dataset.guests.filter((inv) => !inv.tableId && !isDemoAddressCollectionOnly(inv.partyTags))) {
      const plusOneName = [g.plusOneFirstName, g.plusOneLastName]
        .filter(Boolean)
        .join(' ');
      rows.push([
        'Unassigned',
        '',
        '',
        '',
        g.guestName,
        g.dietaryNotes ?? '',
        plusOneName,
        '',
        g.used ? 'Attending' : 'Pending',
        '',
        '',
        '',
      ]);
    }
    return binaryDemoResponse(
      buildDemoCsv(headers, rows),
      'text/csv; charset=utf-8',
      `seating-roster-${dateStamp}.csv`
    );
  }

  if (path === '/api/admin/invitation-codes/export' && method === 'GET') {
    const demoState = getDemoState();
    const dataset = getActiveArchetypeDataset();
    const tableById = new Map(dataset.seatingTables.map((t) => [t.id, t.name]));
    const idsParam = (url.searchParams.get('ids') || '').trim();
    const idSet = idsParam
      ? new Set(
        idsParam
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      )
      : null;
    const search = (url.searchParams.get('search') || url.searchParams.get('q') || '')
      .trim()
      .toLowerCase();
    const statusFilter = (url.searchParams.get('status') || '').trim().toLowerCase();
    const partyGroupFilter = (url.searchParams.get('partyGroup') || '').trim();
    const partyTagsFilter = (url.searchParams.get('partyTags') || '').trim().toLowerCase();

    const getGuestRsvpOverrides = (code: string) => {
      const prefix = `${demoState.archetype}:${code.toUpperCase()}:`;
      return Object.entries(demoState.rsvpOverrides)
        .filter(([key]) => key.startsWith(prefix))
        .map(([, val]) => val);
    };

    const filtered = dataset.guests.filter((inv) => {
      if (idSet && !idSet.has(inv.id)) return false;
      if (search) {
        const matches =
          inv.guestName.toLowerCase().includes(search) ||
          (inv.householdName || '').toLowerCase().includes(search) ||
          inv.code.toLowerCase().includes(search) ||
          (inv.email || '').toLowerCase().includes(search) ||
          (inv.city || '').toLowerCase().includes(search);
        if (!matches) return false;
      }
      const hasRsvpOverride = getGuestRsvpOverrides(inv.code).length > 0;
      const isUsed = Boolean(inv.used || hasRsvpOverride);
      if ((statusFilter === 'used' || statusFilter === 'redeemed') && !isUsed) return false;
      if (statusFilter === 'unused' && isUsed) return false;
      if (partyGroupFilter && partyGroupFilter !== 'all' && inv.partyGroup !== partyGroupFilter) {
        return false;
      }
      if (
        partyTagsFilter &&
        !(inv.partyTags || []).some((t) => t.toLowerCase() === partyTagsFilter)
      ) {
        return false;
      }
      return true;
    });

    const csv = buildDemoCsv(
      [
        'Code',
        'Guest Name',
        'Email',
        'Household',
        'Party Group',
        'Party Tags',
        'Plus Ones',
        'Dietary Notes',
        'Table',
        'Seat',
        'Used',
        'Address Line 1',
        'City',
        'State',
        'Zip',
        'Country',
      ],
      filtered.map((inv) => {
        const overrides = getGuestRsvpOverrides(inv.code);
        const hasOverrides = overrides.length > 0;
        const attendingOverrides = overrides.filter((o) => o.status === 'attending');
        const allOverridesDeclined =
          hasOverrides && overrides.every((o) => o.status === 'declined');
        const extraRecord =
          inv.extraFields && typeof inv.extraFields === 'object'
            ? (inv.extraFields as Record<string, unknown>)
            : null;
        const isExtraDeclined =
          typeof extraRecord?.attendanceStatus === 'string' &&
          extraRecord.attendanceStatus.trim().toLowerCase() === 'declined';
        const isDeclined = allOverridesDeclined || (!hasOverrides && isExtraDeclined);
        const confirmedPlusOnes =
          attendingOverrides.length > 0
            ? Math.max(...attendingOverrides.map((o) => o.plusOneCount))
            : extraRecord && typeof extraRecord.plusOneCount === 'number'
              ? extraRecord.plusOneCount
              : null;
        const resolvedDietary = hasOverrides
          ? overrides[overrides.length - 1].dietaryNotes
          : (inv.dietaryNotes ?? '');
        const isUsed = Boolean(inv.used || hasOverrides);

        return [
          inv.code,
          inv.guestName,
          inv.email ?? '',
          inv.householdName ?? '',
          inv.partyGroup ?? '',
          (inv.partyTags ?? []).join('; '),
          isDeclined ? 0 : (confirmedPlusOnes ?? inv.plusOneAllocations ?? 0),
          resolvedDietary,
          inv.tableId ? (tableById.get(inv.tableId) ?? '') : '',
          inv.seatNumber ?? '',
          isUsed ? 'Yes' : 'No',
          inv.addressLine1 ?? '',
          inv.city ?? '',
          inv.state ?? '',
          inv.zipCode ?? '',
          inv.country ?? '',
        ];
      })
    );
    return binaryDemoResponse(csv, 'text/csv; charset=utf-8', 'guest-invitations.csv');
  }

  if (path === '/api/admin/invitation-codes/catalog' || path === '/api/admin/invitation-codes') {
    if (method === 'GET') {
      const search = (url.searchParams.get('search') || url.searchParams.get('q') || '')
        .trim()
        .toLowerCase();
      const limitParam = Number(url.searchParams.get('limit') || '0');
      let guests = getActiveArchetypeDataset().guests;
      if (search) {
        guests = guests.filter(
          (g) =>
            g.guestName.toLowerCase().includes(search) ||
            (g.householdName || '').toLowerCase().includes(search) ||
            g.code.toLowerCase().includes(search) ||
            (g.email || '').toLowerCase().includes(search) ||
            (g.city || '').toLowerCase().includes(search)
        );
      }
      const effectiveLimit = limitParam > 0 ? limitParam : Math.max(50, guests.length);
      const limited = limitParam > 0 ? guests.slice(0, limitParam) : guests;
      return jsonResponse(
        {
          success: true,
          data: {
            items: limited,
            total: guests.length,
            page: 1,
            limit: effectiveLimit,
            totalPages: 1,
          },
        },
        200,
        {
          'X-Total-Count': String(guests.length),
          'X-Page': '1',
          'X-Limit': String(effectiveLimit),
          'X-Total-Pages': '1',
        }
      );
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init);
      const seqSuffix = `${Date.now().toString().slice(-3)}${(++demoIdSequence) % 10}`;
      const code = String(body.code || `GUEST${seqSuffix}`).toUpperCase();
      const newGuest: InvitationCodeDTO = {
        id: nextDemoId('demo-guest'),
        code,
        guestName: String(body.guestName || 'Invited Guest'),
        householdName: typeof body.householdName === 'string' ? body.householdName : '',
        partyGroup: typeof body.partyGroup === 'string' ? body.partyGroup : 'Friends',
        partyTags: Array.isArray(body.partyTags)
          ? body.partyTags.filter((t): t is string => typeof t === 'string')
          : [],
        plusOneAllocations: Number(body.plusOneAllocations || 0),
        used: false,
        isSample: false,
      };
      mutateActiveDataset((current) => ({
        ...current,
        guests: [...current.guests, newGuest],
      }));
      upsertInvitationsIntoStaticDemoStore([newGuest]);
      return jsonResponse({ success: true, data: newGuest }, 201);
    }
  }

  if (path === '/api/admin/invitation-codes/batch' && method === 'POST') {
    const body = await parseJsonBody(init);
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id): id is string => typeof id === 'string')
      : [];
    const idSet = new Set(ids);
    const cleanTags = normalizePartyTags(body.tags, { dedupe: true });
    const action = body.action === 'remove' || body.action === 'replace' ? body.action : 'add';
    const updatedRecords: InvitationCodeDTO[] = [];

    if (idSet.size > 0) {
      mutateActiveDataset((current) => ({
        ...current,
        guests: current.guests.map((guest) => {
          if (!idSet.has(guest.id)) return guest;
          const existing = normalizePartyTags(guest.partyTags, { dedupe: true });
          const nextTags =
            action === 'replace'
              ? [...cleanTags]
              : action === 'remove'
                ? existing.filter((tag) => !cleanTags.includes(tag))
                : Array.from(new Set([...existing, ...cleanTags]));
          const updated: InvitationCodeDTO = { ...guest, partyTags: nextTags };
          updatedRecords.push(updated);
          return updated;
        }),
      }));
      upsertInvitationsIntoStaticDemoStore(updatedRecords);
    }

    return jsonResponse({
      success: true,
      count: updatedRecords.length,
      updatedCount: updatedRecords.length,
      records: updatedRecords,
      data: {
        count: updatedRecords.length,
        updatedCount: updatedRecords.length,
        records: updatedRecords,
      },
    });
  }

  if (path === '/api/admin/invitation-codes/import' && method === 'POST') {
    const body = await parseJsonBody(init);
    const records = Array.isArray(body.records)
      ? (body.records as Array<Record<string, unknown>>)
      : Array.isArray(body.items)
        ? (body.items as Array<Record<string, unknown>>)
        : [];
    const created: InvitationCodeDTO[] = records.map((rec, idx) => ({
      id: `${nextDemoId('demo-imported')}-${idx}`,
      code: String(rec.code || `IMPORT${100 + idx}`).toUpperCase(),
      guestName: String(rec.guestName || `Imported Guest ${idx + 1}`),
      householdName: typeof rec.householdName === 'string' ? rec.householdName : '',
      partyGroup: typeof rec.partyGroup === 'string' ? rec.partyGroup : 'Imported',
      partyTags: [],
      plusOneAllocations: Number(rec.plusOneAllocations || 0),
      used: false,
      isSample: false,
    }));
    if (created.length > 0) {
      mutateActiveDataset((current) => ({
        ...current,
        guests: [...current.guests, ...created],
      }));
      upsertInvitationsIntoStaticDemoStore(created);
    }
    return jsonResponse({
      success: true,
      data: {
        importedCount: created.length,
        createdCount: created.length,
        updatedCount: 0,
        skippedCount: 0,
        items: created,
      },
    });
  }

  if (path === '/api/admin/wedding-party') {
    if (method === 'GET') {
      return jsonResponse({
        success: true,
        data: getActiveArchetypeDataset().weddingParty,
      });
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init);
      const now = new Date();
      const side: WeddingPartySide =
        body.side === 'BRIDE' || body.side === 'GROOM' || body.side === 'JOINT'
          ? body.side
          : 'JOINT';
      const member: WeddingPartyMemberDTO = {
        id: nextDemoId('demo-party'),
        name: String(body.name || 'Party Member'),
        role: String(body.role || 'Attendant'),
        bio: String(body.bio || ''),
        side,
        link: null,
        order: Number(body.order || getActiveArchetypeDataset().weddingParty.length + 1),
        isSample: false,
        photoId: null,
        photo: null,
        createdAt: now,
        updatedAt: now,
      };
      mutateActiveDataset((current) => ({
        ...current,
        weddingParty: [...current.weddingParty, member],
      }));
      return jsonResponse({ success: true, data: member }, 201);
    }
  }

  if (path === '/api/admin/attractions') {
    if (method === 'GET') {
      return jsonResponse({
        success: true,
        data: getActiveArchetypeDataset().attractions,
      });
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init);
      const now = new Date();
      const attraction: AttractionDTO = {
        id: nextDemoId('demo-attraction'),
        name: String(body.name || 'Local Spot'),
        description: String(body.description || ''),
        category: String(body.category || 'Activities'),
        website: typeof body.website === 'string' ? body.website : 'https://example.com',
        directions: String(body.directions || ''),
        latitude: Number(body.latitude || 41.8781),
        longitude: Number(body.longitude || -87.6298),
        isVisible: body.isVisible !== false,
        promoCode: typeof body.promoCode === 'string' ? body.promoCode : null,
        bookingUrl: typeof body.bookingUrl === 'string' ? body.bookingUrl : null,
        roomRate: typeof body.roomRate === 'string' ? body.roomRate : null,
        cutoffDate: null,
        shuttleInfo: null,
        isSample: false,
        imageId: null,
        image: null,
        createdAt: now,
        updatedAt: now,
      };
      mutateActiveDataset((current) => ({
        ...current,
        attractions: [...current.attractions, attraction],
      }));
      return jsonResponse({ success: true, data: attraction }, 201);
    }
  }

  if (
    path.startsWith('/api/admin/sub-events') ||
    path === '/api/admin/invitation-codes/rsvps' ||
    path.startsWith('/api/admin/broadcast')
  ) {
    const delegated = await delegateToStaticDemoRouter(rawInput ?? url, init, method, path);
    if (delegated) {
      return delegated;
    }
  }

  if (path === '/api/admin/sub-events/rsvp-summary' && method === 'GET') {
    return jsonResponse({ success: true, data: null });
  }

  if (path === '/api/admin/sub-events/access' && method === 'GET') {
    return jsonResponse({
      success: true,
      data: {
        subEvents: [],
        invitationCodes: [],
      },
    });
  }

  if (path === '/api/admin/sub-events/access/batch' && method === 'POST') {
    return jsonResponse({ success: true, data: { updatedCount: 0 } });
  }

  if (path === '/api/admin/sub-events' && method === 'GET') {
    return jsonResponse({ success: true, data: [] });
  }

  if (path === '/api/admin/invitation-codes/rsvps' && method === 'GET') {
    return jsonResponse({ success: true, data: [] });
  }

  if (path === '/api/admin/broadcast/history' && method === 'GET') {
    return jsonResponse({ success: true, data: [] });
  }

  if (path.startsWith('/api/admin/broadcast/') && method === 'GET') {
    return jsonResponse({ error: 'Broadcast message not found in demo mode.' }, 404);
  }

  if (path === '/api/admin/onboarding-milestones' && method === 'GET') {
    const state = getDemoState();
    const dataset = getActiveArchetypeDataset();
    const effectiveConfig = state.configOverrides;
    const partner1 = (effectiveConfig.partner1Name || effectiveConfig.brideName || '').trim();
    const partner2 = (effectiveConfig.partner2Name || effectiveConfig.groomName || '').trim();
    const weddingDetailsCompleted =
      Boolean(partner1 && partner2) && hasNonPlaceholderVenueDetails(effectiveConfig);
    const customStoryConfigured = hasCustomStoryText(effectiveConfig);
    const hasPublicScheduleEvent = dataset.logisticsNodes.some((node) => {
      const data =
        node?.data && typeof node.data === 'object' && !Array.isArray(node.data)
          ? (node.data as Record<string, unknown>)
          : {};
      if (data.isSample === true || data.isSample === 'true') return false;
      if (data.isPrivate === true || data.isPrivate === 'true') return false;
      return (
        node.type === 'Schedule' ||
        (typeof data.startTime === 'string' && data.startTime.trim().length > 0) ||
        (node.type === 'Logistics' &&
          typeof data.ceremonyTitle === 'string' &&
          data.ceremonyTitle.trim().length > 0)
      );
    });
    const storyAndScheduleCompleted = customStoryConfigured && hasPublicScheduleEvent;
    const guestListCompleted = dataset.guests.some(
      (g) => !g.isSample && !isDemoAddressCollectionOnly(g.partyTags)
    );
    const registryCompleted = dataset.registryItems.some((i) => !i.isSample);
    const seatingCompleted = dataset.seatingTables.some((t) => !t.isSample);
    const faqCompleted = dataset.faqs.some((n) => n.type === 'FAQ' && !n.data.isSample);
    const milestones = [
      {
        id: 'wedding-details',
        title: 'Wedding Details',
        description:
          'Verify partner names, wedding date, venue details, and your public website URL.',
        completed: weddingDetailsCompleted,
        href: '/admin/dashboard/settings',
        actionLabel: weddingDetailsCompleted ? 'Edit Wedding Details' : 'Configure Wedding Details',
      },
      {
        id: 'story-and-schedule',
        title: 'Story & Schedule',
        description: 'Share your custom couple story and publish at least one public schedule event.',
        completed: storyAndScheduleCompleted,
        href: !customStoryConfigured ? '/admin/dashboard/settings' : '/admin/dashboard/sub-events',
        actionLabel: storyAndScheduleCompleted
          ? 'Edit Story & Schedule'
          : !customStoryConfigured
            ? 'Write Our Story'
            : 'Add Schedule Event',
      },
      {
        id: 'guest-list',
        title: 'Guest List',
        description: 'Import or add guest invitations so guests can RSVP.',
        completed: guestListCompleted,
        href: '/admin/dashboard/invitation-codes',
        actionLabel: guestListCompleted ? 'Manage Guest List' : 'Add Guest List',
      },
      {
        id: 'registry',
        title: 'Gift Registry',
        description: 'Add gifts or cash funds to your wedding registry.',
        completed: registryCompleted,
        href: '/registry/add-item',
        actionLabel: registryCompleted ? 'Add More Gifts' : 'Add Registry Gifts',
      },
      {
        id: 'seating-layout',
        title: 'Seating Layout',
        description: 'Create reception tables and organize your seating chart.',
        completed: seatingCompleted,
        href: '/admin/dashboard/seating-chart',
        actionLabel: seatingCompleted ? 'Edit Seating Layout' : 'Create Seating Layout',
      },
      {
        id: 'faq-setup',
        title: 'Wedding Q&A (FAQs)',
        description:
          'Publish guest Q&A answers for attire, RSVP deadlines, travel, and accommodations.',
        completed: faqCompleted,
        href: '/admin/dashboard/content',
        actionLabel: faqCompleted ? 'Manage Wedding Q&A' : 'Add Starter FAQs',
      },
    ];
    const completedCount = milestones.filter((m) => m.completed).length;
    return jsonResponse({
      success: true,
      data: {
        completedCount,
        pendingCount: milestones.length - completedCount,
        totalCount: milestones.length,
        allComplete: completedCount === milestones.length,
        milestones,
      },
    });
  }

  if (
    path.startsWith('/api/admin/registry/items/') &&
    path.endsWith('/unclaim') &&
    method === 'POST'
  ) {
    const itemId = decodeURIComponent(
      path.slice('/api/admin/registry/items/'.length, -'/unclaim'.length)
    );
    let updatedItem: RegistryItem | null = null;
    mutateActiveDataset((current) => ({
      ...current,
      registryItems: current.registryItems.map((item) => {
        if (item.id !== itemId) return item;
        updatedItem = {
          ...item,
          purchased: false,
          purchaserName: null,
          amountContributed: 0,
          contributors: [],
        };
        return updatedItem;
      }),
    }));
    if (!updatedItem) {
      return jsonResponse({ error: 'Registry item not found.' }, 404);
    }
    return jsonResponse({ success: true, data: { item: updatedItem }, item: updatedItem });
  }

  if (path.startsWith('/api/admin/contributors/')) {
    const rawRest = path.slice('/api/admin/contributors/'.length);
    const isAction = rawRest.endsWith('/action');
    const contributorId = decodeURIComponent(
      isAction ? rawRest.slice(0, -'/action'.length) : rawRest
    );
    const body = await parseJsonBody(init);
    let matchedContributor: RegistryItem['contributors'][number] | null = null;
    let updatedParentItem: RegistryItem | null = null;
    let deleted = false;

    mutateActiveDataset((current) => ({
      ...current,
      registryItems: current.registryItems.map((item) => {
        const idx = (item.contributors || []).findIndex((c) => c.id === contributorId);
        if (idx === -1) return item;
        const target = item.contributors[idx];

        if (method === 'DELETE' && !isAction) {
          deleted = true;
          const nextContributors = item.contributors.filter((c) => c.id !== contributorId);
          const nextTotal = nextContributors.reduce(
            (sum, c) => (c.status === 'CANCELLED' ? sum : sum + c.amount),
            0
          );
          updatedParentItem = {
            ...item,
            contributors: nextContributors,
            amountContributed: nextTotal,
            purchased: item.isGroupGift ? nextTotal >= item.price : nextContributors.length > 0,
            purchaserName: nextContributors[0]?.name ?? null,
          };
          return updatedParentItem;
        }

        const nextStatus =
          isAction && method === 'POST'
            ? body.action === 'void'
              ? 'CANCELLED'
              : body.action === 'confirm'
                ? 'CONFIRMED'
                : target.status
            : body.status === 'CONFIRMED' || body.status === 'RESERVED' || body.status === 'CANCELLED'
              ? body.status
              : target.status;

        const nextContributor: RegistryItem['contributors'][number] = {
          ...target,
          ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim() } : {}),
          ...(body.email === null || typeof body.email === 'string' ? { email: body.email } : {}),
          ...(typeof body.amount === 'number' && body.amount > 0 ? { amount: body.amount } : {}),
          ...(body.message === null || typeof body.message === 'string'
            ? { message: body.message }
            : {}),
          status: nextStatus,
        };
        matchedContributor = nextContributor;
        const nextContributors = item.contributors.map((c) =>
          c.id === contributorId ? nextContributor : c
        );
        const nextTotal = nextContributors.reduce(
          (sum, c) => (c.status === 'CANCELLED' ? sum : sum + c.amount),
          0
        );
        updatedParentItem = {
          ...item,
          contributors: nextContributors,
          amountContributed: nextTotal,
          purchased: item.isGroupGift
            ? nextTotal >= item.price
            : nextContributors.some((c) => c.status !== 'CANCELLED'),
        };
        return updatedParentItem;
      }),
    }));

    if (method === 'DELETE' && !isAction) {
      if (!deleted) return jsonResponse({ error: 'Contributor not found.' }, 404);
      return jsonResponse({
        success: true,
        deletedId: contributorId,
        item: updatedParentItem,
        data: { deletedId: contributorId, item: updatedParentItem },
      });
    }
    if (!matchedContributor) {
      return jsonResponse({ error: 'Contributor not found.' }, 404);
    }
    return jsonResponse({
      success: true,
      changed: true,
      action: typeof body.action === 'string' ? body.action : 'confirm',
      contributor: matchedContributor,
      item: updatedParentItem,
      data: {
        changed: true,
        contributor: matchedContributor,
        item: updatedParentItem,
      },
    });
  }

  if (path === '/api/admin/thank-you-notes' && method === 'POST') {
    const body = await parseJsonBody(init);
    const nowIso = new Date().toISOString();
    const thankYouStatus =
      body.thankYouStatus === 'Sent' || body.thankYouStatus === 'Not Needed'
        ? body.thankYouStatus
        : 'Unsent';
    const created: ContributorRecord = {
      id: nextDemoId('demo-offline-gift'),
      name: String(body.name || 'Offline Contributor').trim(),
      email: typeof body.email === 'string' ? body.email : null,
      addressLine1: typeof body.addressLine1 === 'string' ? body.addressLine1 : null,
      addressLine2: typeof body.addressLine2 === 'string' ? body.addressLine2 : null,
      city: typeof body.city === 'string' ? body.city : null,
      state: typeof body.state === 'string' ? body.state : null,
      zipCode: typeof body.zipCode === 'string' ? body.zipCode : null,
      country: typeof body.country === 'string' ? body.country : null,
      isPlusOne: false,
      amount: Number(body.amount || 50),
      refundedAmount: 0,
      status: 'CONFIRMED',
      coverFee: false,
      feeAmount: 0,
      date: typeof body.date === 'string' ? body.date : nowIso,
      message: typeof body.message === 'string' ? body.message : null,
      thankYouStatus,
      thankYouSentAt: thankYouStatus === 'Sent' ? nowIso : null,
      thankYouNote: typeof body.thankYouNote === 'string' ? body.thankYouNote : null,
      transactionTimestamp: null,
      registryItemId: typeof body.registryItemId === 'string' ? body.registryItemId : null,
      invitationCodeId: typeof body.invitationCodeId === 'string' ? body.invitationCodeId : null,
    };
    mutateActiveDataset((current) => ({
      ...current,
      offlineContributors: [...(current.offlineContributors || []), created],
    }));
    return jsonResponse({ success: true, item: { ...created, registryItem: null } }, 201);
  }

  if (path === '/api/admin/thank-you-notes/export' && method === 'GET') {
    const dataset = getActiveArchetypeDataset();
    const itemById = new Map(dataset.registryItems.map((i) => [i.id, i.name]));
    const inviteById = new Map(dataset.guests.map((g) => [g.id, g]));
    const statusParam = (url.searchParams.get('status') || '').trim();
    const searchParam = (url.searchParams.get('search') || '').trim().toLowerCase();

    const allContributors: Array<{ c: ContributorRecord; giftName: string }> = [
      ...dataset.registryItems.flatMap((item) =>
        (item.contributors || []).map((c) => ({ c, giftName: item.name }))
      ),
      ...(dataset.offlineContributors || []).map((c) => ({
        c,
        giftName: c.registryItemId ? (itemById.get(c.registryItemId) ?? 'Wedding Gift') : 'Wedding Gift',
      })),
    ];

    const filtered = allContributors.filter(({ c, giftName }) => {
      const tyStatus = c.thankYouStatus || 'Unsent';
      if (statusParam && statusParam !== 'All' && tyStatus !== statusParam) return false;
      if (searchParam) {
        const inv = c.invitationCodeId ? inviteById.get(c.invitationCodeId) : undefined;
        const matches =
          c.name.toLowerCase().includes(searchParam) ||
          (c.email || '').toLowerCase().includes(searchParam) ||
          giftName.toLowerCase().includes(searchParam) ||
          (inv?.householdName || '').toLowerCase().includes(searchParam);
        if (!matches) return false;
      }
      return true;
    });

    const csv = buildDemoCsv(
      [
        'Contributor Name',
        'Email',
        'Gift Item',
        'Amount',
        'Contribution Status',
        'Thank-You Status',
        'Sent At',
        'Note',
        'Mailing Address',
      ],
      filtered.map(({ c, giftName }) => {
        const inv = c.invitationCodeId ? inviteById.get(c.invitationCodeId) : undefined;
        const hasOwnAddress = Boolean(c.addressLine1 && c.addressLine1.trim());
        const address = hasOwnAddress
          ? [c.addressLine1, c.city, c.state, c.zipCode].filter(Boolean).join(', ')
          : inv
            ? [inv.addressLine1, inv.city, inv.state, inv.zipCode].filter(Boolean).join(', ')
            : '';
        return [
          c.name,
          c.email ?? '',
          giftName,
          c.amount.toFixed(2),
          c.status ?? 'CONFIRMED',
          c.thankYouStatus || 'Unsent',
          c.thankYouSentAt ?? '',
          c.thankYouNote ?? '',
          address,
        ];
      })
    );
    return binaryDemoResponse(csv, 'text/csv; charset=utf-8', 'thank-you-notes.csv');
  }

  if (
    path === '/api/admin/thank-you-notes/export-labels' &&
    (method === 'GET' || method === 'POST')
  ) {
    const body = method === 'POST' ? await parseJsonBody(init) : {};
    const template =
      url.searchParams.get('template') === 'avery_5163' || body.template === 'avery_5163'
        ? 'avery_5163'
        : 'avery_5160';
    const skipUnaddressed =
      url.searchParams.get('skipUnaddressed') === 'true' ||
      url.searchParams.get('skipUnaddressed') === '1' ||
      body.skipUnaddressed === true;
    const statusParam = (url.searchParams.get('status') || '').trim();
    const searchParam = (url.searchParams.get('search') || '').trim().toLowerCase();

    const dataset = getActiveArchetypeDataset();
    const inviteById = new Map(dataset.guests.map((g) => [g.id, g]));
    const allContributors: ContributorRecord[] = [
      ...dataset.registryItems.flatMap((item) => item.contributors || []),
      ...(dataset.offlineContributors || []),
    ];

    const lines: string[] = [];
    for (const c of allContributors) {
      const tyStatus = c.thankYouStatus || 'Unsent';
      if (statusParam && statusParam !== 'All' && tyStatus !== statusParam) continue;
      const inv = c.invitationCodeId ? inviteById.get(c.invitationCodeId) : undefined;
      if (searchParam) {
        const matches =
          c.name.toLowerCase().includes(searchParam) ||
          (c.email || '').toLowerCase().includes(searchParam) ||
          (inv?.householdName || '').toLowerCase().includes(searchParam);
        if (!matches) continue;
      }
      const hasOwnAddress = Boolean(c.addressLine1 && c.addressLine1.trim());
      const resolvedParts = hasOwnAddress
        ? [c.addressLine1, c.addressLine2, c.city, c.state, c.zipCode].filter(Boolean)
        : inv && inv.addressLine1 && inv.addressLine1.trim()
          ? [inv.addressLine1, inv.addressLine2, inv.city, inv.state, inv.zipCode].filter(Boolean)
          : [];
      if (resolvedParts.length === 0 && skipUnaddressed) continue;
      const addr = resolvedParts.length > 0 ? resolvedParts.join(', ') : 'Address pending';
      lines.push(`${c.name} - ${addr}`);
    }
    const title =
      template === 'avery_5163'
        ? 'Thank-You Shipping Labels (Avery 5163)'
        : 'Thank-You Mailing Labels (Avery 5160)';
    const pdf = buildSimplePdfBytes(title, lines);
    return binaryDemoResponse(pdf, 'application/pdf', `thank-you-labels-${template}.pdf`);
  }

  if (path === '/api/admin/thank-you-notes/batch' && method === 'POST') {
    const body = await parseJsonBody(init);
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id): id is string => typeof id === 'string')
      : [];
    const nextStatus =
      body.thankYouStatus === 'Sent' ||
      body.thankYouStatus === 'Not Needed' ||
      body.status === 'Sent' ||
      body.status === 'Not Needed'
        ? ((body.thankYouStatus || body.status) as 'Sent' | 'Not Needed')
        : 'Unsent';
    if (ids.length > 0) {
      const idSet = new Set(ids);
      mutateActiveDataset((current) => ({
        ...current,
        registryItems: current.registryItems.map((item) => ({
          ...item,
          contributors: (item.contributors || []).map((c) =>
            c.id && idSet.has(c.id) ? { ...c, thankYouStatus: nextStatus } : c
          ),
        })),
        offlineContributors: (current.offlineContributors || []).map((c) =>
          c.id && idSet.has(c.id) ? { ...c, thankYouStatus: nextStatus } : c
        ),
      }));
    }
    return jsonResponse({ success: true, updatedCount: ids.length });
  }

  if (
    path.startsWith('/api/admin/thank-you-notes/') &&
    path.endsWith('/send-email') &&
    method === 'POST'
  ) {
    const noteId = decodeURIComponent(
      path.slice('/api/admin/thank-you-notes/'.length, -'/send-email'.length)
    );
    const body = await parseJsonBody(init);
    const mode = body.mode === 'test' || body.mode === 'send' ? body.mode : 'preview';
    const dataset = getActiveArchetypeDataset();
    let foundContributor: RegistryItem['contributors'][number] | null = null;
    let foundItem: RegistryItem | null = null;
    for (const regItem of dataset.registryItems) {
      const match = (regItem.contributors || []).find((c) => c.id === noteId);
      if (match) {
        foundContributor = match;
        foundItem = regItem;
        break;
      }
    }
    if (!foundContributor) {
      return jsonResponse({ error: 'Contributor record not found' }, 404);
    }

    const linkedGuest = foundContributor.invitationCodeId
      ? dataset.guests.find((g) => g.id === foundContributor.invitationCodeId) ?? null
      : null;
    const demoState = getDemoState();
    const presetConfig = ARCHETYPE_PRESETS[demoState.archetype].siteConfig;
    const p1 = demoState.configOverrides.partner1Name || presetConfig.partner1Name;
    const p2 = demoState.configOverrides.partner2Name || presetConfig.partner2Name;
    const contactEmail = demoState.configOverrides.contactEmail || presetConfig.contactEmail;

    const rawBody = typeof body.body === 'string' ? body.body.trim() : '';
    const renderedText = formatDemoThankYouText(rawBody, {
      guestName: foundContributor.name,
      giftName: foundItem?.name || 'Wedding Gift',
      amount: foundContributor.amount,
    });
    const rawSubject =
      typeof body.subject === 'string' && body.subject.trim()
        ? body.subject.trim()
        : `Thank you from ${p1} & ${p2}!`;
    const safeSubject = rawSubject.replace(/[\r\n]+/g, ' ').trim();
    const overrideEmail =
      typeof body.recipientEmail === 'string' && body.recipientEmail.trim()
        ? body.recipientEmail.trim()
        : null;
    const resolvedRecipient =
      overrideEmail || foundContributor.email || linkedGuest?.email || null;

    if (mode === 'preview') {
      return jsonResponse({
        mode: 'preview',
        to: resolvedRecipient,
        testRecipient: contactEmail || null,
        subject: safeSubject,
        textBody: renderedText,
        htmlBody: formatDemoEmailHtml(renderedText),
      });
    }

    if (mode === 'test') {
      const targetTestEmail = contactEmail || 'couple-demo@example.com';
      return jsonResponse({
        mode: 'test',
        to: targetTestEmail,
        subject: `[TEST] ${safeSubject}`,
        messageId: `demo-test-${Date.now()}`,
      });
    }

    if (!resolvedRecipient) {
      return jsonResponse(
        { error: 'Contributor has no email address on file. Please provide a recipient email.' },
        400
      );
    }
    const nowIso = new Date().toISOString();
    mutateActiveDataset((current) => ({
      ...current,
      registryItems: current.registryItems.map((item) => ({
        ...item,
        contributors: (item.contributors || []).map((c) =>
          c.id === noteId
            ? {
              ...c,
              ...(overrideEmail && !c.email ? { email: overrideEmail } : {}),
              thankYouStatus: 'Sent',
              thankYouSentAt: c.thankYouSentAt || nowIso,
              thankYouEmailSentAt: nowIso,
              thankYouNote: renderedText,
            }
            : c
        ),
      })),
    }));
    return jsonResponse({
      mode: 'send',
      to: resolvedRecipient,
      subject: safeSubject,
      messageId: `demo-send-${Date.now()}`,
      thankYouStatus: 'Sent',
      thankYouSentAt: foundContributor.thankYouSentAt || nowIso,
      thankYouEmailSentAt: nowIso,
    });
  }

  if (path.startsWith('/api/admin/thank-you-notes/') && (method === 'PATCH' || method === 'PUT')) {
    const noteId = decodeURIComponent(path.slice('/api/admin/thank-you-notes/'.length));
    const body = await parseJsonBody(init);
    mutateActiveDataset((current) => {
      let targetInviteId: string | null | undefined;
      let syncedAddress: Record<string, string> | null = null;
      const nextRegistryItems = current.registryItems.map((item) => ({
        ...item,
        contributors: (item.contributors || []).map((c) => {
          if (c.id !== noteId) return c;
          const nextStatus =
            body.thankYouStatus === 'Sent' ||
            body.thankYouStatus === 'Not Needed' ||
            body.thankYouStatus === 'Unsent'
              ? body.thankYouStatus
              : (c.thankYouStatus ?? 'Unsent');
          const resolvedInviteId =
            body.invitationCodeId === null
              ? null
              : typeof body.invitationCodeId === 'string'
                ? body.invitationCodeId
                : (c.invitationCodeId ?? null);
          targetInviteId = resolvedInviteId;
          const nextContrib = {
            ...c,
            thankYouStatus: nextStatus,
            ...(body.thankYouNote === null || typeof body.thankYouNote === 'string'
              ? { thankYouNote: body.thankYouNote }
              : {}),
            ...(body.thankYouSentAt === null || typeof body.thankYouSentAt === 'string'
              ? { thankYouSentAt: body.thankYouSentAt }
              : {}),
            invitationCodeId: resolvedInviteId,
            ...(body.addressLine1 === null || typeof body.addressLine1 === 'string'
              ? { addressLine1: body.addressLine1 || null }
              : {}),
            ...(body.addressLine2 === null || typeof body.addressLine2 === 'string'
              ? { addressLine2: body.addressLine2 || null }
              : {}),
            ...(body.city === null || typeof body.city === 'string'
              ? { city: body.city || null }
              : {}),
            ...(body.state === null || typeof body.state === 'string'
              ? { state: body.state || null }
              : {}),
            ...(body.zipCode === null || typeof body.zipCode === 'string'
              ? { zipCode: body.zipCode || null }
              : {}),
            ...(body.country === null || typeof body.country === 'string'
              ? { country: body.country || null }
              : {}),
          };
          if (body.syncAddressToGuest && resolvedInviteId) {
            syncedAddress = {
              addressLine1: nextContrib.addressLine1 || '',
              addressLine2: nextContrib.addressLine2 || '',
              city: nextContrib.city || '',
              state: nextContrib.state || '',
              zipCode: nextContrib.zipCode || '',
              country: nextContrib.country || '',
            };
          }
          return nextContrib;
        }),
      }));
      const nextOffline = (current.offlineContributors || []).map((c) => {
        if (c.id !== noteId) return c;
        const nextStatus =
          body.thankYouStatus === 'Sent' ||
          body.thankYouStatus === 'Not Needed' ||
          body.thankYouStatus === 'Unsent'
            ? body.thankYouStatus
            : (c.thankYouStatus ?? 'Unsent');
        const resolvedInviteId =
          body.invitationCodeId === null
            ? null
            : typeof body.invitationCodeId === 'string'
              ? body.invitationCodeId
              : (c.invitationCodeId ?? null);
        targetInviteId = resolvedInviteId;
        const nextContrib = {
          ...c,
          thankYouStatus: nextStatus,
          ...(body.thankYouNote === null || typeof body.thankYouNote === 'string'
            ? { thankYouNote: body.thankYouNote }
            : {}),
          ...(body.thankYouSentAt === null || typeof body.thankYouSentAt === 'string'
            ? { thankYouSentAt: body.thankYouSentAt }
            : {}),
          invitationCodeId: resolvedInviteId,
          ...(body.addressLine1 === null || typeof body.addressLine1 === 'string'
            ? { addressLine1: body.addressLine1 || null }
            : {}),
          ...(body.addressLine2 === null || typeof body.addressLine2 === 'string'
            ? { addressLine2: body.addressLine2 || null }
            : {}),
          ...(body.city === null || typeof body.city === 'string'
            ? { city: body.city || null }
            : {}),
          ...(body.state === null || typeof body.state === 'string'
            ? { state: body.state || null }
            : {}),
          ...(body.zipCode === null || typeof body.zipCode === 'string'
            ? { zipCode: body.zipCode || null }
            : {}),
          ...(body.country === null || typeof body.country === 'string'
            ? { country: body.country || null }
            : {}),
        };
        if (body.syncAddressToGuest && resolvedInviteId) {
          syncedAddress = {
            addressLine1: nextContrib.addressLine1 || '',
            addressLine2: nextContrib.addressLine2 || '',
            city: nextContrib.city || '',
            state: nextContrib.state || '',
            zipCode: nextContrib.zipCode || '',
            country: nextContrib.country || '',
          };
        }
        return nextContrib;
      });
      const nextGuests =
        syncedAddress && targetInviteId
          ? current.guests.map((g) => (g.id === targetInviteId ? { ...g, ...syncedAddress } : g))
          : current.guests;
      return {
        ...current,
        registryItems: nextRegistryItems,
        offlineContributors: nextOffline,
        guests: nextGuests,
      };
    });
    return jsonResponse({ success: true, id: noteId });
  }

  if (path === '/api/admin/thank-you-notes' && method === 'GET') {
    const dataset = getActiveArchetypeDataset();
    const guestById = new Map(dataset.guests.map((g) => [g.id, g]));
    const regItemById = new Map(dataset.registryItems.map((r) => [r.id, r]));
    const mapContributorToDto = (
      contributor: ContributorRecord,
      registryItem: RegistryItem | null
    ) => {
      const linked = contributor.invitationCodeId
        ? guestById.get(contributor.invitationCodeId) ?? null
        : null;
      return {
        id: contributor.id,
        name: contributor.name,
        email: contributor.email ?? null,
        addressLine1: contributor.addressLine1 ?? null,
        addressLine2: contributor.addressLine2 ?? null,
        city: contributor.city ?? null,
        state: contributor.state ?? null,
        zipCode: contributor.zipCode ?? null,
        country: contributor.country ?? null,
        message: contributor.message ?? null,
        amount: contributor.amount,
        refundedAmount: contributor.refundedAmount ?? 0,
        status: contributor.status ?? 'CONFIRMED',
        date: contributor.date || new Date().toISOString(),
        thankYouStatus: contributor.thankYouStatus || 'Unsent',
        thankYouSentAt: contributor.thankYouSentAt ?? null,
        thankYouEmailSentAt: contributor.thankYouEmailSentAt ?? null,
        thankYouNote: contributor.thankYouNote ?? null,
        invitationCodeId: contributor.invitationCodeId ?? null,
        invitationCode: linked
          ? {
            id: linked.id,
            code: linked.code,
            guestName: linked.guestName,
            email: linked.email ?? null,
            householdName: linked.householdName ?? null,
            addressLine1: linked.addressLine1 ?? null,
            addressLine2: linked.addressLine2 ?? null,
            city: linked.city ?? null,
            state: linked.state ?? null,
            zipCode: linked.zipCode ?? null,
            country: linked.country ?? null,
          }
          : null,
        registryItemId: registryItem?.id ?? contributor.registryItemId ?? null,
        registryItem: registryItem
          ? {
            id: registryItem.id,
            name: registryItem.name,
            category: registryItem.category,
          }
          : null,
      };
    };
    const items = [
      ...dataset.registryItems.flatMap((registryItem) =>
        (registryItem.contributors || []).map((c) => mapContributorToDto(c, registryItem))
      ),
      ...(dataset.offlineContributors || []).map((c) =>
        mapContributorToDto(c, c.registryItemId ? (regItemById.get(c.registryItemId) ?? null) : null)
      ),
    ];
    const sent = items.filter((i) => i.thankYouStatus === 'Sent').length;
    const notNeeded = items.filter((i) => i.thankYouStatus === 'Not Needed').length;
    const unsent = items.length - sent - notNeeded;
    const thanked = sent + notNeeded;
    return jsonResponse({
      items,
      metrics: {
        total: items.length,
        sent,
        unsent,
        notNeeded,
        thanked,
        completionPercentage: items.length > 0 ? Math.round((thanked / items.length) * 100) : 0,
      },
      pagination: {
        page: 1,
        pageSize: Math.max(25, items.length),
        totalItems: items.length,
        totalPages: 1,
      },
    });
  }

  if (path === '/api/admin/maintenance/export' && method === 'GET') {
    const demoState = getDemoState();
    const dataset = getActiveArchetypeDataset();
    const presetConfig = ARCHETYPE_PRESETS[demoState.archetype].siteConfig;
    const nowIso = new Date().toISOString();
    const dateStamp = nowIso.slice(0, 10);
    const weddingDateVal = demoState.configOverrides.weddingDate;
    const weddingDateIso =
      weddingDateVal instanceof Date && !Number.isNaN(weddingDateVal.getTime())
        ? weddingDateVal.toISOString()
        : presetConfig.weddingDate;

    const placeholderMediaId = 'demo-placeholder-media';
    const mediaMap = new Map<
      string,
      {
        id: string;
        url: string;
        altText: string | null;
        isDecorative: boolean;
        isSample: boolean;
        createdAt: string;
        updatedAt: string;
      }
    >();
    mediaMap.set(placeholderMediaId, {
      id: placeholderMediaId,
      url: '/images/placeholder.png',
      altText: 'Registry gift placeholder',
      isDecorative: false,
      isSample: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    const registryItemRows = dataset.registryItems.map((item, idx) => {
      const resolvedImageId = item.imageId || placeholderMediaId;
      if (!mediaMap.has(resolvedImageId)) {
        const rawUrl = item.image?.url || '/images/placeholder.png';
        const safeUrl =
          rawUrl.startsWith('/') || rawUrl.startsWith('https://')
            ? rawUrl
            : '/images/placeholder.png';
        mediaMap.set(resolvedImageId, {
          id: resolvedImageId,
          url: safeUrl,
          altText: item.image?.altText ?? item.name,
          isDecorative: Boolean(item.image?.isDecorative),
          isSample: Boolean(item.isSample),
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
      return {
        id: item.id,
        createdAt: nowIso,
        updatedAt: nowIso,
        name: item.name,
        description: item.description ?? '',
        category: item.category || 'Home',
        price: item.price,
        imageId: resolvedImageId,
        quantity: Math.max(1, item.quantity ?? 1),
        itemType: item.itemType ?? 'PHYSICAL',
        paymentHandleType: item.paymentHandleType ?? null,
        paymentHandle: item.paymentHandle ?? null,
        vendorUrl: item.vendorUrl ?? null,
        isGroupGift: Boolean(item.isGroupGift),
        isMostWanted: Boolean(item.isMostWanted),
        displayOrder: item.displayOrder ?? idx,
        purchased: Boolean(item.purchased),
        isSample: Boolean(item.isSample),
        purchaserName: item.purchaserName ?? null,
        amountContributed: item.amountContributed ?? 0,
      };
    });

    const contributorRows = [
      ...dataset.registryItems.flatMap((item) =>
        (item.contributors || []).map((c) => ({
          id: c.id || nextDemoId('demo-contrib'),
          createdAt: c.date || nowIso,
          updatedAt: c.date || nowIso,
          name: c.name,
          email: c.email || null,
          addressLine1: c.addressLine1 ?? null,
          addressLine2: c.addressLine2 ?? null,
          city: c.city ?? null,
          state: c.state ?? null,
          zipCode: c.zipCode ?? null,
          country: c.country ?? null,
          amount: c.amount,
          refundedAmount: c.refundedAmount ?? 0,
          status: c.status ?? 'CONFIRMED',
          date: c.date || nowIso,
          message: c.message ?? null,
          thankYouStatus: c.thankYouStatus || 'Unsent',
          thankYouSentAt: c.thankYouSentAt ?? null,
          thankYouEmailSentAt: c.thankYouEmailSentAt ?? null,
          thankYouNote: c.thankYouNote ?? null,
          registryItemId: item.id,
          invitationCodeId: c.invitationCodeId ?? null,
        }))
      ),
      ...(dataset.offlineContributors || []).map((c) => ({
        id: c.id || nextDemoId('demo-offline'),
        createdAt: c.date || nowIso,
        updatedAt: c.date || nowIso,
        name: c.name,
        email: c.email || null,
        addressLine1: c.addressLine1 ?? null,
        addressLine2: c.addressLine2 ?? null,
        city: c.city ?? null,
        state: c.state ?? null,
        zipCode: c.zipCode ?? null,
        country: c.country ?? null,
        amount: c.amount,
        refundedAmount: c.refundedAmount ?? 0,
        status: c.status ?? 'CONFIRMED',
        date: c.date || nowIso,
        message: c.message ?? null,
        thankYouStatus: c.thankYouStatus || 'Unsent',
        thankYouSentAt: c.thankYouSentAt ?? null,
        thankYouEmailSentAt: c.thankYouEmailSentAt ?? null,
        thankYouNote: c.thankYouNote ?? null,
        registryItemId: c.registryItemId ?? null,
        invitationCodeId: c.invitationCodeId ?? null,
      })),
    ];

    const seedSubEvents = buildArchetypeSeedData(demoState.archetype).subEvents;
    const backupPayload = {
      version: '2.0',
      schemaVersion: '2.0',
      exportedAt: nowIso,
      appConfig: [
        {
          id: 'default',
          createdAt: nowIso,
          updatedAt: nowIso,
          partner1Name: demoState.configOverrides.partner1Name || presetConfig.partner1Name,
          partner2Name: demoState.configOverrides.partner2Name || presetConfig.partner2Name,
          weddingDate: weddingDateIso,
          venueName: demoState.configOverrides.venueName || presetConfig.venueName,
          venueAddress: demoState.configOverrides.venueAddress || presetConfig.venueAddress,
          venueCity: demoState.configOverrides.venueCity || presetConfig.venueCity,
          venueState: demoState.configOverrides.venueState || presetConfig.venueState,
          venueZip: demoState.configOverrides.venueZip || presetConfig.venueZip,
          timezone: demoState.configOverrides.timezone || presetConfig.timezone,
          themePreset: demoState.themePreset,
          setupCompleted: true,
        },
      ],
      media: Array.from(mediaMap.values()),
      registryItem: registryItemRows,
      contributor: contributorRows,
      seatingTable: dataset.seatingTables.map(({ invitationCodes: _ic, ...rest }) => ({
        ...rest,
        createdAt: rest.createdAt || nowIso,
        updatedAt: rest.updatedAt || nowIso,
      })),
      invitationCode: dataset.guests.map((g) => ({
        id: g.id,
        code: g.code,
        guestName: g.guestName,
        email: g.email || null,
        addressLine1: g.addressLine1 ?? null,
        addressLine2: g.addressLine2 ?? null,
        city: g.city ?? null,
        state: g.state ?? null,
        zipCode: g.zipCode ?? null,
        country: g.country ?? null,
        dietaryNotes: g.dietaryNotes ?? null,
        plusOneAllocations: g.plusOneAllocations ?? 0,
        plusOneFirstName: g.plusOneFirstName ?? null,
        plusOneLastName: g.plusOneLastName ?? null,
        householdName: g.householdName ?? null,
        partyGroup: g.partyGroup ?? null,
        partyTags: g.partyTags ?? [],
        used: Boolean(g.used),
        usedAt: g.usedAt || null,
        tableId: g.tableId ?? null,
        seatNumber: g.seatNumber ?? null,
        isSample: Boolean(g.isSample),
        createdAt: g.createdAt || nowIso,
        updatedAt: g.updatedAt || nowIso,
      })),
      weddingPartyMember: dataset.weddingParty.map(({ photo: _photo, ...m }) => ({
        ...m,
        createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt || nowIso),
        updatedAt: m.updatedAt instanceof Date ? m.updatedAt.toISOString() : String(m.updatedAt || nowIso),
      })),
      attraction: dataset.attractions.map(({ image: _img, ...a }) => ({
        ...a,
        createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt || nowIso),
        updatedAt: a.updatedAt instanceof Date ? a.updatedAt.toISOString() : String(a.updatedAt || nowIso),
      })),
      contentNode: [...dataset.faqs, ...dataset.logisticsNodes].map((n) => ({
        id: n.id,
        type: n.type,
        tags: n.tags,
        data: n.data as Record<string, unknown>,
        createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : String(n.createdAt || nowIso),
        updatedAt: n.updatedAt instanceof Date ? n.updatedAt.toISOString() : String(n.updatedAt || nowIso),
      })),
      subEvent: seedSubEvents.map((ev) => ({
        id: ev.id,
        title: ev.title,
        description: ev.description ?? null,
        startTime: ev.startTime instanceof Date ? ev.startTime.toISOString() : (ev.startTime ?? null),
        endTime: ev.endTime instanceof Date ? ev.endTime.toISOString() : (ev.endTime ?? null),
        locationName: ev.locationName ?? null,
        location: ev.location ?? null,
        category: ev.category ?? null,
        isPrivate: Boolean(ev.isPrivate),
        mealOptions: ev.mealOptions ?? [],
        customQuestions: ev.customQuestions ?? [],
        createdAt: ev.createdAt instanceof Date ? ev.createdAt.toISOString() : nowIso,
        updatedAt: ev.updatedAt instanceof Date ? ev.updatedAt.toISOString() : nowIso,
      })),
      subEventAccess: [],
      subEventRsvp: [],
      broadcastMessage: [],
      broadcastRecipient: [],
      snapshotVersion: [],
    };
    return binaryDemoResponse(
      JSON.stringify(backupPayload, null, 2),
      'application/json; charset=utf-8',
      `wedding-backup-${dateStamp}.json`
    );
  }

  if (path === '/api/admin/maintenance/import' && method === 'POST') {
    const body = await parseJsonBody(init);
    if (Array.isArray(body.appConfig) && body.appConfig[0] && typeof body.appConfig[0] === 'object') {
      const cfg = body.appConfig[0] as Record<string, unknown>;
      updateDemoConfigOverrides({
        ...(typeof cfg.partner1Name === 'string' ? { partner1Name: cfg.partner1Name } : {}),
        ...(typeof cfg.partner2Name === 'string' ? { partner2Name: cfg.partner2Name } : {}),
        ...(typeof cfg.venueName === 'string' ? { venueName: cfg.venueName } : {}),
        ...(typeof cfg.timezone === 'string' ? { timezone: cfg.timezone } : {}),
      });
    }
    return jsonResponse({
      success: true,
      restored: true,
      data: { imported: true, restored: true },
    });
  }

  const icsMatch = path.match(/^\/api\/schedule\/([^/]+)\/ics$/);
  if (icsMatch && method === 'GET') {
    const delegatedIcs = await delegateToStaticDemoRouter(rawInput ?? url, init, method, path);
    if (delegatedIcs && delegatedIcs.ok) {
      return delegatedIcs;
    }
    const eventId = decodeURIComponent(icsMatch[1]).trim();
    const demoState = getDemoState();
    const seed = buildArchetypeSeedData(demoState.archetype);
    const timezone = resolveValidTimezone(
      demoState.configOverrides.timezone ||
        seed.config.timezone ||
        ARCHETYPE_PRESETS[demoState.archetype].siteConfig.timezone
    );
    const matchedSubEvent = seed.subEvents.find((ev) => ev.id === eventId);
    if (!matchedSubEvent) {
      return jsonResponse({ error: 'Schedule event not found' }, 404);
    }
    const calendarEvent = formatScheduleEventToCalendarEvent(
      {
        id: matchedSubEvent.id,
        title: matchedSubEvent.title,
        startTime:
          matchedSubEvent.startTime instanceof Date
            ? matchedSubEvent.startTime.toISOString()
            : (matchedSubEvent.startTime || undefined),
        endTime:
          matchedSubEvent.endTime instanceof Date
            ? matchedSubEvent.endTime.toISOString()
            : (matchedSubEvent.endTime || undefined),
        locationName: matchedSubEvent.locationName || undefined,
        location: matchedSubEvent.location || undefined,
        attireRules: matchedSubEvent.attireRules || undefined,
        description: matchedSubEvent.description || undefined,
      },
      undefined,
      timezone
    );
    const icsContent =
      createIcsFile(calendarEvent) ||
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Wedding Showcase//EN',
        'BEGIN:VEVENT',
        `UID:${matchedSubEvent.id}@wedding.showcase`,
        `SUMMARY:${matchedSubEvent.title}`,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
    const cleanTitle =
      (matchedSubEvent.title || 'event').replace(/["\r\n\t]/g, '').trim() || 'event';
    return binaryDemoResponse(icsContent, 'text/calendar; charset=utf-8', `${cleanTitle}.ics`);
  }

  // Guest weather forecast (localized seasonal climate fallback with venue/override support)
  if (path === '/api/weather' && method === 'GET') {
    const state = getDemoState();
    const preset = ARCHETYPE_PRESETS[state.archetype] ?? ARCHETYPE_PRESETS.classic;
    const overrides = state.configOverrides;
    const latitude =
      typeof overrides.latitude === 'number' && Number.isFinite(overrides.latitude)
        ? overrides.latitude
        : preset.siteConfig.latitude;
    const longitude =
      typeof overrides.longitude === 'number' && Number.isFinite(overrides.longitude)
        ? overrides.longitude
        : preset.siteConfig.longitude;
    const timezone =
      (typeof overrides.timezone === 'string' && overrides.timezone.trim()) ||
      preset.siteConfig.timezone ||
      'UTC';
    const rawWeddingDate =
      overrides.weddingDate instanceof Date && !Number.isNaN(overrides.weddingDate.getTime())
        ? overrides.weddingDate
        : new Date(preset.siteConfig.weddingDate);
    const weddingDate = Number.isNaN(rawWeddingDate.getTime())
      ? new Date('2026-09-19T16:00:00.000Z')
      : rawWeddingDate;
    const weddingDayStr = formatForecastDateInTimezone(weddingDate, timezone);
    const availableDateStr = computeLiveForecastAvailableDate(weddingDayStr, timezone);
    const forecast = getLocalizedClimateFallback(
      latitude,
      longitude,
      weddingDayStr,
      availableDateStr
    );

    return jsonResponse({
      success: true,
      data: forecast,
      ...forecast,
    });
  }

  // Delegate extended OpenAPI routes (schedule, rsvp, photos, media, content-nodes,
  // versions, guest login/lookup) to the staticDemo router when installed
  const delegatedExtended = await delegateToStaticDemoRouter(rawInput ?? url, init, method, path);
  if (delegatedExtended) {
    return delegatedExtended;
  }

  if (path === '/api/admin/photos/qr') {
    if (method === 'POST') {
      const body = await parseJsonBody(init);
      if (typeof body.autoApproveGuestPhotos === 'boolean') {
        demoAutoApproveGuestPhotos = body.autoApproveGuestPhotos;
      }
      if (body.action === 'rotate') {
        demoPhotoQrTokenVersion += 1;
      }
    }
    if (method === 'GET' || method === 'POST') {
      return jsonResponse({
        success: true,
        uploadUrl: `${url.origin}${withBasePath('/photos')}?tab=guest&v=${demoPhotoQrTokenVersion}`,
        tokenVersion: demoPhotoQrTokenVersion,
        autoApproveGuestPhotos: demoAutoApproveGuestPhotos,
      });
    }
  }

  // Health & readiness probes (standalone DemoProvider fallback)
  if (
    (path === '/api/health' || path === '/api/live' || path === '/api/ready') &&
    method === 'GET'
  ) {
    return jsonResponse({ status: 'ok', ready: true, mode: 'static-demo' });
  }

  // Public & moderated photos + media library (#1232 cursor-compatible)
  if (path === '/api/photos' && method === 'GET') {
    const state = getDemoState();
    const preset = ARCHETYPE_PRESETS[state.archetype] ?? ARCHETYPE_PRESETS.classic;
    const photoTimestampIso = '2026-01-15T12:00:00.000Z';
    const sinceParam = url.searchParams.get('since');
    const sinceMs = sinceParam ? new Date(sinceParam).getTime() : NaN;
    const allPhotos = preset.photos.map((photo, idx) => ({
      id: `demo-photo-${state.archetype}-${idx + 1}`,
      url: photo.url,
      title: photo.caption,
      caption: photo.caption,
      altText: photo.altText,
      isGuestUpload: false,
      createdAt: photoTimestampIso,
      updatedAt: photoTimestampIso,
    }));
    const photos =
      !Number.isNaN(sinceMs) && sinceMs >= new Date(photoTimestampIso).getTime() ? [] : allPhotos;
    return jsonResponse({ success: true, photos, data: photos });
  }

  if (
    (path === '/api/photos/upload' ||
      path === '/api/guest/photos/upload' ||
      path === '/api/admin/upload') &&
    method === 'POST'
  ) {
    return jsonResponse({
      success: true,
      url: '/images/sunset-embrace.jpg',
      data: { id: nextDemoId('demo-upload'), url: '/images/sunset-embrace.jpg' },
    });
  }

  if (path === '/api/media' || path.startsWith('/api/media/')) {
    const state = getDemoState();
    const preset = ARCHETYPE_PRESETS[state.archetype] ?? ARCHETYPE_PRESETS.classic;
    const mediaList = preset.photos.map((photo, idx) => ({
      id: `demo-media-${state.archetype}-${idx + 1}`,
      url: photo.url,
      altText: photo.altText,
      isDecorative: false,
      isSample: true,
      mimeType: 'image/jpeg',
      createdAt: '2026-01-15T12:00:00.000Z',
      updatedAt: '2026-01-15T12:00:00.000Z',
    }));
    if (method === 'GET') {
      return jsonResponse({
        success: true,
        data: mediaList,
        total: mediaList.length,
        page: 1,
        totalPages: 1,
      });
    }
    if (method === 'DELETE') {
      return jsonResponse({ success: true, data: { deleted: true } });
    }
    const body = await parseJsonBody(init);
    return jsonResponse({
      success: true,
      data: {
        id: nextDemoId('demo-media'),
        url: typeof body.url === 'string' ? body.url : '/images/sunset-embrace.jpg',
        altText: typeof body.altText === 'string' ? body.altText : 'Uploaded demo photo',
        isDecorative: Boolean(body.isDecorative),
        isSample: false,
      },
    });
  }

  if (path === '/api/admin/photos/moderation' || path === '/api/admin/photos/moderation/batch') {
    if (method === 'GET') {
      return jsonResponse({
        success: true,
        pendingCount: 0,
        count: 0,
        photos: [],
        data: [],
        pagination: { page: 1, limit: 50, total: 0, totalPages: 1 },
      });
    }
    return jsonResponse({ success: true, updatedCount: 1, data: { updatedCount: 1 } });
  }

  // Guest login
  if (path === '/api/guest/login' && method === 'POST') {
    const body = await parseJsonBody(init);
    const code =
      typeof body.code === 'string'
        ? body.code.trim()
        : typeof body.passcode === 'string'
          ? body.passcode.trim()
          : '';
    const matched = code
      ? findDemoGuestByCode(code)
      : getActiveArchetypeDataset().guests.find((g) => !isDemoAddressCollectionOnly(g.partyTags));
    if (matched) {
      setDemoGuestSession({ invitationCode: matched.code, guestName: matched.guestName });
    }
    return jsonResponse({
      success: true,
      authenticated: true,
      data: { authenticated: true, guestName: matched?.guestName ?? 'Invited Guest' },
    });
  }

  // Admin Settings (/admin/dashboard/settings)
  if (path === '/api/admin/settings') {
    const state = getDemoState();
    const preset = ARCHETYPE_PRESETS[state.archetype] ?? ARCHETYPE_PRESETS.classic;
    const rawWeddingDate = state.configOverrides.weddingDate ?? preset.siteConfig.weddingDate;
    const weddingDateIso =
      rawWeddingDate instanceof Date
        ? rawWeddingDate.toISOString()
        : typeof rawWeddingDate === 'string'
          ? rawWeddingDate
          : '2026-10-18T16:00:00.000Z';

    const mergedProfile = {
      id: 'global',
      subdomain: 'global',
      partner1Name: state.configOverrides.partner1Name ?? preset.siteConfig.partner1Name,
      partner2Name: state.configOverrides.partner2Name ?? preset.siteConfig.partner2Name,
      brideName: state.configOverrides.partner1Name ?? preset.siteConfig.partner1Name,
      groomName: state.configOverrides.partner2Name ?? preset.siteConfig.partner2Name,
      weddingDate: weddingDateIso,
      venueName: state.configOverrides.venueName ?? preset.siteConfig.venueName,
      venueAddress: state.configOverrides.venueAddress ?? preset.siteConfig.venueAddress,
      venueCity: state.configOverrides.venueCity ?? preset.siteConfig.venueCity,
      venueState: state.configOverrides.venueState ?? preset.siteConfig.venueState,
      venueZip: state.configOverrides.venueZip ?? preset.siteConfig.venueZip,
      timezone: state.configOverrides.timezone ?? preset.siteConfig.timezone,
      themePreset: state.themePreset,
      colorPrimary: state.configOverrides.colorPrimary ?? preset.siteConfig.colorPrimary,
      colorSecondary: state.configOverrides.colorSecondary ?? preset.siteConfig.colorSecondary,
      heroImageUrl: preset.siteConfig.heroImageUrl,
      ogImageUrl: preset.siteConfig.ogImageUrl,
      baseUrl: state.configOverrides.baseUrl || 'https://alexandtaylor2026.wedding',
      contactEmail: state.configOverrides.contactEmail || 'hello@alexandtaylor2026.wedding',
      rsvpOpen: true,
      isRsvpOpen: true,
      multisiteEnabled: false,
      emailProvider: 'none',
      smsProvider: 'none',
      hasSmtpPass: false,
      hasResendApiKey: false,
      hasSendgridApiKey: false,
      hasTwilioAuthToken: false,
    };

    if (method === 'GET') {
      if (url.searchParams.get('list') === 'true') {
        return jsonResponse({ success: true, data: [mergedProfile] });
      }
      return jsonResponse({ success: true, data: mergedProfile });
    }
    const body = await parseJsonBody(init);
    updateDemoConfigOverrides(body as Partial<PublicAppConfig>);
    return jsonResponse({ success: true, data: { ...mergedProfile, ...body } });
  }

  // Admin Site Manager features (/admin/dashboard/site-manager)
  if (path === '/api/admin/features') {
    const defaultSections = [
      { id: 'story', type: 'story', title: 'Our Story', visible: true },
      { id: 'details', type: 'details', title: 'Wedding Day Details', visible: true },
      { id: 'accommodations', type: 'accommodations', title: 'Accommodations', visible: true },
      { id: 'venue', type: 'venue', title: 'About Our Venue', visible: true },
      { id: 'travel', type: 'travel', title: 'Travel & Things to Do', visible: true },
      { id: 'faq', type: 'faq', title: 'Questions You Probably Have', visible: true },
    ];
    if (method === 'GET') {
      return jsonResponse({ success: true, data: defaultSections });
    }
    const body = await parseJsonBody(init);
    const updated = Array.isArray(body.features) ? body.features : defaultSections;
    return jsonResponse({ success: true, data: updated });
  }

  // Admin Content Nodes (/admin/dashboard/content)
  if (path === '/api/admin/content-nodes' || path.startsWith('/api/admin/content-nodes/')) {
    const dataset = getActiveArchetypeDataset();
    if (method === 'GET') {
      return jsonResponse({
        success: true,
        data: [...dataset.faqs, ...dataset.logisticsNodes],
      });
    }
    if (method === 'DELETE') {
      const nodeId = decodeURIComponent(path.slice('/api/admin/content-nodes/'.length));
      mutateActiveDataset((curr) => ({
        ...curr,
        faqs: curr.faqs.filter((n) => n.id !== nodeId),
        logisticsNodes: curr.logisticsNodes.filter((n) => n.id !== nodeId),
      }));
      return jsonResponse({ success: true, data: { deleted: true } });
    }
    const body = await parseJsonBody(init);
    return jsonResponse({
      success: true,
      data: {
        id: nextDemoId('demo-node'),
        type: typeof body.type === 'string' ? body.type : 'FAQ',
        slug: typeof body.slug === 'string' ? body.slug : nextDemoId('demo-faq'),
        tags: Array.isArray(body.tags) ? body.tags : [],
        data: body.data && typeof body.data === 'object' ? body.data : {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }

  // Admin Version History (/admin/dashboard/history)
  if (path === '/api/admin/versions' || path.startsWith('/api/admin/versions/')) {
    if (method === 'POST') {
      return jsonResponse({ success: true, data: { restored: true } });
    }
    const items = [
      {
        id: 'demo-version-1',
        entityType: 'AppConfig',
        entityId: 'global',
        author: 'Couple Admin',
        createdAt: '2026-01-15T12:00:00.000Z',
        snapshot: { themePreset: getDemoState().themePreset },
      },
    ];
    return jsonResponse({
      success: true,
      data: {
        items,
        pagination: { page: 1, limit: 50, total: items.length, totalPages: 1 },
      },
    });
  }

  // Admin Broadcast actions (/admin/dashboard/invitation-codes & history)
  if (
    (path === '/api/admin/broadcast/preview' ||
      path === '/api/admin/broadcast/send' ||
      path === '/api/admin/broadcast/test-send' ||
      path === '/api/admin/broadcast/test-connection' ||
      path === '/api/admin/broadcast/retry') &&
    method === 'POST'
  ) {
    const dataset = getActiveArchetypeDataset();
    const eligibleGuests = dataset.guests.filter((g) => !isDemoAddressCollectionOnly(g.partyTags));
    return jsonResponse({
      success: true,
      data: {
        recipientCount: eligibleGuests.length,
        matchedCount: eligibleGuests.length,
        sentCount: eligibleGuests.length,
        failedCount: 0,
        subject: 'Wedding Update Preview',
        htmlBody: '<p>We look forward to celebrating together!</p>',
        textBody: 'We look forward to celebrating together!',
      },
    });
  }

  if (path.startsWith('/api/admin/broadcast/schedule/') && method === 'DELETE') {
    return jsonResponse({ success: true, data: { cancelled: true } });
  }

  // Safe fallback for read-only admin overview widgets on static export
  if (path.startsWith('/api/admin/') && method === 'GET') {
    const dataset = getActiveArchetypeDataset();
    return jsonResponse({
      success: true,
      data: {
        items: [],
        total: 0,
        registryCount: dataset.registryItems.length,
        guestCount: dataset.guests.length,
      },
    });
  }

  return jsonResponse({ error: `Demo endpoint not implemented: ${method} ${path}` }, 404);
}

export async function dispatchDemoApiRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response | null> {
  if (!isDemoRuntimeActive()) return null;
  const apiUrl = resolveApiPathname(input);
  if (!apiUrl) return null;
  if (init?.signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
  return handleDemoApi(apiUrl, init, input);
}

let activeInterceptCount = 0;
let originalFetchRef: typeof window.fetch | null = null;

export function installDemoFetchInterceptor(): () => void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
    return () => {};
  }

  activeInterceptCount += 1;
  if (activeInterceptCount === 1) {
    originalFetchRef = window.fetch.bind(window);
    const fallbackFetch = originalFetchRef;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      if (isDemoRuntimeActive()) {
        const apiUrl = resolveApiPathname(input);
        if (apiUrl) {
          if (init?.signal?.aborted) {
            throw new DOMException('The operation was aborted.', 'AbortError');
          }
          return handleDemoApi(apiUrl, init, input);
        }
      }
      return fallbackFetch(input, init);
    };
  }

  return () => {
    activeInterceptCount = Math.max(0, activeInterceptCount - 1);
    if (activeInterceptCount === 0 && originalFetchRef) {
      window.fetch = originalFetchRef;
      originalFetchRef = null;
    }
  };
}
