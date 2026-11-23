/** @jest-environment node */

import { POST } from '../contribute';
import { registryService } from '../../service';
import { dispatchConfirmedContributionAlert } from '../../notifications';
import { NextRequest } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig } from '@/lib/config';
import { MultiChannelMessagingProvider } from '@/features/broadcast';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

jest.mock('../../service', () => ({
  registryService: {
    getItemById: jest.fn(),
    contributeToItem: jest.fn(),
  },
}));

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('@/core/auth/guestInviteSession', () => ({
  getGuestInviteSession: jest.fn().mockResolvedValue(null),
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

describe('POST /api/registry/contribute', () => {
  const mockItem = {
    id: 'item-123',
    name: 'Blender',
    price: 100,
    amountContributed: 0,
    purchased: false,
    isGroupGift: true,
    isSample: false,
    paymentHandleType: 'Venmo' as const,
    paymentHandle: '@happy-couple',
    image: { id: 'img-1', url: '/image.jpg' },
    contributors: [],
  };

  const mockUpdatedItem = {
    ...mockItem,
    amountContributed: 50,
    contributors: [
      {
        id: 'c-1',
        name: 'John Wellwisher',
        email: 'john@example.com',
        amount: 50,
        message: 'Congrats!',
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getAppConfig as jest.Mock).mockResolvedValue({
      modules: ['registry', 'groupGifting'],
    });
    (isAdminRequest as jest.Mock).mockResolvedValue(false);
    (registryService.getItemById as jest.Mock).mockResolvedValue(mockItem);
    (registryService.contributeToItem as jest.Mock).mockResolvedValue(mockUpdatedItem);
  });

  it('successfully processes contribution without an invitation code', async () => {
    const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'item-123',
        name: 'John Wellwisher',
        email: 'john@example.com',
        amount: 50,
        message: 'Best wishes!',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(registryService.contributeToItem).toHaveBeenCalledWith('item-123', {
      name: 'John Wellwisher',
      email: 'john@example.com',
      amount: 50,
      code: undefined,
      message: 'Best wishes!',
      coverFee: false,
    });
  });

  it('accepts contribution when email is omitted/blank', async () => {
    const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'item-123',
        name: 'Anonymous Friend',
        amount: 25,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(registryService.contributeToItem).toHaveBeenCalledWith('item-123', {
      name: 'Anonymous Friend',
      email: undefined,
      amount: 25,
      code: undefined,
      message: undefined,
      coverFee: false,
    });
  });

  it('rejects contribution with invalid email format', async () => {
    const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'item-123',
        name: 'John Wellwisher',
        email: 'not-an-email',
        amount: 50,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('Invalid email address.');
  });

  it('rejects contributions on sample registry items', async () => {
    (registryService.getItemById as jest.Mock).mockResolvedValue({
      ...mockItem,
      isSample: true,
    });

    const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'item-123',
        name: 'Test Contributor',
        amount: 50,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const body = await response.json();
    expect(body.error).toContain('Sample registry items do not accept contributions');
  });

  describe('Stripe PaymentIntent Verification (Requirement 4 & Requirement 6)', () => {
    it('Requirement 4: verifies PaymentIntent status is succeeded before creating contributor records', async () => {
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_verified_999',
        status: 'succeeded',
        amount: 5125,
        amount_received: 5125,
        currency: 'usd',
        metadata: {
          itemId: 'item-123',
          baseAmount: '50.00',
          coverFee: 'true',
        },
        latest_charge: 'ch_verified_999',
        created: 1731763200,
      });

      const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'item-123',
          name: 'Verified Guest',
          email: 'verified@example.com',
          amount: 50,
          paymentIntentId: 'pi_verified_999',
          coverFee: true,
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      expect(mockPaymentIntentsRetrieve).toHaveBeenCalledWith('pi_verified_999');
      expect(registryService.contributeToItem).toHaveBeenCalledWith('item-123', {
        name: 'Verified Guest',
        email: 'verified@example.com',
        amount: 50,
        code: undefined,
        message: undefined,
        coverFee: true,
        stripePaymentIntentId: 'pi_verified_999',
        stripeChargeId: 'ch_verified_999',
        transactionTimestamp: new Date(1731763200 * 1000),
      });
    });

    it('rejects contribution when PaymentIntent is not in succeeded status', async () => {
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_declined_111',
        status: 'requires_payment_method',
        amount: 5000,
        currency: 'usd',
        metadata: { itemId: 'item-123', coverFee: 'false' },
      });

      const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'item-123',
          name: 'Declined Guest',
          amount: 50,
          paymentIntentId: 'pi_declined_111',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/Payment must be succeeded before recording contribution/i);
      expect(registryService.contributeToItem).not.toHaveBeenCalled();
    });

    it('rejects contribution when Stripe PaymentIntent cannot be retrieved', async () => {
      mockPaymentIntentsRetrieve.mockRejectedValueOnce(new Error('No such payment_intent'));

      const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'item-123',
          name: 'Error Guest',
          amount: 50,
          paymentIntentId: 'pi_nonexistent',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/Invalid or unresolved Stripe PaymentIntent/i);
      expect(registryService.contributeToItem).not.toHaveBeenCalled();
    });

    it('rejects $1.00 (100-cent) PaymentIntent for item-small-1 when submitted as $5,000 on fund-card-only-5000', async () => {
      (registryService.getItemById as jest.Mock).mockResolvedValueOnce({
        ...mockItem,
        id: 'fund-card-only-5000',
        name: 'Card Only Honeymoon Fund',
        itemType: 'CASH_FUND',
        price: 5000,
      });

      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_one_dollar_100',
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

      const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'fund-card-only-5000',
          name: 'Tampered Contributor',
          amount: 5000,
          coverFee: true,
          paymentIntentId: 'pi_one_dollar_100',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      expect(registryService.contributeToItem).not.toHaveBeenCalled();
    });

    it('rejects PaymentIntent when currency is not usd', async () => {
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_wrong_currency',
        status: 'succeeded',
        amount: 5000,
        amount_received: 5000,
        currency: 'jpy',
        metadata: {
          itemId: 'item-123',
          baseAmount: '50.00',
          coverFee: 'false',
        },
      });

      const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'item-123',
          name: 'Wrong Currency Guest',
          amount: 50,
          coverFee: false,
          paymentIntentId: 'pi_wrong_currency',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/currency/i);
      expect(registryService.contributeToItem).not.toHaveBeenCalled();
    });

    it('rejects PaymentIntent when amount, amount_received, or coverFee metadata does not match', async () => {
      // Case 1: Mismatched cent amount on same item
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_underpaid',
        status: 'succeeded',
        amount: 100,
        amount_received: 100,
        currency: 'usd',
        metadata: {
          itemId: 'item-123',
          coverFee: 'false',
        },
      });

      const underpaidRes = await POST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          body: JSON.stringify({
            itemId: 'item-123',
            name: 'Underpaid Guest',
            amount: 50,
            coverFee: false,
            paymentIntentId: 'pi_underpaid',
          }),
        })
      );
      expect(underpaidRes.status).toBe(400);

      // Case 2: Partial amount_received < totalChargeCents
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_partial_capture',
        status: 'succeeded',
        amount: 5000,
        amount_received: 2500,
        currency: 'usd',
        metadata: {
          itemId: 'item-123',
          baseAmount: '50.00',
          coverFee: 'false',
        },
      });

      const partialRes = await POST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          body: JSON.stringify({
            itemId: 'item-123',
            name: 'Partial Capture Guest',
            amount: 50,
            coverFee: false,
            paymentIntentId: 'pi_partial_capture',
          }),
        })
      );
      expect(partialRes.status).toBe(400);

      // Case 3: Mismatched coverFee metadata
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_cover_mismatch',
        status: 'succeeded',
        amount: 5125,
        amount_received: 5125,
        currency: 'usd',
        metadata: {
          itemId: 'item-123',
          baseAmount: '50.00',
          coverFee: 'false',
        },
      });

      const coverMismatchRes = await POST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          body: JSON.stringify({
            itemId: 'item-123',
            name: 'Cover Mismatch Guest',
            amount: 50,
            coverFee: true,
            paymentIntentId: 'pi_cover_mismatch',
          }),
        })
      );
      expect(coverMismatchRes.status).toBe(400);

      expect(registryService.contributeToItem).not.toHaveBeenCalled();
    });
  });

  describe('Inline Transactional Gift Emails & Provider Resilience', () => {
    let sendEmailSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      sendEmailSpy = jest
        .spyOn(MultiChannelMessagingProvider.prototype, 'sendEmail')
        .mockResolvedValue({ success: true });
      warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      (prisma.contributor.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    });

    afterEach(() => {
      sendEmailSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('dispatches guest confirmation and couple alert emails for a card contribution and strips email from response', async () => {
      (getAppConfig as jest.Mock).mockResolvedValue({
        modules: ['registry', 'groupGifting'],
        emailProvider: 'smtp',
        smtpHost: 'smtp.wedding.test',
        smtpFrom: 'noreply@wedding.test',
        contactEmail: 'couple@wedding.test',
        baseUrl: 'https://couple.wedding.test',
        timezone: 'UTC',
      });
      (registryService.getItemById as jest.Mock).mockResolvedValueOnce({
        ...mockItem,
        id: 'fund-honeymoon',
        name: 'Tokyo Honeymoon Fund',
        itemType: 'CASH_FUND',
        price: 1000,
      });
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_card_gift_777',
        status: 'succeeded',
        amount: 10250,
        amount_received: 10250,
        currency: 'usd',
        latest_charge: 'ch_card_gift_777',
        created: 1731763200,
        metadata: {
          itemId: 'fund-honeymoon',
          baseAmount: '100.00',
          feeAmount: '2.50',
          coverFee: 'true',
        },
      });
      (registryService.contributeToItem as jest.Mock).mockResolvedValueOnce({
        ...mockItem,
        id: 'fund-honeymoon',
        name: 'Tokyo Honeymoon Fund',
        itemType: 'CASH_FUND',
        amountContributed: 100,
        contributors: [
          {
            id: 'contrib-card-1',
            name: 'Clara Guest',
            email: 'clara@example.com',
            amount: 100,
            coverFee: true,
            feeAmount: 2.5,
            message: 'Have an amazing trip!',
            date: '2026-11-16T12:00:00.000Z',
            stripePaymentIntentId: 'pi_card_gift_777',
            transactionTimestamp: '2026-11-16T12:00:00.000Z',
          },
        ],
      });

      const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'fund-honeymoon',
          name: 'Clara Guest',
          email: 'clara@example.com',
          amount: 100,
          coverFee: true,
          message: 'Have an amazing trip!',
          paymentIntentId: 'pi_card_gift_777',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const responseJson = await response.json();
      expect(JSON.stringify(responseJson)).not.toContain('clara@example.com');

      expect(sendEmailSpy).toHaveBeenCalledTimes(2);

      const guestPayload = sendEmailSpy.mock.calls.find(([p]) => p.to === 'clara@example.com')?.[0];
      expect(guestPayload).toBeDefined();
      expect(guestPayload.subject).toContain('Tokyo Honeymoon Fund');
      expect(guestPayload.body).toContain('Tokyo Honeymoon Fund');
      expect(guestPayload.body).toContain('$100.00');
      expect(guestPayload.body).toContain('+$2.50 processing fee');
      expect(guestPayload.body).toContain('$102.50 total charged');
      expect(guestPayload.body).toContain('November 16, 2026');
      expect(guestPayload.body).toContain('pi_card_gift_777');
      expect(guestPayload.body).toContain('https://couple.wedding.test/registry');

      const couplePayload = sendEmailSpy.mock.calls.find(([p]) => p.to === 'couple@wedding.test')?.[0];
      expect(couplePayload).toBeDefined();
      expect(couplePayload.body).toContain('Clara Guest');
      expect(couplePayload.body).toContain('Tokyo Honeymoon Fund');
      expect(couplePayload.body).toContain('$100.00');
      expect(couplePayload.body).toContain('Card Checkout');
      expect(couplePayload.body).toContain('Have an amazing trip!');
      expect(couplePayload.body).toContain('https://couple.wedding.test/admin/dashboard/thank-you-notes');
    });

    it('includes payment handle and external transfer reminder for self-reported fund transfers', async () => {
      const fundItem = {
        ...mockItem,
        id: 'fund-venmo-1',
        name: 'Home Down Payment Fund',
        itemType: 'CASH_FUND',
        paymentHandleType: 'Venmo',
        paymentHandle: '@alex-and-taylor',
      };
      (getAppConfig as jest.Mock).mockResolvedValue({
        modules: ['registry', 'groupGifting'],
        emailProvider: 'smtp',
        smtpHost: 'smtp.wedding.test',
        contactEmail: 'couple@wedding.test',
        baseUrl: 'https://couple.wedding.test',
      });
      (registryService.getItemById as jest.Mock).mockResolvedValueOnce(fundItem);
      (registryService.contributeToItem as jest.Mock).mockResolvedValueOnce({
        ...fundItem,
        amountContributed: 75,
        contributors: [
          {
            id: 'contrib-direct-1',
            name: 'Jordan Transfer',
            email: 'jordan@example.com',
            amount: 75,
            coverFee: false,
            feeAmount: 0,
            message: 'Sent on Venmo!',
            date: '2026-11-20T15:00:00.000Z',
          },
        ],
      });

      const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'fund-venmo-1',
          name: 'Jordan Transfer',
          email: 'jordan@example.com',
          amount: 75,
          message: 'Sent on Venmo!',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.claimActions).toEqual({
        confirmToken: expect.any(String),
        cancelToken: expect.any(String),
      });

      // Couple alert is delayed while RESERVED; guest reservation email sends immediately with signed links
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);

      const guestPayload = sendEmailSpy.mock.calls.find(([p]) => p.to === 'jordan@example.com')?.[0];
      expect(guestPayload.body).toContain('@alex-and-taylor');
      expect(guestPayload.body).toContain('Venmo');
      expect(guestPayload.body).toMatch(/finish sending your transfer externally/i);
      expect(guestPayload.body).toContain('No processing fee ($0.00)');
      expect(guestPayload.body).toContain('contrib-direct-1');
      expect(guestPayload.body).toContain('https://couple.wedding.test/guest/claim?token=');
      expect(guestPayload.body).toContain('https://couple.wedding.test/registry');

      // Confirming the gift dispatches the couple alert email
      await dispatchConfirmedContributionAlert({
        contributor: {
          id: 'contrib-direct-1',
          name: 'Jordan Transfer',
          email: 'jordan@example.com',
          amount: 75,
          status: 'CONFIRMED',
          message: 'Sent on Venmo!',
        },
        item: fundItem,
      });

      expect(sendEmailSpy).toHaveBeenCalledTimes(2);
      const couplePayload = sendEmailSpy.mock.calls.find(([p]) => p.to === 'couple@wedding.test')?.[0];
      expect(couplePayload.body).toContain('Direct Transfer (Venmo)');
    });

    it('escapes untrusted HTML and subject injection sequences in guest names, item titles, and notes', async () => {
      const unsafeItem = {
        ...mockItem,
        id: 'item-xss',
        name: 'Crystal Vase <img src=x onerror=alert(1)>\r\nBcc: leak@evil.test',
        itemType: 'PHYSICAL',
        isGroupGift: false,
        price: 50,
      };
      (getAppConfig as jest.Mock).mockResolvedValue({
        modules: ['registry', 'groupGifting'],
        emailProvider: 'smtp',
        smtpHost: 'smtp.wedding.test',
        contactEmail: 'couple@wedding.test',
        baseUrl: 'https://couple.wedding.test',
      });
      (registryService.getItemById as jest.Mock).mockResolvedValueOnce(unsafeItem);
      (registryService.contributeToItem as jest.Mock).mockResolvedValueOnce({
        ...unsafeItem,
        purchased: true,
        amountContributed: 50,
        contributors: [
          {
            id: 'contrib-xss-1',
            name: '<script>alert("name")</script>',
            email: 'safe@example.com',
            amount: 50,
            status: 'RESERVED',
            message: 'Congrats! <svg onload=alert(\'xss\')>',
            date: '2026-11-20T15:00:00.000Z',
          },
        ],
      });

      const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'item-xss',
          name: '<script>alert("name")</script>',
          email: 'safe@example.com',
          amount: 50,
          message: 'Congrats! <svg onload=alert(\'xss\')>',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);

      await dispatchConfirmedContributionAlert({
        contributor: {
          id: 'contrib-xss-1',
          name: '<script>alert("name")</script>',
          email: 'safe@example.com',
          amount: 50,
          status: 'CONFIRMED',
          message: 'Congrats! <svg onload=alert(\'xss\')>',
        },
        item: unsafeItem,
      });

      expect(sendEmailSpy).toHaveBeenCalledTimes(2);

      for (const [payload] of sendEmailSpy.mock.calls) {
        expect(payload.subject).not.toMatch(/[\r\n<>]/);
        expect(payload.body).not.toContain('<script>');
        expect(payload.body).not.toContain('<img src=x');
        expect(payload.body).not.toContain('<svg onload=');
      }
      const couplePayload = sendEmailSpy.mock.calls.find(([p]) => p.to === 'couple@wedding.test')?.[0];
      expect(couplePayload.body).toContain('&lt;script&gt;alert(&quot;name&quot;)&lt;/script&gt;');
      expect(couplePayload.body).toContain('&lt;svg onload=alert(&#39;xss&#39;)&gt;');
      expect(couplePayload.body).toContain('Physical Gift Claim');
    });

    it.each([
      ['resend', 'Resend API error (502): Invalid recipient john@example.com for John Wellwisher'],
      ['sendgrid', 'SendGrid API error (500): Upstream failure for john@example.com'],
      ['smtp', 'SMTP connection refused while sending Congrats! to john@example.com'],
    ])(
      'logs a server warning without PII and returns HTTP 200 when %s dispatch fails',
      async (providerName, simulatedError) => {
        (getAppConfig as jest.Mock).mockResolvedValue({
          modules: ['registry', 'groupGifting'],
          emailProvider: providerName,
          resendApiKey: 're_test_key',
          sendgridApiKey: 'SG.test_key',
          smtpHost: 'smtp.wedding.test',
          contactEmail: 'couple@wedding.test',
          baseUrl: 'https://couple.wedding.test',
        });

        sendEmailSpy.mockResolvedValue({
          success: false,
          error: simulatedError,
        });

        const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          body: JSON.stringify({
            itemId: 'item-123',
            name: 'John Wellwisher',
            email: 'john@example.com',
            amount: 50,
            message: 'Congrats!',
          }),
        });

        const response = await POST(request);
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.id).toBe('item-123');
        expect(JSON.stringify(body)).not.toContain('john@example.com');

        expect(warnSpy).toHaveBeenCalled();
        const serializedWarnings = JSON.stringify(warnSpy.mock.calls);
        expect(serializedWarnings).not.toContain('john@example.com');
        expect(serializedWarnings).not.toContain('couple@wedding.test');
        expect(serializedWarnings).not.toContain('John Wellwisher');
        expect(serializedWarnings).not.toContain('Congrats!');
      }
    );
  });
});
