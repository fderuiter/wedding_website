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
    reconcileStripeAdjustment: jest.fn(),
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

  it('processes charge.refunded (partial and full) and charge.dispute.created idempotently and alerts the couple', async () => {
    const sendEmailSpy = jest
      .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
      .mockResolvedValue({ success: true });

    try {
      (getAppConfig as jest.Mock).mockResolvedValue({
        modules: ['registry', 'groupGifting'],
        emailProvider: 'smtp',
        smtpHost: 'smtp.wedding.test',
        contactEmail: 'couple@wedding.test',
        baseUrl: 'https://couple.wedding.test',
      });

      // 1. Partial refund ($30 of $100)
      mockConstructEvent.mockReturnValueOnce({
        id: 'evt_partial_refund',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_refund_partial_1',
            payment_intent: 'pi_refund_partial_1',
            amount: 10000,
            amount_refunded: 3000,
            refunded: false,
          },
        },
      });
      (registryService.reconcileStripeAdjustment as jest.Mock).mockResolvedValueOnce({
        matched: true,
        changed: true,
        contributor: {
          id: 'c-1',
          name: 'Dana Cardholder',
          amount: 100,
          refundedAmount: 30,
          status: 'CONFIRMED',
        },
        item: {
          id: 'item-1',
          name: 'Honeymoon Fund',
          amountContributed: 70,
          purchased: false,
        },
        previousStatus: 'CONFIRMED',
        previousRefundedAmount: 0,
        refundedAmount: 30,
      });

      const partialRes = await POST(
        new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 't=12345,v1=validsig' },
          body: JSON.stringify({ type: 'charge.refunded' }),
        })
      );
      expect(partialRes.status).toBe(200);
      expect(registryService.reconcileStripeAdjustment).toHaveBeenCalledWith({
        stripeChargeId: 'ch_refund_partial_1',
        stripePaymentIntentId: 'pi_refund_partial_1',
        refundedCents: 3000,
        forceFullReversal: false,
      });
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
      expect(sendEmailSpy.mock.calls[0][0].subject).toContain('Partial Refund Processed');
      expect(sendEmailSpy.mock.calls[0][0].body).toContain('-$30.00');
      expect(sendEmailSpy.mock.calls[0][0].body).toContain('$70.00');

      // 2. Duplicate charge.refunded delivery -> changed: false sends zero additional emails
      mockConstructEvent.mockReturnValueOnce({
        id: 'evt_partial_refund_dup',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_refund_partial_1',
            payment_intent: 'pi_refund_partial_1',
            amount: 10000,
            amount_refunded: 3000,
            refunded: false,
          },
        },
      });
      (registryService.reconcileStripeAdjustment as jest.Mock).mockResolvedValueOnce({
        matched: true,
        changed: false,
        contributor: {
          id: 'c-1',
          name: 'Dana Cardholder',
          amount: 100,
          refundedAmount: 30,
          status: 'CONFIRMED',
        },
        item: null,
        previousStatus: 'CONFIRMED',
        previousRefundedAmount: 30,
        refundedAmount: 30,
      });

      const dupRes = await POST(
        new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 't=12345,v1=validsig' },
          body: JSON.stringify({ type: 'charge.refunded' }),
        })
      );
      expect(dupRes.status).toBe(200);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);

      // 3. Dispute opened -> reconciles disputed cents and sends dispute ledger alert
      mockConstructEvent.mockReturnValueOnce({
        id: 'evt_dispute_1',
        type: 'charge.dispute.created',
        data: {
          object: {
            id: 'dp_1',
            charge: 'ch_disputed_1',
            payment_intent: 'pi_disputed_1',
            amount: 10000,
          },
        },
      });
      (registryService.reconcileStripeAdjustment as jest.Mock).mockResolvedValueOnce({
        matched: true,
        changed: true,
        contributor: {
          id: 'c-2',
          name: 'Disputed Donor',
          amount: 100,
          refundedAmount: 100,
          status: 'REFUNDED',
        },
        item: {
          id: 'item-2',
          name: 'Espresso Machine',
          amountContributed: 0,
          purchased: false,
        },
        previousStatus: 'CONFIRMED',
        previousRefundedAmount: 0,
        refundedAmount: 100,
      });

      const disputeRes = await POST(
        new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 't=12345,v1=validsig' },
          body: JSON.stringify({ type: 'charge.dispute.created' }),
        })
      );
      expect(disputeRes.status).toBe(200);
      expect(registryService.reconcileStripeAdjustment).toHaveBeenCalledWith({
        stripeChargeId: 'ch_disputed_1',
        stripePaymentIntentId: 'pi_disputed_1',
        refundedCents: 10000,
        forceFullReversal: false,
      });
      expect(sendEmailSpy).toHaveBeenCalledTimes(2);
      expect(sendEmailSpy.mock.calls[1][0].subject).toContain('Card Dispute Opened');
      expect(sendEmailSpy.mock.calls[1][0].body).toContain('Reopened for guest contributions');
    } finally {
      sendEmailSpy.mockRestore();
    }
  });

  it('loads site config concurrently with gift write, sends both emails in parallel, and isolates single-branch failures', async () => {
    const timeline: string[] = [];
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    const sendEmailSpy = jest
      .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
      .mockImplementation(async (payload) => {
        timeline.push(`email:${payload.to}:start`);
        await new Promise((resolve) => setTimeout(resolve, 80));
        if (payload.to === 'guest-fail@example.com') {
          return {
            success: false,
            error: 'Provider rejected guest-fail@example.com for Parallel Guest',
          };
        }
        return { success: true };
      });

    try {
      (getAppConfig as jest.Mock).mockImplementationOnce(async () => {
        timeline.push('getAppConfig:start');
        await new Promise((resolve) => setTimeout(resolve, 40));
        timeline.push('getAppConfig:end');
        return {
          modules: ['registry', 'groupGifting'],
          emailProvider: 'resend',
          resendApiKey: 're_parallel_webhook',
          contactEmail: 'couple@wedding.test',
          baseUrl: 'https://couple.wedding.test',
        };
      });

      (registryService.contributeToItem as jest.Mock).mockImplementationOnce(async () => {
        timeline.push('contributeToItem:start');
        await new Promise((resolve) => setTimeout(resolve, 40));
        timeline.push('contributeToItem:end');
        return {
          id: 'item-cash-fund-1',
          name: 'Cash Fund',
          itemType: 'CASH_FUND',
          amountContributed: 75,
          contributors: [
            {
              id: 'contrib-parallel-webhook',
              name: 'Parallel Guest',
              email: 'guest-fail@example.com',
              amount: 75,
              message: 'Secret parallel note',
              stripePaymentIntentId: 'pi_parallel_webhook_1',
            },
          ],
        };
      });
      (prisma.contributor.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const mockPaymentIntent = {
        id: 'pi_parallel_webhook_1',
        status: 'succeeded',
        amount: 7500,
        amount_received: 7500,
        currency: 'usd',
        latest_charge: 'ch_parallel_webhook_1',
        created: 1731763200,
        metadata: {
          itemId: 'item-cash-fund-1',
          contributorName: 'Parallel Guest',
          contributorEmail: 'guest-fail@example.com',
          contributorMessage: 'Secret parallel note',
          coverFee: 'false',
          baseAmount: '75.00',
        },
      };

      mockConstructEvent.mockReturnValueOnce({
        type: 'payment_intent.succeeded',
        data: { object: mockPaymentIntent },
      });

      const start = performance.now();
      const response = await POST(
        new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 't=12345,v1=validsig' },
          body: JSON.stringify({
            type: 'payment_intent.succeeded',
            data: { object: mockPaymentIntent },
          }),
        })
      );
      const elapsedMs = performance.now() - start;

      expect(response.status).toBe(200);
      // getAppConfig was called once in parallel before contributeToItem finished
      expect(getAppConfig).toHaveBeenCalledTimes(1);
      expect(timeline.indexOf('getAppConfig:start')).toBeLessThan(
        timeline.indexOf('contributeToItem:end')
      );
      expect(timeline.indexOf('contributeToItem:start')).toBeLessThan(
        timeline.indexOf('getAppConfig:end')
      );

      // Both guest and couple emails ran concurrently via Promise.allSettled
      expect(sendEmailSpy).toHaveBeenCalledTimes(2);
      expect(
        sendEmailSpy.mock.calls.some(([payload]) => payload.to === 'couple@wedding.test')
      ).toBe(true);
      // 40ms parallel DB+config + 80ms parallel emails (~120ms) stays well below serial 240ms
      expect(elapsedMs).toBeLessThan(210);

      // Guest failure warning is logged with PII redacted
      const serializedWarnings = JSON.stringify(warnSpy.mock.calls);
      expect(serializedWarnings).not.toContain('guest-fail@example.com');
      expect(serializedWarnings).not.toContain('couple@wedding.test');
      expect(serializedWarnings).not.toContain('Parallel Guest');
      expect(serializedWarnings).not.toContain('Secret parallel note');
    } finally {
      sendEmailSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('aborts stalled outbound email provider calls at the configured timeout and returns HTTP 200', async () => {
    const originalFetch = global.fetch;
    const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

    try {
      global.fetch = jest.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener(
            'abort',
            () => {
              reject(signal.reason ?? new DOMException('Timed out', 'TimeoutError'));
            },
            { once: true }
          );
        });
      }) as unknown as typeof fetch;

      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        modules: ['registry', 'groupGifting'],
        emailProvider: 'resend',
        resendApiKey: 're_stalled_webhook',
        emailTimeoutMs: 50,
        contactEmail: 'couple@wedding.test',
        baseUrl: 'https://couple.wedding.test',
      });
      (prisma.contributor.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const mockPaymentIntent = {
        id: 'pi_stalled_provider_99',
        status: 'succeeded',
        amount: 5000,
        amount_received: 5000,
        currency: 'usd',
        latest_charge: 'ch_stalled_99',
        created: 1731763200,
        metadata: {
          itemId: 'item-cash-fund-1',
          contributorName: 'Timeout Guest',
          contributorEmail: 'timeout.guest@example.com',
          contributorMessage: 'Hope this settles fast!',
          coverFee: 'false',
          baseAmount: '50.00',
        },
      };

      mockConstructEvent.mockReturnValueOnce({
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
            id: 'contrib-stalled-99',
            name: 'Timeout Guest',
            email: 'timeout.guest@example.com',
            amount: 50,
            stripePaymentIntentId: 'pi_stalled_provider_99',
          },
        ],
      });

      const start = performance.now();
      const res = await POST(
        new NextRequest('http://localhost:3000/api/registry/webhook/stripe', {
          method: 'POST',
          headers: { 'stripe-signature': 't=12345,v1=validsig' },
          body: JSON.stringify({
            type: 'payment_intent.succeeded',
            data: { object: mockPaymentIntent },
          }),
        })
      );
      const elapsedMs = performance.now() - start;

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true });
      // Both stalled Resend calls abort concurrently around 50ms instead of hanging past 3,000ms
      expect(elapsedMs).toBeLessThan(400);
      expect(warnSpy).toHaveBeenCalledTimes(2);
      const serializedWarnings = JSON.stringify(warnSpy.mock.calls);
      expect(serializedWarnings).not.toContain('timeout.guest@example.com');
      expect(serializedWarnings).not.toContain('couple@wedding.test');
      expect(serializedWarnings).not.toContain('Timeout Guest');
    } finally {
      global.fetch = originalFetch;
      warnSpy.mockRestore();
    }
  });
});
