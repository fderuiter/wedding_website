/** @jest-environment node */

import { POST } from '../payment-intent';
import { registryService } from '../../service';
import { NextRequest } from 'next/server';
import { getAppConfig } from '@/lib/config';

jest.mock('../../service', () => ({
  registryService: {
    getItemById: jest.fn(),
  },
}));

jest.mock('@/lib/config', () => ({
  getAppConfig: jest.fn(),
}));

jest.mock('@/core/auth/guestInviteSession', () => ({
  getGuestInviteSession: jest.fn().mockResolvedValue(null),
}));

const mockPaymentIntentsCreate = jest.fn();
const mockPaymentIntentsUpdate = jest.fn();
const mockPaymentIntentsRetrieve = jest.fn();

jest.mock('@/lib/stripe', () => {
  const actual = jest.requireActual('@/lib/stripe');
  return {
    ...actual,
    getStripeInstance: jest.fn(() => ({
      paymentIntents: {
        create: mockPaymentIntentsCreate,
        update: mockPaymentIntentsUpdate,
        retrieve: mockPaymentIntentsRetrieve,
      },
    })),
  };
});

describe('POST /api/registry/payment-intent', () => {
  const mockCashFundItem = {
    id: 'fund-101',
    name: 'Honeymoon Cash Fund',
    price: 1000,
    amountContributed: 200,
    purchased: false,
    isGroupGift: true,
    isSample: false,
    itemType: 'CASH_FUND',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getAppConfig as jest.Mock).mockResolvedValue({
      modules: { registry: true, groupGifting: true },
    });
    (registryService.getItemById as jest.Mock).mockResolvedValue(mockCashFundItem);
    mockPaymentIntentsCreate.mockResolvedValue({
      id: 'pi_test_created_123',
      client_secret: 'pi_test_created_123_secret_abc',
      amount: 10000,
      currency: 'usd',
    });
    mockPaymentIntentsRetrieve.mockResolvedValue({
      id: 'pi_test_existing_456',
      status: 'requires_payment_method',
      client_secret: 'pi_test_existing_456_secret_def',
      metadata: {
        itemId: 'fund-101',
      },
    });
    mockPaymentIntentsUpdate.mockResolvedValue({
      id: 'pi_test_existing_456',
      client_secret: 'pi_test_existing_456_secret_def',
      amount: 10250,
    });
  });

  it('Requirement 1: creates a PaymentIntent with 2.5% standard fee when coverFee=false', async () => {
    const request = new NextRequest('http://localhost:3000/api/registry/payment-intent', {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'fund-101',
        amount: 100,
        coverFee: false,
        name: 'Alex Guest',
        email: 'alex@example.com',
        message: 'Wishing you the best!',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.clientSecret).toBe('pi_test_created_123_secret_abc');
    expect(json.paymentIntentId).toBe('pi_test_created_123');
    expect(json.amount).toBe(100);
    expect(json.baseAmount).toBe(100);
    expect(json.feeAmount).toBe(0);
    expect(json.netPayout).toBe(97.5);

    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 10000, // $100 in cents
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: expect.objectContaining({
          itemId: 'fund-101',
          baseAmount: '100.00',
          coverFee: 'false',
          contributorName: 'Alex Guest',
        }),
      })
    );
  });

  it('Requirement 3: dynamically calculates fee and updates PaymentIntent when user toggles coverFee=true', async () => {
    const request = new NextRequest('http://localhost:3000/api/registry/payment-intent', {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'fund-101',
        amount: 100,
        coverFee: true,
        paymentIntentId: 'pi_test_existing_456',
        clientSecret: 'pi_test_existing_456_secret_def',
        name: 'Alex Guest',
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.paymentIntentId).toBe('pi_test_existing_456');
    expect(json.amount).toBe(102.5);
    expect(json.baseAmount).toBe(100);
    expect(json.feeAmount).toBe(2.5);
    expect(json.netPayout).toBe(100);

    expect(mockPaymentIntentsUpdate).toHaveBeenCalledWith(
      'pi_test_existing_456',
      expect.objectContaining({
        amount: 10250, // $102.50 in cents
        metadata: expect.objectContaining({
          coverFee: 'true',
          feeAmount: '2.50',
          totalChargeAmount: '102.50',
        }),
      })
    );
  });

  it('rejects contribution when amount exceeds remaining balance', async () => {
    const request = new NextRequest('http://localhost:3000/api/registry/payment-intent', {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'fund-101',
        amount: 900, // Price is 1000, 200 already contributed, remaining is 800
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toMatch(/Contribution cannot be greater than the remaining amount/i);
  });

  it('rejects payment intent creation on sample items', async () => {
    (registryService.getItemById as jest.Mock).mockResolvedValueOnce({
      ...mockCashFundItem,
      isSample: true,
    });

    const request = new NextRequest('http://localhost:3000/api/registry/payment-intent', {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'fund-101',
        amount: 50,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toMatch(/Sample registry items do not accept contributions/i);
  });

  it('rejects when group gifting is disabled and amount is less than full price', async () => {
    (getAppConfig as jest.Mock).mockResolvedValueOnce({
      modules: { registry: true, groupGifting: false },
    });

    const request = new NextRequest('http://localhost:3000/api/registry/payment-intent', {
      method: 'POST',
      body: JSON.stringify({
        itemId: 'fund-101',
        amount: 50,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toMatch(/Group gifting is currently disabled/i);
  });

  it('rejects updating an existing PaymentIntent with 403 when clientSecret or metadata.itemId does not match', async () => {
    // Missing clientSecret
    const missingSecretRes = await POST(
      new NextRequest('http://localhost:3000/api/registry/payment-intent', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'fund-101',
          amount: 50,
          paymentIntentId: 'pi_test_existing_456',
        }),
      })
    );
    expect(missingSecretRes.status).toBe(403);

    // Wrong clientSecret
    const wrongSecretRes = await POST(
      new NextRequest('http://localhost:3000/api/registry/payment-intent', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'fund-101',
          amount: 50,
          paymentIntentId: 'pi_test_existing_456',
          clientSecret: 'pi_test_existing_456_secret_wrong',
        }),
      })
    );
    expect(wrongSecretRes.status).toBe(403);

    // Mismatched itemId in existingIntent.metadata
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_test_existing_456',
      status: 'requires_payment_method',
      client_secret: 'pi_test_existing_456_secret_def',
      metadata: {
        itemId: 'fund-other-999',
      },
    });
    const wrongItemRes = await POST(
      new NextRequest('http://localhost:3000/api/registry/payment-intent', {
        method: 'POST',
        body: JSON.stringify({
          itemId: 'fund-101',
          amount: 50,
          paymentIntentId: 'pi_test_existing_456',
          clientSecret: 'pi_test_existing_456_secret_def',
        }),
      })
    );
    expect(wrongItemRes.status).toBe(403);
    expect(mockPaymentIntentsUpdate).not.toHaveBeenCalled();
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });
});
