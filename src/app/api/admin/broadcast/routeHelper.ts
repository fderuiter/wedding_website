import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware, type ApiMiddlewareOptions } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { parseJsonRequestBody } from '@/utils/contentType';
import { formatZodError } from '@/utils/validation';
import { resolveRequestOrigin } from '@/utils/hostValidation';

type SafeParseResult<TData> =
  | { success: true; data: TData }
  | { success: false; error: Parameters<typeof formatZodError>[0] };

interface AdminBroadcastRouteConfig<TData, TResult> {
  parse: (_body: unknown) => SafeParseResult<TData>;
  handler: (_data: TData, _requestOrigin: string) => Promise<TResult>;
  fallbackErrorMessage: string;
  middlewareOptions?: ApiMiddlewareOptions;
}

export function createAdminBroadcastRoute<TData, TResult>({
  parse,
  handler,
  fallbackErrorMessage,
  middlewareOptions,
}: AdminBroadcastRouteConfig<TData, TResult>) {
  return withApiMiddleware(async (req: NextRequest) => {
    const body = await parseJsonRequestBody(req);
    const parseResult = parse(body);

    if (!parseResult.success) {
      throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
    }

    const requestOrigin = resolveRequestOrigin(req);

    try {
      const result = await handler(parseResult.data, requestOrigin);
      return NextResponse.json(result);
    } catch (error: unknown) {
      const errorMessage =
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : '';
      throw new ApiError(500, errorMessage || fallbackErrorMessage);
    }
  }, middlewareOptions);
}
