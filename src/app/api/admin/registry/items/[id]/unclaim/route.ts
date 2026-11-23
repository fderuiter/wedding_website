import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { formatZodError } from '@/utils/validation';
import {
  AdminUnclaimRegistryItemSchema,
  registryService,
  sanitizeRegistryItem,
} from '@/features/registry';

export const POST = withApiMiddleware(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const itemId = typeof id === 'string' ? id.trim() : '';
    if (!itemId) {
      throw new ApiError(400, 'Registry item ID is required');
    }

    const body = await req.json().catch(() => ({}));
    const parseResult = AdminUnclaimRegistryItemSchema.safeParse(body);
    if (!parseResult.success) {
      throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
    }

    const updatedItem = await registryService.unclaimItem(
      itemId,
      parseResult.data,
      'Admin'
    );

    return NextResponse.json({
      item: sanitizeRegistryItem(updatedItem),
    });
  }
);
