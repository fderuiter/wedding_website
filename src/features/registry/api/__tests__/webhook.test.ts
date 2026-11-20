/** @jest-environment node */

import { POST } from '../webhook';
import { registryService } from '../../service';
import { NextRequest } from 'next/server';
import { getAppConfig } from '@/lib/config';
import { MultiChannelMessagingProvider } from '@/features/broadcast';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn().mockResolvedValue({
    modules: ['registry', 'groupGifting'],
    emailProvider: 'none',
    contactEmail: '',
    baseUrl: 'https://couple.wedding.test',
  }),
}));

jest.mock('../../service', () => ({
  registryService: {
    contributeToItem: jest.fn(),
  },
}));

const mockConstructEvent = jest.fn();

jest.mock('@/lib/stripe', () => {
  const actual = jest.requireActual('@/lib/stripe');
  return {
    ...actual,
    getStripeInstance: jest.fn(() => ({
      webhooks: {
        constructEvent: mockConstructEvent,
      },
    })),
  };
});

describe('POST /api/registry/webhook/stripe', () => {
  const originalSecret = process.env.STRIPE_WEBHOOK_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_123';
  });

  afterAll(() => {
    process.env.STRIPE_WEBHOOK_SECRET = originalSecret;
  });

  it('rejects requests missing stripe-signature header', async () => {
    const request = new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
      method: 'POST',
      body: JSON.stringify({ type: 'payment_intent.succeeded' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain('Missing stripe-signature header');
  });

  it('rejects requests that fail cryptographic signature verification', async () => {
    mockConstructEvent.mockImplementationOnce(() => {
      throw new Error('Invalid signature hash');
    });

    const request = new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': 't=12345,v1=invalidsig',
      },
      body: JSON.stringify({ type: 'payment_intent.succeeded' }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).toContain('Webhook signature verification failed');
  });

  it('Criterion 4: processes payment_intent.succeeded events idempotently and records contribution details', async () => {
    const mockPaymentIntent = {
      id: 'pi_test_webhook_success_999',
      status: 'succeeded',
      amount: 10250,
      amount_received: 10250,
      currency: 'usd',
      latest_charge: 'ch_test_charge_999',
      created: 1731763200, // Unix timestamp in seconds
      metadata: {
        itemId: 'item-cash-fund-1',
        contributorName: 'Webhook Guest',
        contributorEmail: 'webhook@example.com',
        contributorMessage: 'Sent via 3D Secure fallback!',
        coverFee: 'true',
        baseAmount: '100.00',
        feeAmount: '2.50',
      },
    };

    mockConstructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: {
        object: mockPaymentIntent,
      },
    });

    (registryService.contributeToItem as jest.Mock).mockResolvedValue({
      id: 'item-cash-fund-1',
      name: 'Cash Fund',
      amountContributed: 100,
    });

    const request = new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': 't=12345,v1=validsig',
      },
      body: JSON.stringify({
        type: 'payment_intent.succeeded',
        data: { object: mockPaymentIntent },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.received).toBe(true);

    expect(registryService.contributeToItem).toHaveBeenCalledWith(
      'item-cash-fund-1',
      expect.objectContaining({
        name: 'Webhook Guest',
        email: 'webhook@example.com',
        amount: 100,
        coverFee: true,
        message: 'Sent via 3D Secure fallback!',
        stripePaymentIntentId: 'pi_test_webhook_success_999',
        stripeChargeId: 'ch_test_charge_999',
        transactionTimestamp: new Date(1731763200 * 1000),
      })
    );
  });

  it('rejects payment_intent.succeeded webhooks when currency is not usd or metadata.baseAmount mismatches paymentIntent.amount', async () => {
    const nonUsdIntent = {
      id: 'pi_webhook_non_usd',
      status: 'succeeded',
      amount: 10000,
      currency: 'eur',
      metadata: {
        itemId: 'item-cash-fund-1',
        baseAmount: '100.00',
        coverFee: 'false',
      },
    };
    mockConstructEvent.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      data: { object: nonUsdIntent },
    });

    const nonUsdRes = await POST(
      new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 't=12345,v1=validsig' },
        body: JSON.stringify({ type: 'payment_intent.succeeded', data: { object: nonUsdIntent } }),
      })
    );
    expect(nonUsdRes.status).toBe(400);

    const mismatchedAmountIntent = {
      id: 'pi_webhook_mismatch',
      status: 'succeeded',
      amount: 100,
      currency: 'usd',
      metadata: {
        itemId: 'item-cash-fund-1',
        baseAmount: '100.00',
        coverFee: 'false',
      },
    };
    mockConstructEvent.mockReturnValueOnce({
      type: 'payment_intent.succeeded',
      data: { object: mismatchedAmountIntent },
    });

    const mismatchRes = await POST(
      new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 't=12345,v1=validsig' },
        body: JSON.stringify({
          type: 'payment_intent.succeeded',
          data: { object: mismatchedAmountIntent },
        }),
      })
    );
    expect(mismatchRes.status).toBe(400);
    expect(registryService.contributeToItem).not.toHaveBeenCalled();
  });

  it('sends zero duplicate emails when payment_intent.succeeded arrives after /api/registry/contribute claimed timestamps', async () => {
    const sendEmailSpy = jest
      .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
      .mockResolvedValue({ success: true });
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      (getAppConfig as jest.Mock).mockResolvedValue({
        modules: ['registry', 'groupGifting'],
        emailProvider: 'resend',
        resendApiKey: 're_test_123',
        contactEmail: 'couple@wedding.test',
        baseUrl: 'https://couple.wedding.test',
      });

      const mockPaymentIntent = {
        id: 'pi_already_claimed_888',
        status: 'succeeded',
        amount: 10000,
        amount_received: 10000,
        currency: 'usd',
        latest_charge: 'ch_already_claimed_888',
        created: 1731763200,
        metadata: {
          itemId: 'item-cash-fund-1',
          contributorName: 'Already Emailed Guest',
          contributorEmail: 'guest@example.com',
          contributorMessage: 'Already sent!',
          coverFee: 'false',
          baseAmount: '100.00',
          feeAmount: '0.00',
        },
      };

      mockConstructEvent.mockReturnValue({
        type: 'payment_intent.succeeded',
        data: { object: mockPaymentIntent },
      });

      (registryService.contributeToItem as jest.Mock).mockResolvedValueOnce({
        id: 'item-cash-fund-1',
        name: 'Cash Fund',
        itemType: 'CASH_FUND',
        amountContributed: 100,
        contributors: [
          {
            id: 'contrib-claimed-888',
            name: 'Already Emailed Guest',
            email: 'guest@example.com',
            amount: 100,
            stripePaymentIntentId: 'pi_already_claimed_888',
            confirmationEmailSentAt: '2026-11-16T12:00:01.000Z',
            alertEmailSentAt: '2026-11-16T12:00:01.000Z',
          },
        ],
      });

      // Atomic DB claim returns count: 0 because /api/registry/contribute already claimed both timestamps
      (prisma.contributor.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      const request = new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 't=12345,v1=validsig' },
        body: JSON.stringify({
          type: 'payment_intent.succeeded',
          data: { object: mockPaymentIntent },
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });
      expect(prisma.contributor.updateMany).toHaveBeenCalledTimes(2);
      expect(sendEmailSpy).not.toHaveBeenCalled();
    } finally {
      sendEmailSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('dispatches emails via webhook when unclaimed and returns 200 even if provider throws', async () => {
    const sendEmailSpy = jest
      .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
      .mockRejectedValue(new Error('Network timeout sending to webhook@example.com'));
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      (getAppConfig as jest.Mock).mockResolvedValue({
        modules: ['registry', 'groupGifting'],
        emailProvider: 'sendgrid',
        sendgridApiKey: 'SG.test_123',
        contactEmail: 'couple@wedding.test',
        baseUrl: 'https://couple.wedding.test',
      });
      (prisma.contributor.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const mockPaymentIntent = {
        id: 'pi_webhook_first_555',
        status: 'succeeded',
        amount: 5000,
        amount_received: 5000,
        currency: 'usd',
        latest_charge: 'ch_webhook_first_555',
        created: 1731763200,
        metadata: {
          itemId: 'item-cash-fund-1',
          contributorName: '3DS Guest',
          contributorEmail: 'webhook@example.com',
          contributorMessage: '3DS redirect completed!',
          coverFee: 'false',
          baseAmount: '50.00',
          feeAmount: '0.00',
        },
      };

      mockConstructEvent.mockReturnValue({
        type: 'payment_intent.succeeded',
        data: { object: mockPaymentIntent },
      });

      (registryService.contributeToItem as jest.Mock).mockResolvedValueOnce({
        id: 'item-cash-fund-1',
        name: 'Cash Fund',
        itemType: 'CASH_FUND',
        amountContributed: 50,
        contributors: [
          {
            id: 'contrib-webhook-555',
            name: '3DS Guest',
            email: 'webhook@example.com',
            amount: 50,
            stripePaymentIntentId: 'pi_webhook_first_555',
          },
        ],
      });

      const request = new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
        method: 'POST',
        headers: { 'stripe-signature': 't=12345,v1=validsig' },
        body: JSON.stringify({
          type: 'payment_intent.succeeded',
          data: { object: mockPaymentIntent },
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: true });
      expect(sendEmailSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalled();
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('webhook@example.com');
    } finally {
      sendEmailSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});
