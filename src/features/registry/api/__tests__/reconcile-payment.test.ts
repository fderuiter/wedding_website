/** @jest-environment node */

import { NextRequest } from 'next/server';
import { POST } from '../reconcile-payment';
import { registryService } from '../../service';
import { dispatchContributionNotifications } from '../../notifications';
import { getAppConfig } from '@/lib/config';

jest.mock('../../service', () => ({
  registryService: {
    getItemById: jest.fn(),
    contributeToItem: jest.fn(),
  },
}));

jest.mock('../../notifications', () => ({
  dispatchContributionNotifications: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

const mockPaymentIntentsRetrieve = jest.fn();

jest.mock('@/lib/stripe', () => {
  const actual = jest.requireActual('@/lib/stripe');
  return {
    ...actual,
    getStripeInstance: jest.fn(() => ({
      paymentIntents: {
        retrieve: mockPaymentIntentsRetrieve,
      },
    })),
  };
});

describe('POST /api/registry/payment-intent/reconcile', () => {
  const baseItem = {
    id: 'fund-kyoto',
    name: 'Kyoto Honeymoon Fund',
    description: 'Tea ceremony and ryokan',
    price: 300,
    quantity: 1,
    category: 'Cash Fund',
    itemType: 'CASH_FUND',
    isGroupGift: true,
    isMostWanted: false,
    displayOrder: 0,
    isSample: false,
    purchased: false,
    amountContributed: 100,
    contributors: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getAppConfig as jest.Mock).mockResolvedValue({
      modules: { registry: true, groupGifting: true },
    });
    (registryService.getItemById as jest.Mock).mockResolvedValue(baseItem);
  });

  it('rejects requests with mismatched clientSecret in constant time with 403', async () => {
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_reconcile_100',
      client_secret: 'pi_reconcile_100_secret_expected',
      status: 'succeeded',
      currency: 'usd',
      amount: 5000,
      amount_received: 5000,
      metadata: {
        itemId: 'fund-kyoto',
        baseAmount: '50.00',
        coverFee: 'false',
        contributorName: 'Alex Guest',
      },
    });

    const res = await POST(
      new NextRequest('http://localhost:3000/api/registry/payment-intent/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentIntentId: 'pi_reconcile_100',
          clientSecret: 'pi_reconcile_100_secret_wrong',
          itemId: 'fund-kyoto',
        }),
      })
    );

    expect(res.status).toBe(403);
    expect(registryService.contributeToItem).not.toHaveBeenCalled();
    expect(dispatchContributionNotifications).not.toHaveBeenCalled();
  });

  it('rejects requests when provided itemId mismatches PaymentIntent metadata.itemId', async () => {
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_reconcile_101',
      client_secret: 'pi_reconcile_101_secret_valid',
      status: 'succeeded',
      currency: 'usd',
      amount: 5000,
      amount_received: 5000,
      metadata: {
        itemId: 'fund-kyoto',
        baseAmount: '50.00',
        coverFee: 'false',
        contributorName: 'Alex Guest',
      },
    });

    const res = await POST(
      new NextRequest('http://localhost:3000/api/registry/payment-intent/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentIntentId: 'pi_reconcile_101',
          clientSecret: 'pi_reconcile_101_secret_valid',
          itemId: 'other-item',
        }),
      })
    );

    expect(res.status).toBe(403);
    expect(registryService.contributeToItem).not.toHaveBeenCalled();
  });

  it('returns reconciled=false with recovery message and records zero contributions for failed/unsettled PaymentIntents', async () => {
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_reconcile_failed',
      client_secret: 'pi_reconcile_failed_secret_valid',
      status: 'requires_payment_method',
      currency: 'usd',
      amount: 5000,
      amount_received: 0,
      metadata: {
        itemId: 'fund-kyoto',
        baseAmount: '50.00',
        coverFee: 'false',
        contributorName: 'Alex Guest',
      },
    });

    const res = await POST(
      new NextRequest('http://localhost:3000/api/registry/payment-intent/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentIntentId: 'pi_reconcile_failed',
          clientSecret: 'pi_reconcile_failed_secret_valid',
        }),
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      success: true,
      data: {
        reconciled: false,
        status: 'requires_payment_method',
        itemId: 'fund-kyoto',
        error: expect.stringMatching(/not completed|no contribution was recorded/i),
      },
    });
    expect(registryService.contributeToItem).not.toHaveBeenCalled();
    expect(dispatchContributionNotifications).not.toHaveBeenCalled();
  });

  it('rejects settled PaymentIntents that fail settlement amount/currency invariants with 400', async () => {
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_reconcile_tampered',
      client_secret: 'pi_reconcile_tampered_secret_valid',
      status: 'succeeded',
      currency: 'eur',
      amount: 5000,
      amount_received: 5000,
      metadata: {
        itemId: 'fund-kyoto',
        baseAmount: '50.00',
        coverFee: 'false',
        contributorName: 'Alex Guest',
      },
    });

    const res = await POST(
      new NextRequest('http://localhost:3000/api/registry/payment-intent/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentIntentId: 'pi_reconcile_tampered',
          clientSecret: 'pi_reconcile_tampered_secret_valid',
        }),
      })
    );

    expect(res.status).toBe(400);
    expect(registryService.contributeToItem).not.toHaveBeenCalled();
  });

  it('idempotently records settled contributions across duplicate redirect/webhook races and returns receipt + masked item', async () => {
    const settledIntent = {
      id: 'pi_reconcile_ok',
      client_secret: 'pi_reconcile_ok_secret_valid',
      status: 'succeeded',
      currency: 'usd',
      amount: 5125,
      amount_received: 5125,
      created: 1732400000,
      latest_charge: 'ch_reconcile_ok',
      receipt_email: 'alex@example.com',
      metadata: {
        itemId: 'fund-kyoto',
        baseAmount: '50.00',
        coverFee: 'true',
        contributorName: 'Alex Rivera',
        contributorEmail: 'alex@example.com',
        invitationCode: 'KYOTO123',
        contributorMessage: 'Safe travels!',
      },
    };

    mockPaymentIntentsRetrieve.mockResolvedValue(settledIntent);

    const updatedItemWithContributor = {
      ...baseItem,
      amountContributed: 150,
      purchased: false,
      contributors: [
        {
          id: 'contrib-reconcile-1',
          name: 'Alex Rivera',
          email: 'alex@example.com',
          amount: 50,
          refundedAmount: 0,
          status: 'CONFIRMED',
          coverFee: true,
          feeAmount: 1.25,
          date: new Date('2026-11-24T00:00:00.000Z').toISOString(),
          isPlusOne: false,
          thankYouStatus: 'Unsent',
          thankYouSentAt: null,
          stripePaymentIntentId: 'pi_reconcile_ok',
          stripeChargeId: 'ch_reconcile_ok',
          transactionTimestamp: new Date(1732400000 * 1000).toISOString(),
        },
      ],
    };
    (registryService.contributeToItem as jest.Mock).mockResolvedValue(updatedItemWithContributor);

    // First call (redirect return) and second call (duplicate refresh / webhook race)
    const makeRequest = () =>
      POST(
        new NextRequest('http://localhost:3000/api/registry/payment-intent/reconcile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            paymentIntentId: 'pi_reconcile_ok',
            clientSecret: 'pi_reconcile_ok_secret_valid',
            itemId: 'fund-kyoto',
          }),
        })
      );

    const [res1, res2] = await Promise.all([makeRequest(), makeRequest()]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const json1 = await res1.json();
    expect(json1.success).toBe(true);
    expect(json1.data.reconciled).toBe(true);
    expect(json1.data.receipt).toEqual({
      itemId: 'fund-kyoto',
      paymentIntentId: 'pi_reconcile_ok',
      contributorName: 'Alex Rivera',
      contributorEmail: 'alex@example.com',
      baseAmount: 50,
      feeAmount: 1.25,
      coverFee: true,
      totalChargeAmount: 51.25,
      message: 'Safe travels!',
    });
    // Public item payload strips contributor PII while keeping receipt accessible via clientSecret proof
    expect(json1.data.item.amountContributed).toBe(150);
    expect(json1.data.item.contributors).toEqual([]);

    expect(registryService.contributeToItem).toHaveBeenCalledWith(
      'fund-kyoto',
      expect.objectContaining({
        name: 'Alex Rivera',
        email: 'alex@example.com',
        amount: 50,
        coverFee: true,
        code: 'KYOTO123',
        stripePaymentIntentId: 'pi_reconcile_ok',
        stripeChargeId: 'ch_reconcile_ok',
      })
    );
    expect(dispatchContributionNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        itemId: 'fund-kyoto',
        contribution: expect.objectContaining({
          name: 'Alex Rivera',
          email: 'alex@example.com',
          amount: 50,
          stripePaymentIntentId: 'pi_reconcile_ok',
        }),
      })
    );
  });

  it('rejects non-JSON Content-Type with 415 and cross-site Fetch Metadata with 403', async () => {
    const nonJsonRes = await POST(
      new NextRequest('http://localhost:3000/api/registry/payment-intent/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          paymentIntentId: 'pi_reconcile_ok',
          clientSecret: 'pi_reconcile_ok_secret_valid',
        }),
      })
    );
    expect(nonJsonRes.status).toBe(415);
    expect(mockPaymentIntentsRetrieve).not.toHaveBeenCalled();

    const crossSiteRes = await POST(
      new NextRequest('http://localhost:3000/api/registry/payment-intent/reconcile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Sec-Fetch-Site': 'cross-site',
        },
        body: JSON.stringify({
          paymentIntentId: 'pi_reconcile_ok',
          clientSecret: 'pi_reconcile_ok_secret_valid',
        }),
      })
    );
    expect(crossSiteRes.status).toBe(403);
    expect(mockPaymentIntentsRetrieve).not.toHaveBeenCalled();
  });
});
