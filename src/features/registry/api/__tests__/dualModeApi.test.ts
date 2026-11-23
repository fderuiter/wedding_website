/** @jest-environment node */

import { NextRequest } from 'next/server';
import Stripe from 'stripe';
import { GET as getCapabilities } from '../capabilities';
import { POST as createPaymentIntent } from '../payment-intent';
import { POST as contributeToRegistry } from '../contribute';
import { POST as stripeWebhookPOST } from '../webhook';
import { middleware } from '@/middleware';
import { registryService } from '../../service';
import { createRegistryRepository } from '../../repository';
import { getAppConfig } from '@/lib/config';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { getStripeInstance } from '@/lib/stripe';

jest.mock('../../service', () => ({
  registryService: {
    getItemById: jest.fn(),
    contributeToItem: jest.fn(),
    getActiveCatalogCapabilitiesSummary: jest.fn(),
  },
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/core/auth/guestInviteSession', () => ({
  getGuestInviteSession: jest.fn().mockResolvedValue(null),
}));

const mockPaymentIntentsCreate = jest.fn();
const mockPaymentIntentsRetrieve = jest.fn();
const mockPaymentIntentsUpdate = jest.fn();
const realStripeWebhooks = new Stripe('sk_test_unit_environment_only', {
  apiVersion: '2025-02-24.acacia' as any,
}).webhooks;

jest.mock('@/lib/stripe', () => {
  const actual = jest.requireActual('@/lib/stripe');
  return {
    ...actual,
    getStripeInstance: jest.fn(() => ({
      paymentIntents: {
        create: mockPaymentIntentsCreate,
        retrieve: mockPaymentIntentsRetrieve,
        update: mockPaymentIntentsUpdate,
      },
      webhooks: realStripeWebhooks,
    })),
  };
});

describe('Dual-Mode Registry Capabilities, PaymentIntent & Contribute APIs', () => {
  const originalEnv = process.env;

  const dualModeFund = {
    id: 'fund-dual-1',
    name: 'Honeymoon Adventure Fund',
    price: 1000,
    amountContributed: 100,
    purchased: false,
    isGroupGift: true,
    isSample: false,
    itemType: 'CASH_FUND',
    paymentHandleType: 'Venmo',
    paymentHandle: '@happy-couple',
    image: { id: 'img-1', url: '/images/placeholder.png' },
    contributors: [],
  };

  const unconfiguredFund = {
    ...dualModeFund,
    id: 'fund-unconfigured-1',
    paymentHandleType: null,
    paymentHandle: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

    (getAppConfig as jest.Mock).mockResolvedValue({
      modules: { registry: true, groupGifting: true },
    });
    (isAdminRequest as jest.Mock).mockResolvedValue(false);
    (getGuestInviteSession as jest.Mock).mockResolvedValue(null);
    (registryService.getActiveCatalogCapabilitiesSummary as jest.Mock).mockResolvedValue({
      hasActivePhysicalItems: true,
      hasActiveFundsOrGroupGifts: true,
    });
    (registryService.getItemById as jest.Mock).mockResolvedValue(dualModeFund);
    (registryService.contributeToItem as jest.Mock).mockImplementation(async (_id, payload) => ({
      ...dualModeFund,
      amountContributed: dualModeFund.amountContributed + payload.amount,
      contributors: [
        {
          id: 'c-new',
          name: payload.name,
          amount: payload.amount,
          coverFee: payload.coverFee,
          feeAmount: payload.coverFee ? Math.round(payload.amount * 0.025 * 100) / 100 : 0,
          message: payload.message ?? null,
          date: new Date().toISOString(),
          stripePaymentIntentId: payload.stripePaymentIntentId ?? null,
          stripeChargeId: payload.stripeChargeId ?? null,
        },
      ],
    }));
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('GET /api/registry/capabilities', () => {
    it('reports cardCheckoutEnabled=false when Stripe credentials are absent', async () => {
      const req = new NextRequest('http://localhost:3000/api/registry/capabilities');
      const res = await getCapabilities(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        success: true,
        data: {
          cardCheckoutEnabled: false,
          stripePublishableKey: null,
        },
      });
    });

    it('reports cardCheckoutEnabled=true and exposes only publishable key when both Stripe keys are valid', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_valid_secret_12345';
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_valid_pub_12345';

      const req = new NextRequest('http://localhost:3000/api/registry/capabilities');
      const res = await getCapabilities(req);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        success: true,
        data: {
          cardCheckoutEnabled: true,
          stripePublishableKey: 'pk_test_valid_pub_12345',
        },
      });
      expect(JSON.stringify(body)).not.toContain('sk_test_valid_secret_12345');
    });

    it('omits shippingAddress for guest_auth-only callers and when zero active PHYSICAL items exist, and omits defaultPaymentHandle without active funds or group gifts', async () => {
      (getAppConfig as jest.Mock).mockResolvedValue({
        modules: { registry: true, groupGifting: true },
        shippingRecipientName: 'Alex & Taylor',
        shippingAddressLine1: '101 Maple Ave',
        shippingCity: 'Seattle',
        shippingState: 'WA',
        shippingZip: '98101',
        shippingCountry: 'United States',
        defaultPaymentHandleType: 'Venmo',
        defaultPaymentHandle: '@couple-venmo',
      });

      // 1. guest_auth-only caller (no guest_invite_session, not admin) -> shippingAddress omitted
      (getGuestInviteSession as jest.Mock).mockResolvedValueOnce(null);
      (registryService.getActiveCatalogCapabilitiesSummary as jest.Mock).mockResolvedValueOnce({
        hasActivePhysicalItems: true,
        hasActiveFundsOrGroupGifts: true,
      });
      const guestOnlyRes = await getCapabilities(
        new NextRequest('http://localhost:3000/api/registry/capabilities')
      );
      const guestOnlyBody = await guestOnlyRes.json();
      expect(guestOnlyBody.data.shippingAddress).toBeUndefined();
      expect(guestOnlyBody.data.defaultPaymentHandle).toBe('@couple-venmo');
      expect(guestOnlyBody.data.defaultPaymentHandleType).toBe('Venmo');

      // 2. Verified guest_invite_session, but zero active PHYSICAL items and zero active funds/group gifts -> both omitted
      (getGuestInviteSession as jest.Mock).mockResolvedValueOnce({
        code: 'INVITE26',
        guestName: 'Invited Household',
      });
      (registryService.getActiveCatalogCapabilitiesSummary as jest.Mock).mockResolvedValueOnce({
        hasActivePhysicalItems: false,
        hasActiveFundsOrGroupGifts: false,
      });
      const emptyCatalogRes = await getCapabilities(
        new NextRequest('http://localhost:3000/api/registry/capabilities')
      );
      const emptyCatalogBody = await emptyCatalogRes.json();
      expect(emptyCatalogBody.data.shippingAddress).toBeUndefined();
      expect(emptyCatalogBody.data.defaultPaymentHandle).toBeUndefined();
      expect(emptyCatalogBody.data.defaultPaymentHandleType).toBeUndefined();

      // 3. Verified guest_invite_session with active PHYSICAL items -> shippingAddress included
      (getGuestInviteSession as jest.Mock).mockResolvedValueOnce({
        code: 'INVITE26',
        guestName: 'Invited Household',
      });
      (registryService.getActiveCatalogCapabilitiesSummary as jest.Mock).mockResolvedValueOnce({
        hasActivePhysicalItems: true,
        hasActiveFundsOrGroupGifts: false,
      });
      const verifiedPhysicalRes = await getCapabilities(
        new NextRequest('http://localhost:3000/api/registry/capabilities')
      );
      const verifiedPhysicalBody = await verifiedPhysicalRes.json();
      expect(verifiedPhysicalBody.data.shippingAddress).toEqual(
        expect.objectContaining({
          recipientName: 'Alex & Taylor',
          addressLine1: '101 Maple Ave',
        })
      );
      expect(verifiedPhysicalBody.data.defaultPaymentHandle).toBeUndefined();
    });
  });

  describe('POST /api/registry/payment-intent', () => {
    it('returns HTTP 503 when Stripe card processing is not configured', async () => {
      (getStripeInstance as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Card checkout is not configured on this deployment.');
      });

      const req = new NextRequest('http://localhost:3000/api/registry/payment-intent', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'fund-dual-1',
          amount: 100,
          coverFee: false,
        }),
      });

      const res = await createPaymentIntent(req);
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toMatch(/Card checkout is not configured/i);
    });

    it('applies 2.5% fee calculation consistently in Card Checkout mode even when fund also has a paymentHandle', async () => {
      mockPaymentIntentsCreate.mockResolvedValueOnce({
        id: 'pi_dual_card_100',
        client_secret: 'pi_dual_card_100_secret_xyz',
        amount: 10250,
        currency: 'usd',
      });

      const req = new NextRequest('http://localhost:3000/api/registry/payment-intent', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'fund-dual-1',
          amount: 100,
          coverFee: true,
          name: 'Taylor Guest',
        }),
      });

      const res = await createPaymentIntent(req);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.baseAmount).toBe(100);
      expect(body.feeAmount).toBe(2.5);
      expect(body.amount).toBe(102.5);
      expect(body.netPayout).toBe(100);
      expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 10250,
          metadata: expect.objectContaining({
            baseAmount: '100.00',
            feeAmount: '2.50',
            coverFee: 'true',
            totalChargeAmount: '102.50',
          }),
        })
      );
    });
  });

  describe('POST /api/registry/contribute', () => {
    it('records self-reported direct transfer with 0% fee (coverFee=false) for verified invite sessions and returns 403 without one', async () => {
      const unverifiedRes = await contributeToRegistry(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          body: JSON.stringify({
            itemId: 'fund-dual-1',
            name: 'Unverified Direct',
            amount: 120,
          }),
        })
      );
      expect(unverifiedRes.status).toBe(403);
      expect(registryService.contributeToItem).not.toHaveBeenCalled();

      (getGuestInviteSession as jest.Mock).mockResolvedValueOnce({
        code: 'DUAL2026',
        guestName: 'Sam Direct',
      });
      const req = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'fund-dual-1',
          name: 'Sam Direct',
          amount: 120,
          message: 'Sent via Venmo!',
          coverFee: true, // Should be forced to false for unverified direct transfers
        }),
      });

      const res = await contributeToRegistry(req);
      expect(res.status).toBe(200);
      expect(mockPaymentIntentsRetrieve).not.toHaveBeenCalled();
      expect(registryService.contributeToItem).toHaveBeenCalledWith('fund-dual-1', {
        name: 'Sam Direct',
        email: undefined,
        amount: 120,
        code: 'DUAL2026',
        message: 'Sent via Venmo!',
        coverFee: false,
      });
    });

    it('applies coverFee=true on a dual-mode fund when a verified Stripe paymentIntentId is provided', async () => {
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_dual_succeeded_1',
        status: 'succeeded',
        amount: 10250,
        amount_received: 10250,
        currency: 'usd',
        metadata: {
          itemId: 'fund-dual-1',
          baseAmount: '100.00',
          coverFee: 'true',
        },
        latest_charge: 'ch_dual_1',
        created: 1731763200,
      });

      const req = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'fund-dual-1',
          name: 'Casey Card',
          amount: 100,
          coverFee: true,
          paymentIntentId: 'pi_dual_succeeded_1',
        }),
      });

      const res = await contributeToRegistry(req);
      expect(res.status).toBe(200);
      expect(registryService.contributeToItem).toHaveBeenCalledWith(
        'fund-dual-1',
        expect.objectContaining({
          name: 'Casey Card',
          amount: 100,
          coverFee: true,
          stripePaymentIntentId: 'pi_dual_succeeded_1',
          stripeChargeId: 'ch_dual_1',
        })
      );
    });

    it('rejects unverified contribution when fund has no paymentHandle configured', async () => {
      (getGuestInviteSession as jest.Mock).mockResolvedValueOnce({
        code: 'DUAL2026',
        guestName: 'Blocked Guest',
      });
      (registryService.getItemById as jest.Mock).mockResolvedValueOnce(unconfiguredFund);

      const req = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'fund-unconfigured-1',
          name: 'Blocked Guest',
          amount: 50,
        }),
      });

      const res = await contributeToRegistry(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/no payment handle is configured/i);
      expect(registryService.contributeToItem).not.toHaveBeenCalled();
    });
  });

  describe('Security Invariants & Signed Webhook Perimeter Regression Suite', () => {
    it('1. allows signed POST /api/registry/webhook/stripe without guest cookies (200, not 401) and rejects tampered webhook amounts', async () => {
      process.env.ALLOWED_HOSTS = 'localhost,127.0.0.1';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_regression_test_secret';

      const webhookPayload = JSON.stringify({
        id: 'evt_signed_valid_1',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_signed_webhook_1',
            status: 'succeeded',
            amount: 10250,
            amount_received: 10250,
            currency: 'usd',
            latest_charge: 'ch_signed_webhook_1',
            created: 1731763200,
            metadata: {
              itemId: 'fund-dual-1',
              contributorName: 'Signed Webhook Guest',
              baseAmount: '100.00',
              coverFee: 'true',
            },
          },
        },
      });

      const sigHeader = realStripeWebhooks.generateTestHeaderString({
        payload: webhookPayload,
        secret: process.env.STRIPE_WEBHOOK_SECRET,
      });

      const webhookReq = new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          'content-type': 'application/json',
          'stripe-signature': sigHeader,
        },
        body: webhookPayload,
      });

      // Perimeter middleware must allow unauthenticated POST webhook without guest cookies
      const middlewareRes = await middleware(webhookReq);
      expect(middlewareRes.status).toBe(200);

      // Route handler verifies Stripe signature and records verified contribution
      const webhookRes = await stripeWebhookPOST(
        new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'stripe-signature': sigHeader,
          },
          body: webhookPayload,
        })
      );
      expect(webhookRes.status).toBe(200);
      expect(registryService.contributeToItem).toHaveBeenCalledWith(
        'fund-dual-1',
        expect.objectContaining({
          name: 'Signed Webhook Guest',
          amount: 100,
          coverFee: true,
          stripePaymentIntentId: 'pi_signed_webhook_1',
        })
      );

      // Signed webhook with tampered baseAmount vs cent amount must be rejected with 400
      (registryService.contributeToItem as jest.Mock).mockClear();
      const tamperedPayload = JSON.stringify({
        id: 'evt_signed_tampered_1',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_signed_tampered_1',
            status: 'succeeded',
            amount: 100,
            amount_received: 100,
            currency: 'usd',
            metadata: {
              itemId: 'fund-dual-1',
              contributorName: 'Tampered Webhook',
              baseAmount: '5000.00',
              coverFee: 'true',
            },
          },
        },
      });
      const tamperedSig = realStripeWebhooks.generateTestHeaderString({
        payload: tamperedPayload,
        secret: process.env.STRIPE_WEBHOOK_SECRET,
      });
      const tamperedWebhookRes = await stripeWebhookPOST(
        new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'stripe-signature': tamperedSig,
          },
          body: tamperedPayload,
        })
      );
      expect(tamperedWebhookRes.status).toBe(400);
      expect(registryService.contributeToItem).not.toHaveBeenCalled();
    });

    it('2. rejects $1.00 (100-cent) PaymentIntent for item-small-1 with 400 when submitted as $5,000 on fund-card-only-5000', async () => {
      const cardOnly5000Fund = {
        ...unconfiguredFund,
        id: 'fund-card-only-5000',
        name: 'Luxury Honeymoon Fund',
        price: 5000,
        amountContributed: 0,
      };
      (registryService.getItemById as jest.Mock).mockResolvedValueOnce(cardOnly5000Fund);

      const oneDollarPiId = 'pi_one_dollar_small_item';
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: oneDollarPiId,
        status: 'succeeded',
        amount: 100,
        amount_received: 100,
        currency: 'usd',
        metadata: {
          itemId: 'item-small-1',
          baseAmount: '1.00',
          coverFee: 'false',
        },
      });

      const tamperRes = await contributeToRegistry(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            itemId: 'fund-card-only-5000',
            name: 'Tampered Contributor',
            amount: 5000,
            coverFee: true,
            paymentIntentId: oneDollarPiId,
          }),
        })
      );

      expect(tamperRes.status).toBe(400);
      expect(registryService.contributeToItem).not.toHaveBeenCalled();
    });

    it('3. rejects updating another guest pending PaymentIntent without matching clientSecret and itemId with 403', async () => {
      mockPaymentIntentsRetrieve.mockResolvedValue({
        id: 'pi_victim_pending_1',
        status: 'requires_payment_method',
        client_secret: 'pi_victim_pending_1_secret_real_token',
        amount: 10000,
        currency: 'usd',
        metadata: {
          itemId: 'fund-dual-1',
          baseAmount: '100.00',
          coverFee: 'false',
        },
      });

      // Missing clientSecret -> 403
      const missingSecretRes = await createPaymentIntent(
        new NextRequest('http://localhost:3000/api/registry/payment-intent', {
          method: 'POST',
          body: JSON.stringify({
            itemId: 'fund-dual-1',
            amount: 25,
            coverFee: false,
            paymentIntentId: 'pi_victim_pending_1',
          }),
        })
      );
      expect(missingSecretRes.status).toBe(403);

      // Wrong clientSecret -> 403
      const wrongSecretRes = await createPaymentIntent(
        new NextRequest('http://localhost:3000/api/registry/payment-intent', {
          method: 'POST',
          body: JSON.stringify({
            itemId: 'fund-dual-1',
            amount: 25,
            coverFee: false,
            paymentIntentId: 'pi_victim_pending_1',
            clientSecret: 'pi_victim_pending_1_secret_guessed_wrong',
          }),
        })
      );
      expect(wrongSecretRes.status).toBe(403);

      // Matching clientSecret but different target itemId -> 403
      (registryService.getItemById as jest.Mock).mockResolvedValueOnce({
        ...dualModeFund,
        id: 'fund-different-2',
      });
      const wrongItemRes = await createPaymentIntent(
        new NextRequest('http://localhost:3000/api/registry/payment-intent', {
          method: 'POST',
          body: JSON.stringify({
            itemId: 'fund-different-2',
            amount: 25,
            coverFee: false,
            paymentIntentId: 'pi_victim_pending_1',
            clientSecret: 'pi_victim_pending_1_secret_real_token',
          }),
        })
      );
      expect(wrongItemRes.status).toBe(403);

      expect(mockPaymentIntentsUpdate).not.toHaveBeenCalled();
      expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();

      // Matching clientSecret AND matching itemId -> 200 update succeeds
      mockPaymentIntentsUpdate.mockResolvedValueOnce({
        id: 'pi_victim_pending_1',
        client_secret: 'pi_victim_pending_1_secret_real_token',
        amount: 2500,
        currency: 'usd',
      });
      const validUpdateRes = await createPaymentIntent(
        new NextRequest('http://localhost:3000/api/registry/payment-intent', {
          method: 'POST',
          body: JSON.stringify({
            itemId: 'fund-dual-1',
            amount: 25,
            coverFee: false,
            paymentIntentId: 'pi_victim_pending_1',
            clientSecret: 'pi_victim_pending_1_secret_real_token',
          }),
        })
      );
      expect(validUpdateRes.status).toBe(200);
      expect(mockPaymentIntentsUpdate).toHaveBeenCalledTimes(1);
    });

    it('4. rejects cross-item stripePaymentIntentId reuse while keeping same-item retries idempotent', async () => {
      const existingContributor = {
        id: 'c-existing',
        registryItemId: 'fund-dual-1',
        stripePaymentIntentId: 'pi_unique_123',
      };
      const repoItem = {
        id: 'fund-dual-1',
        itemType: 'CASH_FUND',
        paymentHandleType: 'Venmo',
        paymentHandle: '@happy-couple',
        name: 'Honeymoon Adventure Fund',
        description: 'Fund',
        category: 'Honeymoon',
        price: 1000,
        imageId: 'img-1',
        image: {
          id: 'img-1',
          url: '/images/placeholder.png',
          altText: null,
          isDecorative: false,
          isSample: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        vendorUrl: null,
        quantity: 1,
        isGroupGift: true,
        isMostWanted: false,
        displayOrder: 0,
        purchased: false,
        purchaserName: null,
        amountContributed: 100,
        isSample: false,
        contributors: [],
      };
      const txMock = {
        contributor: {
          findFirst: jest.fn().mockResolvedValue(existingContributor),
        },
        registryItem: {
          findUnique: jest.fn().mockResolvedValue(repoItem),
          update: jest.fn(),
        },
      };
      const repo = createRegistryRepository({
        $transaction: (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock),
      });

      // Same-item retry stays idempotent without mutating amountContributed
      const idempotentResult = await repo.contributeToItem('fund-dual-1', {
        name: 'Casey Card',
        amount: 100,
        coverFee: true,
        stripePaymentIntentId: 'pi_unique_123',
      });
      expect(idempotentResult.id).toBe('fund-dual-1');
      expect(txMock.registryItem.update).not.toHaveBeenCalled();

      // Cross-item reuse throws 400 ApiError
      await expect(
        repo.contributeToItem('fund-other-999', {
          name: 'Replay Attacker',
          amount: 100,
          coverFee: true,
          stripePaymentIntentId: 'pi_unique_123',
        })
      ).rejects.toMatchObject({
        statusCode: 400,
      });
    });
  });
});
