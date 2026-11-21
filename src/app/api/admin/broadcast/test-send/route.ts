import { SendTestBroadcastSchema, BroadcastService } from '@/features/broadcast';
import { createAdminBroadcastRoute } from '../routeHelper';

export const POST = createAdminBroadcastRoute({
  parse: (body) => SendTestBroadcastSchema.safeParse(body),
  fallbackErrorMessage: 'Failed to dispatch test broadcast message.',
  middlewareOptions: { limit: 5, windowMs: 60 * 1000 },
  handler: (data, requestOrigin) =>
    BroadcastService.sendTestBroadcast({ ...data, requestOrigin }),
});
