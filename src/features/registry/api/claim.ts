import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { parseJsonRequestBody } from '@/utils/contentType';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { GuestClaimActionSchema, GuestClaimQuerySchema } from '../schemas';
import {
  signContributorActionToken,
  verifyContributorActionToken,
} from '../lib/contributorToken';
import { maskRegistryItem } from '../lib/masking';
import { dispatchConfirmedContributionAlert } from '../notifications';
import { registryService } from '../service';
import type { ClaimHubHold, ClaimHubResponse, ContributorWithItemRecord } from '../types';
import {
  extractShippingAddressFromConfig,
  resolveEffectivePaymentHandle,
} from '../utils/paymentUrls';

async function toClaimHubHold(
  record: ContributorWithItemRecord,
  config: Awaited<ReturnType<typeof getAppConfig>>
): Promise<ClaimHubHold> {
  const item = record.item!;
  const contributor = record.contributor;
  const itemType = item.itemType ?? 'PHYSICAL';
  const effectiveHandle = resolveEffectivePaymentHandle(item, config);
  const contributorId = contributor.id || '';
  const [confirmToken, cancelToken] = await Promise.all([
    signContributorActionToken({
      contributorId,
      action: 'confirm',
    }),
    signContributorActionToken({
      contributorId,
      action: 'cancel',
    }),
  ]);

  return {
    contributorId,
    status: contributor.status ?? 'RESERVED',
    amount: contributor.amount,
    createdAt:
      contributor.date && typeof contributor.date === 'string'
        ? contributor.date
        : new Date().toISOString(),
    itemId: item.id,
    itemName: item.name,
    itemDescription: item.description ?? '',
    itemImageUrl: item.image?.url ?? null,
    itemCategory: item.category ?? null,
    itemType,
    isGroupGift: Boolean(item.isGroupGift),
    vendorUrl: item.vendorUrl ?? null,
    paymentHandle: effectiveHandle.paymentHandle || null,
    paymentHandleType: effectiveHandle.paymentHandleType || null,
    retailerOrderNumber: contributor.retailerOrderNumber ?? null,
    carrier: contributor.carrier ?? null,
    trackingNumber: contributor.trackingNumber ?? null,
    confirmToken,
    cancelToken,
  };
}

/**
 * Scanner-safe read endpoint for signed guest claim confirmation/cancellation links
 * and the multi-item Guest Claim & Fulfillment Hub.
 * Performs zero database mutations so email security link scanners cannot confirm or cancel gifts.
 * Security guardrail: A shared guest_auth cookie alone never lists holds; multi-item lookup
 * strictly requires a verified guest_invite_session or contributor-scoped signed claim token(s).
 */
export const GET = withApiMiddleware(
  async (request: NextRequest) => {
    const config = await getAppConfig();
    if (!isFeatureEnabled('registry', config.modules)) {
      throw new ApiError(404, "Feature 'registry' is disabled");
    }

    const searchParams =
      request.nextUrl?.searchParams ?? new URL(request.url, 'http://localhost').searchParams;
    const rawToken = searchParams.get('token') ?? '';
    const rawHub = searchParams.get('hub') ?? '';
    const rawTokens = searchParams.get('tokens') ?? '';
    const parsedQuery = GuestClaimQuerySchema.safeParse({
      token: rawToken || undefined,
      hub: rawHub || undefined,
      tokens: rawTokens || undefined,
    });
    if (!parsedQuery.success) {
      throw new ApiError(400, parsedQuery.error.issues[0].message);
    }

    const isHubMode = parsedQuery.data.hub === '1' || parsedQuery.data.hub === 'true';

    if (isHubMode) {
      const inviteSession = await getGuestInviteSession(request);
      const primaryToken = parsedQuery.data.token?.trim() || '';
      const extraTokens = (parsedQuery.data.tokens || '')
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && t !== primaryToken)
        .slice(0, 25);

      const hasSuppliedTokens = Boolean(primaryToken || extraTokens.length > 0);
      if (!inviteSession?.code && !hasSuppliedTokens) {
        throw new ApiError(400, 'Missing or invalid claim token.');
      }

      const recordsByContributorId = new Map<string, ContributorWithItemRecord>();
      let selectedContributorId: string | null = null;
      let selectedAction: 'confirm' | 'cancel' | null = null;
      let verifiedAnyToken = false;
      let validTokenMissingItem = false;

      if (primaryToken) {
        const primaryPayload = await verifyContributorActionToken(primaryToken);
        if (primaryPayload) {
          verifiedAnyToken = true;
          selectedAction = primaryPayload.action;
          const record = await registryService.getContributorWithItem(primaryPayload.contributorId);
          if (record && record.item && !record.item.isSample && record.contributor.id) {
            recordsByContributorId.set(record.contributor.id, record);
            selectedContributorId = record.contributor.id;
          } else {
            validTokenMissingItem = true;
          }
        }
      }

      if (inviteSession?.code) {
        const householdHolds = await registryService.getReservedContributionsByInvitationCode(
          inviteSession.code
        );
        for (const record of householdHolds) {
          if (record.item && !record.item.isSample && record.contributor.id) {
            if (!recordsByContributorId.has(record.contributor.id)) {
              recordsByContributorId.set(record.contributor.id, record);
            }
          }
        }
      }

      if (extraTokens.length > 0) {
        const verifiedExtras = await Promise.all(
          extraTokens.map((candidate) => verifyContributorActionToken(candidate))
        );
        for (const extraPayload of verifiedExtras) {
          if (!extraPayload) continue;
          verifiedAnyToken = true;
          if (recordsByContributorId.has(extraPayload.contributorId)) continue;
          const record = await registryService.getContributorWithItem(extraPayload.contributorId);
          if (
            record &&
            record.item &&
            !record.item.isSample &&
            record.contributor.id &&
            record.contributor.status === 'RESERVED'
          ) {
            recordsByContributorId.set(record.contributor.id, record);
          }
        }
      }

      if (!inviteSession?.code && hasSuppliedTokens) {
        if (!verifiedAnyToken) {
          throw new ApiError(401, 'This gift link is invalid or has expired.');
        }
        if (recordsByContributorId.size === 0 && validTokenMissingItem) {
          throw new ApiError(404, 'Gift reservation not found.');
        }
      }

      const holds = await Promise.all(
        Array.from(recordsByContributorId.values()).map((rec) => toClaimHubHold(rec, config))
      );

      const { shippingCandidate, hasShippingAddress } = extractShippingAddressFromConfig(config);
      const hasPhysicalHold = holds.some(
        (h) => h.itemType === 'PHYSICAL' && h.status !== 'CANCELLED' && h.status !== 'REFUNDED'
      );
      const canDiscloseShippingWithoutPhysicalHold =
        Boolean(inviteSession?.code) && config.shippingDisclosureTier !== 'POST_CLAIM_ONLY';
      const shippingAddress =
        hasShippingAddress && (hasPhysicalHold || canDiscloseShippingWithoutPhysicalHold)
          ? shippingCandidate
          : null;

      const maxPendingReservations =
        typeof config.maxPendingReservations === 'number' &&
        Number.isInteger(config.maxPendingReservations) &&
        config.maxPendingReservations >= 1
          ? config.maxPendingReservations
          : 5;

      const coupleNames =
        [config.partner1Name?.trim(), config.partner2Name?.trim()].filter(Boolean).join(' & ') ||
        'the couple';

      const hubResponse: ClaimHubResponse = {
        holds,
        maxPendingReservations,
        coupleNames,
        shippingAddress,
        selectedContributorId: selectedContributorId ?? holds[0]?.contributorId ?? null,
        selectedAction: selectedAction ?? 'confirm',
      };

      return NextResponse.json(hubResponse);
    }

    const tokenPayload = await verifyContributorActionToken(parsedQuery.data.token || '');
    if (!tokenPayload) {
      throw new ApiError(401, 'This gift link is invalid or has expired.');
    }

    const record = await registryService.getContributorWithItem(tokenPayload.contributorId);
    if (!record || !record.item || record.item.isSample) {
      throw new ApiError(404, 'Gift reservation not found.');
    }

    const itemType = record.item.itemType ?? 'PHYSICAL';
    const effectiveHandle = resolveEffectivePaymentHandle(record.item, config);
    const { shippingCandidate, hasShippingAddress } = extractShippingAddressFromConfig(config);
    const shippingAddress =
      itemType === 'PHYSICAL' && hasShippingAddress ? shippingCandidate : null;

    return NextResponse.json({
      action: tokenPayload.action,
      status: record.contributor.status,
      amount: record.contributor.amount,
      itemId: record.item.id,
      itemName: record.item.name,
      itemType,
      isGroupGift: Boolean(record.item.isGroupGift),
      vendorUrl: record.item.vendorUrl ?? null,
      ...(shippingAddress ? { shippingAddress } : {}),
      paymentHandle: effectiveHandle.paymentHandle || null,
      paymentHandleType: effectiveHandle.paymentHandleType || null,
    });
  },
  {
    limit: 30,
    windowMs: 60 * 1000,
    keyPrefix: 'registry-claim-preview',
    scope: 'ip',
  }
);

/**
 * Explicit form-submission mutation endpoint for signed guest claim confirmation or cancellation.
 */
export const POST = withApiMiddleware(
  async (request: NextRequest) => {
    const config = await getAppConfig();
    if (!isFeatureEnabled('registry', config.modules)) {
      throw new ApiError(404, "Feature 'registry' is disabled");
    }

    const body = await parseJsonRequestBody(request);
    const parsedBody = GuestClaimActionSchema.safeParse(body);
    if (!parsedBody.success) {
      throw new ApiError(400, parsedBody.error.issues[0].message);
    }

    const {
      token,
      retailerOrderNumber,
      carrier,
      trackingNumber,
    } = parsedBody.data;

    const tokenPayload = await verifyContributorActionToken(token);
    if (!tokenPayload) {
      throw new ApiError(401, 'This gift link is invalid or has expired.');
    }

    const existing = await registryService.getContributorWithItem(tokenPayload.contributorId);
    if (!existing || !existing.item || existing.item.isSample) {
      throw new ApiError(404, 'Gift reservation not found.');
    }

    if (tokenPayload.action === 'confirm') {
      const trimOrUndefined = (val?: string | null) =>
        val && val.trim().length > 0 ? val.trim() : undefined;
      const cleanOrderNumber = trimOrUndefined(retailerOrderNumber);
      const cleanCarrier = trimOrUndefined(carrier);
      const cleanTrackingNumber = trimOrUndefined(trackingNumber);
      const hasOrderDetails = Boolean(
        cleanOrderNumber || cleanCarrier || cleanTrackingNumber
      );

      const result = hasOrderDetails
        ? await registryService.confirmContribution(tokenPayload.contributorId, 'Guest', {
          ...(cleanOrderNumber ? { retailerOrderNumber: cleanOrderNumber } : {}),
          ...(cleanCarrier ? { carrier: cleanCarrier } : {}),
          ...(cleanTrackingNumber ? { trackingNumber: cleanTrackingNumber } : {}),
        })
        : await registryService.confirmContribution(tokenPayload.contributorId, 'Guest');

      await dispatchConfirmedContributionAlert({
        contributor: result.contributor,
        item: result.item ?? existing.item,
        config,
        requestUrl: request.url,
      });

      return NextResponse.json({
        action: 'confirm',
        status: result.contributor.status,
        changed: result.changed,
        item: result.item ? maskRegistryItem(result.item) : null,
      });
    }

    const result = await registryService.cancelReservedContribution(
      tokenPayload.contributorId,
      'Guest'
    );

    return NextResponse.json({
      action: 'cancel',
      status: result.contributor.status,
      changed: result.changed,
      item: result.item ? maskRegistryItem(result.item) : null,
    });
  },
  {
    limit: 20,
    windowMs: 60 * 1000,
    keyPrefix: 'registry-claim-mutate',
    scope: 'ip',
  }
);
