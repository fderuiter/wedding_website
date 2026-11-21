import { PreviewBroadcastSchema, BroadcastService } from '@/features/broadcast';
import { createAdminBroadcastRoute } from '../routeHelper';

export const POST = createAdminBroadcastRoute({
  parse: (body) => PreviewBroadcastSchema.safeParse(body),
  fallbackErrorMessage: 'Failed to generate broadcast preview.',
  handler: (data, requestOrigin) =>
    BroadcastService.renderPreview({ ...data, requestOrigin }),
});
