import { NextResponse, after } from 'next/server';
import type Stripe from 'stripe';
import { maskRegistryItem, sanitizeRegistryItem } from '../lib/masking';
import { dispatchContributionNotifications } from '../notifications';
import type { GuestClaimActions, RegistryItem } from '../types';
import { getStripeInstance, validatePaymentIntentInvariants } from '@/lib/stripe';
import { ApiError } from '@/utils/ApiError';
import { timingSafeEqualJS } from '@/utils/crypto';

const DEFAULT_STRIPE_UNAVAILABLE_MESSAGE = 'Card checkout is not configured on this deployment.';
const ADDRESS_KEYS = ['addressLine1', 'addressLine2', 'city', 'state', 'zipCode', 'country'] as const;

type AddressKey = (typeof ADDRESS_KEYS)[number];
type AddressInput = Partial<Record<AddressKey, string | null | undefined>>;
type NormalizedAddressFields = Partial<Record<AddressKey, string>>;
type ContributionNotificationParams = Parameters<typeof dispatchContributionNotifications>[0];
type SettlementPaymentIntentLike = Parameters<typeof validatePaymentIntentInvariants>[0] & {
  id: string;
  created?: number | null;
  latest_charge?: string | { id?: string | null } | null;
};
type ValidatedSettlement = {
  baseAmount: number;
  coverFee: boolean;
  totalChargeCents: number;
  stripePaymentIntentId: string;
  stripeChargeId: string | null;
  transactionTimestamp: Date;
};
type ValidateSettlementBase = {
  itemId: string;
  expectedAmounts?: { baseAmount: number; coverFee: boolean };
  defaultSucceededStatus?: boolean;
  invariantErrorPrefix?: string;
};
type PaymentIntentLookupSource =
  | { stripe: { paymentIntents: { retrieve: (id: string) => Promise<Stripe.PaymentIntent> } }; paymentIntentId: string }
  | { settledResult: PromiseSettledResult<Stripe.PaymentIntent> };

function extractErrorMessage(err: unknown): string | undefined {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }
  return undefined;
}

export function buildStripeUnavailableResponse(err: unknown): NextResponse {
  return NextResponse.json(
    { success: false, error: extractErrorMessage(err) || DEFAULT_STRIPE_UNAVAILABLE_MESSAGE },
    { status: 503 }
  );
}

export function resolveStripeClient(): { ok: true; stripe: Stripe } | { ok: false; response: NextResponse } {
  try {
    return { ok: true, stripe: getStripeInstance() };
  } catch (err: unknown) {
    return { ok: false, response: buildStripeUnavailableResponse(err) };
  }
}

export function verifyClientSecretConstantTime(provided?: string | null, expected?: string | null): boolean {
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  return timingSafeEqualJS(encoder.encode(provided), encoder.encode(expected));
}

export async function verifyPaymentIntentOwnership(
  options: {
    source: PaymentIntentLookupSource;
    requireClientSecret: boolean;
    clientSecret?: string | null;
    expectedItemId?: string;
    requireMetadataItemId?: boolean;
  },
  failureStatus: 400 | 403
): Promise<{ paymentIntent: Stripe.PaymentIntent; resolvedItemId: string }> {
  const { source, requireClientSecret, clientSecret, expectedItemId, requireMetadataItemId = false } = options;
  if (requireClientSecret && !clientSecret) {
    throw new ApiError(failureStatus, 'Valid clientSecret is required to update an existing PaymentIntent.');
  }

  let paymentIntent: Stripe.PaymentIntent | null = null;
  let lookupReason: unknown;
  if ('stripe' in source) {
    try {
      paymentIntent = await source.stripe.paymentIntents.retrieve(source.paymentIntentId);
    } catch (err: unknown) {
      lookupReason = err;
    }
  } else if (source.settledResult.status === 'fulfilled') {
    paymentIntent = source.settledResult.value;
  } else {
    lookupReason = source.settledResult.reason;
  }

  if (!paymentIntent) {
    throw new ApiError(
      failureStatus,
      failureStatus === 403
        ? 'Unable to verify ownership of the specified PaymentIntent.'
        : `Invalid or unresolved Stripe PaymentIntent: ${extractErrorMessage(lookupReason)}`
    );
  }
  if (requireClientSecret && !verifyClientSecretConstantTime(clientSecret, paymentIntent.client_secret)) {
    throw new ApiError(failureStatus, 'Forbidden: PaymentIntent ownership mismatch.');
  }

  const rawItemId = typeof paymentIntent.metadata?.itemId === 'string' ? paymentIntent.metadata.itemId : '';
  const resolvedItemId = requireMetadataItemId ? rawItemId.trim() : rawItemId;
  if (requireMetadataItemId && !resolvedItemId) {
    throw new ApiError(400, 'PaymentIntent is missing registry item metadata.');
  }
  if (expectedItemId && expectedItemId !== resolvedItemId) {
    throw new ApiError(failureStatus, 'Forbidden: PaymentIntent item binding mismatch.');
  }
  return { paymentIntent, resolvedItemId };
}

export function truncateStripeMetadata(value?: string | null): string {
  return value ? value.slice(0, 500) : '';
}

type StripeMetadataSerializerInput = AddressInput & {
  itemId: string; itemName: string; baseAmount: number; feeAmount: number; coverFee: boolean; totalChargeAmount: number;
  contributorName?: string | null; contributorEmail?: string | null; contributorMessage?: string | null; invitationCode?: string | null;
};

export function serializeStripePaymentIntentMetadata(input: StripeMetadataSerializerInput): Record<string, string> {
  const addressMetadata: Record<string, string> = {};
  for (const key of ADDRESS_KEYS) {
    addressMetadata[key] = truncateStripeMetadata(input[key]?.trim());
  }
  return {
    itemId: truncateStripeMetadata(input.itemId),
    itemName: truncateStripeMetadata(input.itemName),
    baseAmount: input.baseAmount.toFixed(2),
    feeAmount: input.feeAmount.toFixed(2),
    coverFee: input.coverFee ? 'true' : 'false',
    totalChargeAmount: input.totalChargeAmount.toFixed(2),
    contributorName: truncateStripeMetadata(input.contributorName),
    contributorEmail: truncateStripeMetadata(input.contributorEmail),
    contributorMessage: truncateStripeMetadata(input.contributorMessage),
    invitationCode: truncateStripeMetadata(input.invitationCode),
    ...addressMetadata,
  };
}

function parseSettlementMetadataAmounts(
  paymentIntent: SettlementPaymentIntentLike,
  trailingPeriod: boolean
): { ok: true; baseAmount: number; coverFee: boolean } | { ok: false; error: string } {
  const suffix = trailingPeriod ? '.' : '';
  const metadata = paymentIntent.metadata || {};
  const rawCoverFee = metadata.coverFee;
  if (rawCoverFee !== undefined && rawCoverFee !== '' && rawCoverFee !== 'true' && rawCoverFee !== 'false') {
    return { ok: false, error: `Invalid PaymentIntent coverFee metadata${suffix}` };
  }
  const coverFee = rawCoverFee === 'true';
  if (metadata.baseAmount !== undefined && metadata.baseAmount !== '') {
    const parsed = Number(metadata.baseAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return { ok: false, error: `Invalid PaymentIntent baseAmount metadata${suffix}` };
    }
    return { ok: true, baseAmount: parsed, coverFee };
  }
  if (!coverFee && typeof paymentIntent.amount === 'number' && paymentIntent.amount > 0) {
    return { ok: true, baseAmount: paymentIntent.amount / 100, coverFee };
  }
  return { ok: false, error: `Missing PaymentIntent baseAmount metadata${suffix}` };
}

export function validateSettlementPaymentIntent(pi: SettlementPaymentIntentLike, options: ValidateSettlementBase & { errorMode: 'api-error' }, failureStatus: number): ValidatedSettlement;
export function validateSettlementPaymentIntent(pi: SettlementPaymentIntentLike, options: ValidateSettlementBase & { errorMode: 'plain-text' }, failureStatus: number): { ok: true; settlement: ValidatedSettlement } | { ok: false; response: NextResponse };
export function validateSettlementPaymentIntent(pi: SettlementPaymentIntentLike, options: ValidateSettlementBase & { errorMode: 'api-error' | 'plain-text' }, failureStatus: number) {
  const isApiError = options.errorMode === 'api-error';
  const fail = (msg: string) => {
    if (isApiError) throw new ApiError(failureStatus, msg);
    return { ok: false as const, response: new NextResponse(msg, { status: failureStatus }) };
  };

  let { baseAmount, coverFee } = options.expectedAmounts ?? { baseAmount: 0, coverFee: false };
  if (!options.expectedAmounts) {
    const parsed = parseSettlementMetadataAmounts(pi, isApiError);
    if (!parsed.ok) return fail(parsed.error);
    ({ baseAmount, coverFee } = parsed);
  }

  const intent = options.defaultSucceededStatus ? { ...pi, status: pi.status ?? 'succeeded' } : pi;
  const check = validatePaymentIntentInvariants(intent, { itemId: options.itemId, baseAmount, coverFee });
  if (!check.valid) {
    const reason = check.error || 'Invalid Stripe PaymentIntent.';
    return fail(options.invariantErrorPrefix ? `${options.invariantErrorPrefix}${reason}` : reason);
  }

  const charge = pi.latest_charge;
  const stripeChargeId =
    typeof charge === 'string'
      ? charge
      : charge && typeof charge === 'object' && typeof charge.id === 'string' && charge.id
        ? charge.id
        : null;
  const settlement: ValidatedSettlement = {
    baseAmount,
    coverFee,
    totalChargeCents: check.totalChargeCents,
    stripePaymentIntentId: pi.id,
    stripeChargeId,
    transactionTimestamp: pi.created ? new Date(pi.created * 1000) : new Date(),
  };
  return isApiError ? settlement : { ok: true as const, settlement };
}

export function buildOptionalAddressFields(address: AddressInput, options?: { trim?: boolean }): NormalizedAddressFields {
  const result: NormalizedAddressFields = {};
  for (const key of ADDRESS_KEYS) {
    const val = options?.trim ? address[key]?.trim() : address[key];
    if (val) result[key] = val;
  }
  return result;
}

export function mapStripeMetadataToContributor(metadata: Record<string, string | undefined> | null | undefined, options: { trimIdentity: boolean }) {
  const meta = metadata || {};
  const pick = (val?: string): string | undefined => (options.trimIdentity ? val?.trim() : val);
  return {
    name: pick(meta.contributorName) || 'Anonymous Guest',
    email: pick(meta.contributorEmail) || null,
    message: pick(meta.contributorMessage) || null,
    code: pick(meta.invitationCode) || undefined,
    addressFields: buildOptionalAddressFields(meta, { trim: true }),
  };
}

export async function runContributionNotifications(params: ContributionNotificationParams, options: { mode: 'after' | 'inline' }): Promise<void> {
  let dispatchPromise: Promise<void> | undefined;
  const run = () => (dispatchPromise ??= dispatchContributionNotifications(params));
  if (options.mode === 'inline') {
    await run();
    return;
  }
  if (typeof after === 'function') {
    try {
      after(run);
      return;
    } catch {
      // Fall back to inline execution when called outside an active Next.js request scope
    }
  }
  await run();
}

export function projectViewerRegistryItem(item: RegistryItem, isAdmin: boolean, claimActions?: GuestClaimActions): unknown {
  if (isAdmin) return sanitizeRegistryItem(item);
  const maskedItem = maskRegistryItem({ ...item, contributors: [] }) as RegistryItem;
  return claimActions ? { ...maskedItem, claimActions } : maskedItem;
}
