import { NextRequest, NextResponse } from 'next/server';
import { BroadcastService } from '@/features/broadcast';
import { getAppConfig } from '@/lib/config';
import { ApiError } from '@/utils/ApiError';
import { parseJsonRequestBody } from '@/utils/contentType';
import {
  RECOVERY_CONFIRMATION_MESSAGE,
  hasRecoveryHoneypotTripped,
  isEmailProviderActive,
  isOutboundMessagingActive,
  isSmsProviderActive,
  parseRecoveryIdentifier,
} from '@/utils/guestSignInRecovery';
import { GuestSignInRecoverySchema } from '@/utils/validation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

function toPlainObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function buildConfirmationResponse(): NextResponse {
  return NextResponse.json(
    {
      success: true,
      message: RECOVERY_CONFIRMATION_MESSAGE,
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}

export const GET = withApiMiddleware(async () => {
  const config = await getAppConfig();
  const emailActive = isEmailProviderActive(config);
  const smsActive = isSmsProviderActive(config);

  return NextResponse.json(
    {
      success: true,
      data: {
        messagingActive: emailActive || smsActive,
        emailActive,
        smsActive,
      },
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
});

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const rawBody = await parseJsonRequestBody<Record<string, unknown>>(req, { allowEmpty: true });
  const body = toPlainObject(rawBody);

  // Silently accept honeypot bot submissions without querying guest records or sending messages
  if (hasRecoveryHoneypotTripped(body)) {
    return buildConfirmationResponse();
  }

  const schemaResult = GuestSignInRecoverySchema.safeParse(body);
  if (!schemaResult.success) {
    throw new ApiError(
      400,
      schemaResult.error.issues[0]?.message ||
        'Please enter a valid email address or your full first and last name.'
    );
  }

  const parsedIdentifier = parseRecoveryIdentifier(schemaResult.data);
  if (!parsedIdentifier.ok) {
    throw new ApiError(400, parsedIdentifier.error);
  }

  const config = await getAppConfig();
  if (!isOutboundMessagingActive(config)) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Outbound email or SMS delivery is not configured on this site. Please contact the hosts directly.',
      },
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );
  }

  try {
    await BroadcastService.requestGuestSignInRecoveryLink({
      parsedIdentifier: parsedIdentifier.data,
      config,
      requestOrigin: req.nextUrl?.origin,
    });
  } catch (err) {
    console.error('[/api/guest/recover] Unexpected error during recovery dispatch:', err);
  }

  return buildConfirmationResponse();
});
