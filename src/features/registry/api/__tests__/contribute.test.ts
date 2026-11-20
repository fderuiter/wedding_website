/** @jest-environment node */

import { POST } from '../contribute';
import { registryService } from '../../service';
import { NextRequest } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig } from '@/lib/config';

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
});
