/** @jest-environment node */

import { POST } from '../contribute';
import { registryService } from '../../service';
import { dispatchConfirmedContributionAlert } from '../../notifications';
import { NextRequest, after } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { signGuestToken } from '@/core/auth/guest.server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { getAppConfig } from '@/lib/config';
import { MultiChannelMessagingProvider } from '@/features/broadcast';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';

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
    mockPaymentIntentsRetrieve.mockReset();
    resetRateLimitsForTesting();
    (getAppConfig as jest.Mock).mockResolvedValue({
      modules: ['registry', 'groupGifting'],
    });
    (isAdminRequest as jest.Mock).mockResolvedValue(false);
    (getGuestInviteSession as jest.Mock).mockResolvedValue({
      code: 'INVITE26',
      guestName: 'Invited Household',
    });
    (registryService.getItemById as jest.Mock).mockResolvedValue(mockItem);
    (registryService.contributeToItem as jest.Mock).mockResolvedValue(mockUpdatedItem);
  });

  it('rejects zero-Stripe claim with HTTP 403 when guest_invite_session and guest_auth are both absent (even if client supplies body.code)', async () => {
    (getGuestInviteSession as jest.Mock).mockResolvedValueOnce(null);

    const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: 'item-123',
        name: 'Unverified Claimant',
        email: 'unauth@example.com',
        amount: 50,
        code: 'SPOOFED8',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/verify your household invitation code/i);
    expect(registryService.contributeToItem).not.toHaveBeenCalled();
  });

  it('authorizes physical claims and direct transfers for guest_auth passcode sessions when email is provided, and rejects with HTTP 400 when email is omitted', async () => {
    process.env.GUEST_PASSCODE = 'celebrate2027';
    process.env.GUEST_SESSION_SECRET = '0123456789abcdef0123456789abcdef';
    const guestToken = await signGuestToken({ guest: true });

    try {
      (getGuestInviteSession as jest.Mock).mockResolvedValue(null);

      // Missing email on passcode RESERVED claim -> HTTP 400
      const missingEmailReq = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `guest_auth=${guestToken}`,
        },
        body: JSON.stringify({
          itemId: 'item-123',
          name: 'Passcode Guest',
          amount: 50,
        }),
      });
      const missingEmailRes = await POST(missingEmailReq);
      expect(missingEmailRes.status).toBe(400);
      const missingEmailBody = await missingEmailRes.json();
      expect(missingEmailBody.error).toMatch(/email address is required/i);
      expect(registryService.contributeToItem).not.toHaveBeenCalled();

      // Spoofed body.code without matching guest_invite_session -> HTTP 403
      const spoofedCodeReq = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `guest_auth=${guestToken}`,
        },
        body: JSON.stringify({
          itemId: 'item-123',
          name: 'Passcode Guest',
          email: 'passcode@example.com',
          amount: 50,
          code: 'SPOOFED8',
        }),
      });
      const spoofedCodeRes = await POST(spoofedCodeReq);
      expect(spoofedCodeRes.status).toBe(403);
      expect(registryService.contributeToItem).not.toHaveBeenCalled();

      // Valid passcode RESERVED claim with email -> HTTP 200 + signed claimActions
      (registryService.contributeToItem as jest.Mock).mockResolvedValueOnce({
        ...mockItem,
        amountContributed: 50,
        contributors: [
          {
            id: 'c-passcode-1',
            name: 'Passcode Guest',
            email: 'passcode@example.com',
            amount: 50,
            status: 'RESERVED',
          },
        ],
      });

      const validPasscodeReq = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie: `guest_auth=${guestToken}`,
        },
        body: JSON.stringify({
          itemId: 'item-123',
          name: 'Passcode Guest',
          email: 'passcode@example.com',
          amount: 50,
        }),
      });
      const validPasscodeRes = await POST(validPasscodeReq);
      expect(validPasscodeRes.status).toBe(200);
      const validBody = await validPasscodeRes.json();
      expect(validBody.data.claimActions).toEqual({
        confirmToken: expect.any(String),
        cancelToken: expect.any(String),
      });
      expect(registryService.contributeToItem).toHaveBeenCalledWith('item-123', {
        name: 'Passcode Guest',
        email: 'passcode@example.com',
        amount: 50,
        code: undefined,
        message: undefined,
        coverFee: false,
      });
    } finally {
      delete process.env.GUEST_PASSCODE;
      delete process.env.GUEST_SESSION_SECRET;
    }
  });

  it('rejects non-admin contribution with HTTP 403 when submitted code does not match guest_invite_session, and succeeds when code matches or is omitted while stripping relational contributors', async () => {
    const mismatchRequest = new NextRequest('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: 'item-123',
        name: 'John Wellwisher',
        email: 'john@example.com',
        amount: 50,
        code: 'CLIENT99',
        message: 'Best wishes!',
      }),
    });
    const mismatchRes = await POST(mismatchRequest);
    expect(mismatchRes.status).toBe(403);
    expect(registryService.contributeToItem).not.toHaveBeenCalled();

    (registryService.contributeToItem as jest.Mock).mockResolvedValueOnce({
      ...mockItem,
      amountContributed: 75,
      purchaserName: 'Prior Guest, John Wellwisher',
      contributors: [
        {
          id: 'c-prior',
          name: 'Prior Guest',
          email: 'prior@example.com',
          amount: 25,
          message: 'Private prior note',
          thankYouNote: 'Private thank-you draft',
          feeAmount: 1.03,
          transactionTimestamp: '2026-08-01T10:00:00.000Z',
          invitationCodeId: 'inv-prior-secret',
          stripePaymentIntentId: 'pi_prior_secret_123',
          stripeChargeId: 'ch_prior_secret_123',
        },
        {
          id: 'c-new',
          name: 'John Wellwisher',
          email: 'john@example.com',
          amount: 50,
          message: 'Best wishes!',
          thankYouNote: null,
          feeAmount: 0,
          transactionTimestamp: '2026-08-02T11:00:00.000Z',
          invitationCodeId: 'inv-john-secret',
          stripePaymentIntentId: null,
          stripeChargeId: null,
        },
      ],
    });

    const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: 'item-123',
        name: 'John Wellwisher',
        email: 'john@example.com',
        amount: 50,
        code: 'invite26',
        message: 'Best wishes!',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    expect(registryService.contributeToItem).toHaveBeenCalledWith('item-123', {
      name: 'John Wellwisher',
      email: 'john@example.com',
      amount: 50,
      code: 'INVITE26',
      message: 'Best wishes!',
      coverFee: false,
    });

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data.amountContributed).toBe(75);
    expect(body.data.purchaserName).toBe('Anonymous');
    expect(body.data.contributors).toEqual([]);
    expect(body.data.claimActions).toEqual({
      confirmToken: expect.any(String),
      cancelToken: expect.any(String),
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('Private prior note');
    expect(serialized).not.toContain('Private thank-you draft');
    expect(serialized).not.toContain('1.03');
    expect(serialized).not.toContain('2026-08-01T10:00:00.000Z');
    expect(serialized).not.toContain('inv-prior-secret');
    expect(serialized).not.toContain('inv-john-secret');
    expect(serialized).not.toContain('pi_prior_secret_123');
    expect(serialized).not.toContain('ch_prior_secret_123');
    expect(serialized).not.toContain('message');
    expect(serialized).not.toContain('thankYouNote');
    expect(serialized).not.toContain('feeAmount');
    expect(serialized).not.toContain('transactionTimestamp');
    expect(serialized).not.toContain('invitationCodeId');
    expect(serialized).not.toContain('stripePaymentIntentId');
    expect(serialized).not.toContain('stripeChargeId');
  });

  it('retains sanitized contributor details without email addresses for admin callers', async () => {
    (isAdminRequest as jest.Mock).mockResolvedValueOnce(true);
    (registryService.contributeToItem as jest.Mock).mockResolvedValueOnce({
      ...mockItem,
      amountContributed: 50,
      contributors: [
        {
          id: 'c-admin-1',
          name: 'John Wellwisher',
          email: 'john@example.com',
          amount: 50,
          message: 'Congrats!',
          thankYouNote: 'Draft thank-you',
          feeAmount: 1.5,
          transactionTimestamp: '2026-08-02T11:00:00.000Z',
          invitationCodeId: 'inv-1',
          stripePaymentIntentId: 'pi_admin_visible_1',
        },
      ],
    });

    const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    expect(body.data.contributors).toHaveLength(1);
    expect(body.data.contributors[0]).toMatchObject({
      id: 'c-admin-1',
      name: 'John Wellwisher',
      amount: 50,
      message: 'Congrats!',
      thankYouNote: 'Draft thank-you',
      feeAmount: 1.5,
      transactionTimestamp: '2026-08-02T11:00:00.000Z',
      invitationCodeId: 'inv-1',
      stripePaymentIntentId: 'pi_admin_visible_1',
    });
    expect(body.data.contributors[0]).not.toHaveProperty('email');
  });

  it('accepts contribution when email is omitted/blank', async () => {
    const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      code: 'INVITE26',
      message: undefined,
      coverFee: false,
    });
  });

  it('rejects contribution with invalid email format', async () => {
    const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
    it('Requirement 4 & 6 & 7: verifies clientSecret ownership, PaymentIntent succeeded status, and reads attribution from metadata before creating contributor records', async () => {
      (getGuestInviteSession as jest.Mock).mockResolvedValueOnce(null);
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_verified_999',
        client_secret: 'pi_verified_999_secret_valid',
        status: 'succeeded',
        amount: 5125,
        amount_received: 5125,
        currency: 'usd',
        metadata: {
          itemId: 'item-123',
          baseAmount: '50.00',
          coverFee: 'true',
          contributorName: 'Verified Guest',
          contributorEmail: 'verified@example.com',
          contributorMessage: '',
          invitationCode: '',
        },
        latest_charge: 'ch_verified_999',
        created: 1731763200,
      });

      const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: 'item-123',
          name: 'Tampered Body Name',
          email: 'attacker@example.com',
          amount: 50,
          paymentIntentId: 'pi_verified_999',
          clientSecret: 'pi_verified_999_secret_valid',
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
        message: null,
        coverFee: true,
        stripePaymentIntentId: 'pi_verified_999',
        stripeChargeId: 'ch_verified_999',
        transactionTimestamp: new Date(1731763200 * 1000),
      });
    });

    it('rejects contribution when PaymentIntent is not in succeeded status', async () => {
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_declined_111',
        client_secret: 'pi_declined_111_secret_ok',
        status: 'requires_payment_method',
        amount: 5000,
        currency: 'usd',
        metadata: { itemId: 'item-123', coverFee: 'false' },
      });

      const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: 'item-123',
          name: 'Declined Guest',
          amount: 50,
          paymentIntentId: 'pi_declined_111',
          clientSecret: 'pi_declined_111_secret_ok',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/Payment must be succeeded before recording contribution/i);
      expect(registryService.contributeToItem).not.toHaveBeenCalled();
    });

    it('masks raw Stripe lookup failures with generic HTTP 403 matching reconcile-payment', async () => {
      mockPaymentIntentsRetrieve.mockRejectedValueOnce(
        new Error('No such payment_intent: pi_nonexistent; secret_key_hint')
      );

      const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: 'item-123',
          name: 'Error Guest',
          amount: 50,
          paymentIntentId: 'pi_nonexistent',
          clientSecret: 'pi_nonexistent_secret_probe',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe('Unable to verify ownership of the specified PaymentIntent.');
      expect(JSON.stringify(body)).not.toContain('No such payment_intent');
      expect(JSON.stringify(body)).not.toContain('secret_key_hint');
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
        client_secret: 'pi_one_dollar_100_secret_owner',
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: 'fund-card-only-5000',
          name: 'Tampered Contributor',
          amount: 5000,
          coverFee: true,
          paymentIntentId: 'pi_one_dollar_100',
          clientSecret: 'pi_one_dollar_100_secret_owner',
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
      expect(registryService.contributeToItem).not.toHaveBeenCalled();
    });

    it('rejects PaymentIntent when currency is not usd', async () => {
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_wrong_currency',
        client_secret: 'pi_wrong_currency_secret_ok',
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: 'item-123',
          name: 'Wrong Currency Guest',
          amount: 50,
          coverFee: false,
          paymentIntentId: 'pi_wrong_currency',
          clientSecret: 'pi_wrong_currency_secret_ok',
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
        client_secret: 'pi_underpaid_secret_ok',
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: 'item-123',
            name: 'Underpaid Guest',
            amount: 50,
            coverFee: false,
            paymentIntentId: 'pi_underpaid',
            clientSecret: 'pi_underpaid_secret_ok',
          }),
        })
      );
      expect(underpaidRes.status).toBe(400);

      // Case 2: Partial amount_received < totalChargeCents
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_partial_capture',
        client_secret: 'pi_partial_capture_secret_ok',
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: 'item-123',
            name: 'Partial Capture Guest',
            amount: 50,
            coverFee: false,
            paymentIntentId: 'pi_partial_capture',
            clientSecret: 'pi_partial_capture_secret_ok',
          }),
        })
      );
      expect(partialRes.status).toBe(400);

      // Case 3: Mismatched coverFee metadata
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_cover_mismatch',
        client_secret: 'pi_cover_mismatch_secret_ok',
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: 'item-123',
            name: 'Cover Mismatch Guest',
            amount: 50,
            coverFee: true,
            paymentIntentId: 'pi_cover_mismatch',
            clientSecret: 'pi_cover_mismatch_secret_ok',
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
      (prisma.invitationCode.findUnique as jest.Mock).mockResolvedValue({
        email: 'jordan@example.com',
        isSample: false,
        source: 'admin',
      });
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
        client_secret: 'pi_card_gift_777_secret_ok',
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
          contributorName: 'Clara Guest',
          contributorEmail: 'clara@example.com',
          contributorMessage: 'Have an amazing trip!',
          invitationCode: 'INVITE26',
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: 'fund-honeymoon',
          name: 'Clara Guest',
          email: 'clara@example.com',
          amount: 100,
          coverFee: true,
          message: 'Have an amazing trip!',
          paymentIntentId: 'pi_card_gift_777',
          clientSecret: 'pi_card_gift_777_secret_ok',
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
        headers: { 'Content-Type': 'application/json' },
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

      // Both verified household reservation email and couple reservation alert send immediately on RESERVED
      expect(sendEmailSpy).toHaveBeenCalledTimes(2);

      const guestPayload = sendEmailSpy.mock.calls.find(([p]) => p.to === 'jordan@example.com')?.[0];
      expect(guestPayload.body).toContain('@alex-and-taylor');
      expect(guestPayload.body).toContain('Venmo');
      expect(guestPayload.body).toMatch(/finish sending your transfer externally/i);
      expect(guestPayload.body).toContain('No processing fee ($0.00)');
      expect(guestPayload.body).toContain('contrib-direct-1');
      expect(guestPayload.body).toContain('https://couple.wedding.test/guest/claim?token=');
      expect(guestPayload.body).toContain('https://couple.wedding.test/registry');

      const initialCoupleAlert = sendEmailSpy.mock.calls.find(
        ([p]) => p.to === 'couple@wedding.test'
      )?.[0];
      expect(initialCoupleAlert.subject).toContain('New Registry Reservation:');
      expect(initialCoupleAlert.body).toContain('Direct Transfer (Venmo) (Reserved)');

      // Confirming the gift dispatches the confirmed couple alert email
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

      expect(sendEmailSpy).toHaveBeenCalledTimes(3);
      const confirmedCouplePayload = sendEmailSpy.mock.calls[2][0];
      expect(confirmedCouplePayload.body).toContain('Direct Transfer (Venmo)');
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

      (prisma.invitationCode.findUnique as jest.Mock).mockResolvedValueOnce({
        email: 'safe@example.com',
        isSample: false,
        source: 'admin',
      });

      const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      expect(sendEmailSpy).toHaveBeenCalledTimes(2);

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

      expect(sendEmailSpy).toHaveBeenCalledTimes(3);

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
          headers: { 'Content-Type': 'application/json' },
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

    it('rolls back confirmationEmailSentAt and alertEmailSentAt to null when sendEmail returns { success: false } or throws so retries succeed', async () => {
      const state: {
        confirmationEmailSentAt: Date | null;
        alertEmailSentAt: Date | null;
      } = {
        confirmationEmailSentAt: null,
        alertEmailSentAt: null,
      };

      (prisma.contributor.updateMany as jest.Mock).mockImplementation(async ({ where, data }) => {
        if ('confirmationEmailSentAt' in data) {
          if (data.confirmationEmailSentAt === null) {
            state.confirmationEmailSentAt = null;
            return { count: 1 };
          }
          if (where.confirmationEmailSentAt === null && state.confirmationEmailSentAt === null) {
            state.confirmationEmailSentAt = data.confirmationEmailSentAt;
            return { count: 1 };
          }
          return { count: 0 };
        }
        if ('alertEmailSentAt' in data) {
          if (data.alertEmailSentAt === null) {
            state.alertEmailSentAt = null;
            return { count: 1 };
          }
          if (where.alertEmailSentAt === null && state.alertEmailSentAt === null) {
            state.alertEmailSentAt = data.alertEmailSentAt;
            return { count: 1 };
          }
          return { count: 0 };
        }
        return { count: 0 };
      });

      const smtpConfig = {
        modules: ['registry', 'groupGifting'],
        emailProvider: 'smtp',
        smtpHost: 'smtp.wedding.test',
        contactEmail: 'couple@wedding.test',
        baseUrl: 'https://couple.wedding.test',
      };
      (getAppConfig as jest.Mock).mockResolvedValue(smtpConfig);

      mockPaymentIntentsRetrieve.mockResolvedValue({
        id: 'pi_retry_test',
        client_secret: 'pi_retry_test_secret_ok',
        status: 'succeeded',
        amount: 5000,
        amount_received: 5000,
        currency: 'usd',
        metadata: {
          itemId: 'item-123',
          baseAmount: '50.00',
          coverFee: 'false',
          contributorName: 'Retry Guest',
          contributorEmail: 'retry@example.com',
        },
        latest_charge: 'ch_retry_test',
        created: 1731763200,
      });

      (registryService.contributeToItem as jest.Mock).mockResolvedValue({
        ...mockItem,
        amountContributed: 50,
        contributors: [
          {
            id: 'contrib-retry-1',
            name: 'Retry Guest',
            email: 'retry@example.com',
            amount: 50,
            status: 'CONFIRMED',
            stripePaymentIntentId: 'pi_retry_test',
          },
        ],
      });

      // Attempt 1: guest receipt returns { success: false }, couple alert throws -> both timestamps rolled back to null
      sendEmailSpy
        .mockResolvedValueOnce({ success: false, error: 'SMTP temporary failure' })
        .mockRejectedValueOnce(new Error('Socket reset'));

      const req1 = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: 'item-123',
          name: 'Retry Guest',
          email: 'retry@example.com',
          amount: 50,
          paymentIntentId: 'pi_retry_test',
          clientSecret: 'pi_retry_test_secret_ok',
        }),
      });
      const res1 = await POST(req1);
      expect(res1.status).toBe(200);
      expect(state.confirmationEmailSentAt).toBeNull();
      expect(state.alertEmailSentAt).toBeNull();

      // Attempt 2 (retry): sendEmail succeeds -> both timestamps remain set and emails deliver
      sendEmailSpy.mockResolvedValue({ success: true });
      const req2 = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: 'item-123',
          name: 'Retry Guest',
          email: 'retry@example.com',
          amount: 50,
          paymentIntentId: 'pi_retry_test',
          clientSecret: 'pi_retry_test_secret_ok',
        }),
      });
      const res2 = await POST(req2);
      expect(res2.status).toBe(200);
      expect(state.confirmationEmailSentAt).toBeInstanceOf(Date);
      expect(state.alertEmailSentAt).toBeInstanceOf(Date);

      // Also verify dispatchConfirmedContributionAlert rolls back alertEmailSentAt when sendEmail fails
      state.alertEmailSentAt = null;
      sendEmailSpy.mockResolvedValueOnce({ success: false, error: 'SMTP down' });
      await dispatchConfirmedContributionAlert({
        contributor: { id: 'contrib-retry-1', name: 'Retry Guest', amount: 50, status: 'CONFIRMED' },
        item: mockItem,
        config: smtpConfig,
      });
      expect(state.alertEmailSentAt).toBeNull();
    });

    it('schedules notifications via after() in active Next.js request scope so HTTP 200 returns before slow emails complete', async () => {
      const runWithAfterScope = (
        globalThis as unknown as {
          __runWithAfterScope: <T>(cb: () => Promise<T>) => Promise<{
            result: T;
            flush: () => Promise<void>;
            pendingCount: () => number;
          }>;
        }
      ).__runWithAfterScope;

      (getAppConfig as jest.Mock).mockResolvedValue({
        modules: ['registry', 'groupGifting'],
        emailProvider: 'smtp',
        smtpHost: 'smtp.wedding.test',
        contactEmail: 'couple@wedding.test',
        baseUrl: 'https://couple.wedding.test',
      });
      (registryService.getItemById as jest.Mock).mockResolvedValueOnce({
        ...mockItem,
        id: 'fund-deferred-1',
        name: 'Deferred Email Honeymoon Fund',
        itemType: 'CASH_FUND',
        price: 1000,
      });
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_deferred_after_1',
        client_secret: 'pi_deferred_after_1_secret_ok',
        status: 'succeeded',
        amount: 10000,
        amount_received: 10000,
        currency: 'usd',
        latest_charge: 'ch_deferred_after_1',
        created: 1731763200,
        metadata: {
          itemId: 'fund-deferred-1',
          baseAmount: '100.00',
          coverFee: 'false',
          contributorName: 'Fast Modal Guest',
          contributorEmail: 'fast@example.com',
        },
      });
      (registryService.contributeToItem as jest.Mock).mockResolvedValueOnce({
        ...mockItem,
        id: 'fund-deferred-1',
        name: 'Deferred Email Honeymoon Fund',
        itemType: 'CASH_FUND',
        amountContributed: 100,
        contributors: [
          {
            id: 'contrib-deferred-1',
            name: 'Fast Modal Guest',
            email: 'fast@example.com',
            amount: 100,
            coverFee: false,
            feeAmount: 0,
            stripePaymentIntentId: 'pi_deferred_after_1',
          },
        ],
      });

      sendEmailSpy.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return { success: true };
      });

      const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: 'fund-deferred-1',
          name: 'Fast Modal Guest',
          email: 'fast@example.com',
          amount: 100,
          coverFee: false,
          paymentIntentId: 'pi_deferred_after_1',
          clientSecret: 'pi_deferred_after_1_secret_ok',
        }),
      });

      const checkoutStart = performance.now();
      const { result: response, flush, pendingCount } = await runWithAfterScope(() => POST(request));
      const checkoutElapsedMs = performance.now() - checkoutStart;

      expect(response.status).toBe(200);
      expect(checkoutElapsedMs).toBeLessThan(100);
      expect(after).toHaveBeenCalledTimes(1);
      expect(pendingCount()).toBe(1);
      expect(sendEmailSpy).not.toHaveBeenCalled();

      const body = await response.json();
      expect(body.success).toBe(true);
      expect(JSON.stringify(body)).not.toContain('fast@example.com');

      const flushStart = performance.now();
      await flush();
      const flushElapsedMs = performance.now() - flushStart;

      expect(sendEmailSpy).toHaveBeenCalledTimes(2);
      // Both 120ms emails run concurrently via Promise.allSettled rather than serially (~240ms)
      expect(flushElapsedMs).toBeLessThan(215);
    });
  });

  describe('Parallel Pre-Checks & Validation Precedence', () => {
    it('starts config/body/admin and item/session/Stripe lookups concurrently while preserving error precedence', async () => {
      const callOrder: string[] = [];

      (getAppConfig as jest.Mock).mockImplementation(async () => {
        callOrder.push('getAppConfig:start');
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { modules: ['registry', 'groupGifting'] };
      });
      (isAdminRequest as jest.Mock).mockImplementation(async () => {
        callOrder.push('isAdminRequest:start');
        await new Promise((resolve) => setTimeout(resolve, 25));
        return false;
      });
      (registryService.getItemById as jest.Mock).mockImplementationOnce(async () => {
        callOrder.push('getItemById:start');
        await new Promise((resolve) => setTimeout(resolve, 25));
        return mockItem;
      });
      (getGuestInviteSession as jest.Mock).mockImplementationOnce(async () => {
        callOrder.push('getGuestInviteSession:start');
        await new Promise((resolve) => setTimeout(resolve, 25));
        return { code: 'INVITE77', guestName: 'Parallel Guest' };
      });
      mockPaymentIntentsRetrieve.mockImplementationOnce(async () => {
        callOrder.push('stripeRetrieve:start');
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          id: 'pi_parallel_1',
          client_secret: 'pi_parallel_1_secret_ok',
          status: 'succeeded',
          amount: 5000,
          amount_received: 5000,
          currency: 'usd',
          metadata: {
            itemId: 'item-123',
            baseAmount: '50.00',
            coverFee: 'false',
            contributorName: 'Parallel Guest',
            invitationCode: 'INVITE77',
          },
          latest_charge: 'ch_parallel_1',
          created: 1731763200,
        };
      });

      const req = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: 'item-123',
          name: 'Parallel Guest',
          amount: 50,
          coverFee: false,
          paymentIntentId: 'pi_parallel_1',
          clientSecret: 'pi_parallel_1_secret_ok',
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(callOrder.slice(0, 2).sort()).toEqual(['getAppConfig:start', 'isAdminRequest:start']);
      expect(callOrder.slice(2, 5).sort()).toEqual([
        'getGuestInviteSession:start',
        'getItemById:start',
        'stripeRetrieve:start',
      ]);
      expect(registryService.contributeToItem).toHaveBeenCalledWith(
        'item-123',
        expect.objectContaining({
          code: 'INVITE77',
          stripePaymentIntentId: 'pi_parallel_1',
        })
      );
    });

    it('preserves 404 disabled feature over malformed JSON, and sample/groupGifting 400 errors over Stripe errors', async () => {
      // 1. Disabled registry feature (404) takes precedence over malformed request.json()
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        modules: { registry: false, groupGifting: false },
      });
      const badJsonReq = new NextRequest('http://localhost:3000/api/registry/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid-json',
      });
      const disabledRes = await POST(badJsonReq);
      expect(disabledRes.status).toBe(404);

      // 2. Sample item (400) takes precedence over failing Stripe retrieve
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        modules: { registry: true, groupGifting: true },
      });
      (registryService.getItemById as jest.Mock).mockResolvedValueOnce({
        ...mockItem,
        isSample: true,
      });
      mockPaymentIntentsRetrieve.mockRejectedValueOnce(new Error('Stripe upstream failure'));

      const sampleWithPiRes = await POST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: 'item-123',
            name: 'Sample Tester',
            amount: 50,
            paymentIntentId: 'pi_broken_on_sample',
            clientSecret: 'pi_broken_on_sample_secret_ok',
          }),
        })
      );
      expect(sampleWithPiRes.status).toBe(400);
      expect((await sampleWithPiRes.json()).error).toContain(
        'Sample registry items do not accept contributions'
      );

      // 3. Disabled groupGifting (400) takes precedence over failing Stripe retrieve
      (getAppConfig as jest.Mock).mockResolvedValueOnce({
        modules: { registry: true, groupGifting: false },
      });
      (registryService.getItemById as jest.Mock).mockResolvedValueOnce({
        ...mockItem,
        isGroupGift: true,
      });
      mockPaymentIntentsRetrieve.mockRejectedValueOnce(new Error('Stripe upstream failure'));

      const groupDisabledRes = await POST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: 'item-123',
            name: 'Group Disabled Tester',
            amount: 50,
            paymentIntentId: 'pi_broken_on_group',
            clientSecret: 'pi_broken_on_group_secret_ok',
          }),
        })
      );
      expect(groupDisabledRes.status).toBe(400);
      expect((await groupDisabledRes.json()).error).toContain('Group gifting is currently disabled');
    });
  });

  it('forwards optional contributor return address fields and strips PII from public responses', async () => {
    (registryService.contributeToItem as jest.Mock).mockResolvedValueOnce({
      ...mockUpdatedItem,
      contributors: [
        {
          id: 'c-addr-1',
          name: 'Alex Giver',
          email: 'alex@example.com',
          addressLine1: '742 Evergreen Terrace',
          addressLine2: 'Apt 2',
          city: 'Springfield',
          state: 'IL',
          zipCode: '62704',
          country: 'USA',
          thankYouEmailSentAt: '2026-06-10T00:00:00.000Z',
          amount: 50,
          date: '2026-06-09T00:00:00.000Z',
        },
      ],
    });

    const request = new NextRequest('http://localhost:3000/api/registry/contribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: 'item-123',
        name: 'Alex Giver',
        email: 'alex@example.com',
        amount: 50,
        addressLine1: ' 742 Evergreen Terrace ',
        addressLine2: ' Apt 2 ',
        city: ' Springfield ',
        state: ' IL ',
        zipCode: ' 62704 ',
        country: ' USA ',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(registryService.contributeToItem).toHaveBeenCalledWith(
      'item-123',
      expect.objectContaining({
        name: 'Alex Giver',
        email: 'alex@example.com',
        amount: 50,
        addressLine1: '742 Evergreen Terrace',
        addressLine2: 'Apt 2',
        city: 'Springfield',
        state: 'IL',
        zipCode: '62704',
        country: 'USA',
      })
    );

    const json = await response.json();
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain('742 Evergreen Terrace');
    expect(serialized).not.toContain('Springfield');
    expect(serialized).not.toContain('62704');
    expect(serialized).not.toContain('alex@example.com');
  });

  describe('Household Session Isolation, Admin Optional Code, Secret Proofs & 5-Attempt IP Lockouts', () => {
    it('allows administrators to record contributions with an optional household code without a guest session, and omits code when admin leaves it blank', async () => {
      (isAdminRequest as jest.Mock).mockResolvedValue(true);
      (getGuestInviteSession as jest.Mock).mockResolvedValue(null);

      const withCodeRes = await POST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: 'item-123',
            name: 'Admin Recorded Household',
            amount: 50,
            code: 'HOUSEHOLD9',
          }),
        })
      );
      expect(withCodeRes.status).toBe(200);
      expect(registryService.contributeToItem).toHaveBeenCalledWith(
        'item-123',
        expect.objectContaining({
          name: 'Admin Recorded Household',
          amount: 50,
          code: 'HOUSEHOLD9',
        })
      );

      (registryService.contributeToItem as jest.Mock).mockClear();
      (getGuestInviteSession as jest.Mock).mockResolvedValueOnce({
        code: 'STALE_COOKIE',
        guestName: 'Stale Session',
      });

      const withoutCodeRes = await POST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: 'item-123',
            name: 'Admin Walk-in Gift',
            amount: 40,
          }),
        })
      );
      expect(withoutCodeRes.status).toBe(200);
      expect(registryService.contributeToItem).toHaveBeenCalledWith(
        'item-123',
        expect.objectContaining({
          name: 'Admin Walk-in Gift',
          amount: 40,
          code: undefined,
        })
      );
    });

    it('rejects card contributions missing clientSecret or with mismatched clientSecret (HTTP 403) and reads postal + note fields strictly from PaymentIntent metadata', async () => {
      (getGuestInviteSession as jest.Mock).mockResolvedValue(null);

      // 1. Missing clientSecret -> 403 without calling Stripe retrieve
      const missingSecretRes = await POST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: 'item-123',
            name: 'Replay Attacker',
            amount: 50,
            paymentIntentId: 'pi_settled_target',
          }),
        })
      );
      expect(missingSecretRes.status).toBe(403);
      expect(mockPaymentIntentsRetrieve).not.toHaveBeenCalled();
      expect(registryService.contributeToItem).not.toHaveBeenCalled();

      // 2. Mismatched clientSecret -> 403 via constant-time check
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_settled_target',
        client_secret: 'pi_settled_target_secret_real_value',
        status: 'succeeded',
        amount: 5000,
        amount_received: 5000,
        currency: 'usd',
        metadata: {
          itemId: 'item-123',
          baseAmount: '50.00',
          coverFee: 'false',
          contributorName: 'True Cardholder',
        },
      });
      const wrongSecretRes = await POST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: 'item-123',
            name: 'Replay Attacker',
            amount: 50,
            paymentIntentId: 'pi_settled_target',
            clientSecret: 'pi_settled_target_secret_wrong_guess',
          }),
        })
      );
      expect(wrongSecretRes.status).toBe(403);
      expect(registryService.contributeToItem).not.toHaveBeenCalled();

      // 3. Matching clientSecret -> reads name, email, verified code, message, and postal details from metadata
      mockPaymentIntentsRetrieve.mockResolvedValueOnce({
        id: 'pi_settled_target',
        client_secret: 'pi_settled_target_secret_real_value',
        status: 'succeeded',
        amount: 5000,
        amount_received: 5000,
        currency: 'usd',
        created: 1732500000,
        latest_charge: 'ch_settled_target',
        metadata: {
          itemId: 'item-123',
          baseAmount: '50.00',
          coverFee: 'false',
          contributorName: 'True Cardholder',
          contributorEmail: 'cardholder@example.com',
          contributorMessage: 'True metadata note',
          invitationCode: 'VERIFIED1',
          addressLine1: '100 Metadata Way',
          addressLine2: 'Unit 5',
          city: 'Austin',
          state: 'TX',
          zipCode: '78701',
          country: 'USA',
        },
      });

      const validSecretRes = await POST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: 'item-123',
            name: 'Spoofed Name Override',
            email: 'spoofed@example.com',
            amount: 50,
            message: 'Spoofed note override',
            addressLine1: '999 Attacker St',
            city: 'Nowhere',
            state: 'ZZ',
            zipCode: '00000',
            paymentIntentId: 'pi_settled_target',
            clientSecret: 'pi_settled_target_secret_real_value',
          }),
        })
      );
      expect(validSecretRes.status).toBe(200);
      expect(registryService.contributeToItem).toHaveBeenCalledWith('item-123', {
        name: 'True Cardholder',
        email: 'cardholder@example.com',
        amount: 50,
        code: 'VERIFIED1',
        message: 'True metadata note',
        coverFee: false,
        addressLine1: '100 Metadata Way',
        addressLine2: 'Unit 5',
        city: 'Austin',
        state: 'TX',
        zipCode: '78701',
        country: 'USA',
        stripePaymentIntentId: 'pi_settled_target',
        stripeChargeId: 'ch_settled_target',
        transactionTimestamp: new Date(1732500000 * 1000),
      });
    });

    it('locks out the client IP with HTTP 429 after 5 failed household or clientSecret checks, while HTTP 404/400 errors do not count toward lockout', async () => {
      (getGuestInviteSession as jest.Mock).mockResolvedValue(null);

      // Six HTTP 404/400 requests must NOT lock out the client IP
      for (let i = 0; i < 6; i += 1) {
        (registryService.contributeToItem as jest.Mock).mockRejectedValueOnce(
          Object.assign(new Error('Item not found'), { statusCode: 404 })
        );
        const badPayloadRes = await POST(
          new NextRequest('http://localhost:3000/api/registry/contribute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId: 'item-123', name: '', amount: -10 }),
          })
        );
        expect(badPayloadRes.status).toBe(400);
      }

      // 5 failed household/clientSecret ownership attempts (mix of household mismatch & secret mismatch) -> HTTP 403
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const res = await POST(
          new NextRequest('http://localhost:3000/api/registry/contribute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              itemId: 'item-123',
              name: 'Brute Force Caller',
              amount: 50,
              code: `GUESS00${attempt}`,
            }),
          })
        );
        expect(res.status).toBe(403);
      }

      for (let attempt = 4; attempt <= 5; attempt += 1) {
        mockPaymentIntentsRetrieve.mockResolvedValueOnce({
          id: 'pi_target_lockout',
          client_secret: 'pi_target_lockout_secret_real',
          status: 'succeeded',
          amount: 5000,
          amount_received: 5000,
          currency: 'usd',
          metadata: { itemId: 'item-123', baseAmount: '50.00', coverFee: 'false' },
        });
        const res = await POST(
          new NextRequest('http://localhost:3000/api/registry/contribute', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              itemId: 'item-123',
              name: 'Brute Force Caller',
              amount: 50,
              paymentIntentId: 'pi_target_lockout',
              clientSecret: `pi_target_lockout_secret_wrong_${attempt}`,
            }),
          })
        );
        expect(res.status).toBe(403);
      }

      // 6th attempt from the same IP is immediately blocked by checkAuthLockout -> HTTP 429
      const sixthRes = await POST(
        new NextRequest('http://localhost:3000/api/registry/contribute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            itemId: 'item-123',
            name: 'Locked Out Caller',
            amount: 50,
            paymentIntentId: 'pi_target_lockout',
            clientSecret: 'pi_target_lockout_secret_real',
          }),
        })
      );
      expect(sixthRes.status).toBe(429);
      const sixthBody = await sixthRes.json();
      expect(sixthBody.error).toMatch(/Too many requests/i);
    });
  });
});
