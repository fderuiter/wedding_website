/** @jest-environment node */

import { NextRequest } from 'next/server';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { middleware } from '@/middleware';
import { AppConfigSchema, PublicAppConfigSchema } from '@/features/content';
import { toPublicAppConfig, toAdminAppConfig, getAppConfig } from '@/lib/config';
import { maskRegistryItem, sanitizeRegistryItem } from '../lib/masking';
import { GET as getCapabilities } from '../api/capabilities';
import { POST as contributePOST } from '../api/contribute';
import { POST as paymentIntentPOST } from '../api/payment-intent';
import { createRegistryRepository } from '../repository';
import { dispatchContributionNotifications } from '../notifications';
import { parseRegistryCsv, generateRegistryCsvTemplate } from '../utils/csv';
import { registryService } from '../service';
import { MultiChannelMessagingProvider } from '@/features/broadcast';
import { isAdminRequest } from '@/core/auth/auth.server';

jest.unmock('@prisma/client');
jest.unmock('@prisma/adapter-pg');
jest.unmock('pg');

const { PrismaClient } = jest.requireActual('@prisma/client');
const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://wedding:wedding123@localhost:5432/wedding_test?schema=public';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const realPrisma = new PrismaClient({ adapter });

jest.mock('@/lib/config', () => {
  const actual = jest.requireActual('@/lib/config');
  return {
    ...actual,
    getAppConfig: jest.fn(),
  };
});

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn().mockResolvedValue(false),
}));

jest.mock('@/core/auth/guestInviteSession', () => ({
  getGuestInviteSession: jest.fn().mockResolvedValue(null),
}));

const mockStripeCreate = jest.fn();
const mockStripeRetrieve = jest.fn();

jest.mock('@/lib/stripe', () => {
  const actual = jest.requireActual('@/lib/stripe');
  return {
    ...actual,
    getStripeInstance: jest.fn(() => ({
      paymentIntents: {
        create: mockStripeCreate,
        retrieve: mockStripeRetrieve,
      },
    })),
  };
});

describe('Registry Ledger, Multi-Quantity Capacity, Shipping Security Perimeter & Order Tracking', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    (isAdminRequest as jest.Mock).mockResolvedValue(false);
    (getAppConfig as jest.Mock).mockResolvedValue({
      modules: { registry: true, groupGifting: true },
      shippingRecipientName: '',
      shippingAddressLine1: '',
      shippingAddressLine2: '',
      shippingCity: '',
      shippingState: '',
      shippingZip: '',
      shippingCountry: '',
      shippingPhone: '',
      shippingDeliveryNotes: '',
      defaultPaymentHandleType: '',
      defaultPaymentHandle: '',
    });
  });

  afterAll(async () => {
    process.env = originalEnv;
    await realPrisma.$disconnect();
    await pool.end();
  });

  describe('Security Perimeter: PublicAppConfig vs AdminAppConfig & Capabilities', () => {
    it('strips all shipping address, phone, delivery notes, and default payment handle fields from PublicAppConfigSchema and toPublicAppConfig while preserving them in toAdminAppConfig', () => {
      const fullConfig = AppConfigSchema.parse({
        id: 'global',
        brideName: 'Alex',
        groomName: 'Jordan',
        partner1Name: 'Alex',
        partner2Name: 'Jordan',
        weddingDate: new Date('2027-06-15T00:00:00.000Z'),
        baseUrl: 'https://wedding.example.com',
        venueName: 'Botanical Conservatory',
        venueAddress: '100 Park Ave',
        venueCity: 'Portland',
        venueState: 'OR',
        venueZip: '97201',
        latitude: 45.52,
        longitude: -122.67,
        heroTitle: 'Welcome',
        heroSubtitle: 'Celebrate with us',
        storyText: 'Our story',
        venueDescription: 'Garden conservatory',
        travelAdvice: 'Fly PDX',
        seoTitle: 'Alex & Jordan',
        seoDescription: 'Wedding site',
        faviconUrl: '/assets/favicon.png',
        ogImageUrl: '/images/og.jpg',
        seoKeywords: 'wedding',
        features: [],
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        shippingRecipientName: 'Alex & Jordan Private Home',
        shippingAddressLine1: '999 Secret Residential Lane',
        shippingAddressLine2: 'Penthouse 9',
        shippingCity: 'Beaverton',
        shippingState: 'OR',
        shippingZip: '97005',
        shippingCountry: 'United States',
        shippingPhone: '+1-503-555-0199',
        shippingDeliveryNotes: 'Secret gate code #8899',
        defaultPaymentHandleType: 'Venmo',
        defaultPaymentHandle: '@private-couple-venmo',
      });

      const publicDto = toPublicAppConfig(fullConfig);
      const reparsedPublic = PublicAppConfigSchema.parse(publicDto);
      const serializedPublic = JSON.stringify(reparsedPublic);

      expect(serializedPublic).not.toContain('999 Secret Residential Lane');
      expect(serializedPublic).not.toContain('Penthouse 9');
      expect(serializedPublic).not.toContain('+1-503-555-0199');
      expect(serializedPublic).not.toContain('Secret gate code #8899');
      expect(serializedPublic).not.toContain('@private-couple-venmo');
      expect('shippingAddressLine1' in publicDto).toBe(false);
      expect('shippingPhone' in publicDto).toBe(false);

      const adminDto = toAdminAppConfig(fullConfig);
      expect(adminDto.shippingRecipientName).toBe('Alex & Jordan Private Home');
      expect(adminDto.shippingAddressLine1).toBe('999 Secret Residential Lane');
      expect(adminDto.shippingPhone).toBe('+1-503-555-0199');
      expect(adminDto.shippingDeliveryNotes).toBe('Secret gate code #8899');
      expect(adminDto.defaultPaymentHandleType).toBe('Venmo');
      expect(adminDto.defaultPaymentHandle).toBe('@private-couple-venmo');
    });

    it('blocks unauthenticated requests to GET /api/registry/capabilities in middleware with HTTP 401 and serves shipping details via capabilities when configured', async () => {
      process.env.GUEST_PASSCODE = 'celebrate2027';
      process.env.GUEST_SESSION_SECRET = '0123456789abcdef0123456789abcdef';

      const unauthReq = new NextRequest('http://localhost:3000/api/registry/capabilities');
      const unauthRes = await middleware(unauthReq);
      expect(unauthRes.status).toBe(401);

      (getAppConfig as jest.Mock).mockResolvedValue({
        modules: { registry: true, groupGifting: true },
        shippingRecipientName: 'Alex & Jordan',
        shippingAddressLine1: '742 Evergreen Terrace',
        shippingAddressLine2: 'Apt 4B',
        shippingCity: 'Portland',
        shippingState: 'OR',
        shippingZip: '97205',
        shippingCountry: 'United States',
        shippingPhone: '(555) 234-5678',
        shippingDeliveryNotes: 'Front porch',
        defaultPaymentHandleType: 'Venmo',
        defaultPaymentHandle: '@site-default',
      });

      const capRes = await getCapabilities(
        new NextRequest('http://localhost:3000/api/registry/capabilities')
      );
      expect(capRes.status).toBe(200);
      const body = await capRes.json();
      expect(body.data.defaultPaymentHandleType).toBe('Venmo');
      expect(body.data.defaultPaymentHandle).toBe('@site-default');
      expect(body.data.shippingAddress).toEqual({
        recipientName: 'Alex & Jordan',
        addressLine1: '742 Evergreen Terrace',
        addressLine2: 'Apt 4B',
        city: 'Portland',
        state: 'OR',
        zip: '97205',
        country: 'United States',
        phone: '(555) 234-5678',
        deliveryNotes: 'Front porch',
      });
    });
  });

  describe('Contributor Masking & Couple Alert Email Escaping', () => {
    it('masks retailerOrderNumber, carrier, and trackingNumber for non-admin responses while retaining them for admins', () => {
      const rawItem = {
        id: 'item-ext-1',
        name: 'Cast Iron Skillet',
        description: '12-inch skillet',
        price: 80,
        imageId: null,
        image: { id: 'img-1', url: '/images/placeholder.png' },
        vendorUrl: 'https://store.example.com/skillet',
        quantity: 1,
        category: 'Kitchen',
        isGroupGift: false,
        isMostWanted: false,
        displayOrder: 0,
        isSample: false,
        purchased: true,
        purchaserName: 'Morgan Guest',
        amountContributed: 80,
        itemType: 'PHYSICAL' as const,
        paymentHandleType: null,
        paymentHandle: null,
        contributors: [
          {
            id: 'contrib-1',
            name: 'Morgan Guest',
            email: 'morgan@example.com',
            amount: 80,
            coverFee: false,
            feeAmount: 0,
            message: 'Happy cooking!',
            date: '2026-06-10T00:00:00.000Z',
            thankYouStatus: 'Unsent',
            thankYouSentAt: null,
            thankYouNote: null,
            retailerOrderNumber: 'ORD-SECRET-99',
            carrier: 'UPS',
            trackingNumber: '1ZSECRET999',
          },
        ],
      };

      const guestView = maskRegistryItem(rawItem as any);
      const serializedGuest = JSON.stringify(guestView);
      expect(serializedGuest).not.toContain('ORD-SECRET-99');
      expect(serializedGuest).not.toContain('1ZSECRET999');
      expect(guestView.contributors[0]).not.toHaveProperty('retailerOrderNumber');
      expect(guestView.contributors[0]).not.toHaveProperty('carrier');
      expect(guestView.contributors[0]).not.toHaveProperty('trackingNumber');

      const adminView = sanitizeRegistryItem(rawItem as any);
      expect(adminView.contributors[0].retailerOrderNumber).toBe('ORD-SECRET-99');
      expect(adminView.contributors[0].carrier).toBe('UPS');
      expect(adminView.contributors[0].trackingNumber).toBe('1ZSECRET999');
    });

    it('renders HTML-escaped order and tracking details in couple alert emails', async () => {
      const sendEmailSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
        .mockResolvedValue({ success: true });

      await dispatchContributionNotifications({
        itemId: 'item-ext-alert-1',
        targetItem: {
          id: 'item-ext-alert-1',
          name: 'Espresso Machine',
          itemType: 'PHYSICAL',
          isGroupGift: false,
        },
        updatedItem: {
          id: 'item-ext-alert-1',
          name: 'Espresso Machine',
          itemType: 'PHYSICAL',
          isGroupGift: false,
          contributors: [
            {
              id: 'c-alert-1',
              name: 'Morgan Guest',
              amount: 300,
              retailerOrderNumber: 'ORD-<script>alert(1)</script>',
              carrier: 'UPS & Co',
              trackingNumber: '1Z"999',
            },
          ],
        },
        contribution: {
          name: 'Morgan Guest',
          amount: 300,
          retailerOrderNumber: 'ORD-<script>alert(1)</script>',
          carrier: 'UPS & Co',
          trackingNumber: '1Z"999',
        },
        config: {
          emailProvider: 'resend',
          contactEmail: 'couple@example.com',
          baseUrl: 'https://wedding.example.com',
          timezone: 'UTC',
        },
        repository: {
          claimContributorEmailSend: jest.fn().mockResolvedValue(true),
        } as any,
      });

      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      const sentPayload = sendEmailSpy.mock.calls[0][0];
      expect(sentPayload.to).toBe('couple@example.com');
      expect(sentPayload.body).toContain('Retailer Order #');
      expect(sentPayload.body).toContain('ORD-&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(sentPayload.body).not.toContain('<script>');
      expect(sentPayload.body).toContain('UPS &amp; Co');
      expect(sentPayload.body).toContain('1Z&quot;999');

      sendEmailSpy.mockRestore();
    });
  });

  describe('Physical Group Gift Payment Enforcement & CSV Import Support', () => {
    it('rejects physical group gift contributions lacking both verified paymentIntentId and configured handle with HTTP 400, and allows fallback to site default handle', async () => {
      const getItemSpy = jest.spyOn(registryService, 'getItemById').mockResolvedValue({
        id: 'phys-group-1',
        name: 'Stand Mixer',
        description: 'Tilt-head mixer',
        price: 400,
        amountContributed: 0,
        purchased: false,
        isGroupGift: true,
        isSample: false,
        itemType: 'PHYSICAL',
        paymentHandleType: null,
        paymentHandle: null,
        quantity: 1,
        category: 'Kitchen',
        image: { id: 'img-1', url: '/images/placeholder.png' },
        contributors: [],
      } as any);
      const contributeSpy = jest.spyOn(registryService, 'contributeToItem').mockResolvedValue({
        id: 'phys-group-1',
        name: 'Stand Mixer',
        price: 400,
        amountContributed: 100,
        purchased: false,
        isGroupGift: true,
        contributors: [{ id: 'c-1', name: 'Guest', amount: 100 }],
      } as any);

      const unconfiguredRes = await contributePOST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          body: JSON.stringify({
            itemId: 'phys-group-1',
            name: 'Guest',
            amount: 100,
          }),
        })
      );
      expect(unconfiguredRes.status).toBe(400);
      expect(contributeSpy).not.toHaveBeenCalled();

      // Now configure site-wide default payment handle
      (getAppConfig as jest.Mock).mockResolvedValue({
        modules: { registry: true, groupGifting: true },
        defaultPaymentHandleType: 'Venmo',
        defaultPaymentHandle: '@couple-default',
      });

      const fallbackRes = await contributePOST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          body: JSON.stringify({
            itemId: 'phys-group-1',
            name: 'Guest',
            amount: 100,
          }),
        })
      );
      expect(fallbackRes.status).toBe(200);
      expect(contributeSpy).toHaveBeenCalledTimes(1);

      getItemSpy.mockRestore();
      contributeSpy.mockRestore();
    });

    it('parses and exports Payment Service and Payment Handle columns for physical group gifts in CSV imports', () => {
      const template = generateRegistryCsvTemplate();
      expect(template).toContain('Payment Service,Payment Handle');

      const parsed = parseRegistryCsv(template);
      expect(parsed.validCount).toBeGreaterThanOrEqual(3);
      const standMixerRow = parsed.rows.find((r) => r.name.includes('Stand Mixer'));
      expect(standMixerRow?.isValid).toBe(true);
      expect(standMixerRow?.isGroupGift).toBe(true);
      expect(standMixerRow?.paymentHandleType).toBe('Venmo');
      expect(standMixerRow?.paymentHandle).toBe('@couple-venmo');

      const dutchOvenRow = parsed.rows.find((r) => r.name.includes('Dutch Oven'));
      expect(dutchOvenRow?.isValid).toBe(true);
      expect(dutchOvenRow?.isGroupGift).toBe(true);
      expect(dutchOvenRow?.paymentHandle).toBeUndefined();
    });
  });

  describe('Multi-Quantity Capacity in PaymentIntent & PostgreSQL Repository', () => {
    it('computes total capacity from price * quantity and enforces whole-unit multiples on non-group items in POST /api/registry/payment-intent', async () => {
      const getItemSpy = jest.spyOn(registryService, 'getItemById').mockResolvedValue({
        id: 'multi-qty-pi-1',
        name: 'Place Setting',
        price: 50,
        quantity: 4, // $200 total capacity
        amountContributed: 50, // 1 claimed -> $150 (3 units) remaining
        purchased: false,
        isGroupGift: false,
        isSample: false,
        itemType: 'PHYSICAL',
        category: 'Dining',
        image: { id: 'img-1', url: '/images/placeholder.png' },
        contributors: [],
      } as any);

      // Fractional unit amount ($75 on $50 unit price) rejected with HTTP 400
      const badMultipleRes = await paymentIntentPOST(
        new NextRequest('http://localhost:3000/api/registry/payment-intent', {
          method: 'POST',
          body: JSON.stringify({
            itemId: 'multi-qty-pi-1',
            amount: 75,
            coverFee: false,
          }),
        })
      );
      expect(badMultipleRes.status).toBe(400);

      // Exceeding remaining 3 units ($200 > $150 remaining) rejected with HTTP 400
      const overRemainingRes = await paymentIntentPOST(
        new NextRequest('http://localhost:3000/api/registry/payment-intent', {
          method: 'POST',
          body: JSON.stringify({
            itemId: 'multi-qty-pi-1',
            amount: 200,
            coverFee: false,
          }),
        })
      );
      expect(overRemainingRes.status).toBe(400);

      // Valid 2-unit claim ($100) succeeds
      mockStripeCreate.mockResolvedValueOnce({
        id: 'pi_multi_2_units',
        client_secret: 'pi_multi_2_units_secret',
      });
      const validUnitsRes = await paymentIntentPOST(
        new NextRequest('http://localhost:3000/api/registry/payment-intent', {
          method: 'POST',
          body: JSON.stringify({
            itemId: 'multi-qty-pi-1',
            amount: 100,
            coverFee: false,
          }),
        })
      );
      expect(validUnitsRes.status).toBe(200);

      getItemSpy.mockRestore();
    });

    it('keeps remaining units open across partial unit claims in PostgreSQL and marks purchased=true only when all requested units are covered, persisting order tracking fields', async () => {
      const repo = createRegistryRepository(realPrisma);
      const created = await repo.createItem({
        itemType: 'PHYSICAL',
        name: 'Test Multi-Unit Linen Set',
        description: 'Set of Belgian linen napkins',
        price: 60,
        quantity: 3, // Total capacity = $180
        category: 'Dining',
        isGroupGift: false,
        isMostWanted: false,
        displayOrder: 0,
        vendorUrl: 'https://retailer.example.com/linen',
      });

      try {
        // Claim 1 unit ($60) with order & tracking details
        const afterFirstClaim = await repo.contributeToItem(created.id, {
          name: 'First Guest',
          email: 'first@example.com',
          amount: 60,
          retailerOrderNumber: 'RET-1001',
          carrier: 'FedEx',
          trackingNumber: 'FX-111222333',
        });

        expect(afterFirstClaim.amountContributed).toBe(60);
        expect(afterFirstClaim.purchased).toBe(false);
        expect(afterFirstClaim.contributors[0]).toEqual(
          expect.objectContaining({
            name: 'First Guest',
            amount: 60,
            retailerOrderNumber: 'RET-1001',
            carrier: 'FedEx',
            trackingNumber: 'FX-111222333',
          })
        );

        // Attempting to over-claim 3 units ($180) when only 2 remain ($120) throws 400
        await expect(
          repo.contributeToItem(created.id, {
            name: 'Overclaiming Guest',
            amount: 180,
          })
        ).rejects.toThrow(/greater than the remaining amount/i);

        // Claim remaining 2 units ($120) -> item becomes purchased=true
        const afterFinalClaim = await repo.contributeToItem(created.id, {
          name: 'Second Guest',
          amount: 120,
        });

        expect(afterFinalClaim.amountContributed).toBe(180);
        expect(afterFinalClaim.purchased).toBe(true);
        expect(afterFinalClaim.purchaserName).toBe('First Guest, Second Guest');
      } finally {
        await realPrisma.contributor.deleteMany({ where: { registryItemId: created.id } });
        await realPrisma.registryItem.delete({ where: { id: created.id } });
      }
    });
  });
});
