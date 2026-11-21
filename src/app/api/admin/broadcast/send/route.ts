import { SendBroadcastSchema, BroadcastService } from '@/features/broadcast';
import { createAdminBroadcastRoute } from '../routeHelper';

export const POST = createAdminBroadcastRoute({
  parse: (body) => SendBroadcastSchema.safeParse(body),
  fallbackErrorMessage: 'Failed to dispatch broadcast message.',
  handler: (data, requestOrigin) =>
    BroadcastService.sendBroadcast({ ...data, requestOrigin }),
});
