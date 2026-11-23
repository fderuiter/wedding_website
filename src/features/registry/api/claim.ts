import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { GuestClaimActionSchema, GuestClaimQuerySchema } from '../schemas';
import { verifyContributorActionToken } from '../lib/contributorToken';
import { maskRegistryItem } from '../lib/masking';
import { dispatchConfirmedContributionAlert } from '../notifications';
import { registryService } from '../service';
import { resolveEffectivePaymentHandle } from '../utils/paymentUrls';

function extractQueryToken(request: NextRequest): string {
  const fromNextUrl = request.nextUrl?.searchParams?.get('token');
  if (typeof fromNextUrl === 'string') {
    return fromNextUrl;
  }
  try {
    const parsedUrl = new URL(request.url, 'http://localhost');
    return parsedUrl.searchParams.get('token') ?? '';
  } catch {
    return '';
  }
}

/**
 * Scanner-safe read endpoint for signed guest claim confirmation/cancellation links.
 * Performs zero database mutations so email security link scanners cannot confirm or cancel gifts.
 */
export const GET = withApiMiddleware(
  async (request: NextRequest) => {
    const config = await getAppConfig();
    if (!isFeatureEnabled('registry', config.modules)) {
      throw new ApiError(404, "Feature 'registry' is disabled");
    }

    const rawToken = extractQueryToken(request);
    const parsedQuery = GuestClaimQuerySchema.safeParse({ token: rawToken });
    if (!parsedQuery.success) {
      throw new ApiError(400, parsedQuery.error.issues[0].message);
    }

    const tokenPayload = await verifyContributorActionToken(parsedQuery.data.token);
    if (!tokenPayload) {
      throw new ApiError(401, 'This gift link is invalid or has expired.');
    }

    const record = await registryService.getContributorWithItem(tokenPayload.contributorId);
    if (!record || !record.item || record.item.isSample) {
      throw new ApiError(404, 'Gift reservation not found.');
    }

    const effectiveHandle = resolveEffectivePaymentHandle(record.item, config);

    return NextResponse.json({
      action: tokenPayload.action,
      status: record.contributor.status,
      amount: record.contributor.amount,
      itemId: record.item.id,
      itemName: record.item.name,
      itemType: record.item.itemType ?? 'PHYSICAL',
      isGroupGift: Boolean(record.item.isGroupGift),
      vendorUrl: record.item.vendorUrl ?? null,
      paymentHandle: effectiveHandle.paymentHandle || null,
      paymentHandleType: effectiveHandle.paymentHandleType || null,
    });
  },
  {
    limit: 30,
    windowMs: 60 * 1000,
    keyPrefix: 'registry-claim-preview',
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

    const body = await request.json();
    const parsedBody = GuestClaimActionSchema.safeParse(body);
    if (!parsedBody.success) {
      throw new ApiError(400, parsedBody.error.issues[0].message);
    }

    const tokenPayload = await verifyContributorActionToken(parsedBody.data.token);
    if (!tokenPayload) {
      throw new ApiError(401, 'This gift link is invalid or has expired.');
    }

    const existing = await registryService.getContributorWithItem(tokenPayload.contributorId);
    if (!existing || !existing.item || existing.item.isSample) {
      throw new ApiError(404, 'Gift reservation not found.');
    }

    if (tokenPayload.action === 'confirm') {
      const result = await registryService.confirmContribution(
        tokenPayload.contributorId,
        'Guest'
      );

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
  }
);
