import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { PaymentIntentRequestSchema } from '../schemas';
import {
  resolveStripeClient,
  serializeStripePaymentIntentMetadata,
  verifyPaymentIntentOwnership,
} from './stripeSettlementHelpers';
import { hasAddressCollectionTag } from '../utils/invitation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { parseJsonRequestBody } from '@/utils/contentType';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { prisma } from '@/lib/prisma';
import { getHydratedGuestInvitation } from '@/lib/requestContext';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { calculateContributionAmounts } from '@/lib/stripe';
import { checkAuthLockout, recordAuthFailure } from '@/utils/rateLimit';

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
  const hasHeaders = Boolean(request?.headers && typeof request.headers.get === 'function');
  if (hasHeaders) {
    const lockoutResponse = await checkAuthLockout(request);
    if (lockoutResponse) {
      return lockoutResponse;
    }
  }

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
    itemId, amount, coverFee, paymentIntentId, clientSecret,
    name, email, message, code, ...addressFields
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

  const [session, isAdmin] = await Promise.all([
    getGuestInviteSession(request),
    isAdminRequest(request),
  ]);
  const submittedCode = code?.trim() ? code.trim() : undefined;
  const sessionCode = session?.code?.trim() ? session.code.trim() : undefined;

  if (!isAdmin && submittedCode) {
    if (!sessionCode || sessionCode.toUpperCase() !== submittedCode.toUpperCase()) {
      if (hasHeaders) {
        await recordAuthFailure(request);
      }
      throw new ApiError(
        403,
        'Forbidden: Please verify your household invitation code before linking a contribution to a household.'
      );
    }
  }

  const finalCode = isAdmin ? submittedCode : sessionCode;
  const sessionEmail =
    !isAdmin && typeof session?.email === 'string' && session.email.trim().length > 0
      ? session.email.trim()
      : null;

  const { baseAmount, feeAmount, totalChargeAmount, totalChargeCents, netPayout } =
    calculateContributionAmounts(amount, Boolean(coverFee));

  const stripeResult = resolveStripeClient();
  if (!stripeResult.ok) {
    return stripeResult.response;
  }
  const { stripe } = stripeResult;

  const explicitEmail = email?.trim() || '';
  const fallbackInviteEmail =
    !explicitEmail && finalCode
      ? sessionEmail ?? (await resolveInviteFallbackEmail(finalCode, request))
      : null;
  const trimmedEmail = explicitEmail || fallbackInviteEmail || '';
  const metadata = serializeStripePaymentIntentMetadata({
    ...addressFields,
    itemId: targetItem.id,
    itemName: targetItem.name,
    baseAmount,
    feeAmount,
    coverFee: Boolean(coverFee),
    totalChargeAmount,
    contributorName: name,
    contributorEmail: trimmedEmail,
    contributorMessage: message,
    invitationCode: finalCode,
  });

  if (paymentIntentId) {
    let existingIntent;
    try {
      const ownership = await verifyPaymentIntentOwnership(
        {
          source: { stripe, paymentIntentId },
          requireClientSecret: true,
          clientSecret,
          expectedItemId: targetItem.id,
        },
        403
      );
      existingIntent = ownership.paymentIntent;
    } catch (err: unknown) {
      if (err instanceof ApiError && err.statusCode === 403 && hasHeaders) {
        await recordAuthFailure(request);
      }
      throw err;
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
}, { limit: 30, windowMs: 60 * 1000, keyPrefix: 'registry-payment-intent' });
