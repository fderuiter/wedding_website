import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { formatZodError } from '@/utils/validation';
import {
  AdminDeleteContributorSchema,
  AdminUpdateContributorSchema,
  registryService,
  sanitizeRegistryItem,
} from '@/features/registry';

export const PATCH = withApiMiddleware(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const contributorId = typeof id === 'string' ? id.trim() : '';
    if (!contributorId) {
      throw new ApiError(400, 'Contributor ID is required');
    }

    const body = await req.json();
    const parseResult = AdminUpdateContributorSchema.safeParse(body);
    if (!parseResult.success) {
      throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
    }

    const result = await registryService.updateContributor(
      contributorId,
      parseResult.data,
      'Admin'
    );

    return NextResponse.json({
      contributor: result.contributor,
      item: result.item ? sanitizeRegistryItem(result.item) : null,
    });
  }
);

export const DELETE = withApiMiddleware(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const contributorId = typeof id === 'string' ? id.trim() : '';
    if (!contributorId) {
      throw new ApiError(400, 'Contributor ID is required');
    }

    const { searchParams } = new URL(req.url);
    const queryConfirm = searchParams.get('confirmVerifiedPayment');
    const rawBody = await req.json().catch(() => ({}));
    const mergedInput =
      rawBody && typeof rawBody === 'object' && 'confirmVerifiedPayment' in rawBody
        ? rawBody
        : queryConfirm === 'true'
          ? { ...rawBody, confirmVerifiedPayment: true }
          : rawBody;

    const parseResult = AdminDeleteContributorSchema.safeParse(mergedInput);
    if (!parseResult.success) {
      throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
    }

    const result = await registryService.deleteContributor(
      contributorId,
      parseResult.data,
      'Admin'
    );

    return NextResponse.json({
      deletedId: result.deletedId,
      item: result.item ? sanitizeRegistryItem(result.item) : null,
    });
  }
);
