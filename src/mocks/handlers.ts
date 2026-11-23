import { http, HttpResponse } from 'msw';
import { getStripeCapability } from '@/lib/stripe';

// 1x1 transparent PNG to mock map tile requests without network access
const TRANSPARENT_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const mockScheduleData = [
  {
    id: 'sub-1',
    title: 'Welcome Dinner & Cocktails',
    startTime: '2026-09-18T18:00:00Z',
    endTime: '2026-09-18T21:00:00Z',
    category: 'Celebration',
    locationName: 'Sunset Terrace',
    attireRules: 'Cocktail Chic',
    description: 'Join us for drinks and welcoming appetizers as guests arrive.',
    isPrivate: false,
    userRsvp: { status: 'attending', plusOneCount: 1, dietaryNotes: 'Vegetarian' },
  },
  {
    id: 'sub-2',
    title: 'Wedding Ceremony',
    startTime: '2026-09-19T15:30:00Z',
    endTime: '2026-09-19T16:30:00Z',
    category: 'Ceremony',
    locationName: 'Grand Oak Lawn',
    attireRules: 'Formal / Black Tie Optional',
    description: 'Exchange of vows under the grand ancient oak.',
    isPrivate: false,
    userRsvp: { status: 'attending', plusOneCount: 1, dietaryNotes: '' },
  },
  {
    id: 'sub-3',
    title: 'Reception & Dancing',
    startTime: '2026-09-19T17:00:00Z',
    endTime: '2026-09-19T23:30:00Z',
    category: 'Reception',
    locationName: 'Lakeside Ballroom',
    attireRules: 'Formal',
    description: 'Dinner, toasts, and dancing late into the night.',
    isPrivate: false,
    mealOptions: [
      {
        id: 'meal-beef',
        label: 'Braised Short Rib',
        description: 'Garlic mashed potatoes & seasonal greens',
        dietaryTags: ['gluten-free'],
      },
      {
        id: 'meal-fish',
        label: 'Herb-Crusted Halibut',
        description: 'Lemon risotto & asparagus',
        dietaryTags: ['gluten-free', 'nut-free'],
      },
      {
        id: 'meal-veg',
        label: 'Wild Mushroom Risotto',
        description: 'Truffle oil & roasted root vegetables',
        dietaryTags: ['vegan', 'gluten-free', 'dairy-free'],
      },
    ],
    customQuestions: [
      {
        id: 'q-shuttle',
        prompt: 'Will you use the hotel shuttle to Lakeside Ballroom?',
        type: 'choice',
        required: true,
        options: ['Yes, round-trip', 'No, driving separately'],
      },
      {
        id: 'q-song',
        prompt: 'What song will get you out on the dance floor?',
        type: 'text',
        required: false,
        options: [],
      },
    ],
    userRsvp: { status: 'pending', plusOneCount: 0, dietaryNotes: '' },
  },
  {
    id: 'sub-4',
    title: 'Farewell Brunch',
    startTime: '2026-09-20T10:00:00Z',
    endTime: '2026-09-20T13:00:00Z',
    category: 'Brunch',
    locationName: 'Garden Pavilion',
    attireRules: 'Casual',
    description: 'Coffee, pastries, and farewell embraces before departures.',
    isPrivate: false,
    userRsvp: { status: 'declined', plusOneCount: 0, dietaryNotes: '' },
  },
];

export const handlers = [
  http.get('*/api/registry/capabilities', () => {
    const hasExplicitStripeEnv =
      process.env.STRIPE_SECRET_KEY !== undefined ||
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY !== undefined;
    const capability = hasExplicitStripeEnv
      ? getStripeCapability()
      : {
        cardCheckoutEnabled: true,
        stripePublishableKey: 'pk_test_msw_mock_publishable_key',
      };
    return HttpResponse.json({
      success: true,
      data: capability,
    });
  }),

  // Schedule API handler for InteractiveTimeline
  http.get('*/api/schedule', () => {
    return HttpResponse.json({
      success: true,
      data: mockScheduleData,
      isGuest: true,
      guestName: 'Alex & Jordan',
      plusOneAllocations: 2,
      savedPlusOneNames: [],
      rsvpOpen: true,
      rsvpDeadlineDate: null,
      rsvpFormattedDeadline: null,
      timezone: 'America/Chicago',
      rsvpClosedMessage:
        'Online RSVPs are now closed. Please contact the hosts directly if your plans or dietary needs have changed.',
    });
  }),

  // RSVP submission API handler for useScheduleRsvpManager
  http.post('*/api/rsvp', async ({ request }) => {
    try {
      const body = (await request.json()) as any;
      let updated: any[] = [];
      if (body && Array.isArray(body.rsvps)) {
        updated = body.rsvps.map((item: any) => ({
          subEventId: item.subEventId,
          status: item.status || 'attending',
          plusOneCount: item.status === 'declined' ? 0 : (item.plusOneCount ?? 0),
          dietaryNotes: item.dietaryNotes || '',
          mealSelections: item.status === 'declined' ? [] : (item.mealSelections || []),
          customAnswers: item.status === 'declined' ? {} : (item.customAnswers || {}),
          plusOneNames: item.status === 'declined' ? [] : (item.plusOneNames || []),
        }));
      } else if (body && body.subEventId) {
        updated = [
          {
            subEventId: body.subEventId,
            status: body.status || 'attending',
            plusOneCount: body.status === 'declined' ? 0 : (body.plusOneCount ?? 0),
            dietaryNotes: body.dietaryNotes || '',
            mealSelections: body.status === 'declined' ? [] : (body.mealSelections || []),
            customAnswers: body.status === 'declined' ? {} : (body.customAnswers || {}),
            plusOneNames: body.status === 'declined' ? [] : (body.plusOneNames || []),
          },
        ];
      }
      return HttpResponse.json({
        success: true,
        data: updated,
      });
    } catch {
      return HttpResponse.json({ success: true, data: [] });
    }
  }),

  // CSV Import Wizard Modal validation endpoint
  http.post('*/api/admin/invitation-codes/validate', async ({ request }) => {
    try {
      const body = (await request.json()) as any;
      const records = Array.isArray(body?.records) ? body.records : [];
      return HttpResponse.json({
        success: true,
        summary: {
          totalRows: records.length,
          validRows: records.length,
          invalidRows: 0,
          duplicateCodes: 0,
          dbCollisions: 0,
        },
        rows: records.map((record: any, index: number) => ({
          ...record,
          rowNumber: index + 1,
          isValid: true,
          errors: [],
          warnings: [],
          hasCollision: false,
        })),
      });
    } catch {
      return HttpResponse.json({
        success: true,
        summary: {
          totalRows: 0,
          validRows: 0,
          invalidRows: 0,
          duplicateCodes: 0,
          dbCollisions: 0,
        },
        rows: [],
      });
    }
  }),

  // CSV Import Wizard Modal & batch update execution endpoint
  http.post('*/api/admin/invitation-codes/batch', async ({ request }) => {
    try {
      const body = (await request.json()) as any;
      if (body && Array.isArray(body.ids)) {
        return HttpResponse.json({
          success: true,
          count: body.ids.length,
          updatedCount: body.ids.length,
          records: [],
        });
      }
      const records = Array.isArray(body?.records) ? body.records : [];
      return HttpResponse.json({
        success: true,
        count: records.length,
        imported: records.length,
        skipped: 0,
        updated: 0,
        records,
      });
    } catch {
      return HttpResponse.json({
        success: true,
        count: 0,
        imported: 0,
        skipped: 0,
        updated: 0,
        records: [],
      });
    }
  }),

  // Duplicate guest merge execution endpoint
  http.post('*/api/admin/invitation-codes/merge', async ({ request }) => {
    try {
      const body = (await request.json()) as { primaryId?: string; secondaryIds?: string[] };
      const primaryId = body?.primaryId || 'inv-primary';
      const secondaryIds = Array.isArray(body?.secondaryIds) ? body.secondaryIds : [];
      return HttpResponse.json({
        success: true,
        record: {
          id: primaryId,
          code: 'MERGED01',
          guestName: 'Merged Guest',
          used: false,
          partyTags: [],
        },
        mergedCount: secondaryIds.length,
        transferredCounts: {
          contributors: 0,
          subEventAccesses: 0,
          subEventRsvps: 0,
          broadcastRecipients: 0,
          seatTransferred: false,
        },
      });
    } catch {
      return HttpResponse.json({ success: false, error: 'Invalid merge payload' }, { status: 400 });
    }
  }),

  // Admin invitation catalog endpoint (bounded up to 1,000 invitations)
  http.get('*/api/admin/invitation-codes/catalog', () => {
    return HttpResponse.json({
      success: true,
      data: {
        items: [],
        total: 0,
        page: 1,
        limit: 1000,
        totalPages: 1,
      },
    });
  }),

  // Admin sub-event access matrix default handler
  http.get('*/api/admin/sub-events/access', () => {
    return HttpResponse.json({
      success: true,
      data: {
        subEvents: [],
        invitationCodes: [],
      },
    });
  }),

  // Admin server-side RSVP summary endpoint
  http.get('*/api/admin/sub-events/rsvp-summary', () => {
    return HttpResponse.json({
      success: true,
      data: {
        global: {
          totalInvitations: 0,
          attendingHouseholds: 0,
          declinedHouseholds: 0,
          pendingHouseholds: 0,
          attendingHeadcount: 0,
          attendingPlusOnes: 0,
          declinedHeadcount: 0,
          pendingHeadcount: 0,
          dietary: {
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
          },
          mealTotals: [],
          questionBreakdowns: [],
        },
        subEvents: [],
      },
    });
  }),

  // Admin RSVP detail & override endpoint
  http.get('*/api/admin/invitation-codes/rsvps', ({ request }) => {
    const url = new URL(request.url);
    const invitationCodeId = url.searchParams.get('invitationCodeId') || 'inv-mock';
    return HttpResponse.json({
      success: true,
      data: {
        invitationCode: {
          id: invitationCodeId,
          code: 'MOCKCODE',
          guestName: 'Mock Guest',
          plusOneAllocations: 1,
          dietaryNotes: '',
          used: false,
          partyTags: [],
        },
        subEvents: [],
        rsvps: [],
      },
    });
  }),

  http.put('*/api/admin/invitation-codes/rsvps', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (Array.isArray(body.invitationCodeIds)) {
      return HttpResponse.json({
        success: true,
        data: {
          updatedCount: body.invitationCodeIds.length,
          records: [],
        },
      });
    }
    const invitationCodeId =
      typeof body.invitationCodeId === 'string' ? body.invitationCodeId : 'inv-mock';
    return HttpResponse.json({
      success: true,
      data: {
        invitationCode: {
          id: invitationCodeId,
          code: 'MOCKCODE',
          guestName: 'Mock Guest',
          plusOneAllocations: 1,
          dietaryNotes: '',
          used: true,
          partyTags: [],
        },
        subEvents: [],
        rsvps: [],
      },
    });
  }),

  // Mock Leaflet tiles for ThingsToDoMap (CartoDB / OpenStreetMap)
  http.get('*/api/admin/photos/qr', () => {
    return HttpResponse.json({
      success: true,
      uploadUrl: 'http://localhost:3000/photos?qr=mock-signed-qr-token',
      tokenVersion: 1,
      autoApproveGuestPhotos: false,
    });
  }),

  http.post('*/api/admin/photos/qr', async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const rotated = body.action === 'rotate';
    return HttpResponse.json({
      success: true,
      uploadUrl: rotated
        ? 'http://localhost:3000/photos?qr=mock-rotated-qr-token-v2'
        : 'http://localhost:3000/photos?qr=mock-signed-qr-token',
      tokenVersion: rotated ? 2 : 1,
      autoApproveGuestPhotos:
        typeof body.autoApproveGuestPhotos === 'boolean' ? body.autoApproveGuestPhotos : false,
    });
  }),

  http.get('https://*.basemaps.cartocdn.com/*', () => {
    return new HttpResponse(TRANSPARENT_PNG, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }),

  http.get('https://*.tile.openstreetmap.org/*', () => {
    return new HttpResponse(TRANSPARENT_PNG, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  }),
];

export const defaultHandlers = handlers;
