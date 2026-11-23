import { stripBasePath } from '@/utils/basePath';
import type { ContributorRecord, RegistryItem } from '@/features/registry';
import type { ArchetypeId } from '@/lib/sampleData/archetypes';
import {
  getLocalizedClimateFallback,
  maskRegistryItem,
  sanitizeRegistryItem,
} from './browserHelpers';
import {
  getDemoState,
  switchDemoArchetype,
  updateDemoState,
} from './store';
import type {
  DemoAttraction,
  DemoContentNode,
  DemoInvitationCode,
  DemoMediaItem,
  DemoSeatingTable,
  DemoSiteSection,
  DemoState,
  DemoSubEvent,
  DemoWeddingPartyMember,
} from './types';

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(extraHeaders ?? {}),
    },
  });
}

function textResponse(
  body: string,
  contentType: string,
  filename?: string,
  status = 200
): Response {
  const headers: Record<string, string> = {
    'Content-Type': contentType,
  };
  if (filename) {
    headers['Content-Disposition'] = `attachment; filename="${filename}"`;
  }
  return new Response(body, { status, headers });
}

async function readJsonBody(init?: RequestInit, request?: Request): Promise<Record<string, unknown>> {
  try {
    if (init?.body && typeof init.body === 'string') {
      return JSON.parse(init.body) as Record<string, unknown>;
    }
    if (request) {
      const cloned = request.clone();
      const text = await cloned.text();
      if (text.trim()) {
        return JSON.parse(text) as Record<string, unknown>;
      }
    }
  } catch {
    // Fall back to empty object
  }
  return {};
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function csvEscape(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function getGuestAttendance(invite: DemoInvitationCode, state: DemoState): 'attending' | 'declined' | 'pending' {
  const rsvps = state.subEventRsvps.filter((r) => r.invitationCodeId === invite.id);
  if (rsvps.some((r) => r.status === 'attending')) return 'attending';
  if (rsvps.length > 0 && rsvps.every((r) => r.status === 'declined')) return 'declined';
  const fromExtra = invite.extraFields?.attendanceStatus;
  if (fromExtra === 'attending' || fromExtra === 'declined' || fromExtra === 'pending') {
    return fromExtra;
  }
  return 'pending';
}

function recalcRegistryItemTotals(item: RegistryItem): void {
  const contributors = Array.isArray(item.contributors) ? item.contributors : [];
  const activeContribs = contributors.filter(
    (c) => c.status !== 'CANCELLED' && c.status !== 'REFUNDED'
  );
  const totalAmount = activeContribs.reduce(
    (sum, c) => sum + Math.max(0, (c.amount ?? 0) - (c.refundedAmount ?? 0)),
    0
  );
  item.amountContributed = Number(totalAmount.toFixed(2));
  const isCash = item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND';
  if (!isCash && item.price > 0) {
    item.purchased = totalAmount >= item.price;
  }
}

function buildRsvpSummary(state: DemoState) {
  const emptyDietary = () => ({
    totalWithRestrictions: 0,
    glutenFree: 0,
    vegetarian: 0,
    vegan: 0,
    dairyFree: 0,
    nutFree: 0,
    halal: 0,
    kosher: 0,
    other: 0,
    kids: 0,
  });

  const globalDietary = emptyDietary();
  let attendingHouseholds = 0;
  let declinedHouseholds = 0;
  let pendingHouseholds = 0;
  let attendingHeadcount = 0;
  let attendingPlusOnes = 0;
  let declinedHeadcount = 0;
  let pendingHeadcount = 0;

  for (const inv of state.invitationCodes) {
    const status = getGuestAttendance(inv, state);
    if (status === 'attending') {
      attendingHouseholds += 1;
      const plusOnes = inv.plusOneFirstName ? 1 : 0;
      attendingPlusOnes += plusOnes;
      attendingHeadcount += 1 + plusOnes;
    } else if (status === 'declined') {
      declinedHouseholds += 1;
      declinedHeadcount += 1;
    } else {
      pendingHouseholds += 1;
      pendingHeadcount += 1 + (inv.plusOneAllocations || 0);
    }

    const notes = (inv.dietaryNotes || '').toLowerCase();
    if (notes) {
      globalDietary.totalWithRestrictions += 1;
      if (notes.includes('gluten')) globalDietary.glutenFree += 1;
      else if (notes.includes('vegan')) globalDietary.vegan += 1;
      else if (notes.includes('vegetarian')) globalDietary.vegetarian += 1;
      else if (notes.includes('dairy')) globalDietary.dairyFree += 1;
      else if (notes.includes('nut')) globalDietary.nutFree += 1;
      else globalDietary.other += 1;
    }
  }

  const mealTotals: Array<{
    subEventId: string;
    subEventTitle: string;
    optionId: string;
    label: string;
    dietaryTags: string[];
    count: number;
  }> = [];

  const subEventsSummary = state.subEvents.map((se) => {
    const invited = state.invitationCodes.filter(
      (inv) => !se.isPrivate || inv.allowedSubEventIds.includes(se.id)
    );
    const rsvps = state.subEventRsvps.filter((r) => r.subEventId === se.id);
    const attendingRsvps = rsvps.filter((r) => r.status === 'attending');
    const declinedRsvps = rsvps.filter((r) => r.status === 'declined');
    const plusOnes = attendingRsvps.reduce((sum, r) => sum + (r.plusOneCount || 0), 0);
    const mealCounts = se.mealOptions.map((opt) => {
      const count = attendingRsvps.reduce(
        (sum, r) => sum + r.mealSelections.filter((m) => m === opt.id || m === opt.label).length,
        0
      );
      mealTotals.push({
        subEventId: se.id,
        subEventTitle: se.title,
        optionId: opt.id,
        label: opt.label,
        dietaryTags: opt.dietaryTags,
        count,
      });
      return {
        optionId: opt.id,
        label: opt.label,
        dietaryTags: opt.dietaryTags,
        count,
      };
    });

    const questionBreakdowns = se.customQuestions.map((q) => {
      const textResponses: Array<{ invitationCodeId: string; guestName: string; answer: string }> = [];
      const optionMap = new Map<string, number>((q.options ?? []).map((opt) => [opt, 0]));
      for (const rsvp of attendingRsvps) {
        const ans = rsvp.customAnswers?.[q.id];
        if (!ans) continue;
        const guest = state.invitationCodes.find((i) => i.id === rsvp.invitationCodeId);
        if (q.type === 'choice') {
          optionMap.set(ans, (optionMap.get(ans) ?? 0) + 1);
        } else {
          textResponses.push({
            invitationCodeId: rsvp.invitationCodeId,
            guestName: guest?.guestName ?? 'Guest',
            answer: ans,
          });
        }
      }
      return {
        subEventId: se.id,
        subEventTitle: se.title,
        questionId: q.id,
        prompt: q.prompt,
        type: q.type,
        totalResponses:
          q.type === 'choice'
            ? Array.from(optionMap.values()).reduce((a, b) => a + b, 0)
            : textResponses.length,
        optionCounts: Array.from(optionMap.entries()).map(([option, count]) => ({ option, count })),
        textResponses,
      };
    });

    return {
      subEventId: se.id,
      title: se.title,
      isPrivate: se.isPrivate,
      invitedCount: invited.length,
      attendingCount: attendingRsvps.length,
      attendingPlusOnes: plusOnes,
      attendingHeadcount: attendingRsvps.length + plusOnes,
      declinedCount: declinedRsvps.length,
      pendingCount: Math.max(0, invited.length - attendingRsvps.length - declinedRsvps.length),
      kidsCount: 0,
      mealCounts,
      dietaryCounts: emptyDietary(),
      questionBreakdowns,
    };
  });

  return {
    global: {
      totalInvitations: state.invitationCodes.length,
      attendingHouseholds,
      declinedHouseholds,
      pendingHouseholds,
      attendingHeadcount,
      attendingPlusOnes,
      declinedHeadcount,
      pendingHeadcount,
      dietary: globalDietary,
      mealTotals,
      questionBreakdowns: subEventsSummary.flatMap((s) => s.questionBreakdowns),
    },
    subEvents: subEventsSummary,
  };
}

export async function routeDemoApiRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response | null> {
  const rawUrl =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  const baseOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost';

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl, baseOrigin);
  } catch {
    return null;
  }

  if (parsedUrl.origin !== baseOrigin) {
    return null;
  }

  const normalizedPath = stripBasePath(parsedUrl.pathname).replace(/\/+$/, '') || '/';
  if (!normalizedPath.startsWith('/api/')) {
    return null;
  }

  const requestObj = input instanceof Request ? input : undefined;
  const method = (init?.method || requestObj?.method || 'GET').toUpperCase();
  const searchParams = parsedUrl.searchParams;
  const state = getDemoState();

  // --- Health, OG & Weather ---
  if (
    normalizedPath === '/api/health' ||
    normalizedPath === '/api/live' ||
    normalizedPath === '/api/ready'
  ) {
    return jsonResponse({
      status: 'ok',
      ready: true,
      mode: 'static-demo',
      timestamp: new Date().toISOString(),
    });
  }

  if (normalizedPath === '/api/og') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#1C1917"/><text x="600" y="300" text-anchor="middle" fill="#FAFAF9" font-family="Georgia, serif" font-size="64">${state.config.partner1Name} &amp; ${state.config.partner2Name}</text><text x="600" y="380" text-anchor="middle" fill="#D6D3D1" font-family="sans-serif" font-size="28">${state.config.venueName}</text></svg>`;
    return textResponse(svg, 'image/svg+xml; charset=utf-8');
  }

  if (normalizedPath === '/api/weather') {
    const lat = Number(searchParams.get('lat') ?? state.config.latitude ?? 42.2529);
    const lon = Number(searchParams.get('lon') ?? state.config.longitude ?? -73.791);
    const rawDate = String(searchParams.get('date') ?? state.config.weddingDate ?? '2026-10-24');
    const weddingDayStr = rawDate.slice(0, 10);
    const weddingMs = Date.parse(`${weddingDayStr}T00:00:00Z`);
    const availableDateStr = Number.isFinite(weddingMs)
      ? new Date(weddingMs - 16 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : '2026-10-08';
    const climate = getLocalizedClimateFallback(
      Number.isFinite(lat) ? lat : 42.2529,
      Number.isFinite(lon) ? lon : -73.791,
      weddingDayStr,
      availableDateStr
    );
    return jsonResponse(climate);
  }

  // --- Admin Auth & Setup ---
  if (normalizedPath === '/api/admin/me' || normalizedPath === '/api/admin/status') {
    return jsonResponse({
      success: true,
      isAdmin: state.isAdmin,
      isAuthenticated: state.isAdmin,
    });
  }

  if (normalizedPath === '/api/admin/login' && method === 'POST') {
    updateDemoState((draft) => {
      draft.isAdmin = true;
    });
    return jsonResponse({ success: true, isAdmin: true });
  }

  if (normalizedPath === '/api/admin/logout' && method === 'POST') {
    updateDemoState((draft) => {
      draft.isAdmin = false;
    });
    return jsonResponse({ success: true });
  }

  if (normalizedPath === '/api/admin/setup' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    const sampleArchetype = body.sampleArchetype as ArchetypeId | undefined;
    if (sampleArchetype && ['classic', 'destination', 'romantic'].includes(sampleArchetype)) {
      switchDemoArchetype(sampleArchetype);
    }
    const updated = updateDemoState((draft) => {
      draft.isAdmin = true;
      if (body.setupCompleted === true) {
        draft.setupWizardPreview = false;
      }
      if (typeof body.partner1Name === 'string' && body.partner1Name.trim()) {
        draft.config.partner1Name = body.partner1Name.trim();
      }
      if (typeof body.partner2Name === 'string' && body.partner2Name.trim()) {
        draft.config.partner2Name = body.partner2Name.trim();
      }
      const coupleLabel = `${draft.config.partner1Name} & ${draft.config.partner2Name}`;
      if (typeof body.weddingDate === 'string' && body.weddingDate) {
        draft.config.weddingDate = new Date(body.weddingDate);
      }
      if (typeof body.venueName === 'string') draft.config.venueName = body.venueName;
      if (typeof body.venueCity === 'string') draft.config.venueCity = body.venueCity;
      if (typeof body.venueState === 'string') draft.config.venueState = body.venueState;
      if (typeof body.themePreset === 'string') {
        draft.config.themePreset = body.themePreset as typeof draft.config.themePreset;
      }
      if (typeof body.colorPrimary === 'string') draft.config.colorPrimary = body.colorPrimary;
      if (typeof body.colorSecondary === 'string') draft.config.colorSecondary = body.colorSecondary;
      if (body.modules && typeof body.modules === 'object') {
        draft.config.modules = {
          ...draft.config.modules,
          ...(body.modules as Partial<typeof draft.config.modules>),
        };
      }
      draft.versions.unshift({
        id: makeId('demo-version'),
        entityType: 'AppConfig',
        entityId: 'global',
        versionNumber: draft.versions.length + 1,
        author: 'Setup Wizard (Demo)',
        summary: `Completed Setup Wizard for ${coupleLabel}`,
        data: {
          partner1Name: draft.config.partner1Name,
          partner2Name: draft.config.partner2Name,
          venueName: draft.config.venueName,
          themePreset: draft.config.themePreset,
        },
        createdAt: new Date().toISOString(),
      });
    });
    return jsonResponse({ success: true, data: updated.config });
  }

  if (normalizedPath === '/api/admin/onboarding-milestones') {
    const faqCount = state.contentNodes.filter((n) => n.type === 'FAQ').length;
    const milestones = [
      {
        id: 'wedding-details',
        title: 'Configure Wedding Details & Theme',
        description: 'Set partner names, ceremony date, venue coordinates, and color palette.',
        completed: Boolean(state.config.partner1Name && state.config.venueName),
        href: '/admin/dashboard/settings',
        actionLabel: 'Edit Settings',
      },
      {
        id: 'guest-list',
        title: 'Import Guest Households & Codes',
        description: 'Add guest households, plus-one allowances, and unique RSVP codes.',
        completed: state.invitationCodes.length > 0,
        href: '/admin/dashboard/invitation-codes',
        actionLabel: 'Manage Guests',
      },
      {
        id: 'registry',
        title: 'Curate Gift Registry & Cash Funds',
        description: 'Add physical gifts, honeymoon funds, or zero-fee Venmo handles.',
        completed: state.registryItems.length > 0,
        href: '/admin/dashboard/registry',
        actionLabel: 'Open Registry',
      },
      {
        id: 'seating-layout',
        title: 'Arrange Reception Floorplan',
        description: 'Create reception tables and assign confirmed guests to seats.',
        completed: state.seatingTables.length > 0,
        href: '/admin/dashboard/seating-chart',
        actionLabel: 'Seating Chart',
      },
      {
        id: 'faq-setup',
        title: 'Publish Guest Q&A & Travel Notes',
        description: 'Answer common questions about dress code, shuttles, and hotels.',
        completed: faqCount > 0,
        href: '/admin/dashboard/content',
        actionLabel: 'Edit FAQs',
      },
    ];
    const completedCount = milestones.filter((m) => m.completed).length;
    return jsonResponse({
      success: true,
      milestones,
      completedCount,
      pendingCount: milestones.length - completedCount,
      totalCount: milestones.length,
      allComplete: completedCount === milestones.length,
    });
  }

  if (normalizedPath === '/api/admin/sample-data') {
    if (method === 'GET') {
      const registry = state.registryItems.filter((i) => i.isSample).length;
      const guests = state.invitationCodes.filter((i) => i.isSample).length;
      const seating = state.seatingTables.filter((i) => i.isSample).length;
      const weddingParty = state.weddingParty.filter((i) => i.isSample).length;
      const attractions = state.attractions.filter((i) => i.isSample).length;
      const faqs = state.contentNodes.filter((i) => i.type === 'FAQ' && i.isSample).length;
      const totalSamples = registry + guests + seating + weddingParty + attractions + faqs;
      return jsonResponse({
        success: true,
        hasSampleData: totalSamples > 0,
        activeArchetype: state.activeArchetype,
        counts: { registry, guests, seating, weddingParty, attractions, faqs },
      });
    }
    if (method === 'POST') {
      const body = await readJsonBody(init, requestObj);
      const archetype = (body.archetype as ArchetypeId) || 'classic';
      const next = switchDemoArchetype(
        ['classic', 'destination', 'romantic'].includes(archetype) ? archetype : 'classic'
      );
      return jsonResponse({
        success: true,
        archetype: next.activeArchetype,
        createdCounts: {
          registry: next.registryItems.length,
          guests: next.invitationCodes.length,
          seating: next.seatingTables.length,
        },
      });
    }
    if (method === 'DELETE') {
      updateDemoState((draft) => {
        draft.activeArchetype = null;
        draft.registryItems = draft.registryItems.filter((i) => !i.isSample);
        draft.invitationCodes = draft.invitationCodes.filter((i) => !i.isSample);
        draft.seatingTables = draft.seatingTables.filter((i) => !i.isSample);
        draft.weddingParty = draft.weddingParty.filter((i) => !i.isSample);
        draft.attractions = draft.attractions.filter((i) => !i.isSample);
        draft.contentNodes = draft.contentNodes.filter((i) => !i.isSample);
      });
      return jsonResponse({ success: true });
    }
  }

  // --- Settings & Features ---
  if (normalizedPath === '/api/admin/settings') {
    if (method === 'GET') {
      if (searchParams.get('list') === 'true') {
        return jsonResponse([state.config]);
      }
      return jsonResponse(state.config);
    }
    const body = await readJsonBody(init, requestObj);
    const updated = updateDemoState((draft) => {
      Object.assign(draft.config, body);
      if (typeof body.weddingDate === 'string') {
        draft.config.weddingDate = new Date(body.weddingDate);
      }
      draft.versions.unshift({
        id: makeId('demo-version'),
        entityType: 'AppConfig',
        entityId: 'global',
        versionNumber: draft.versions.length + 1,
        author: 'Demo Admin',
        summary: 'Updated website settings & theme configuration',
        data: {
          themePreset: draft.config.themePreset,
          colorPrimary: draft.config.colorPrimary,
          venueName: draft.config.venueName,
        },
        createdAt: new Date().toISOString(),
      });
    });
    return jsonResponse(updated.config);
  }

  if (normalizedPath === '/api/admin/features') {
    if (method === 'GET') {
      return jsonResponse(state.config.siteSections);
    }
    const body = await readJsonBody(init, requestObj);
    const updated = updateDemoState((draft) => {
      const incoming = Array.isArray(body.features)
        ? body.features
        : Array.isArray(body)
          ? body
          : null;
      if (incoming) {
        draft.config.siteSections = incoming as DemoSiteSection[];
        (draft.config as unknown as { features?: DemoSiteSection[] }).features =
          draft.config.siteSections;
      } else if (typeof body.id === 'string' && typeof body.visible === 'boolean') {
        draft.config.siteSections = draft.config.siteSections.map((section) =>
          section.id === body.id ? { ...section, visible: Boolean(body.visible) } : section
        );
      } else if (typeof body.id === 'string' && typeof body.enabled === 'boolean') {
        draft.config.moduleToggles = draft.config.moduleToggles.map((f) =>
          f.id === body.id ? { ...f, enabled: Boolean(body.enabled) } : f
        );
        const modulePatch: Record<string, boolean> = {};
        for (const feat of draft.config.moduleToggles) {
          if (feat.id in draft.config.modules) {
            modulePatch[feat.id] = feat.enabled;
          }
        }
        draft.config.modules = {
          ...draft.config.modules,
          ...(modulePatch as Partial<typeof draft.config.modules>),
        };
      }
    });
    return jsonResponse({ success: true, features: updated.config.siteSections });
  }

  // --- Guest Auth, Lookup, Address, Schedule & RSVP ---
  if (normalizedPath === '/api/guest/login' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    const rawCode = String(body.passcode ?? body.code ?? '').trim();
    const matched =
      state.invitationCodes.find((i) => i.code.toLowerCase() === rawCode.toLowerCase()) ??
      state.invitationCodes[0];
    if (matched) {
      updateDemoState((draft) => {
        draft.guestSession = {
          invitationCodeId: matched.id,
          code: matched.code,
          guestName: matched.guestName,
          email: matched.email,
        };
      });
      return jsonResponse({
        success: true,
        sessionType: 'invitation',
        guestName: matched.guestName,
        code: matched.code,
      });
    }
    return jsonResponse({ success: true, sessionType: 'guest' });
  }

  if (normalizedPath === '/api/guest/lookup') {
    const body = method === 'POST' ? await readJsonBody(init, requestObj) : {};
    const q = String(
      body.query ?? body.name ?? body.email ?? searchParams.get('query') ?? ''
    )
      .trim()
      .toLowerCase();
    const matched =
      state.invitationCodes.find(
        (inv) =>
          inv.guestName.toLowerCase().includes(q) ||
          (inv.email?.toLowerCase().includes(q) ?? false) ||
          inv.code.toLowerCase() === q
      ) ?? state.invitationCodes[0];
    return jsonResponse({
      success: true,
      guestName: matched.guestName,
      code: matched.code,
      data: {
        guestName: matched.guestName,
        code: matched.code,
      },
    });
  }

  if (normalizedPath === '/api/guest/address' || normalizedPath === '/api/guest/address/public') {
    const activeInvite =
      state.invitationCodes.find((i) => i.code === state.guestSession.code) ??
      state.invitationCodes[0];
    if (method === 'GET') {
      return jsonResponse({
        success: true,
        data: {
          guestName: activeInvite?.guestName ?? 'Demo Guest',
          code: activeInvite?.code ?? 'DEMO2026',
          addressLine1: activeInvite?.addressLine1 ?? '',
          addressLine2: activeInvite?.addressLine2 ?? '',
          city: activeInvite?.city ?? '',
          state: activeInvite?.state ?? '',
          zipCode: activeInvite?.zipCode ?? '',
          country: activeInvite?.country ?? 'US',
        },
      });
    }
    const body = await readJsonBody(init, requestObj);
    let savedRecord = activeInvite;
    updateDemoState((draft) => {
      let target = draft.invitationCodes.find((i) => i.code === draft.guestSession.code);
      if (!target && normalizedPath.endsWith('/public')) {
        target = {
          id: makeId('demo-invite'),
          code: makeId('ADDR').toUpperCase().slice(0, 10),
          guestName: String(body.guestName ?? body.name ?? 'Visiting Friend'),
          email: typeof body.email === 'string' ? body.email : null,
          householdName: String(body.householdName ?? body.guestName ?? 'Guest Household'),
          partyGroup: 'Address Book',
          partyTags: ['address-collection'],
          used: false,
          plusOneAllocations: 0,
          plusOneFirstName: null,
          plusOneLastName: null,
          dietaryNotes: null,
          addressLine1: null,
          addressLine2: null,
          city: null,
          state: null,
          zipCode: null,
          country: 'US',
          addressUpdatedAt: new Date().toISOString(),
          tableId: null,
          seatNumber: null,
          allowedSubEventIds: [],
          extraFields: {},
          isSample: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        draft.invitationCodes.unshift(target);
      }
      if (target) {
        target.addressLine1 = String(body.addressLine1 ?? target.addressLine1 ?? '');
        target.addressLine2 = body.addressLine2 ? String(body.addressLine2) : null;
        target.city = String(body.city ?? target.city ?? '');
        target.state = String(body.state ?? target.state ?? '');
        target.zipCode = String(body.zipCode ?? body.zip ?? target.zipCode ?? '');
        target.country = String(body.country ?? target.country ?? 'US');
        target.addressUpdatedAt = new Date().toISOString();
        savedRecord = target;
      }
    });
    return jsonResponse({
      success: true,
      data: {
        guestName: savedRecord?.guestName ?? 'Guest',
        code: savedRecord?.code ?? 'DEMO2026',
        addressLine1: savedRecord?.addressLine1 ?? '',
        addressLine2: savedRecord?.addressLine2 ?? '',
        city: savedRecord?.city ?? '',
        state: savedRecord?.state ?? '',
        zipCode: savedRecord?.zipCode ?? '',
        country: savedRecord?.country ?? 'US',
      },
    });
  }

  if (normalizedPath === '/api/registry/session') {
    if (method === 'DELETE') {
      updateDemoState((draft) => {
        draft.guestSession = {
          invitationCodeId: '',
          code: '',
          guestName: '',
          email: null,
        };
      });
      return jsonResponse({
        isVerified: false,
        invitationCode: null,
        code: null,
        guestName: null,
      });
    }
    const verified = Boolean(state.guestSession.code);
    return jsonResponse({
      isVerified: verified,
      invitationCode: verified ? state.guestSession.code : null,
      code: verified ? state.guestSession.code : null,
      guestName: verified ? state.guestSession.guestName : null,
    });
  }

  if (normalizedPath === '/api/registry/validate-code') {
    const body = method === 'POST' ? await readJsonBody(init, requestObj) : {};
    const code = String(searchParams.get('code') ?? body.code ?? '')
      .trim()
      .toUpperCase();
    const invite =
      state.invitationCodes.find((i) => i.code.toUpperCase() === code) ??
      (code ? state.invitationCodes[0] : null);
    if (!invite) {
      return jsonResponse({ error: 'Invalid invitation code.' }, 404);
    }
    updateDemoState((draft) => {
      draft.guestSession = {
        invitationCodeId: invite.id,
        code: invite.code,
        guestName: invite.guestName,
        email: invite.email,
      };
    });
    return jsonResponse({
      valid: true,
      guestName: invite.guestName,
      code: invite.code,
    });
  }

  if (normalizedPath === '/api/schedule') {
    const activeInvite = state.invitationCodes.find(
      (i) => i.code === state.guestSession.code
    );
    const visibleEvents = state.subEvents
      .filter((se) => !se.isPrivate || (activeInvite?.allowedSubEventIds.includes(se.id) ?? true))
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((se) => {
        const guestRsvp = activeInvite
          ? state.subEventRsvps.find(
            (r) => r.invitationCodeId === activeInvite.id && r.subEventId === se.id
          )
          : undefined;
        return {
          ...se,
          rsvp: guestRsvp ?? null,
          guestRsvp: guestRsvp ?? null,
        };
      });
    return jsonResponse({
      success: true,
      data: visibleEvents,
      isGuest: Boolean(activeInvite),
      guestName: activeInvite?.guestName ?? null,
      plusOneAllocations: activeInvite?.plusOneAllocations ?? 1,
      savedPlusOneNames:
        activeInvite?.plusOneFirstName
          ? [`${activeInvite.plusOneFirstName} ${activeInvite.plusOneLastName ?? ''}`.trim()]
          : [],
      rsvpOpen: state.config.rsvpOpen,
      rsvpDeadlineDate: state.config.rsvpDeadlineDate,
      rsvpFormattedDeadline: 'September 20, 2026',
      timezone: state.config.timezone || 'America/New_York',
      rsvpClosedMessage: state.config.rsvpClosedMessage,
    });
  }

  const icsMatch = normalizedPath.match(/^\/api\/schedule\/([^/]+)\/ics$/);
  if (icsMatch) {
    const event =
      state.subEvents.find((se) => se.id === icsMatch[1]) ?? state.subEvents[0];
    const formatIcsDate = (iso: string) =>
      new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Wedding Platform Showcase//EN',
      'BEGIN:VEVENT',
      `UID:${event.id}@wedding-showcase.local`,
      `DTSTAMP:${formatIcsDate(new Date().toISOString())}`,
      `DTSTART:${formatIcsDate(event.startTime)}`,
      `DTEND:${formatIcsDate(event.endTime)}`,
      `SUMMARY:${event.title}`,
      `LOCATION:${event.location} - ${event.address}`,
      `DESCRIPTION:${event.description}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    return textResponse(ics, 'text/calendar; charset=utf-8', `${event.id}.ics`);
  }

  if (normalizedPath === '/api/rsvp' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    const submissions = Array.isArray(body.rsvps)
      ? (body.rsvps as Array<Record<string, unknown>>)
      : body.subEventId
        ? [body]
        : [];
    const saved: unknown[] = [];
    updateDemoState((draft) => {
      const invite =
        draft.invitationCodes.find((i) => i.code === draft.guestSession.code) ??
        draft.invitationCodes[0];
      if (!invite) return;
      invite.used = true;
      for (const item of submissions) {
        const subEventId = String(item.subEventId ?? '');
        if (!subEventId) continue;
        const status =
          item.status === 'attending' || item.status === 'declined' ? item.status : 'pending';
        let existing = draft.subEventRsvps.find(
          (r) => r.invitationCodeId === invite.id && r.subEventId === subEventId
        );
        if (!existing) {
          existing = {
            id: makeId('demo-rsvp'),
            invitationCodeId: invite.id,
            subEventId,
            status,
            plusOneCount: Number(item.plusOneCount ?? 0),
            plusOneNames: Array.isArray(item.plusOneNames) ? (item.plusOneNames as string[]) : [],
            mealSelections: Array.isArray(item.mealSelections)
              ? (item.mealSelections as string[])
              : [],
            dietaryNotes: typeof item.dietaryNotes === 'string' ? item.dietaryNotes : null,
            customAnswers:
              item.customAnswers && typeof item.customAnswers === 'object'
                ? (item.customAnswers as Record<string, string>)
                : {},
            updatedAt: new Date().toISOString(),
          };
          draft.subEventRsvps.push(existing);
        } else {
          existing.status = status;
          if (item.plusOneCount !== undefined) existing.plusOneCount = Number(item.plusOneCount);
          if (Array.isArray(item.plusOneNames)) existing.plusOneNames = item.plusOneNames as string[];
          if (Array.isArray(item.mealSelections)) {
            existing.mealSelections = item.mealSelections as string[];
          }
          if (item.dietaryNotes !== undefined) {
            existing.dietaryNotes = typeof item.dietaryNotes === 'string' ? item.dietaryNotes : null;
          }
          if (item.customAnswers && typeof item.customAnswers === 'object') {
            existing.customAnswers = item.customAnswers as Record<string, string>;
          }
          existing.updatedAt = new Date().toISOString();
        }
        invite.extraFields.attendanceStatus = status;
        saved.push(existing);
      }
    });
    return jsonResponse({ success: true, data: saved });
  }

  // --- Registry & Contributions ---
  if (normalizedPath === '/api/registry/capabilities') {
    return jsonResponse({
      success: true,
      data: {
        cardCheckoutEnabled: false,
        stripePublishableKey: null,
        defaultPaymentHandle: state.config.defaultPaymentHandle,
        defaultPaymentHandleType: state.config.defaultPaymentHandleType,
        shippingAddress: {
          recipientName: state.config.shippingRecipientName,
          addressLine1: state.config.shippingAddressLine1,
          city: state.config.shippingCity,
          state: state.config.shippingState,
          zip: state.config.shippingZip,
          country: state.config.shippingCountry,
        },
      },
    });
  }

  if (normalizedPath === '/api/registry/payment-intent' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    return jsonResponse({
      clientSecret: 'pi_demo_secret_showcase',
      paymentIntentId: makeId('pi_demo'),
      amount: Number(body.amount ?? 50),
    });
  }

  if (normalizedPath === '/api/registry/scrape' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    const rawTarget = String(body.url ?? 'https://example.com/artisan-serving-bowl');
    return jsonResponse({
      title: 'Artisan Olivewood Serving Bowl',
      name: 'Artisan Olivewood Serving Bowl',
      description: `Hand-carved serving bowl imported from ${rawTarget}`,
      price: 95,
      imageUrl: '/images/sample-registry-ceramics.jpg',
      vendorUrl: rawTarget,
      category: 'Dining',
    });
  }

  if (normalizedPath === '/api/registry/scrape/batch' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    const urls = Array.isArray(body.urls) ? (body.urls as string[]) : [];
    const results = urls.map((url, idx) => ({
      url,
      success: true,
      data: {
        title: `Curated Registry Gift #${idx + 1}`,
        name: `Curated Registry Gift #${idx + 1}`,
        description: 'Scraped gift preview generated by interactive demo runtime.',
        price: 85 + idx * 25,
        imageUrl: '/images/sample-registry-dinnerware.jpg',
        vendorUrl: url,
        category: 'Home',
      },
    }));
    return jsonResponse({ success: true, results });
  }

  if (normalizedPath === '/api/registry' || normalizedPath === '/api/registry/items') {
    if (method === 'GET') {
      const category = searchParams.get('category');
      const minPrice = searchParams.get('minPrice');
      const maxPrice = searchParams.get('maxPrice');
      const page = Math.max(1, Number(searchParams.get('page') ?? 1));
      const limit = Math.max(1, Number(searchParams.get('limit') ?? searchParams.get('pageSize') ?? 50));

      let filtered = [...state.registryItems];
      if (category && category !== 'All') {
        filtered = filtered.filter((item) => item.category === category);
      }
      if (minPrice !== null && minPrice !== '') {
        filtered = filtered.filter((item) => item.price >= Number(minPrice));
      }
      if (maxPrice !== null && maxPrice !== '') {
        filtered = filtered.filter((item) => item.price <= Number(maxPrice));
      }
      filtered.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

      const total = filtered.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const paged = filtered.slice((page - 1) * limit, page * limit);
      const items = state.isAdmin
        ? paged.map((i) => sanitizeRegistryItem(i))
        : paged.map((i) => maskRegistryItem(i));

      return jsonResponse({
        items,
        total,
        page,
        limit,
        totalPages,
      });
    }

    if (method === 'POST') {
      const body = await readJsonBody(init, requestObj);
      let created: RegistryItem | undefined;
      updateDemoState((draft) => {
        const isCash = body.itemType === 'CASH_FUND' || body.itemType === 'EXPERIENCE_FUND';
        const price = Number(body.price ?? body.goalAmount ?? 100);
        const newItem: RegistryItem = {
          id: makeId('demo-reg'),
          name: String(body.name ?? 'New Registry Gift'),
          description: String(body.description ?? ''),
          price,
          quantity: Number(body.quantity ?? 1),
          purchased: false,
          purchaserName: null,
          imageUrl: String(body.imageUrl || '/images/sample-registry-ceramics.jpg'),
          imageAlt: String(body.imageAlt || body.name || 'Registry item'),
          vendorUrl: String(body.vendorUrl ?? ''),
          category: String(body.category ?? 'Home'),
          isGroupGift: Boolean(body.isGroupGift ?? isCash),
          amountContributed: 0,
          contributors: [],
          itemType: (body.itemType as RegistryItem['itemType']) ?? 'PHYSICAL',
          isMostWanted: Boolean(body.isMostWanted),
          isSample: false,
          displayOrder: draft.registryItems.length,
          paymentHandleType: isCash ? 'Venmo' : null,
          paymentHandle: isCash ? draft.config.defaultPaymentHandle : null,
        };
        draft.registryItems.push(newItem);
        created = newItem;
      });
      return jsonResponse(created, 201);
    }
  }

  if (normalizedPath === '/api/registry/items/batch' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    const incoming = Array.isArray(body.items) ? (body.items as Array<Record<string, unknown>>) : [];
    const createdItems: RegistryItem[] = [];
    updateDemoState((draft) => {
      incoming.forEach((entry, idx) => {
        const price = Number(entry.price ?? 100);
        const item: RegistryItem = {
          id: makeId('demo-reg'),
          name: String(entry.name ?? `Imported Gift ${idx + 1}`),
          description: String(entry.description ?? ''),
          price,
          quantity: Number(entry.quantity ?? 1),
          purchased: false,
          purchaserName: null,
          imageUrl: String(entry.imageUrl || '/images/sample-registry-dinnerware.jpg'),
          imageAlt: String(entry.imageAlt || entry.name || 'Registry gift'),
          vendorUrl: String(entry.vendorUrl ?? ''),
          category: String(entry.category ?? 'Home'),
          isGroupGift: Boolean(entry.isGroupGift),
          amountContributed: 0,
          contributors: [],
          itemType: (entry.itemType as RegistryItem['itemType']) ?? 'PHYSICAL',
          isMostWanted: Boolean(entry.isMostWanted),
          isSample: false,
          displayOrder: draft.registryItems.length + idx,
          paymentHandleType: null,
          paymentHandle: null,
        };
        draft.registryItems.push(item);
        createdItems.push(item);
      });
    });
    return jsonResponse({ success: true, count: createdItems.length, items: createdItems }, 201);
  }

  const registryItemMatch = normalizedPath.match(/^\/api\/registry\/items\/([^/]+)$/);
  if (registryItemMatch) {
    const itemId = decodeURIComponent(registryItemMatch[1]);
    if (method === 'GET') {
      const found = state.registryItems.find((i) => i.id === itemId);
      if (!found) return jsonResponse({ error: 'Item not found' }, 404);
      return jsonResponse(state.isAdmin ? sanitizeRegistryItem(found) : maskRegistryItem(found));
    }
    if (method === 'PUT' || method === 'PATCH') {
      const body = await readJsonBody(init, requestObj);
      let updatedItem: RegistryItem | undefined;
      updateDemoState((draft) => {
        const target = draft.registryItems.find((i) => i.id === itemId);
        if (!target) return;
        Object.assign(target, body, { id: target.id });
        updatedItem = target;
      });
      if (!updatedItem) return jsonResponse({ error: 'Item not found' }, 404);
      return jsonResponse(sanitizeRegistryItem(updatedItem));
    }
    if (method === 'DELETE') {
      updateDemoState((draft) => {
        draft.registryItems = draft.registryItems.filter((i) => i.id !== itemId);
      });
      return jsonResponse({ success: true });
    }
  }

  if (normalizedPath === '/api/registry/contribute' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    const itemId = String(body.itemId ?? '');
    const contributorName = String(body.name ?? state.guestSession.guestName ?? 'Demo Guest');
    const contributorEmail = typeof body.email === 'string' ? body.email : state.guestSession.email ?? 'guest@example.com';
    const message = typeof body.message === 'string' ? body.message : '';
    const isReservation = Boolean(body.isReservation);
    let responseItem: RegistryItem | undefined;
    let contribId = '';

    updateDemoState((draft) => {
      const item = draft.registryItems.find((i) => i.id === itemId);
      if (!item) return;
      const amount = Number(body.amount ?? item.price ?? 50);
      contribId = makeId('demo-contrib');
      const newContributor: ContributorRecord = {
        id: contribId,
        name: contributorName,
        email: contributorEmail,
        isPlusOne: false,
        message,
        amount,
        refundedAmount: 0,
        status: isReservation ? 'RESERVED' : 'CONFIRMED',
        coverFee: false,
        feeAmount: 0,
        date: new Date().toISOString(),
        transactionTimestamp: null,
        thankYouStatus: 'Unsent',
        thankYouSentAt: null,
        thankYouNote: null,
        registryItemId: item.id,
        ...(typeof body.retailerOrderNumber === 'string'
          ? { retailerOrderNumber: body.retailerOrderNumber }
          : {}),
        ...(typeof body.carrier === 'string' ? { carrier: body.carrier } : {}),
        ...(typeof body.trackingNumber === 'string'
          ? { trackingNumber: body.trackingNumber }
          : {}),
      };
      if (!Array.isArray(item.contributors)) {
        item.contributors = [];
      }
      item.contributors.push(newContributor);
      if (!isReservation && item.itemType === 'PHYSICAL') {
        item.purchased = true;
      }
      recalcRegistryItemTotals(item);
      responseItem = JSON.parse(JSON.stringify(item)) as RegistryItem;
    });

    if (!responseItem) {
      return jsonResponse({ error: 'Registry item not found.' }, 404);
    }

    const masked = maskRegistryItem({ ...responseItem, contributors: [] });
    return jsonResponse({
      ...masked,
      claimActions: {
        confirmToken: `demo-confirm-${contribId}`,
        cancelToken: `demo-cancel-${contribId}`,
      },
    });
  }

  if (normalizedPath === '/api/registry/claim') {
    const rawToken =
      method === 'GET'
        ? String(searchParams.get('token') ?? '')
        : String((await readJsonBody(init, requestObj)).token ?? '');
    const tokenMatch = rawToken.match(/^demo-(confirm|cancel)-(.+)$/);
    if (!tokenMatch) {
      return jsonResponse({ error: 'Invalid or expired claim link.' }, 401);
    }
    const action = tokenMatch[1] as 'confirm' | 'cancel';
    const targetContribId = tokenMatch[2];

    if (method === 'GET') {
      for (const item of state.registryItems) {
        const contrib = (item.contributors ?? []).find((c) => c.id === targetContribId);
        if (contrib) {
          return jsonResponse({
            action,
            status: contrib.status ?? 'RESERVED',
            amount: contrib.amount,
            itemId: item.id,
            itemName: item.name,
            itemType: item.itemType ?? 'PHYSICAL',
            isGroupGift: Boolean(item.isGroupGift),
            vendorUrl: item.vendorUrl ?? null,
            paymentHandle: state.config.defaultPaymentHandle,
            paymentHandleType: state.config.defaultPaymentHandleType,
          });
        }
      }
      return jsonResponse({ error: 'Gift reservation not found.' }, 404);
    }

    let mutatedItem: RegistryItem | undefined;
    let nextStatus: ContributorRecord['status'] = 'CONFIRMED';
    updateDemoState((draft) => {
      for (const item of draft.registryItems) {
        const contrib = (item.contributors ?? []).find((c) => c.id === targetContribId);
        if (contrib) {
          nextStatus = action === 'confirm' ? 'CONFIRMED' : 'CANCELLED';
          contrib.status = nextStatus;
          recalcRegistryItemTotals(item);
          mutatedItem = item;
          break;
        }
      }
    });
    if (!mutatedItem) return jsonResponse({ error: 'Gift reservation not found.' }, 404);
    return jsonResponse({
      action,
      status: nextStatus,
      changed: true,
      item: maskRegistryItem(mutatedItem),
    });
  }

  const adminUnclaimMatch = normalizedPath.match(/^\/api\/admin\/registry\/items\/([^/]+)\/unclaim$/);
  if (adminUnclaimMatch && method === 'POST') {
    const itemId = decodeURIComponent(adminUnclaimMatch[1]);
    let updatedItem: RegistryItem | undefined;
    updateDemoState((draft) => {
      const target = draft.registryItems.find((i) => i.id === itemId);
      if (!target) return;
      target.purchased = false;
      target.purchaserName = null;
      for (const c of target.contributors ?? []) {
        if (c.status === 'CONFIRMED' || c.status === 'RESERVED') {
          c.status = 'CANCELLED';
        }
      }
      recalcRegistryItemTotals(target);
      updatedItem = target;
    });
    if (!updatedItem) {
      return jsonResponse({ error: 'Registry item not found.' }, 404);
    }
    return jsonResponse({ item: sanitizeRegistryItem(updatedItem) });
  }

  const contribActionMatch = normalizedPath.match(/^\/api\/admin\/contributors\/([^/]+)\/action$/);
  if (contribActionMatch && method === 'POST') {
    const contribId = decodeURIComponent(contribActionMatch[1]);
    const body = await readJsonBody(init, requestObj);
    const action = String(body.action ?? 'confirm');
    let foundContrib: ContributorRecord | undefined;
    let foundItem: RegistryItem | undefined;

    updateDemoState((draft) => {
      for (const item of draft.registryItems) {
        const contrib = (item.contributors ?? []).find((c) => c.id === contribId);
        if (contrib) {
          if (action === 'confirm') contrib.status = 'CONFIRMED';
          else if (action === 'void') contrib.status = 'CANCELLED';
          else if (action === 'remind') contrib.reminderEmailSentAt = new Date().toISOString();
          recalcRegistryItemTotals(item);
          foundContrib = contrib;
          foundItem = item;
          break;
        }
      }
    });
    if (!foundContrib || !foundItem) {
      return jsonResponse({ error: 'Contribution not found.' }, 404);
    }
    return jsonResponse({
      action,
      changed: true,
      contributor: foundContrib,
      item: sanitizeRegistryItem(foundItem),
    });
  }

  const contribIdMatch = normalizedPath.match(/^\/api\/admin\/contributors\/([^/]+)$/);
  if (contribIdMatch && (method === 'PATCH' || method === 'DELETE')) {
    const contribId = decodeURIComponent(contribIdMatch[1]);
    if (method === 'PATCH') {
      const body = await readJsonBody(init, requestObj);
      let updatedContrib: ContributorRecord | undefined;
      let updatedItem: RegistryItem | undefined;
      updateDemoState((draft) => {
        for (const item of draft.registryItems) {
          const contrib = (item.contributors ?? []).find((c) => c.id === contribId);
          if (contrib) {
            if (typeof body.name === 'string') contrib.name = body.name.trim();
            if (body.email !== undefined) {
              contrib.email = body.email ? String(body.email).trim() : null;
            }
            if (body.amount !== undefined) contrib.amount = Number(body.amount);
            if (typeof body.status === 'string') {
              contrib.status = body.status as ContributorRecord['status'];
            }
            if (body.message !== undefined) {
              contrib.message = body.message ? String(body.message) : null;
            }
            recalcRegistryItemTotals(item);
            updatedContrib = contrib;
            updatedItem = item;
            break;
          }
        }
      });
      if (!updatedContrib || !updatedItem) {
        return jsonResponse({ error: 'Contribution not found.' }, 404);
      }
      return jsonResponse({
        contributor: updatedContrib,
        item: sanitizeRegistryItem(updatedItem),
      });
    }

    let deletedFromItem: RegistryItem | undefined;
    let deleted = false;
    updateDemoState((draft) => {
      for (const item of draft.registryItems) {
        const before = (item.contributors ?? []).length;
        if (before === 0) continue;
        const remaining = (item.contributors ?? []).filter((c) => c.id !== contribId);
        if (remaining.length !== before) {
          item.contributors = remaining;
          recalcRegistryItemTotals(item);
          deletedFromItem = item;
          deleted = true;
          break;
        }
      }
    });
    if (!deleted) {
      return jsonResponse({ error: 'Contribution not found.' }, 404);
    }
    return jsonResponse({
      deletedId: contribId,
      item: deletedFromItem ? sanitizeRegistryItem(deletedFromItem) : null,
    });
  }

  // --- Thank-You Notes ---
  if (normalizedPath === '/api/admin/thank-you-notes' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    let createdGift: Record<string, unknown> | null = null;
    updateDemoState((draft) => {
      const targetItem =
        draft.registryItems.find((i) => i.id === body.registryItemId) ?? draft.registryItems[0];
      if (!targetItem) return;
      const newContrib: ContributorRecord = {
        id: makeId('demo-contrib'),
        name: String(body.name ?? 'Offline Guest').trim(),
        email: body.email ? String(body.email).trim() : null,
        isPlusOne: false,
        amount: Number(body.amount ?? 100),
        refundedAmount: 0,
        status: 'CONFIRMED',
        coverFee: false,
        feeAmount: 0,
        message: body.message ? String(body.message) : null,
        date: body.date ? new Date(String(body.date)).toISOString() : new Date().toISOString(),
        transactionTimestamp: null,
        thankYouStatus: typeof body.thankYouStatus === 'string' ? body.thankYouStatus : 'Unsent',
        thankYouSentAt: body.thankYouStatus === 'Sent' ? new Date().toISOString() : null,
        thankYouNote: body.thankYouNote ? String(body.thankYouNote) : null,
        registryItemId: targetItem.id,
      };
      if (!Array.isArray(targetItem.contributors)) {
        targetItem.contributors = [];
      }
      targetItem.contributors.unshift(newContrib);
      createdGift = {
        ...newContrib,
        registryItem: {
          id: targetItem.id,
          name: targetItem.name,
          category: targetItem.category,
        },
        invitationCodeId: null,
        invitationCode: null,
      };
    });
    return jsonResponse({ success: true, item: createdGift }, 201);
  }
  if (normalizedPath === '/api/admin/thank-you-notes/export') {
    const rows = ['Contributor,Email,Gift,Amount,Status,ThankYouStatus,Address'];
    for (const item of state.registryItems) {
      for (const c of item.contributors ?? []) {
        rows.push(
          [
            csvEscape(c.name),
            csvEscape(c.email ?? ''),
            csvEscape(item.name),
            csvEscape(c.amount),
            csvEscape(c.status ?? 'CONFIRMED'),
            csvEscape(c.thankYouStatus ?? 'Unsent'),
            csvEscape('100 Maple Avenue, Hudson, NY 12534'),
          ].join(',')
        );
      }
    }
    return textResponse(rows.join('\n'), 'text/csv; charset=utf-8', 'thank-you-notes.csv');
  }

  if (normalizedPath === '/api/admin/thank-you-notes/export-labels') {
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Mailing Labels</title></head><body><h1>Demo Mailing Labels</h1><p>Jordan Rivera — 100 Maple Avenue, Hudson, NY 12534</p></body></html>';
    return textResponse(html, 'text/html; charset=utf-8', 'mailing-labels.html');
  }

  if (normalizedPath === '/api/admin/thank-you-notes/batch' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    const ids = new Set(Array.isArray(body.ids) ? (body.ids as string[]) : []);
    const status = String(body.thankYouStatus ?? body.status ?? 'Sent');
    let updatedCount = 0;
    updateDemoState((draft) => {
      for (const item of draft.registryItems) {
        for (const c of item.contributors ?? []) {
          if (c.id && ids.has(c.id)) {
            c.thankYouStatus = status;
            if (status === 'Sent') c.thankYouSentAt = new Date().toISOString();
            updatedCount += 1;
          }
        }
      }
    });
    return jsonResponse({ success: true, updatedCount });
  }

  const thankYouItemMatch = normalizedPath.match(/^\/api\/admin\/thank-you-notes\/([^/]+)$/);
  if (thankYouItemMatch && (method === 'PATCH' || method === 'PUT')) {
    const targetId = decodeURIComponent(thankYouItemMatch[1]);
    const body = await readJsonBody(init, requestObj);
    let updatedRecord: ContributorRecord | null = null;
    updateDemoState((draft) => {
      for (const item of draft.registryItems) {
        const c = (item.contributors ?? []).find((entry) => entry.id === targetId);
        if (c) {
          if (typeof body.thankYouStatus === 'string') {
            c.thankYouStatus = body.thankYouStatus;
            c.thankYouSentAt = body.thankYouStatus === 'Sent' ? new Date().toISOString() : null;
          }
          if (body.thankYouNote !== undefined) {
            c.thankYouNote = body.thankYouNote ? String(body.thankYouNote) : undefined;
          }
          updatedRecord = c;
          break;
        }
      }
    });
    return jsonResponse({ success: true, item: updatedRecord });
  }

  if (normalizedPath === '/api/admin/thank-you-notes') {
    const statusFilter = searchParams.get('status');
    const search = (searchParams.get('search') ?? '').trim().toLowerCase();
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const pageSize = Math.max(1, Number(searchParams.get('pageSize') ?? 25));

    const allRows = state.registryItems.flatMap((item) =>
      (item.contributors ?? []).map((c, idx) => {
        const matchedInvite =
          state.invitationCodes.find(
            (inv) =>
              inv.guestName.toLowerCase().includes(c.name.toLowerCase()) ||
              (c.email && inv.email?.toLowerCase() === c.email.toLowerCase())
          ) ?? state.invitationCodes[0];
        return {
          id: c.id ?? `contrib-${item.id}-${idx}`,
          name: c.name,
          email: c.email ?? null,
          message: c.message ?? null,
          amount: c.amount,
          refundedAmount: c.refundedAmount ?? 0,
          status: c.status ?? 'CONFIRMED',
          reminderEmailSentAt: c.reminderEmailSentAt ?? null,
          date: typeof c.date === 'string' ? c.date : new Date().toISOString(),
          thankYouStatus: c.thankYouStatus ?? 'Unsent',
          thankYouSentAt: c.thankYouSentAt ? String(c.thankYouSentAt) : null,
          thankYouNote: c.thankYouNote ?? null,
          registryItemId: item.id,
          registryItem: {
            id: item.id,
            name: item.name,
            category: item.category,
          },
          invitationCodeId: matchedInvite?.id ?? null,
          invitationCode: matchedInvite
            ? {
              id: matchedInvite.id,
              code: matchedInvite.code,
              guestName: matchedInvite.guestName,
              addressLine1: matchedInvite.addressLine1,
              addressLine2: matchedInvite.addressLine2,
              city: matchedInvite.city,
              state: matchedInvite.state,
              zipCode: matchedInvite.zipCode,
              country: matchedInvite.country,
            }
            : null,
        };
      })
    );

    const total = allRows.length;
    const sent = allRows.filter((r) => r.thankYouStatus === 'Sent').length;
    const notNeeded = allRows.filter((r) => r.thankYouStatus === 'Not Needed').length;
    const unsent = Math.max(0, total - sent - notNeeded);
    const actionable = Math.max(0, total - notNeeded);
    const completionPercentage = actionable > 0 ? Math.round((sent / actionable) * 100) : 100;

    let filtered = allRows;
    if (statusFilter && statusFilter !== 'All') {
      filtered = filtered.filter((r) => r.thankYouStatus === statusFilter);
    }
    if (search) {
      filtered = filtered.filter(
        (r) =>
          r.name.toLowerCase().includes(search) ||
          (r.registryItem?.name.toLowerCase().includes(search) ?? false)
      );
    }

    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

    return jsonResponse({
      success: true,
      items: paged,
      metrics: {
        total,
        sent,
        unsent,
        notNeeded,
        thanked: sent,
        completionPercentage,
      },
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
    });
  }

  // --- Sub-Events Specialized Routes ---
  if (normalizedPath === '/api/admin/sub-events/rsvp-summary') {
    return jsonResponse({
      success: true,
      data: buildRsvpSummary(state),
    });
  }

  if (
    normalizedPath === '/api/admin/sub-events/access' ||
    normalizedPath === '/api/admin/sub-events/access/batch'
  ) {
    if (method === 'GET') {
      const page = Math.max(1, Number(searchParams.get('page') ?? 1));
      const limit = Math.max(1, Number(searchParams.get('limit') ?? 25));
      const search = (searchParams.get('search') ?? '').trim().toLowerCase();
      let codes = [...state.invitationCodes];
      if (search) {
        codes = codes.filter(
          (inv) =>
            inv.guestName.toLowerCase().includes(search) ||
            inv.code.toLowerCase().includes(search)
        );
      }
      const total = codes.length;
      const paged = codes.slice((page - 1) * limit, page * limit).map((inv) => ({
        ...inv,
        accesses: inv.allowedSubEventIds.map((subEventId) => ({
          invitationCodeId: inv.id,
          subEventId,
        })),
      }));
      const partyTags = Array.from(new Set(state.invitationCodes.flatMap((i) => i.partyTags)));
      const partyGroups = Array.from(
        new Set(state.invitationCodes.map((i) => i.partyGroup).filter((v): v is string => Boolean(v)))
      );
      const householdNames = Array.from(
        new Set(state.invitationCodes.map((i) => i.householdName).filter((v): v is string => Boolean(v)))
      );

      return jsonResponse({
        success: true,
        data: {
          subEvents: state.subEvents,
          invitationCodes: paged,
          pagination: {
            total,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(total / limit)),
          },
          filterOptions: {
            partyTags,
            partyGroups,
            householdNames,
          },
        },
      });
    }

    const body = await readJsonBody(init, requestObj);
    let updatedCount = 0;
    updateDemoState((draft) => {
      const targetIds = Array.isArray(body.invitationCodeIds)
        ? new Set(body.invitationCodeIds as string[])
        : typeof body.invitationCodeId === 'string'
          ? new Set([body.invitationCodeId])
          : null;
      const subEventIds = Array.isArray(body.subEventIds)
        ? (body.subEventIds as string[])
        : typeof body.subEventId === 'string'
          ? [body.subEventId]
          : [];
      const action = String(body.action ?? (body.hasAccess === false ? 'revoke' : 'grant'));

      for (const inv of draft.invitationCodes) {
        if (targetIds && !targetIds.has(inv.id)) continue;
        const set = new Set(inv.allowedSubEventIds);
        if (action === 'set') {
          inv.allowedSubEventIds = [...subEventIds];
        } else if (action === 'revoke') {
          subEventIds.forEach((id) => set.delete(id));
          inv.allowedSubEventIds = Array.from(set);
        } else {
          subEventIds.forEach((id) => set.add(id));
          inv.allowedSubEventIds = Array.from(set);
        }
        updatedCount += 1;
      }
    });
    return jsonResponse({ success: true, updatedCount });
  }

  // --- Invitation Codes Specialized Routes ---
  if (normalizedPath === '/api/admin/invitation-codes/export') {
    const header = 'Code,GuestName,Email,Household,PartyGroup,Tags,Attendance,TableId,SeatNumber';
    const lines = state.invitationCodes.map((inv) =>
      [
        csvEscape(inv.code),
        csvEscape(inv.guestName),
        csvEscape(inv.email ?? ''),
        csvEscape(inv.householdName ?? ''),
        csvEscape(inv.partyGroup ?? ''),
        csvEscape(inv.partyTags.join(';')),
        csvEscape(getGuestAttendance(inv, state)),
        csvEscape(inv.tableId ?? ''),
        csvEscape(inv.seatNumber ?? ''),
      ].join(',')
    );
    return textResponse([header, ...lines].join('\n'), 'text/csv; charset=utf-8', 'invitation-codes.csv');
  }

  if (normalizedPath === '/api/admin/invitation-codes/catalog') {
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const limit = Math.max(1, Number(searchParams.get('limit') ?? 50));
    const search = (searchParams.get('search') ?? '').trim().toLowerCase();
    const attendance = searchParams.get('attendanceStatus');

    let items = state.invitationCodes.map((inv) => {
      const rsvps = state.subEventRsvps
        .filter((r) => r.invitationCodeId === inv.id)
        .map((r) => {
          const se = state.subEvents.find((s) => s.id === r.subEventId);
          return {
            ...r,
            subEventTitle: se?.title ?? 'Event',
          };
        });
      return {
        ...inv,
        attendanceStatus: getGuestAttendance(inv, state),
        subEventRsvps: rsvps,
      };
    });

    if (search) {
      items = items.filter(
        (inv) =>
          inv.guestName.toLowerCase().includes(search) ||
          inv.code.toLowerCase().includes(search) ||
          (inv.householdName?.toLowerCase().includes(search) ?? false)
      );
    }
    if (attendance && attendance !== 'all') {
      items = items.filter((inv) => inv.attendanceStatus === attendance);
    }

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const paged = items.slice((page - 1) * limit, page * limit);

    return jsonResponse({
      items: paged,
      total,
      page,
      limit,
      totalPages,
    });
  }

  if (normalizedPath === '/api/admin/invitation-codes/rsvps') {
    if (method === 'GET') {
      const invId = searchParams.get('invitationCodeId') ?? state.invitationCodes[0]?.id;
      const inv = state.invitationCodes.find((i) => i.id === invId) ?? state.invitationCodes[0];
      if (!inv) return jsonResponse({ error: 'Invitation not found' }, 404);
      return jsonResponse({
        success: true,
        data: {
          invitationCode: inv,
          subEvents: state.subEvents.map((se) => ({
            id: se.id,
            title: se.title,
            isPrivate: se.isPrivate,
            hasAccess: !se.isPrivate || inv.allowedSubEventIds.includes(se.id),
            mealOptions: se.mealOptions,
            customQuestions: se.customQuestions,
          })),
          rsvps: state.subEventRsvps.filter((r) => r.invitationCodeId === inv.id),
        },
      });
    }

    const body = await readJsonBody(init, requestObj);
    updateDemoState((draft) => {
      if (Array.isArray(body.invitationCodeIds)) {
        const ids = new Set(body.invitationCodeIds as string[]);
        const nextStatus = String(body.status ?? 'attending');
        for (const inv of draft.invitationCodes) {
          if (!ids.has(inv.id)) continue;
          if (nextStatus === 'clear') {
            inv.used = false;
            inv.extraFields.attendanceStatus = 'pending';
            draft.subEventRsvps = draft.subEventRsvps.filter((r) => r.invitationCodeId !== inv.id);
          } else {
            inv.used = nextStatus !== 'pending';
            inv.extraFields.attendanceStatus = nextStatus;
          }
        }
      } else if (typeof body.invitationCodeId === 'string') {
        const inv = draft.invitationCodes.find((i) => i.id === body.invitationCodeId);
        if (!inv) return;
        if (typeof body.overallAttendanceStatus === 'string') {
          inv.extraFields.attendanceStatus = body.overallAttendanceStatus;
          inv.used = body.overallAttendanceStatus !== 'pending';
        }
        if (Array.isArray(body.rsvps)) {
          for (const item of body.rsvps as Array<Record<string, unknown>>) {
            const seId = String(item.subEventId ?? '');
            const status = String(item.status ?? 'attending');
            if (status === 'clear') {
              draft.subEventRsvps = draft.subEventRsvps.filter(
                (r) => !(r.invitationCodeId === inv.id && r.subEventId === seId)
              );
              continue;
            }
            const validStatus =
              status === 'attending' || status === 'declined' ? status : 'pending';
            let rsvp = draft.subEventRsvps.find(
              (r) => r.invitationCodeId === inv.id && r.subEventId === seId
            );
            if (!rsvp) {
              rsvp = {
                id: makeId('demo-rsvp'),
                invitationCodeId: inv.id,
                subEventId: seId,
                status: validStatus,
                plusOneCount: Number(item.plusOneCount ?? 0),
                plusOneNames: Array.isArray(item.plusOneNames) ? (item.plusOneNames as string[]) : [],
                mealSelections: Array.isArray(item.mealSelections)
                  ? (item.mealSelections as string[])
                  : [],
                dietaryNotes: typeof item.dietaryNotes === 'string' ? item.dietaryNotes : null,
                customAnswers:
                  item.customAnswers && typeof item.customAnswers === 'object'
                    ? (item.customAnswers as Record<string, string>)
                    : {},
                updatedAt: new Date().toISOString(),
              };
              draft.subEventRsvps.push(rsvp);
            } else {
              rsvp.status = validStatus;
              rsvp.updatedAt = new Date().toISOString();
            }
          }
        }
      }
    });
    return jsonResponse({ success: true });
  }

  if (
    normalizedPath === '/api/admin/invitation-codes/validate' ||
    normalizedPath === '/api/admin/invitation-codes/batch/validate'
  ) {
    const body = await readJsonBody(init, requestObj);
    const rows = Array.isArray(body.records)
      ? (body.records as Array<Record<string, unknown>>)
      : Array.isArray(body.rows)
        ? (body.rows as Array<Record<string, unknown>>)
        : [];
    const validatedRows = rows.map((row, index) => ({
      rowIndex: index + 1,
      valid: true,
      errors: [],
      warnings: [],
      normalized: row,
    }));
    return jsonResponse({
      valid: true,
      summary: {
        total: validatedRows.length,
        valid: validatedRows.length,
        invalid: 0,
        collisions: 0,
        duplicateInFile: 0,
        existingInDb: 0,
      },
      rows: validatedRows,
      records: validatedRows,
    });
  }

  if (normalizedPath === '/api/admin/invitation-codes/merge' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    const primaryId = String(body.primaryId ?? '');
    const secondaryIds = new Set(
      Array.isArray(body.secondaryIds) ? (body.secondaryIds as string[]) : []
    );
    let primary: DemoInvitationCode | null = null;
    updateDemoState((draft) => {
      const target = draft.invitationCodes.find((i) => i.id === primaryId);
      if (!target) return;
      const secondaries = draft.invitationCodes.filter((i) => secondaryIds.has(i.id));
      const mergedTags = new Set(target.partyTags);
      for (const sec of secondaries) {
        sec.partyTags.forEach((t) => mergedTags.add(t));
      }
      target.partyTags = Array.from(mergedTags);
      draft.invitationCodes = draft.invitationCodes.filter((i) => !secondaryIds.has(i.id));
      primary = target;
    });
    return jsonResponse({
      success: true,
      primary,
      record: primary,
      mergedCount: secondaryIds.size,
      deletedCount: secondaryIds.size,
    });
  }

  if (normalizedPath === '/api/admin/invitation-codes/batch' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    if (body.action === 'delete' || (!body.tags && !body.records && Array.isArray(body.ids))) {
      const ids = new Set(body.ids as string[]);
      updateDemoState((draft) => {
        draft.invitationCodes = draft.invitationCodes.filter((i) => !ids.has(i.id));
      });
      return jsonResponse({ success: true, deletedCount: ids.size, count: ids.size });
    }
    if (Array.isArray(body.tags) && Array.isArray(body.ids)) {
      const ids = new Set(body.ids as string[]);
      const tags = body.tags as string[];
      const tagAction = String(body.action ?? 'add');
      updateDemoState((draft) => {
        for (const inv of draft.invitationCodes) {
          if (!ids.has(inv.id)) continue;
          const set = new Set(inv.partyTags);
          if (tagAction === 'remove') tags.forEach((t) => set.delete(t));
          else if (tagAction === 'replace' || tagAction === 'set') inv.partyTags = [...tags];
          else tags.forEach((t) => set.add(t));
          if (tagAction !== 'replace' && tagAction !== 'set') inv.partyTags = Array.from(set);
        }
      });
      return jsonResponse({ success: true, updatedCount: ids.size, count: ids.size });
    }
    const incoming = Array.isArray(body.records)
      ? (body.records as Array<Record<string, unknown>>)
      : [];
    const created: DemoInvitationCode[] = [];
    updateDemoState((draft) => {
      const publicSubEvents = draft.subEvents.filter((s) => !s.isPrivate).map((s) => s.id);
      incoming.forEach((row) => {
        const record: DemoInvitationCode = {
          id: makeId('demo-invite'),
          code: String(row.code ?? makeId('GUEST').toUpperCase().slice(0, 8)),
          guestName: String(row.guestName ?? 'Imported Guest'),
          email: typeof row.email === 'string' ? row.email : null,
          householdName: typeof row.householdName === 'string' ? row.householdName : null,
          partyGroup: typeof row.partyGroup === 'string' ? row.partyGroup : null,
          partyTags: Array.isArray(row.partyTags) ? (row.partyTags as string[]) : [],
          used: false,
          plusOneAllocations: Number(row.plusOneAllocations ?? 0),
          plusOneFirstName: null,
          plusOneLastName: null,
          dietaryNotes: typeof row.dietaryNotes === 'string' ? row.dietaryNotes : null,
          addressLine1: typeof row.addressLine1 === 'string' ? row.addressLine1 : null,
          addressLine2: null,
          city: typeof row.city === 'string' ? row.city : null,
          state: typeof row.state === 'string' ? row.state : null,
          zipCode: typeof row.zipCode === 'string' ? row.zipCode : null,
          country: 'US',
          addressUpdatedAt: null,
          tableId: null,
          seatNumber: null,
          allowedSubEventIds: publicSubEvents,
          extraFields: { attendanceStatus: 'pending' },
          isSample: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        draft.invitationCodes.unshift(record);
        created.push(record);
      });
    });
    return jsonResponse({ success: true, count: created.length, records: created }, 201);
  }

  // --- Seating Chart Specialized Routes ---
  if (normalizedPath === '/api/admin/seating/assign' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);

    if (Array.isArray(body.invitationCodeIds)) {
      const ids = body.invitationCodeIds as string[];
      const tableId = body.tableId ? String(body.tableId) : null;
      const updatedGuests: DemoInvitationCode[] = [];
      updateDemoState((draft) => {
        const table = tableId ? draft.seatingTables.find((t) => t.id === tableId) : null;
        const usedSeats = new Set(
          draft.invitationCodes
            .filter((g) => g.tableId === tableId && !ids.includes(g.id) && g.seatNumber)
            .map((g) => g.seatNumber as number)
        );
        let seatCursor = 1;
        for (const id of ids) {
          const guest = draft.invitationCodes.find((g) => g.id === id);
          if (!guest) continue;
          guest.tableId = tableId;
          if (tableId && table) {
            while (usedSeats.has(seatCursor) && seatCursor <= table.capacity) {
              seatCursor += 1;
            }
            guest.seatNumber = seatCursor <= table.capacity ? seatCursor : null;
            if (guest.seatNumber) usedSeats.add(guest.seatNumber);
          } else {
            guest.seatNumber = null;
            guest.plusOneSeatNumbers = [];
          }
          updatedGuests.push(guest);
        }
      });
      return jsonResponse({ updatedGuests });
    }

    if (Array.isArray(body.assignments)) {
      const entries = body.assignments as Array<{
        invitationCodeId: string;
        tableId: string | null;
        seatNumber?: number | null;
        plusOneSeatNumbers?: number[];
      }>;
      const updatedGuests: DemoInvitationCode[] = [];
      updateDemoState((draft) => {
        for (const entry of entries) {
          const guest = draft.invitationCodes.find((g) => g.id === entry.invitationCodeId);
          if (!guest) continue;
          guest.tableId = entry.tableId || null;
          guest.seatNumber = entry.tableId ? (entry.seatNumber ?? null) : null;
          guest.plusOneSeatNumbers = entry.tableId
            ? Array.isArray(entry.plusOneSeatNumbers)
              ? entry.plusOneSeatNumbers.map(Number)
              : (guest.plusOneSeatNumbers ?? [])
            : [];
          updatedGuests.push(guest);
        }
      });
      return jsonResponse({ updatedGuests });
    }

    const invitationCodeId = String(body.invitationCodeId ?? '');
    const tableId = body.tableId ? String(body.tableId) : null;
    const seatNumber =
      body.seatNumber !== null && body.seatNumber !== undefined ? Number(body.seatNumber) : null;
    const plusOneSeatNumbers = Array.isArray(body.plusOneSeatNumbers)
      ? body.plusOneSeatNumbers.map(Number)
      : undefined;
    let updatedGuest: DemoInvitationCode | null = null;
    updateDemoState((draft) => {
      const guest = draft.invitationCodes.find((g) => g.id === invitationCodeId);
      if (!guest) return;
      if (tableId && seatNumber) {
        const occupant = draft.invitationCodes.find(
          (g) => g.tableId === tableId && g.seatNumber === seatNumber && g.id !== invitationCodeId
        );
        if (occupant) occupant.seatNumber = null;
      }
      guest.tableId = tableId;
      guest.seatNumber = tableId ? seatNumber : null;
      guest.plusOneSeatNumbers = tableId
        ? (plusOneSeatNumbers ?? guest.plusOneSeatNumbers ?? [])
        : [];
      updatedGuest = guest;
    });
    if (!updatedGuest) return jsonResponse({ error: 'Guest not found' }, 404);
    return jsonResponse(updatedGuest);
  }

  if (normalizedPath === '/api/admin/seating/auto-assign' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    const includePending = Boolean(body.includePending);
    const assignedGuests: DemoInvitationCode[] = [];
    let unassignedCount = 0;

    updateDemoState((draft) => {
      const eligible = draft.invitationCodes.filter((inv) => {
        if (inv.tableId) return false;
        if (inv.partyTags.includes('address-collection')) return false;
        const status = getGuestAttendance(inv, draft);
        return status === 'attending' || (includePending && status === 'pending');
      });

      for (const guest of eligible) {
        let placed = false;
        for (const table of draft.seatingTables) {
          if (table.capacity <= 0) continue;
          const occupants = draft.invitationCodes.filter((g) => g.tableId === table.id);
          if (occupants.length >= table.capacity) continue;
          const used = new Set(occupants.map((o) => o.seatNumber).filter(Boolean));
          let seat = 1;
          while (used.has(seat) && seat <= table.capacity) seat += 1;
          guest.tableId = table.id;
          guest.seatNumber = seat;
          assignedGuests.push(guest);
          placed = true;
          break;
        }
        if (!placed) unassignedCount += 1;
      }
    });

    return jsonResponse({
      assignedCount: assignedGuests.length,
      unassignedCount,
      assignedGuests,
    });
  }

  if (normalizedPath === '/api/admin/seating/export') {
    const format = searchParams.get('format')?.toLowerCase();
    const guestTables = state.seatingTables.filter((t) => t.capacity > 0);
    if (format === 'meals' || format === 'meal-counts') {
      const rows = ['Table Name,Table Shape,Capacity,Seated Guests,Entree Counts,Dietary Counts'];
      for (const table of guestTables) {
        const guests = state.invitationCodes.filter((g) => g.tableId === table.id);
        rows.push(
          [
            csvEscape(table.name),
            csvEscape(table.shape),
            csvEscape(table.capacity),
            csvEscape(guests.length),
            csvEscape('Chef Selection'),
            csvEscape(guests.filter((g) => g.dietaryNotes).length || 'None'),
          ].join(',')
        );
      }
      return textResponse(rows.join('\n'), 'text/csv; charset=utf-8', 'seating-meal-counts.csv');
    }
    const rows = ['Table,Shape,Seat,PlusOneSeats,GuestName,Household,DietaryNotes'];
    for (const table of guestTables) {
      const guests = state.invitationCodes
        .filter((g) => g.tableId === table.id)
        .sort((a, b) => (a.seatNumber ?? 99) - (b.seatNumber ?? 99));
      for (const g of guests) {
        rows.push(
          [
            csvEscape(table.name),
            csvEscape(table.shape),
            csvEscape(g.seatNumber ?? ''),
            csvEscape((g.plusOneSeatNumbers ?? []).join(' ')),
            csvEscape(g.guestName),
            csvEscape(g.householdName ?? ''),
            csvEscape(g.dietaryNotes ?? ''),
          ].join(',')
        );
      }
    }
    return textResponse(rows.join('\n'), 'text/csv; charset=utf-8', 'seating-chart.csv');
  }

  // --- Photos, Media & Moderation ---
  if (normalizedPath === '/api/photos') {
    const photos = state.mediaItems
      .filter((m) => m.moderationStatus === 'APPROVED')
      .map((m) => ({
        id: m.id,
        url: m.url,
        title: m.caption || m.altText || 'Wedding Photo',
        altText: m.altText || m.caption || 'Wedding Photo',
        caption: m.caption,
        uploaderName: m.uploaderName,
        isGuestUpload: m.category === 'Guest Uploads',
        createdAt: m.createdAt,
      }));
    return jsonResponse({ success: true, photos });
  }

  if (
    (normalizedPath === '/api/photos/upload' || normalizedPath === '/api/guest/photos/upload') &&
    method === 'POST'
  ) {
    let createdPhoto: DemoMediaItem | null = null;
    updateDemoState((draft) => {
      createdPhoto = {
        id: makeId('demo-media'),
        url: '/images/sample-photo-toast.jpg',
        filename: 'guest-upload-demo.jpg',
        mimeType: 'image/jpeg',
        size: 9400,
        altText: 'Guest uploaded celebration photo',
        caption: 'Shared from the interactive wedding demo!',
        category: 'Guest Uploads',
        isDecorative: false,
        uploaderName: draft.guestSession.guestName || 'Celebration Guest',
        moderationStatus: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      draft.mediaItems.unshift(createdPhoto);
    });
    return jsonResponse({
      success: true,
      message: 'Photo uploaded and queued for host moderation!',
      photo: createdPhoto,
    }, 201);
  }

  if (normalizedPath === '/api/admin/upload' && method === 'POST') {
    return jsonResponse({
      success: true,
      url: '/images/sample-photo-garden.jpg',
      filename: 'uploaded-demo-image.jpg',
    });
  }

  if (normalizedPath === '/api/media/export') {
    return textResponse(
      JSON.stringify({ exportedAt: new Date().toISOString(), media: state.mediaItems }, null, 2),
      'application/json; charset=utf-8',
      'media-library-export.json'
    );
  }

  if (normalizedPath === '/api/media') {
    if (method === 'GET') {
      const page = Math.max(1, Number(searchParams.get('page') ?? 1));
      const limit = Math.max(1, Number(searchParams.get('limit') ?? 20));
      const approved = state.mediaItems.filter((m) => m.moderationStatus === 'APPROVED');
      const total = approved.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const paged = approved.slice((page - 1) * limit, page * limit);
      return jsonResponse({
        data: paged,
        items: paged,
        total,
        page,
        limit,
        totalPages,
      });
    }
    if (method === 'POST') {
      const body = await readJsonBody(init, requestObj);
      let created: DemoMediaItem | null = null;
      updateDemoState((draft) => {
        created = {
          id: makeId('demo-media'),
          url: String(body.url || '/images/sample-photo-garden.jpg'),
          filename: String(body.filename || 'library-photo.jpg'),
          mimeType: 'image/jpeg',
          size: 9500,
          altText: String(body.altText || 'Wedding gallery photo'),
          caption: typeof body.caption === 'string' ? body.caption : undefined,
          category: String(body.category || 'Gallery'),
          isDecorative: Boolean(body.isDecorative),
          moderationStatus: 'APPROVED',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        draft.mediaItems.unshift(created);
      });
      return jsonResponse(created, 201);
    }
  }

  const mediaIdMatch = normalizedPath.match(/^\/api\/media\/([^/]+)$/);
  if (mediaIdMatch) {
    const mediaId = decodeURIComponent(mediaIdMatch[1]);
    if (method === 'PUT' || method === 'PATCH') {
      const body = await readJsonBody(init, requestObj);
      let updated: DemoMediaItem | null = null;
      updateDemoState((draft) => {
        const target = draft.mediaItems.find((m) => m.id === mediaId);
        if (!target) return;
        Object.assign(target, body, { id: target.id, updatedAt: new Date().toISOString() });
        updated = target;
      });
      if (!updated) return jsonResponse({ error: 'Media item not found' }, 404);
      return jsonResponse(updated);
    }
    if (method === 'DELETE') {
      updateDemoState((draft) => {
        draft.mediaItems = draft.mediaItems.filter((m) => m.id !== mediaId);
      });
      return jsonResponse({ success: true });
    }
  }

  if (
    normalizedPath === '/api/admin/photos/moderation' ||
    normalizedPath === '/api/admin/photos/moderation/batch'
  ) {
    if (method === 'GET') {
      const pending = state.mediaItems.filter((m) => m.moderationStatus === 'PENDING');
      return jsonResponse({ success: true, photos: pending, data: pending });
    }
    const body = await readJsonBody(init, requestObj);
    const ids = new Set(
      Array.isArray(body.ids)
        ? (body.ids as string[])
        : typeof body.id === 'string'
          ? [body.id]
          : []
    );
    const action = String(body.action ?? 'approve');
    updateDemoState((draft) => {
      if (action === 'reject') {
        draft.mediaItems = draft.mediaItems.filter((m) => !ids.has(m.id));
      } else {
        for (const m of draft.mediaItems) {
          if (ids.has(m.id)) {
            m.moderationStatus = 'APPROVED';
            m.updatedAt = new Date().toISOString();
          }
        }
      }
    });
    return jsonResponse({ success: true, updatedCount: ids.size });
  }

  const adminPhotoMatch = normalizedPath.match(/^\/api\/admin\/photos\/([^/]+)$/);
  if (adminPhotoMatch && adminPhotoMatch[1] !== 'moderation') {
    const photoId = decodeURIComponent(adminPhotoMatch[1]);
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readJsonBody(init, requestObj);
      const rawAction = String(
        body.action ??
          (String(body.status ?? '').toUpperCase() === 'REJECTED' ? 'reject' : 'approve')
      ).toLowerCase();
      let targetPhoto: DemoMediaItem | null = null;
      updateDemoState((draft) => {
        if (rawAction === 'reject') {
          targetPhoto = draft.mediaItems.find((m) => m.id === photoId) ?? null;
          draft.mediaItems = draft.mediaItems.filter((m) => m.id !== photoId);
        } else {
          const found = draft.mediaItems.find((m) => m.id === photoId);
          if (found) {
            found.moderationStatus = 'APPROVED';
            found.updatedAt = new Date().toISOString();
            targetPhoto = found;
          }
        }
      });
      if (!targetPhoto) return jsonResponse({ error: 'Photo not found' }, 404);
      return jsonResponse({
        success: true,
        message: `Photo ${rawAction}d successfully`,
        data: targetPhoto,
      });
    }
    if (method === 'DELETE') {
      updateDemoState((draft) => {
        draft.mediaItems = draft.mediaItems.filter((m) => m.id !== photoId);
      });
      return jsonResponse({ success: true });
    }
  }

  // --- Versions, Broadcasts & Maintenance ---
  if (normalizedPath === '/api/admin/versions') {
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const limit = Math.max(1, Number(searchParams.get('limit') ?? 50));
    const total = state.versions.length;
    const paged = state.versions.slice((page - 1) * limit, page * limit);
    return jsonResponse({
      items: paged,
      versions: paged,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  }

  const versionRestoreMatch = normalizedPath.match(/^\/api\/admin\/versions\/([^/]+)\/restore$/);
  if (versionRestoreMatch && method === 'POST') {
    const versionId = decodeURIComponent(versionRestoreMatch[1]);
    updateDemoState((draft) => {
      const target = draft.versions.find((v) => v.id === versionId);
      if (target && target.data) {
        Object.assign(draft.config, target.data);
        draft.versions.unshift({
          id: makeId('demo-version'),
          entityType: target.entityType,
          entityId: target.entityId,
          versionNumber: draft.versions.length + 1,
          author: 'Demo Admin',
          summary: `Restored snapshot v${target.versionNumber}`,
          data: { ...target.data },
          createdAt: new Date().toISOString(),
        });
      }
    });
    return jsonResponse({ success: true });
  }

  if (normalizedPath === '/api/admin/broadcast/history') {
    const page = Math.max(1, Number(searchParams.get('page') ?? 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 50)));
    const total = state.broadcasts.length;
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
    const paged = state.broadcasts.slice((page - 1) * limit, page * limit);
    return jsonResponse(paged, 200, {
      'X-Total-Count': String(total),
      'X-Page': String(page),
      'X-Limit': String(limit),
      'X-Total-Pages': String(totalPages),
      'X-Per-Page': String(limit),
      'X-Current-Page': String(page),
      'X-Has-Next-Page': String(page < totalPages),
      'X-Has-Prev-Page': String(page > 1),
    });
  }

  if (normalizedPath === '/api/admin/broadcast/preview' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    const sampleGuest = state.invitationCodes[0];
    const rawBody = String(body.body ?? '<p>Hello {{guestName}}!</p>');
    const rendered = rawBody
      .replace(/\{\{\s*guestName\s*\}\}/g, sampleGuest?.guestName ?? 'Jordan Rivera')
      .replace(/\{\{\s*invitationCode\s*\}\}/g, sampleGuest?.code ?? 'RIVERA26');
    return jsonResponse({
      success: true,
      subject: String(body.subject ?? 'Wedding Update'),
      html: rendered,
      body: rendered,
      recipientCount: state.invitationCodes.length,
      totalRecipients: state.invitationCodes.length,
      sampleGuestName: sampleGuest?.guestName ?? 'Jordan Rivera',
    });
  }

  if (normalizedPath === '/api/admin/broadcast/send' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    let recordId = '';
    const recipientCount = state.invitationCodes.length;
    const isScheduled = Boolean(body.scheduledFor);
    updateDemoState((draft) => {
      recordId = makeId('demo-broadcast');
      draft.broadcasts.unshift({
        id: recordId,
        channel: body.channel === 'SMS' ? 'SMS' : 'EMAIL',
        subject: body.subject ? String(body.subject) : 'Wedding Broadcast',
        body: String(body.body ?? ''),
        status: isScheduled ? 'SCHEDULED' : 'SENT',
        totalRecipients: recipientCount,
        sentCount: isScheduled ? 0 : recipientCount,
        failedCount: 0,
        scheduledFor: typeof body.scheduledFor === 'string' ? body.scheduledFor : null,
        sentAt: isScheduled ? null : new Date().toISOString(),
        createdAt: new Date().toISOString(),
        recipients: draft.invitationCodes.slice(0, 3).map((inv, idx) => ({
          id: `${recordId}-r-${idx}`,
          invitationCodeId: inv.id,
          guestName: inv.guestName,
          destination: inv.email ?? 'guest@example.com',
          status: isScheduled ? 'PENDING' : 'SENT',
          error: null,
          sentAt: isScheduled ? null : new Date().toISOString(),
        })),
      });
    });
    return jsonResponse({
      success: true,
      broadcastId: recordId,
      status: isScheduled ? 'SCHEDULED' : 'SENT',
      totalRecipients: recipientCount,
      sentCount: isScheduled ? 0 : recipientCount,
      failedCount: 0,
    });
  }

  if (
    normalizedPath === '/api/admin/broadcast/test-send' ||
    normalizedPath === '/api/admin/broadcast/test-connection' ||
    normalizedPath === '/api/admin/broadcast/retry'
  ) {
    return jsonResponse({
      success: true,
      message: 'Simulated successfully in static demo mode.',
    });
  }

  const cancelScheduleMatch = normalizedPath.match(/^\/api\/admin\/broadcast\/schedule\/([^/]+)$/);
  if (cancelScheduleMatch && method === 'DELETE') {
    const targetId = decodeURIComponent(cancelScheduleMatch[1]);
    updateDemoState((draft) => {
      const target = draft.broadcasts.find((b) => b.id === targetId);
      if (target) target.status = 'CANCELLED';
    });
    return jsonResponse({ success: true });
  }

  const broadcastDetailMatch = normalizedPath.match(/^\/api\/admin\/broadcast\/([^/]+)$/);
  if (broadcastDetailMatch && method === 'GET') {
    const targetId = decodeURIComponent(broadcastDetailMatch[1]);
    const target = state.broadcasts.find((b) => b.id === targetId);
    if (!target) {
      return jsonResponse({ error: 'Broadcast message not found.' }, 404);
    }
    return jsonResponse(target);
  }

  if (normalizedPath === '/api/admin/maintenance/export') {
    const backup = {
      version: '2.0',
      exportedAt: new Date().toISOString(),
      appConfig: [state.config],
      registryItems: state.registryItems,
      invitationCodes: state.invitationCodes,
      seatingTables: state.seatingTables,
      weddingPartyMembers: state.weddingParty,
      attractions: state.attractions,
      contentNodes: state.contentNodes,
      subEvents: state.subEvents,
    };
    return textResponse(
      JSON.stringify(backup, null, 2),
      'application/json; charset=utf-8',
      'wedding-demo-backup.json'
    );
  }

  if (normalizedPath === '/api/admin/maintenance/import' && method === 'POST') {
    const body = await readJsonBody(init, requestObj);
    updateDemoState((draft) => {
      const payload = (body.backup && typeof body.backup === 'object'
        ? body.backup
        : body) as Record<string, unknown>;
      if (Array.isArray(payload.appConfig) && payload.appConfig[0]) {
        Object.assign(draft.config, payload.appConfig[0]);
      }
      if (Array.isArray(payload.registryItems)) {
        draft.registryItems = payload.registryItems as RegistryItem[];
      }
      if (Array.isArray(payload.invitationCodes)) {
        draft.invitationCodes = payload.invitationCodes as DemoInvitationCode[];
      }
      if (Array.isArray(payload.seatingTables)) {
        draft.seatingTables = payload.seatingTables as DemoSeatingTable[];
      }
    });
    return jsonResponse({
      success: true,
      message: 'Backup restored into browser demo session.',
    });
  }

  // --- Generic Admin Entity CRUD (/api/admin/[entity], /batch, /[id]) ---
  const entityMatch = normalizedPath.match(/^\/api\/admin\/([a-z-]+)(?:\/([^/]+))?$/);
  if (entityMatch) {
    const entity = entityMatch[1];
    const subSegment = entityMatch[2] ? decodeURIComponent(entityMatch[2]) : undefined;

    const getCollection = (
      s: DemoState
    ): Array<
      | DemoSeatingTable
      | DemoWeddingPartyMember
      | DemoAttraction
      | DemoContentNode
      | DemoSubEvent
      | DemoInvitationCode
      | RegistryItem
    > | null => {
      switch (entity) {
        case 'seating-tables':
          return s.seatingTables;
        case 'wedding-party':
          return s.weddingParty;
        case 'attractions':
          return s.attractions;
        case 'content-nodes':
          return s.contentNodes;
        case 'sub-events':
          return s.subEvents;
        case 'invitation-codes':
          return s.invitationCodes;
        case 'registry-items':
          return s.registryItems;
        default:
          return null;
      }
    };

    const collection = getCollection(state);
    if (collection) {
      if (!subSegment && method === 'GET') {
        const page = Math.max(1, Number(searchParams.get('page') ?? 1));
        const limit = Math.max(1, Number(searchParams.get('limit') ?? 200));
        let items: unknown[] = [...collection];
        const typeFilter = searchParams.get('type');
        if (entity === 'content-nodes' && typeFilter) {
          items = (items as DemoContentNode[]).filter((n) => n.type === typeFilter);
        }
        if (entity === 'seating-tables') {
          items = (items as DemoSeatingTable[]).map((table) => ({
            ...table,
            invitationCodes: state.invitationCodes
              .filter((g) => g.tableId === table.id)
              .sort((a, b) => (a.seatNumber ?? 99) - (b.seatNumber ?? 99)),
          }));
        }
        const total = items.length;
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const paged = items.slice((page - 1) * limit, page * limit);
        return jsonResponse(paged, 200, {
          'X-Total-Count': String(total),
          'X-Page': String(page),
          'X-Limit': String(limit),
          'X-Total-Pages': String(totalPages),
        });
      }

      if (!subSegment && method === 'POST') {
        const body = await readJsonBody(init, requestObj);
        let created: Record<string, unknown> | null = null;
        updateDemoState((draft) => {
          const target = getCollection(draft) as Array<Record<string, unknown>>;
          const now = new Date().toISOString();
          created = {
            id: makeId(`demo-${entity}`),
            isSample: false,
            displayOrder: target.length,
            order: target.length,
            createdAt: now,
            updatedAt: now,
            ...body,
          };
          if (entity === 'seating-tables') {
            created.width = Number(body.width ?? (body.shape === 'rectangular' ? 180 : 130));
            created.height = Number(body.height ?? (body.shape === 'rectangular' ? 100 : 130));
            created.rotation = Number(body.rotation ?? 0);
            created.capacity = Number(body.capacity ?? 8);
            created.x = Number(body.x ?? 220);
            created.y = Number(body.y ?? 220);
          }
          target.push(created);
        });
        if (entity === 'seating-tables' && created) {
          return jsonResponse({ ...(created as Record<string, unknown>), invitationCodes: [] }, 201);
        }
        return jsonResponse(created, 201);
      }

      if (!subSegment && method === 'PUT') {
        const body = await readJsonBody(init, requestObj);
        if (body.action === 'reorder' && Array.isArray(body.orderedIds)) {
          const orderedIds = body.orderedIds as string[];
          updateDemoState((draft) => {
            const target = getCollection(draft) as Array<Record<string, unknown>>;
            orderedIds.forEach((id, idx) => {
              const item = target.find((entry) => entry.id === id);
              if (item) {
                item.order = idx;
                item.displayOrder = idx;
                if (item.data && typeof item.data === 'object') {
                  (item.data as Record<string, unknown>).displayOrder = idx;
                }
              }
            });
            target.sort(
              (a, b) => Number(a.displayOrder ?? a.order ?? 0) - Number(b.displayOrder ?? b.order ?? 0)
            );
          });
          return jsonResponse({ success: true });
        }
      }

      if (subSegment === 'batch' && method === 'POST') {
        const body = await readJsonBody(init, requestObj);
        const ids = new Set(Array.isArray(body.ids) ? (body.ids as string[]) : []);
        updateDemoState((draft) => {
          const target = getCollection(draft) as Array<Record<string, unknown>>;
          const kept = target.filter((entry) => !ids.has(String(entry.id)));
          target.splice(0, target.length, ...kept);
        });
        return jsonResponse({ success: true, deletedCount: ids.size });
      }

      if (subSegment) {
        if (method === 'GET') {
          const item = (collection as Array<Record<string, unknown>>).find(
            (entry) => entry.id === subSegment
          );
          if (!item) return jsonResponse({ error: 'Not found' }, 404);
          return jsonResponse(item);
        }
        if (method === 'PUT' || method === 'PATCH') {
          const body = await readJsonBody(init, requestObj);
          let updated: Record<string, unknown> | null = null;
          updateDemoState((draft) => {
            const target = getCollection(draft) as Array<Record<string, unknown>>;
            const item = target.find((entry) => entry.id === subSegment);
            if (!item) return;
            Object.assign(item, body, {
              id: item.id,
              updatedAt: new Date().toISOString(),
            });
            updated = item;
          });
          if (!updated) return jsonResponse({ error: 'Not found' }, 404);
          if (entity === 'seating-tables') {
            const updatedState = getDemoState();
            return jsonResponse({
              ...(updated as Record<string, unknown>),
              invitationCodes: updatedState.invitationCodes.filter((g) => g.tableId === subSegment),
            });
          }
          return jsonResponse(updated);
        }
        if (method === 'DELETE') {
          updateDemoState((draft) => {
            const target = getCollection(draft) as Array<Record<string, unknown>>;
            const idx = target.findIndex((entry) => entry.id === subSegment);
            if (idx !== -1) target.splice(idx, 1);
            if (entity === 'seating-tables') {
              for (const g of draft.invitationCodes) {
                if (g.tableId === subSegment) {
                  g.tableId = null;
                  g.seatNumber = null;
                }
              }
            }
          });
          return jsonResponse({ success: true });
        }
      }
    }
  }

  return jsonResponse({
    success: true,
    mode: 'static-demo-fallback',
    path: normalizedPath,
  });
}
