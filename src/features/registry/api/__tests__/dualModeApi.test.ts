/** @jest-environment node */

import { NextRequest } from 'next/server';
import { GET as getCapabilities } from '../capabilities';
import { POST as createPaymentIntent } from '../payment-intent';
import { POST as contributeToRegistry } from '../contribute';
import { registryService } from '../../service';
import { getAppConfig } from '@/lib/config';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getStripeInstance } from '@/lib/stripe';

jest.mock('../../service', () => ({
  registryService: {
    getItemById: jest.fn(),
    contributeToItem: jest.fn(),
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

jest.mock('@/lib/stripe', () => {
  const actual = jest.requireActual('@/lib/stripe');
  return {
    ...actual,
    getStripeInstance: jest.fn(() => ({
      paymentIntents: {
        create: mockPaymentIntentsCreate,
        retrieve: mockPaymentIntentsRetrieve,
        update: jest.fn(),
      },
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
    it('records self-reported direct transfer with 0% fee (coverFee=false) without requiring paymentIntentId', async () => {
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
        code: undefined,
        message: 'Sent via Venmo!',
        coverFee: false,
      });
    });

    it('applies coverFee=true on a dual-mode fund when a verified Stripe paymentIntentId is provided', async () => {
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_dual_succeeded_1',
        status: 'succeeded',
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
});
