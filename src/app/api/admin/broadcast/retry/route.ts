import { RetryBroadcastSchema, BroadcastService } from '@/features/broadcast';
import { createAdminBroadcastRoute } from '../routeHelper';

export const POST = createAdminBroadcastRoute({
  parse: (body) => RetryBroadcastSchema.safeParse(body),
  fallbackErrorMessage: 'Failed to retry broadcast dispatch.',
  handler: (data, requestOrigin) =>
    BroadcastService.retryFailedRecipients(data.broadcastId, data.recipientIds, requestOrigin),
});
