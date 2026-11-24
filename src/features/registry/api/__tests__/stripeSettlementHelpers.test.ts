/** @jest-environment node */

import { after } from 'next/server';
import type Stripe from 'stripe';
import {
  buildOptionalAddressFields,
  buildStripeUnavailableResponse,
  mapStripeMetadataToContributor,
  projectViewerRegistryItem,
  resolveStripeClient,
  runContributionNotifications,
  serializeStripePaymentIntentMetadata,
  truncateStripeMetadata,
  validateSettlementPaymentIntent,
  verifyClientSecretConstantTime,
  verifyPaymentIntentOwnership,
} from '../stripeSettlementHelpers';
import { dispatchContributionNotifications } from '../../notifications';
import type { GuestClaimActions, RegistryItem } from '../../types';
import { getStripeInstance } from '@/lib/stripe';
import {
  createMockContributor,
  createMockRegistryItem,
} from '@/testing/factories/registryFactory';

jest.mock('../../notifications', () => ({
  dispatchContributionNotifications: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/stripe', () => {
  const actual = jest.requireActual('@/lib/stripe');
  return {
    ...actual,
    getStripeInstance: jest.fn(),
  };
});

describe('stripeSettlementHelpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Stripe 503 fallback and client resolution', () => {
    it('builds a 503 response preserving Error messages and falling back to default copy', async () => {
      const customRes = buildStripeUnavailableResponse(new Error('Missing STRIPE_SECRET_KEY'));
      expect(customRes.status).toBe(503);
      await expect(customRes.json()).resolves.toEqual({
        success: false,
        error: 'Missing STRIPE_SECRET_KEY',
      });

      const defaultRes = buildStripeUnavailableResponse(null);
      expect(defaultRes.status).toBe(503);
      await expect(defaultRes.json()).resolves.toEqual({
        success: false,
        error: 'Card checkout is not configured on this deployment.',
      });
    });

    it('returns { ok: true, stripe } when configured and { ok: false, response } on failure', async () => {
      const fakeStripe = { paymentIntents: {} } as unknown as Stripe;
      (getStripeInstance as jest.Mock).mockReturnValueOnce(fakeStripe);

      const okResult = resolveStripeClient();
      expect(okResult).toEqual({ ok: true, stripe: fakeStripe });

      (getStripeInstance as jest.Mock).mockImplementationOnce(() => {
        throw new Error('Stripe credentials missing');
      });

      const failResult = resolveStripeClient();
      expect(failResult.ok).toBe(false);
      if (!failResult.ok) {
        expect(failResult.response.status).toBe(503);
        await expect(failResult.response.json()).resolves.toEqual({
          success: false,
          error: 'Stripe credentials missing',
        });
      }
    });
  });

  describe('Constant-time secret checks and PaymentIntent ownership verification', () => {
    it('verifies client secrets in constant time and rejects empty or mismatched values', () => {
      expect(verifyClientSecretConstantTime('pi_1_secret_abc', 'pi_1_secret_abc')).toBe(true);
      expect(verifyClientSecretConstantTime('pi_1_secret_abc', 'pi_1_secret_xyz')).toBe(false);
      expect(verifyClientSecretConstantTime('pi_1_secret_abc', 'pi_1_secret_longer')).toBe(false);
      expect(verifyClientSecretConstantTime('', 'pi_1_secret_abc')).toBe(false);
      expect(verifyClientSecretConstantTime('pi_1_secret_abc', null)).toBe(false);
    });

    it('enforces 403 ownership and item-binding checks when requireClientSecret is true', async () => {
      const retrieve = jest.fn().mockResolvedValue({
        id: 'pi_own_1',
        client_secret: 'pi_own_1_secret_valid',
        metadata: { itemId: '  item-42  ' },
      } as unknown as Stripe.PaymentIntent);

      await expect(
        verifyPaymentIntentOwnership(
          {
            source: { stripe: { paymentIntents: { retrieve } }, paymentIntentId: 'pi_own_1' },
            requireClientSecret: true,
            clientSecret: undefined,
          },
          403
        )
      ).rejects.toMatchObject({ statusCode: 403 });

      await expect(
        verifyPaymentIntentOwnership(
          {
            source: { stripe: { paymentIntents: { retrieve } }, paymentIntentId: 'pi_own_1' },
            requireClientSecret: true,
            clientSecret: 'pi_own_1_secret_wrong',
          },
          403
        )
      ).rejects.toMatchObject({ statusCode: 403 });

      await expect(
        verifyPaymentIntentOwnership(
          {
            source: { stripe: { paymentIntents: { retrieve } }, paymentIntentId: 'pi_own_1' },
            requireClientSecret: true,
            clientSecret: 'pi_own_1_secret_valid',
            expectedItemId: 'item-other',
            requireMetadataItemId: true,
          },
          403
        )
      ).rejects.toMatchObject({ statusCode: 403 });

      const verified = await verifyPaymentIntentOwnership(
        {
          source: { stripe: { paymentIntents: { retrieve } }, paymentIntentId: 'pi_own_1' },
          requireClientSecret: true,
          clientSecret: 'pi_own_1_secret_valid',
          expectedItemId: 'item-42',
          requireMetadataItemId: true,
        },
        403
      );
      expect(verified.resolvedItemId).toBe('item-42');
    });

    it('throws 400 when requireMetadataItemId is true and metadata.itemId is blank, or when settledResult rejects with failureStatus=400', async () => {
      const retrieveMissingItem = jest.fn().mockResolvedValue({
        id: 'pi_no_item',
        client_secret: 'pi_no_item_secret',
        metadata: { itemId: '   ' },
      } as unknown as Stripe.PaymentIntent);

      await expect(
        verifyPaymentIntentOwnership(
          {
            source: {
              stripe: { paymentIntents: { retrieve: retrieveMissingItem } },
              paymentIntentId: 'pi_no_item',
            },
            requireClientSecret: true,
            clientSecret: 'pi_no_item_secret',
            requireMetadataItemId: true,
          },
          403
        )
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'PaymentIntent is missing registry item metadata.',
      });

      await expect(
        verifyPaymentIntentOwnership(
          {
            source: {
              settledResult: {
                status: 'rejected',
                reason: new Error('No such payment_intent'),
              },
            },
            requireClientSecret: false,
          },
          400
        )
      ).rejects.toMatchObject({
        statusCode: 400,
        message: 'Invalid or unresolved Stripe PaymentIntent: No such payment_intent',
      });
    });
  });

  describe('Metadata codec and settlement invariant validation', () => {
    it('serializes all 16 Stripe metadata keys and truncates values to 500 characters', () => {
      expect(truncateStripeMetadata(null)).toBe('');
      expect(truncateStripeMetadata('x'.repeat(600))).toHaveLength(500);

      const metadata = serializeStripePaymentIntentMetadata({
        itemId: 'fund-1',
        itemName: 'Honeymoon Fund',
        baseAmount: 100,
        feeAmount: 2.5,
        coverFee: true,
        totalChargeAmount: 102.5,
        contributorName: 'Jordan Guest',
        contributorEmail: 'jordan@example.com',
        contributorMessage: 'm'.repeat(550),
        invitationCode: 'INVITE1',
        addressLine1: ' 123 Main St ',
        addressLine2: ' Apt 4 ',
        city: ' Seattle ',
        state: ' WA ',
        zipCode: ' 98101 ',
        country: ' USA ',
      });

      expect(Object.keys(metadata)).toHaveLength(16);
      expect(metadata).toEqual({
        itemId: 'fund-1',
        itemName: 'Honeymoon Fund',
        baseAmount: '100.00',
        feeAmount: '2.50',
        coverFee: 'true',
        totalChargeAmount: '102.50',
        contributorName: 'Jordan Guest',
        contributorEmail: 'jordan@example.com',
        contributorMessage: 'm'.repeat(500),
        invitationCode: 'INVITE1',
        addressLine1: '123 Main St',
        addressLine2: 'Apt 4',
        city: 'Seattle',
        state: 'WA',
        zipCode: '98101',
        country: 'USA',
      });
    });

    it('validates settlement invariants across api-error and plain-text modes and extracts charge/timestamp fields', async () => {
      const validIntent = {
        id: 'pi_settle_1',
        currency: 'usd',
        amount: 10250,
        amount_received: 10250,
        created: 1732400000,
        latest_charge: { id: 'ch_expanded_1' },
        metadata: {
          itemId: 'fund-1',
          baseAmount: '100.00',
          coverFee: 'true',
        },
      };

      const webhookValidated = validateSettlementPaymentIntent(
        validIntent,
        {
          itemId: 'fund-1',
          defaultSucceededStatus: true,
          errorMode: 'plain-text',
        },
        400
      );

      expect(webhookValidated.ok).toBe(true);
      if (webhookValidated.ok) {
        expect(webhookValidated.settlement).toEqual({
          baseAmount: 100,
          coverFee: true,
          totalChargeCents: 10250,
          stripePaymentIntentId: 'pi_settle_1',
          stripeChargeId: 'ch_expanded_1',
          transactionTimestamp: new Date(1732400000 * 1000),
        });
      }

      expect(() =>
        validateSettlementPaymentIntent(
          {
            ...validIntent,
            status: 'succeeded',
            metadata: { itemId: 'fund-1', coverFee: 'invalid-bool' },
          },
          { itemId: 'fund-1', errorMode: 'api-error' },
          400
        )
      ).toThrow('Invalid PaymentIntent coverFee metadata.');

      const plainTextError = validateSettlementPaymentIntent(
        {
          ...validIntent,
          status: 'succeeded',
          currency: 'eur',
        },
        {
          itemId: 'fund-1',
          errorMode: 'plain-text',
          invariantErrorPrefix: 'Webhook PaymentIntent validation failed: ',
        },
        400
      );
      expect(plainTextError.ok).toBe(false);
      if (!plainTextError.ok) {
        expect(plainTextError.response.status).toBe(400);
        await expect(plainTextError.response.text()).resolves.toContain(
          'Webhook PaymentIntent validation failed:'
        );
      }
    });
  });

  describe('Contributor metadata trimming flags', () => {
    it('trims identity strings when trimIdentity=true and retains raw identity strings when trimIdentity=false', () => {
      const rawMeta = {
        contributorName: '  Alex Rivera  ',
        contributorEmail: '  alex@example.com  ',
        contributorMessage: '  Safe travels!  ',
        invitationCode: '  CODE99  ',
        addressLine1: '  10 Downing St  ',
        addressLine2: '   ',
        city: ' London ',
      };

      const trimmed = mapStripeMetadataToContributor(rawMeta, { trimIdentity: true });
      expect(trimmed).toEqual({
        name: 'Alex Rivera',
        email: 'alex@example.com',
        message: 'Safe travels!',
        code: 'CODE99',
        addressFields: {
          addressLine1: '10 Downing St',
          city: 'London',
        },
      });

      const untrimmed = mapStripeMetadataToContributor(rawMeta, { trimIdentity: false });
      expect(untrimmed).toEqual({
        name: '  Alex Rivera  ',
        email: '  alex@example.com  ',
        message: '  Safe travels!  ',
        code: '  CODE99  ',
        addressFields: {
          addressLine1: '10 Downing St',
          city: 'London',
        },
      });

      const whitespaceOnly = mapStripeMetadataToContributor(
        { contributorName: '   ', contributorEmail: '   ' },
        { trimIdentity: true }
      );
      expect(whitespaceOnly.name).toBe('Anonymous Guest');
      expect(whitespaceOnly.email).toBeNull();

      expect(
        buildOptionalAddressFields({ addressLine1: '42 Wallaby Way', state: '' })
      ).toEqual({ addressLine1: '42 Wallaby Way' });
    });
  });

  describe('Notification scheduling modes', () => {
    const baseParams = {
      itemId: 'fund-1',
      contribution: {
        name: 'Alex Rivera',
        email: 'alex@example.com',
        amount: 50,
      },
    };

    it('awaits inline delivery immediately when mode is inline', async () => {
      await runContributionNotifications(baseParams, { mode: 'inline' });
      expect(after).not.toHaveBeenCalled();
      expect(dispatchContributionNotifications).toHaveBeenCalledTimes(1);
      expect(dispatchContributionNotifications).toHaveBeenCalledWith(baseParams);
    });

    it('schedules via after() in active request scope and falls back inline when after() throws', async () => {
      const runWithAfterScope = (
        globalThis as unknown as {
          __runWithAfterScope: <T>(cb: () => Promise<T>) => Promise<{
            result: T;
            flush: () => Promise<void>;
            pendingCount: () => number;
          }>;
        }
      ).__runWithAfterScope;

      const { flush, pendingCount } = await runWithAfterScope(() =>
        runContributionNotifications(baseParams, { mode: 'after' })
      );
      expect(after).toHaveBeenCalledTimes(1);
      expect(pendingCount()).toBe(1);
      expect(dispatchContributionNotifications).not.toHaveBeenCalled();

      await flush();
      expect(dispatchContributionNotifications).toHaveBeenCalledTimes(1);

      (dispatchContributionNotifications as jest.Mock).mockClear();
      (after as jest.Mock).mockImplementationOnce(() => {
        throw new Error('after() called outside request scope');
      });

      await runContributionNotifications(baseParams, { mode: 'after' });
      expect(dispatchContributionNotifications).toHaveBeenCalledTimes(1);
    });
  });

  describe('Viewer-role item projection', () => {
    it('strips contributor records and masks purchaserName for guests while returning sanitized contributors for admins', () => {
      const item = createMockRegistryItem({
        id: 'item-proj-1',
        purchaserName: 'Alex Rivera',
        amountContributed: 100,
        contributors: [
          createMockContributor({
            id: 'c-1',
            name: 'Alex Rivera',
            email: 'alex@example.com',
            addressLine1: '123 Secret Ln',
            amount: 100,
          }),
        ],
      });

      const guestProjected = projectViewerRegistryItem(item, false, {
        confirmToken: 'tok-confirm',
        cancelToken: 'tok-cancel',
      }) as RegistryItem & { claimActions?: GuestClaimActions };
      expect(guestProjected.purchaserName).toBe('Anonymous');
      expect(guestProjected.contributors).toEqual([]);
      expect(guestProjected).toMatchObject({
        claimActions: {
          confirmToken: 'tok-confirm',
          cancelToken: 'tok-cancel',
        },
      });
      expect(JSON.stringify(guestProjected)).not.toContain('alex@example.com');
      expect(JSON.stringify(guestProjected)).not.toContain('123 Secret Ln');

      const adminProjected = projectViewerRegistryItem(item, true) as RegistryItem;
      expect(adminProjected.purchaserName).toBe('Alex Rivera');
      expect(adminProjected.contributors).toHaveLength(1);
      expect(adminProjected.contributors?.[0]).toMatchObject({
        id: 'c-1',
        name: 'Alex Rivera',
        amount: 100,
      });
      expect(adminProjected.contributors?.[0]).not.toHaveProperty('email');
      expect(adminProjected.contributors?.[0]).not.toHaveProperty('addressLine1');
    });
  });
});
