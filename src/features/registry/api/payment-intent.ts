import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { PaymentIntentRequestSchema } from '../schemas';
import { hasAddressCollectionTag } from '../utils/invitation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { parseJsonRequestBody } from '@/utils/contentType';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { prisma } from '@/lib/prisma';
import { getHydratedGuestInvitation } from '@/lib/requestContext';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { getStripeInstance, calculateContributionAmounts } from '@/lib/stripe';
import { timingSafeEqualJS } from '@/utils/crypto';

const STRIPE_METADATA_VALUE_MAX_LENGTH = 500;

function truncateStripeMetadata(value?: string | null): string {
  if (!value) return '';
  return value.slice(0, STRIPE_METADATA_VALUE_MAX_LENGTH);
}

async function resolveInviteFallbackEmail(
  code: string,
  request: NextRequest
): Promise<string | null> {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) {
    return null;
  }

  const hydrated = getHydratedGuestInvitation(normalizedCode, request);
  if (hydrated && typeof hydrated.email === 'string' && hydrated.email.trim().length > 0) {
    return hydrated.email.trim();
  }

  try {
    const delegate = (
      prisma as unknown as {
        invitationCode?: {
          findUnique?: (args: {
            where: { code: string };
          }) => Promise<{
            email?: string | null;
            used?: boolean;
            isSample?: boolean;
            partyTags?: unknown;
          } | null>;
        };
      }
    )?.invitationCode;

    if (typeof delegate?.findUnique !== 'function') {
      return null;
    }

    const invite = await delegate.findUnique({
      where: { code: normalizedCode },
    });
    if (!invite || invite.isSample || invite.used || hasAddressCollectionTag(invite.partyTags)) {
      return null;
    }
    return typeof invite.email === 'string' && invite.email.trim().length > 0
      ? invite.email.trim()
      : null;
  } catch {
    return null;
  }
}

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    throw new ApiError(404, "Feature 'registry' is disabled");
  }

  const data = await parseJsonRequestBody(request);
  const parseResult = PaymentIntentRequestSchema.safeParse(data);

  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const {
    itemId,
    amount,
    coverFee,
    paymentIntentId,
    clientSecret,
    name,
    email,
    message,
    code,
    addressLine1,
    addressLine2,
    city,
    state,
    zipCode,
    country,
  } = parseResult.data;

  const targetItem = await registryService.getItemById(itemId);
  if (!targetItem) {
    throw new ApiError(404, 'Item not found');
  }

  if (targetItem.isSample) {
    throw new ApiError(400, 'Sample registry items do not accept contributions or payments.');
  }

  if (targetItem.purchased) {
    throw new ApiError(400, 'This item has already been purchased.');
  }

  if (!isFeatureEnabled('groupGifting', config.modules)) {
    if (targetItem.isGroupGift || amount < targetItem.price) {
      throw new ApiError(400, 'Group gifting is currently disabled.');
    }
  }

  const isFund =
    targetItem.itemType === 'CASH_FUND' || targetItem.itemType === 'EXPERIENCE_FUND';
  const quantity = isFund ? 1 : Math.max(1, Math.floor(targetItem.quantity || 1));
  const unitPriceCents = Math.round(targetItem.price * 100);
  const totalTargetCents = unitPriceCents * quantity;
  const contributedCents = Math.round(targetItem.amountContributed * 100);
  const remainingCents = totalTargetCents - contributedCents;
  const contributionCents = Math.round(amount * 100);

  if (contributionCents > remainingCents) {
    throw new ApiError(400, 'Contribution cannot be greater than the remaining amount.');
  }

  if (!isFund && !targetItem.isGroupGift && unitPriceCents > 0) {
    if (contributionCents < unitPriceCents || contributionCents % unitPriceCents !== 0) {
      throw new ApiError(400, 'Contribution amount must match a whole number of available units.');
    }
  }

  let finalCode = code?.trim() || undefined;
  let sessionEmail: string | null = null;
  if (!finalCode || !email?.trim()) {
    const session = await getGuestInviteSession(request);
    if (session?.code) {
      if (!finalCode) {
        finalCode = session.code;
      }
      if (finalCode.trim().toUpperCase() === session.code.trim().toUpperCase()) {
        sessionEmail =
          typeof session.email === 'string' && session.email.trim().length > 0
            ? session.email.trim()
            : null;
      }
    }
  }

  const { baseAmount, feeAmount, totalChargeAmount, totalChargeCents, netPayout } =
    calculateContributionAmounts(amount, Boolean(coverFee));

  let stripe;
  try {
    stripe = getStripeInstance();
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        error: err?.message || 'Card checkout is not configured on this deployment.',
      },
      { status: 503 }
    );
  }
  const explicitEmail = email?.trim() || '';
  const fallbackInviteEmail =
    !explicitEmail && finalCode
      ? sessionEmail ?? (await resolveInviteFallbackEmail(finalCode, request))
      : null;
  const trimmedEmail = explicitEmail || fallbackInviteEmail || '';
  const metadata: Record<string, string> = {
    itemId: truncateStripeMetadata(targetItem.id),
    itemName: truncateStripeMetadata(targetItem.name),
    baseAmount: baseAmount.toFixed(2),
    feeAmount: feeAmount.toFixed(2),
    coverFee: coverFee ? 'true' : 'false',
    totalChargeAmount: totalChargeAmount.toFixed(2),
    contributorName: truncateStripeMetadata(name),
    contributorEmail: truncateStripeMetadata(trimmedEmail),
    contributorMessage: truncateStripeMetadata(message),
    invitationCode: truncateStripeMetadata(finalCode),
    addressLine1: truncateStripeMetadata(addressLine1?.trim()),
    addressLine2: truncateStripeMetadata(addressLine2?.trim()),
    city: truncateStripeMetadata(city?.trim()),
    state: truncateStripeMetadata(state?.trim()),
    zipCode: truncateStripeMetadata(zipCode?.trim()),
    country: truncateStripeMetadata(country?.trim()),
  };

  if (paymentIntentId) {
    if (!clientSecret) {
      throw new ApiError(403, 'Valid clientSecret is required to update an existing PaymentIntent.');
    }

    let existingIntent;
    try {
      existingIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch {
      throw new ApiError(403, 'Unable to verify ownership of the specified PaymentIntent.');
    }

    if (!existingIntent) {
      throw new ApiError(403, 'Unable to verify ownership of the specified PaymentIntent.');
    }

    const encoder = new TextEncoder();
    const providedSecretBytes = encoder.encode(clientSecret);
    const expectedSecretBytes =
      typeof existingIntent.client_secret === 'string' && existingIntent.client_secret.length > 0
        ? encoder.encode(existingIntent.client_secret)
        : null;
    const hasMatchingSecret =
      expectedSecretBytes !== null &&
      timingSafeEqualJS(providedSecretBytes, expectedSecretBytes);
    const hasMatchingItem = existingIntent.metadata?.itemId === targetItem.id;

    if (!hasMatchingSecret || !hasMatchingItem) {
      throw new ApiError(403, 'Forbidden: PaymentIntent ownership or item binding mismatch.');
    }

    if (existingIntent.status === 'requires_payment_method') {
      try {
        const updated = await stripe.paymentIntents.update(paymentIntentId, {
          amount: totalChargeCents,
          receipt_email: trimmedEmail || null,
          metadata,
        });
        return NextResponse.json({
          success: true,
          clientSecret: updated.client_secret,
          paymentIntentId: updated.id,
          amount: totalChargeAmount,
          baseAmount,
          feeAmount,
          coverFee: Boolean(coverFee),
          netPayout,
        });
      } catch {
        // In case update is no longer possible for a verified intent, fall through to create a new PaymentIntent
      }
    }
  }

  const newPaymentIntent = await stripe.paymentIntents.create({
    amount: totalChargeCents,
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    ...(trimmedEmail ? { receipt_email: trimmedEmail } : {}),
    metadata,
  });

  return NextResponse.json({
    success: true,
    clientSecret: newPaymentIntent.client_secret,
    paymentIntentId: newPaymentIntent.id,
    amount: totalChargeAmount,
    baseAmount,
    feeAmount,
    coverFee: Boolean(coverFee),
    netPayout,
  });
});
