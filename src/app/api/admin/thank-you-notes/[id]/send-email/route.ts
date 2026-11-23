import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { SendThankYouEmailSchema, thankYouService } from '@/features/registry';
import { formatZodError } from '@/utils/validation';

export const POST = withApiMiddleware(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const body = await req.json();

    const parseResult = SendThankYouEmailSchema.safeParse(body);
    if (!parseResult.success) {
      throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
    }

    const result = await thankYouService.sendThankYouEmail(id, parseResult.data, 'Admin');
    return NextResponse.json({
      success: true,
      ...result,
    });
  }
);
