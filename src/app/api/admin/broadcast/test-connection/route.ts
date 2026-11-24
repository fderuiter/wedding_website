import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { parseJsonRequestBody } from '@/utils/contentType';
import { formatZodError } from '@/utils/validation';
import { TestConnectionSchema, MultiChannelMessagingProvider } from '@/features/broadcast';
import { getAppConfig } from '@/lib/config';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const body = await parseJsonRequestBody(req);
  const parseResult = TestConnectionSchema.safeParse(body);

  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const config = await getAppConfig('global');
  const provider = new MultiChannelMessagingProvider(config);

  const result = await provider.testConnection(parseResult.data);
  return NextResponse.json(result);
});
