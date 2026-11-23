/** @jest-environment node */

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/registry/reconcile/route';
import { registryService } from '../../service';
import { dispatchContributionNotifications } from '../../notifications';
import { getAppConfig } from '@/lib/config';
import { getStripeInstance } from '@/lib/stripe';
import { timingSafeEqualJS } from '@/utils/crypto';
import type { z } from 'zod';
import { ReconcilePaymentIntentSchema } from '../../schemas';

type ReconcilePaymentIntentDTO = z.infer<typeof ReconcilePaymentIntentSchema>;

jest.mock('@/utils/crypto', () => {
  const actual = jest.requireActual('@/utils/crypto');
  return {
    ...actual,
    timingSafeEqualJS: jest.fn(actual.timingSafeEqualJS),
  };
});

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

describe('POST /api/registry/reconcile', () => {
  const targetItem = {
    id: 'item-reconcile-1',
    name: 'Amalfi Honeymoon Fund',
    description: 'Coastal travel fund',
    price: 500,
    quantity: 1,
    category: 'Honeymoon',
    itemType: 'CASH_FUND' as const,
    amountContributed: 400,
    purchased: false,
    isGroupGift: true,
    isMostWanted: false,
    displayOrder: 1,
    isSample: false,
    contributors: [],
  };

  const fundedItemWithPii = {
    ...targetItem,
    amountContributed: 500,
    purchased: true,
    purchaserName: 'Jordan Donor',
    contributors: [
      {
        id: 'contrib-1',
        name: 'Jordan Donor',
        email: 'jordan-private@example.com',
        amount: 100,
        message: 'Private personal note for the couple only!',
        status: 'CONFIRMED',
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getAppConfig as jest.Mock).mockResolvedValue({
      modules: ['registry', 'groupGifting'],
    });
    (registryService.getItemById as jest.Mock).mockResolvedValue(targetItem);
    (registryService.contributeToItem as jest.Mock).mockResolvedValue(fundedItemWithPii);
  });

  function buildRequest(body: Partial<ReconcilePaymentIntentDTO> & Record<string, unknown>) {
    return new NextRequest('http://localhost:3000/api/registry/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('returns 400 when paymentIntentId format is invalid or clientSecret is missing', async () => {
    const badIdRes = await POST(
      buildRequest({
        paymentIntentId: 'invalid_id',
        clientSecret: 'pi_123_secret_abc',
      })
    );
    expect(badIdRes.status).toBe(400);

    const missingSecretRes = await POST(
      buildRequest({
        paymentIntentId: 'pi_valid_123',
        clientSecret: '',
      })
    );
    expect(missingSecretRes.status).toBe(400);
  });

  it('verifies payment_intent_client_secret in constant time and returns 403 on mismatch or item mismatch', async () => {
    (timingSafeEqualJS as jest.Mock).mockClear();

    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_reconcile_sec',
      client_secret: 'pi_reconcile_sec_secret_expected_value',
      status: 'succeeded',
      amount: 10000,
      currency: 'usd',
      metadata: { itemId: 'item-reconcile-1', baseAmount: '100', coverFee: 'false' },
    });

    const mismatchRes = await POST(
      buildRequest({
        paymentIntentId: 'pi_reconcile_sec',
        clientSecret: 'pi_reconcile_sec_secret_wrong_value!!!',
        itemId: 'item-reconcile-1',
      })
    );
    expect(mismatchRes.status).toBe(403);
    expect(timingSafeEqualJS).toHaveBeenCalled();
    expect(registryService.contributeToItem).not.toHaveBeenCalled();

    // Item binding mismatch also returns 403
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_reconcile_sec',
      client_secret: 'pi_reconcile_sec_secret_expected_value',
      status: 'succeeded',
      amount: 10000,
      currency: 'usd',
      metadata: { itemId: 'item-reconcile-1', baseAmount: '100', coverFee: 'false' },
    });

    const itemMismatchRes = await POST(
      buildRequest({
        paymentIntentId: 'pi_reconcile_sec',
        clientSecret: 'pi_reconcile_sec_secret_expected_value',
        itemId: 'different-item-id',
      })
    );
    expect(itemMismatchRes.status).toBe(403);
    expect(registryService.contributeToItem).not.toHaveBeenCalled();
  });

  it('records succeeded PaymentIntents idempotently from metadata, dispatches notifications, and omits donor email and personal notes from response', async () => {
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_succeeded_3ds',
      client_secret: 'pi_succeeded_3ds_secret_verified',
      status: 'succeeded',
      amount: 10250,
      currency: 'usd',
      latest_charge: 'ch_3ds_999',
      created: 1735689600,
      metadata: {
        itemId: 'item-reconcile-1',
        baseAmount: '100',
        coverFee: 'true',
        contributorName: 'Jordan Donor',
        contributorEmail: 'jordan-private@example.com',
        contributorMessage: 'Private personal note for the couple only!',
        invitationCode: 'INVITE88',
      },
    });

    const response = await POST(
      buildRequest({
        paymentIntentId: 'pi_succeeded_3ds',
        clientSecret: 'pi_succeeded_3ds_secret_verified',
        itemId: 'item-reconcile-1',
      })
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    const bodyText = JSON.stringify(json);

    expect(registryService.contributeToItem).toHaveBeenCalledWith(
      'item-reconcile-1',
      expect.objectContaining({
        name: 'Jordan Donor',
        email: 'jordan-private@example.com',
        amount: 100,
        code: 'INVITE88',
        message: 'Private personal note for the couple only!',
        coverFee: true,
        stripePaymentIntentId: 'pi_succeeded_3ds',
        stripeChargeId: 'ch_3ds_999',
      })
    );
    expect(dispatchContributionNotifications).toHaveBeenCalledTimes(1);

    expect(json.success).toBe(true);
    expect(json.data).toMatchObject({
      status: 'succeeded',
      recorded: true,
      paymentIntentId: 'pi_succeeded_3ds',
      itemId: 'item-reconcile-1',
      amount: 100,
      coverFee: true,
      contributorName: 'Jordan Donor',
      item: expect.objectContaining({
        id: 'item-reconcile-1',
        purchased: true,
      }),
    });

    // Public payload must NEVER expose donor email or personal notes
    expect(bodyText).not.toContain('jordan-private@example.com');
    expect(bodyText).not.toContain('Private personal note');
    expect(json.data.contributorEmail).toBeUndefined();
    expect(json.data.message).toBeUndefined();
  });

  it('returns processing and failed statuses without recording contributions or leaking donor PII', async () => {
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_processing_1',
      client_secret: 'pi_processing_1_secret_ok',
      status: 'processing',
      amount: 7500,
      currency: 'usd',
      metadata: {
        itemId: 'item-reconcile-1',
        baseAmount: '75',
        coverFee: 'false',
        contributorName: 'Casey Pending',
        contributorEmail: 'casey-secret@example.com',
        contributorMessage: 'Secret note while processing',
      },
    });

    const procRes = await POST(
      buildRequest({
        paymentIntentId: 'pi_processing_1',
        clientSecret: 'pi_processing_1_secret_ok',
      })
    );
    expect(procRes.status).toBe(200);
    const procJson = await procRes.json();
    const procText = JSON.stringify(procJson);
    expect(procJson.data.status).toBe('processing');
    expect(procJson.data.recorded).toBe(false);
    expect(procText).not.toContain('casey-secret@example.com');
    expect(procText).not.toContain('Secret note while processing');
    expect(registryService.contributeToItem).not.toHaveBeenCalled();

    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_failed_1',
      client_secret: 'pi_failed_1_secret_ok',
      status: 'requires_payment_method',
      amount: 7500,
      currency: 'usd',
      last_payment_error: { message: 'Authentication declined by issuer' },
      metadata: {
        itemId: 'item-reconcile-1',
        baseAmount: '75',
        coverFee: 'false',
        contributorName: 'Casey Declined',
        contributorEmail: 'casey-secret@example.com',
        contributorMessage: 'Secret note on failed charge',
      },
    });

    const failRes = await POST(
      buildRequest({
        paymentIntentId: 'pi_failed_1',
        clientSecret: 'pi_failed_1_secret_ok',
      })
    );
    expect(failRes.status).toBe(200);
    const failJson = await failRes.json();
    const failText = JSON.stringify(failJson);
    expect(failJson.data.status).toBe('failed');
    expect(failJson.data.recorded).toBe(false);
    expect(failJson.data.failureMessage).toContain('card issuer');
    expect(failText).not.toContain('casey-secret@example.com');
    expect(failText).not.toContain('Secret note on failed charge');
    expect(registryService.contributeToItem).not.toHaveBeenCalled();
  });

  it('handles disabled module, unconfigured Stripe, missing/sample items, and invalid metadata safely', async () => {
    // 1. Disabled registry module -> 404
    (getAppConfig as jest.Mock).mockResolvedValueOnce({ modules: { registry: false } });
    const disabledRes = await POST(
      buildRequest({
        paymentIntentId: 'pi_disabled_1',
        clientSecret: 'pi_disabled_1_secret_ok',
      })
    );
    expect(disabledRes.status).toBe(404);

    // 2. Stripe unconfigured -> 503
    (getStripeInstance as jest.Mock).mockImplementationOnce(() => {
      throw new Error('Stripe secret key not configured');
    });
    const noStripeRes = await POST(
      buildRequest({
        paymentIntentId: 'pi_nostripe_1',
        clientSecret: 'pi_nostripe_1_secret_ok',
      })
    );
    expect(noStripeRes.status).toBe(503);

    // 3. Stripe retrieve throws -> 403
    mockPaymentIntentsRetrieve.mockRejectedValueOnce(new Error('No such payment_intent'));
    const retrieveErrRes = await POST(
      buildRequest({
        paymentIntentId: 'pi_missing_1',
        clientSecret: 'pi_missing_1_secret_ok',
      })
    );
    expect(retrieveErrRes.status).toBe(403);

    // 4. Different-length secret -> 403
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_len_1',
      client_secret: 'pi_len_1_secret_expected_long',
      status: 'succeeded',
    });
    const lenMismatchRes = await POST(
      buildRequest({
        paymentIntentId: 'pi_len_1',
        clientSecret: 'pi_len_1_secret_short',
      })
    );
    expect(lenMismatchRes.status).toBe(403);

    // 5. Missing itemId metadata and body -> 400
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_noitem_1',
      client_secret: 'pi_noitem_1_secret_ok',
      status: 'succeeded',
      metadata: {},
    });
    const noItemMetaRes = await POST(
      buildRequest({
        paymentIntentId: 'pi_noitem_1',
        clientSecret: 'pi_noitem_1_secret_ok',
      })
    );
    expect(noItemMetaRes.status).toBe(400);

    // 6. Item not found -> 404, sample item -> 400
    (registryService.getItemById as jest.Mock).mockResolvedValueOnce(null);
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_notfound_1',
      client_secret: 'pi_notfound_1_secret_ok',
      status: 'succeeded',
      metadata: { itemId: 'missing-item' },
    });
    const notFoundRes = await POST(
      buildRequest({
        paymentIntentId: 'pi_notfound_1',
        clientSecret: 'pi_notfound_1_secret_ok',
      })
    );
    expect(notFoundRes.status).toBe(404);

    (registryService.getItemById as jest.Mock).mockResolvedValueOnce({
      id: 'sample-item',
      isSample: true,
    });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_sample_1',
      client_secret: 'pi_sample_1_secret_ok',
      status: 'succeeded',
      metadata: { itemId: 'sample-item' },
    });
    const sampleRes = await POST(
      buildRequest({
        paymentIntentId: 'pi_sample_1',
        clientSecret: 'pi_sample_1_secret_ok',
      })
    );
    expect(sampleRes.status).toBe(400);

    // 7. Invalid coverFee / baseAmount metadata -> 400
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_badmeta_1',
      client_secret: 'pi_badmeta_1_secret_ok',
      status: 'succeeded',
      metadata: { itemId: 'item-reconcile-1', coverFee: 'maybe' },
    });
    expect(
      (
        await POST(
          buildRequest({
            paymentIntentId: 'pi_badmeta_1',
            clientSecret: 'pi_badmeta_1_secret_ok',
          })
        )
      ).status
    ).toBe(400);

    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_badamt_1',
      client_secret: 'pi_badamt_1_secret_ok',
      status: 'succeeded',
      metadata: { itemId: 'item-reconcile-1', coverFee: 'false', baseAmount: '-10' },
    });
    expect(
      (
        await POST(
          buildRequest({
            paymentIntentId: 'pi_badamt_1',
            clientSecret: 'pi_badamt_1_secret_ok',
          })
        )
      ).status
    ).toBe(400);

    // 8. Concurrent over-contribution / already purchased conflict -> 409
    (registryService.contributeToItem as jest.Mock).mockRejectedValueOnce(
      new Error('This item has already been purchased.')
    );
    mockPaymentIntentsRetrieve.mockResolvedValueOnce({
      id: 'pi_conflict_1',
      client_secret: 'pi_conflict_1_secret_ok',
      status: 'succeeded',
      amount: 10000,
      currency: 'usd',
      metadata: { itemId: 'item-reconcile-1', coverFee: 'false', baseAmount: '100' },
    });
    expect(
      (
        await POST(
          buildRequest({
            paymentIntentId: 'pi_conflict_1',
            clientSecret: 'pi_conflict_1_secret_ok',
          })
        )
      ).status
    ).toBe(409);
  });
});
