/** @jest-environment node */

jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');
jest.unmock('@/lib/prisma');

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AppConfigSchema, PublicAppConfigSchema } from '@/features/content';
import { MultiChannelMessagingProvider } from '@/features/broadcast';
import {
  toAdminAppConfig,
  toPublicAppConfig,
} from '@/lib/config';
import { isAdminRequest } from '@/core/auth/auth.server';
import { signGuestToken } from '@/core/auth/guest.server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { GET as exportBackup } from '@/app/api/admin/maintenance/export/route';
import { POST as importBackup } from '@/app/api/admin/maintenance/import/route';
import { GET as capabilitiesGET } from '../api/capabilities';
import { POST as contributePOST } from '../api/contribute';
import { GET as claimGET, POST as claimPOST } from '../api/claim';
import { registryService } from '../service';
import { verifyContributorActionToken } from '../lib/contributorToken';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/core/auth/guestInviteSession', () => ({
  getGuestInviteSession: jest.fn().mockResolvedValue(null),
  GUEST_INVITE_COOKIE: 'guest_invite_session',
}));

async function wipeAllTables() {
  await prisma.$transaction([
    prisma.broadcastRecipient.deleteMany(),
    prisma.broadcastMessage.deleteMany(),
    prisma.subEventRsvp.deleteMany(),
    prisma.subEventAccess.deleteMany(),
    prisma.subEvent.deleteMany(),
    prisma.contributor.deleteMany(),
    prisma.registryItem.deleteMany(),
    prisma.invitationCode.deleteMany(),
    prisma.seatingTable.deleteMany(),
    prisma.attraction.deleteMany(),
    prisma.weddingPartyMember.deleteMany(),
    prisma.media.deleteMany(),
    prisma.contentNode.deleteMany(),
    prisma.appConfig.deleteMany(),
    prisma.snapshotVersion.deleteMany(),
  ]);
}

async function readStreamResponseJson(res: Response) {
  const maybeMock = res as unknown as {
    bodyContent?: ReadableStream<Uint8Array>;
  };
  const stream = maybeMock.bodyContent ?? res.body;
  if (stream && typeof stream.getReader === 'function') {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let out = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
    return JSON.parse(out);
  }
  return JSON.parse(await res.text());
}

describe('Configurable Registry Access Tiers, Hold Quotas & Multi-Item Claim Hub (PostgreSQL Integration)', () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      GUEST_PASSCODE: 'wedding2027',
      GUEST_SESSION_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef',
    };
    (isAdminRequest as jest.Mock).mockResolvedValue(false);
    (getGuestInviteSession as jest.Mock).mockResolvedValue(null);
    await wipeAllTables();
  });

  afterAll(async () => {
    process.env = originalEnv;
    await wipeAllTables();
    await prisma.$disconnect();
  });

  it('round-trips registryGiftAccessTier, shippingDisclosureTier, and maxPendingReservations in v2.0 backups while never leaking shipping PII in toPublicAppConfig', async () => {
    const created = await prisma.appConfig.create({
      data: {
        id: 'global',
        partner1Name: 'Alex',
        partner2Name: 'Taylor',
        brideName: 'Alex',
        groomName: 'Taylor',
        shippingRecipientName: 'Alex & Taylor Residence',
        shippingAddressLine1: '742 Evergreen Terrace',
        shippingAddressLine2: 'Suite 4B',
        shippingCity: 'Portland',
        shippingState: 'OR',
        shippingZip: '97205',
        shippingCountry: 'United States',
        shippingPhone: '(503) 555-0199',
        shippingDeliveryNotes: 'Leave inside covered porch',
        defaultPaymentHandleType: 'Venmo',
        defaultPaymentHandle: '@alex-and-taylor',
        registryGiftAccessTier: 'INVITED_HOUSEHOLDS',
        shippingDisclosureTier: 'POST_CLAIM_ONLY',
        maxPendingReservations: 3,
      },
    });

    const parsed = AppConfigSchema.parse(created);
    const publicDto = PublicAppConfigSchema.parse(toPublicAppConfig(parsed));
    const serializedPublic = JSON.stringify(publicDto);

    expect(serializedPublic).not.toContain('742 Evergreen Terrace');
    expect(serializedPublic).not.toContain('(503) 555-0199');
    expect(serializedPublic).not.toContain('Leave inside covered porch');
    expect('shippingAddressLine1' in publicDto).toBe(false);

    const adminDto = toAdminAppConfig(parsed);
    expect(adminDto.registryGiftAccessTier).toBe('INVITED_HOUSEHOLDS');
    expect(adminDto.shippingDisclosureTier).toBe('POST_CLAIM_ONLY');
    expect(adminDto.maxPendingReservations).toBe(3);

    // Export v2.0 JSON backup, wipe database, and re-import
    (isAdminRequest as jest.Mock).mockResolvedValue(true);
    const exportRes = await exportBackup(
      new NextRequest('http://localhost:3000/api/admin/maintenance/export')
    );
    expect(exportRes.status).toBe(200);
    const backupPayload = await readStreamResponseJson(exportRes);
    expect(backupPayload.version).toBe('2.0');
    expect(backupPayload.appConfig[0]).toMatchObject({
      registryGiftAccessTier: 'INVITED_HOUSEHOLDS',
      shippingDisclosureTier: 'POST_CLAIM_ONLY',
      maxPendingReservations: 3,
    });

    await wipeAllTables();

    const importRes = await importBackup(
      new NextRequest('http://localhost:3000/api/admin/maintenance/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(backupPayload),
      })
    );
    expect(importRes.status).toBe(200);

    const restored = await prisma.appConfig.findUniqueOrThrow({
      where: { id: 'global' },
    });
    expect(restored.registryGiftAccessTier).toBe('INVITED_HOUSEHOLDS');
    expect(restored.shippingDisclosureTier).toBe('POST_CLAIM_ONLY');
    expect(restored.maxPendingReservations).toBe(3);
    expect(restored.shippingAddressLine1).toBe('742 Evergreen Terrace');
  });

  it('includes group-gifted and reserved physical items in active catalog capabilities and enforces shippingDisclosureTier across PASSCODE_GUESTS, INVITED_HOUSEHOLDS, and POST_CLAIM_ONLY', async () => {
    await prisma.appConfig.create({
      data: {
        id: 'global',
        partner1Name: 'Alex',
        partner2Name: 'Taylor',
        shippingRecipientName: 'Alex & Taylor',
        shippingAddressLine1: '101 Maple Ave',
        shippingCity: 'Seattle',
        shippingState: 'WA',
        shippingZip: '98101',
        shippingCountry: 'United States',
        defaultPaymentHandleType: 'Venmo',
        defaultPaymentHandle: '@alex-taylor',
        registryGiftAccessTier: 'PASSCODE_GUESTS',
        shippingDisclosureTier: 'PASSCODE_GUESTS',
        maxPendingReservations: 4,
      },
    });

    const media = await prisma.media.create({
      data: { id: 'media-phys-1', url: '/images/espresso.jpg' },
    });

    // 1a. Group-gifted physical item counts toward hasActivePhysicalItems
    const groupPhysical = await prisma.registryItem.create({
      data: {
        id: 'item-group-phys',
        name: 'Espresso Machine',
        description: 'Dual boiler espresso maker',
        price: 600,
        category: 'Kitchen',
        imageId: media.id,
        itemType: 'PHYSICAL',
        isGroupGift: true,
        purchased: false,
        vendorUrl: 'https://retailer.example.com/espresso',
      },
    });

    let summary = await registryService.getActiveCatalogCapabilitiesSummary();
    expect(summary.hasActivePhysicalItems).toBe(true);

    // 1b. Single-unit physical item with purchased=true because of an active RESERVED hold STILL counts toward hasActivePhysicalItems
    await prisma.registryItem.delete({ where: { id: groupPhysical.id } });
    const reservedSingleUnit = await prisma.registryItem.create({
      data: {
        id: 'item-reserved-phys',
        name: 'Cast Iron Skillet',
        description: '12-inch seasoned skillet',
        price: 95,
        category: 'Kitchen',
        imageId: media.id,
        itemType: 'PHYSICAL',
        isGroupGift: false,
        quantity: 1,
        purchased: true,
        vendorUrl: 'https://retailer.example.com/skillet',
      },
    });
    await prisma.contributor.create({
      data: {
        id: 'contrib-active-hold',
        registryItem: { connect: { id: reservedSingleUnit.id } },
        name: 'Cousin Sam',
        amount: 95,
        status: 'RESERVED',
      },
    });

    summary = await registryService.getActiveCatalogCapabilitiesSummary();
    expect(summary.hasActivePhysicalItems).toBe(true);

    const guestToken = await signGuestToken({ guest: true });

    // 2a. Unauthenticated request never receives shippingAddress
    const unauthRes = await capabilitiesGET(
      new NextRequest('http://localhost:3000/api/registry/capabilities')
    );
    const unauthJson = await unauthRes.json();
    expect(unauthJson.data).toMatchObject({
      giftAccessTier: 'PASSCODE_GUESTS',
      shippingDisclosureTier: 'PASSCODE_GUESTS',
      maxPendingReservations: 4,
      hasShippingAddress: true,
    });
    expect(unauthJson.data.shippingAddress).toBeUndefined();

    // 2b. PASSCODE_GUESTS: passcode-authenticated guest receives shippingAddress
    const passcodeRes = await capabilitiesGET(
      new NextRequest('http://localhost:3000/api/registry/capabilities', {
        headers: { cookie: `guest_auth=${guestToken}` },
      })
    );
    const passcodeJson = await passcodeRes.json();
    expect(passcodeJson.data.shippingAddress?.addressLine1).toBe('101 Maple Ave');

    // 2c. INVITED_HOUSEHOLDS: passcode-only guest has shippingAddress withheld; verified household receives it
    await prisma.appConfig.update({
      where: { id: 'global' },
      data: { shippingDisclosureTier: 'INVITED_HOUSEHOLDS' },
    });

    const passcodeUnderInvitedRes = await capabilitiesGET(
      new NextRequest('http://localhost:3000/api/registry/capabilities', {
        headers: { cookie: `guest_auth=${guestToken}` },
      })
    );
    const passcodeUnderInvitedJson = await passcodeUnderInvitedRes.json();
    expect(passcodeUnderInvitedJson.data.shippingDisclosureTier).toBe('INVITED_HOUSEHOLDS');
    expect(passcodeUnderInvitedJson.data.hasShippingAddress).toBe(true);
    expect(passcodeUnderInvitedJson.data.shippingAddress).toBeUndefined();

    (getGuestInviteSession as jest.Mock).mockResolvedValueOnce({
      code: 'HOUSE27',
      guestName: 'The Rivera Family',
    });
    const invitedHouseholdRes = await capabilitiesGET(
      new NextRequest('http://localhost:3000/api/registry/capabilities', {
        headers: { cookie: `guest_auth=${guestToken}` },
      })
    );
    const invitedHouseholdJson = await invitedHouseholdRes.json();
    expect(invitedHouseholdJson.data.shippingAddress?.addressLine1).toBe('101 Maple Ave');

    // 2d. POST_CLAIM_ONLY: shippingAddress withheld pre-claim even for verified households, while hasShippingAddress=true
    await prisma.appConfig.update({
      where: { id: 'global' },
      data: { shippingDisclosureTier: 'POST_CLAIM_ONLY' },
    });

    (getGuestInviteSession as jest.Mock).mockResolvedValueOnce({
      code: 'HOUSE27',
      guestName: 'The Rivera Family',
    });
    const postClaimCapRes = await capabilitiesGET(
      new NextRequest('http://localhost:3000/api/registry/capabilities', {
        headers: { cookie: `guest_auth=${guestToken}` },
      })
    );
    const postClaimCapJson = await postClaimCapRes.json();
    expect(postClaimCapJson.data.shippingDisclosureTier).toBe('POST_CLAIM_ONLY');
    expect(postClaimCapJson.data.hasShippingAddress).toBe(true);
    expect(postClaimCapJson.data.shippingAddress).toBeUndefined();
  });

  it('enforces registryGiftAccessTier on POST /api/registry/contribute and reveals post-claim shippingAddress on physical claims under POST_CLAIM_ONLY', async () => {
    const sendEmailSpy = jest
      .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
      .mockResolvedValue({ success: true });

    try {
      await prisma.appConfig.create({
        data: {
          id: 'global',
          partner1Name: 'Alex',
          partner2Name: 'Taylor',
          shippingRecipientName: 'Alex & Taylor',
          shippingAddressLine1: '550 Blossom Way',
          shippingCity: 'Bend',
          shippingState: 'OR',
          shippingZip: '97701',
          shippingCountry: 'United States',
          defaultPaymentHandleType: 'Venmo',
          defaultPaymentHandle: '@alex-taylor',
          registryGiftAccessTier: 'PASSCODE_GUESTS',
          shippingDisclosureTier: 'POST_CLAIM_ONLY',
          maxPendingReservations: 5,
        },
      });

      const media = await prisma.media.create({
        data: { id: 'media-tier-test', url: '/images/kettle.jpg' },
      });
      const physicalItem = await prisma.registryItem.create({
        data: {
          id: 'item-tier-phys',
          name: 'Copper Kettle',
          description: 'Stovetop gooseneck kettle',
          price: 110,
          quantity: 3,
          category: 'Kitchen',
          imageId: media.id,
          itemType: 'PHYSICAL',
          isGroupGift: false,
          vendorUrl: 'https://retailer.example.com/kettle',
        },
      });
      const cashFund = await prisma.registryItem.create({
        data: {
          id: 'item-tier-fund',
          name: 'Kyoto Bullet Train Fund',
          description: 'Shinkansen tickets',
          price: 400,
          category: 'Honeymoon',
          imageId: media.id,
          itemType: 'CASH_FUND',
          isGroupGift: true,
        },
      });

      const guestToken = await signGuestToken({ guest: true });

      // 1. Default PASSCODE_GUESTS: passcode guest claims physical gift AND records zero-fee fund transfer without InvitationCode
      const claimPhysRes = await contributePOST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `guest_auth=${guestToken}`,
          },
          body: JSON.stringify({
            itemId: physicalItem.id,
            name: 'Passcode Coworker',
            email: 'coworker@example.com',
            amount: 110,
          }),
        })
      );
      expect(claimPhysRes.status).toBe(200);
      const claimPhysBody = await claimPhysRes.json();
      expect(claimPhysBody.data.claimActions).toBeDefined();
      expect(claimPhysBody.data.claimActions.shippingAddress).toMatchObject({
        recipientName: 'Alex & Taylor',
        addressLine1: '550 Blossom Way',
        city: 'Bend',
        state: 'OR',
        zip: '97701',
      });

      const fundContribRes = await contributePOST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `guest_auth=${guestToken}`,
          },
          body: JSON.stringify({
            itemId: cashFund.id,
            name: 'Passcode Coworker',
            email: 'coworker@example.com',
            amount: 75,
          }),
        })
      );
      expect(fundContribRes.status).toBe(200);

      // 2. Switch to INVITED_HOUSEHOLDS: passcode-only guest rejected with 403 + clear invitation code guidance
      await prisma.appConfig.update({
        where: { id: 'global' },
        data: { registryGiftAccessTier: 'INVITED_HOUSEHOLDS' },
      });

      const blockedPasscodeRes = await contributePOST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `guest_auth=${guestToken}`,
          },
          body: JSON.stringify({
            itemId: physicalItem.id,
            name: 'Passcode Coworker',
            email: 'coworker@example.com',
            amount: 110,
          }),
        })
      );
      expect(blockedPasscodeRes.status).toBe(403);
      const blockedBody = await blockedPasscodeRes.json();
      expect(blockedBody.error.message ?? blockedBody.error).toMatch(/household invitation code/i);

      // 3. Verified household invitation code succeeds under INVITED_HOUSEHOLDS
      const inviteRow = await prisma.invitationCode.create({
        data: {
          id: 'inv-household-1',
          code: 'RIVERA27',
          guestName: 'Elena Rivera',
        },
      });
      (getGuestInviteSession as jest.Mock).mockResolvedValueOnce({
        code: inviteRow.code,
        guestName: inviteRow.guestName,
      });

      const allowedHouseholdRes = await contributePOST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `guest_auth=${guestToken}`,
          },
          body: JSON.stringify({
            itemId: physicalItem.id,
            name: 'Elena Rivera',
            amount: 110,
          }),
        })
      );
      expect(allowedHouseholdRes.status).toBe(200);
    } finally {
      sendEmailSpy.mockRestore();
    }
  });

  it('enforces configurable maxPendingReservations only on RESERVED PHYSICAL items, exempts cash/experience funds, returns /guest/claim on 429, and manages multi-item Claim Hub safely', async () => {
    const sendEmailSpy = jest
      .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
      .mockResolvedValue({ success: true });

    try {
      await prisma.appConfig.create({
        data: {
          id: 'global',
          partner1Name: 'Alex',
          partner2Name: 'Taylor',
          shippingRecipientName: 'Alex & Taylor',
          shippingAddressLine1: '88 Harbor View Dr',
          shippingCity: 'Astoria',
          shippingState: 'OR',
          shippingZip: '97103',
          shippingCountry: 'United States',
          defaultPaymentHandleType: 'Venmo',
          defaultPaymentHandle: '@alex-taylor',
          registryGiftAccessTier: 'PASSCODE_GUESTS',
          shippingDisclosureTier: 'PASSCODE_GUESTS',
          maxPendingReservations: 2,
        },
      });

      const invite = await prisma.invitationCode.create({
        data: {
          id: 'inv-hub-family',
          code: 'FAMILY27',
          guestName: 'Aunt Clara',
        },
      });
      const otherInvite = await prisma.invitationCode.create({
        data: {
          id: 'inv-other-family',
          code: 'OTHER27',
          guestName: 'Uncle Bob',
        },
      });

      const media = await prisma.media.create({
        data: { id: 'media-hub-items', url: '/images/gift.jpg' },
      });

      const [phys1, phys2, phys3, cashFund, expFund] = await Promise.all([
        prisma.registryItem.create({
          data: {
            id: 'hub-phys-1',
            name: 'Linen Duvet Set',
            description: 'Belgian flax linen',
            price: 240,
            category: 'Bedroom',
            imageId: media.id,
            itemType: 'PHYSICAL',
            vendorUrl: 'https://retailer.example.com/duvet',
          },
        }),
        prisma.registryItem.create({
          data: {
            id: 'hub-phys-2',
            name: 'Stoneware Dinnerware',
            description: '16-piece ceramic set',
            price: 180,
            category: 'Dining',
            imageId: media.id,
            itemType: 'PHYSICAL',
            vendorUrl: 'https://retailer.example.com/stoneware',
          },
        }),
        prisma.registryItem.create({
          data: {
            id: 'hub-phys-3',
            name: 'Walnut Cutting Board',
            description: 'End-grain butcher block',
            price: 95,
            category: 'Kitchen',
            imageId: media.id,
            itemType: 'PHYSICAL',
            vendorUrl: 'https://retailer.example.com/board',
          },
        }),
        prisma.registryItem.create({
          data: {
            id: 'hub-cash-fund',
            name: 'First Home Down Payment Fund',
            description: 'Help us plant roots',
            price: 2000,
            category: 'Cash Fund',
            imageId: media.id,
            itemType: 'CASH_FUND',
            isGroupGift: true,
          },
        }),
        prisma.registryItem.create({
          data: {
            id: 'hub-exp-fund',
            name: 'Amalfi Cooking Class',
            description: 'Handmade pasta lesson',
            price: 300,
            category: 'Experiences',
            imageId: media.id,
            itemType: 'EXPERIENCE_FUND',
            isGroupGift: true,
          },
        }),
      ]);

      // Seed another household's hold to prove zero cross-visitor leakage
      const otherPhys = await prisma.registryItem.create({
        data: {
          id: 'hub-other-phys',
          name: 'Secret Blender',
          description: 'Other guest hold',
          price: 150,
          category: 'Kitchen',
          imageId: media.id,
          itemType: 'PHYSICAL',
          vendorUrl: 'https://retailer.example.com/blender',
        },
      });
      await prisma.contributor.create({
        data: {
          id: 'contrib-other-household',
          registryItem: { connect: { id: otherPhys.id } },
          invitationCode: { connect: { id: otherInvite.id } },
          name: 'Uncle Bob',
          amount: 150,
          status: 'RESERVED',
        },
      });

      const guestToken = await signGuestToken({ guest: true });
      (getGuestInviteSession as jest.Mock).mockResolvedValue({
        code: invite.code,
        guestName: invite.guestName,
      });

      // Pre-existing RESERVED cash/experience fund transfers must NOT count toward physical hold quota
      const fundRes1 = await contributePOST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `guest_auth=${guestToken}`,
          },
          body: JSON.stringify({
            itemId: cashFund.id,
            name: 'Aunt Clara',
            amount: 100,
          }),
        })
      );
      expect(fundRes1.status).toBe(200);

      // Claim 2 physical items up to maxPendingReservations=2
      const claim1Res = await contributePOST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `guest_auth=${guestToken}`,
          },
          body: JSON.stringify({
            itemId: phys1.id,
            name: 'Aunt Clara',
            amount: 240,
          }),
        })
      );
      expect(claim1Res.status).toBe(200);
      const claim1Json = await claim1Res.json();

      const claim2Res = await contributePOST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `guest_auth=${guestToken}`,
          },
          body: JSON.stringify({
            itemId: phys2.id,
            name: 'Aunt Clara',
            amount: 180,
          }),
        })
      );
      expect(claim2Res.status).toBe(200);
      const claim2Json = await claim2Res.json();

      // 3rd physical item exceeds maxPendingReservations=2 -> 429 with direct /guest/claim link
      const claim3BlockedRes = await contributePOST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `guest_auth=${guestToken}`,
          },
          body: JSON.stringify({
            itemId: phys3.id,
            name: 'Aunt Clara',
            amount: 95,
          }),
        })
      );
      expect(claim3BlockedRes.status).toBe(429);
      const claim3BlockedJson = await claim3BlockedRes.json();
      expect(claim3BlockedJson.error.message ?? claim3BlockedJson.error).toContain('/guest/claim');

      // Experience fund transfer STILL succeeds even when physical holds are full!
      const expFundRes = await contributePOST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `guest_auth=${guestToken}`,
          },
          body: JSON.stringify({
            itemId: expFund.id,
            name: 'Aunt Clara',
            amount: 120,
          }),
        })
      );
      expect(expFundRes.status).toBe(200);

      // SECURITY GUARDRAIL: Shared guest_auth cookie ALONE (without guest_invite_session or signed token) MUST NEVER list holds!
      (getGuestInviteSession as jest.Mock).mockResolvedValueOnce(null);
      const sharedPasscodeOnlyHubRes = await claimGET(
        new NextRequest('http://localhost:3000/api/registry/claim?hub=1', {
          headers: { cookie: `guest_auth=${guestToken}` },
        })
      );
      expect(sharedPasscodeOnlyHubRes.status).toBe(400);
      const sharedPasscodeOnlyBody = await sharedPasscodeOnlyHubRes.json();
      expect(JSON.stringify(sharedPasscodeOnlyBody)).not.toContain('Secret Blender');
      expect(JSON.stringify(sharedPasscodeOnlyBody)).not.toContain('Linen Duvet Set');

      // Scanner-safe GET /api/registry/claim?hub=1 with verified guest_invite_session returns Aunt Clara's holds ONLY and mutates nothing
      sendEmailSpy.mockClear();
      const hubGetRes = await claimGET(
        new NextRequest('http://localhost:3000/api/registry/claim?hub=1', {
          headers: { cookie: `guest_auth=${guestToken}` },
        })
      );
      expect(hubGetRes.status).toBe(200);
      const hubGetJson = await hubGetRes.json();
      expect(hubGetJson.data.maxPendingReservations).toBe(2);
      expect(hubGetJson.data.coupleNames).toBe('Alex & Taylor');
      expect(hubGetJson.data.shippingAddress?.addressLine1).toBe('88 Harbor View Dr');
      const holdItemNames = hubGetJson.data.holds.map((h: { itemName: string }) => h.itemName);
      expect(holdItemNames).toEqual(
        expect.arrayContaining(['Linen Duvet Set', 'Stoneware Dinnerware'])
      );
      expect(holdItemNames).not.toContain('Secret Blender');
      expect(sendEmailSpy).not.toHaveBeenCalled();

      // Token-based multi-item lookup (?hub=1&tokens=...) also works without guest_invite_session
      (getGuestInviteSession as jest.Mock).mockResolvedValueOnce(null);
      const token1 = claim1Json.data.claimActions.confirmToken as string;
      const token2 = claim2Json.data.claimActions.confirmToken as string;
      const cancelToken2 = claim2Json.data.claimActions.cancelToken as string;

      const tokenHubRes = await claimGET(
        new NextRequest(
          `http://localhost:3000/api/registry/claim?hub=1&token=${encodeURIComponent(token1)}&tokens=${encodeURIComponent(token2)}`
        )
      );
      expect(tokenHubRes.status).toBe(200);
      const tokenHubJson = await tokenHubRes.json();
      expect(tokenHubJson.data.holds).toHaveLength(2);

      // Confirm hold 1 with retailerOrderNumber, carrier, and trackingNumber
      const confirm1Res = await claimPOST(
        new NextRequest('http://localhost:3000/api/registry/claim', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: token1,
            retailerOrderNumber: 'ORD-99281',
            carrier: 'UPS',
            trackingNumber: '1Z999AA10123456784',
          }),
        })
      );
      expect(confirm1Res.status).toBe(200);

      const verifiedToken1 = await verifyContributorActionToken(token1, 'confirm');
      const updatedContrib1 = await prisma.contributor.findUniqueOrThrow({
        where: { id: verifiedToken1!.contributorId },
      });
      expect(updatedContrib1.status).toBe('CONFIRMED');
      expect(updatedContrib1.retailerOrderNumber).toBe('ORD-99281');
      expect(updatedContrib1.carrier).toBe('UPS');
      expect(updatedContrib1.trackingNumber).toBe('1Z999AA10123456784');

      // Release hold 2 via signed cancel token -> frees physical hold slot so phys3 can now be reserved!
      const cancel2Res = await claimPOST(
        new NextRequest('http://localhost:3000/api/registry/claim', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token: cancelToken2 }),
        })
      );
      expect(cancel2Res.status).toBe(200);

      const claim3AllowedRes = await contributePOST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            cookie: `guest_auth=${guestToken}`,
          },
          body: JSON.stringify({
            itemId: phys3.id,
            name: 'Aunt Clara',
            amount: 95,
          }),
        })
      );
      expect(claim3AllowedRes.status).toBe(200);
    } finally {
      sendEmailSpy.mockRestore();
    }
  });
});
