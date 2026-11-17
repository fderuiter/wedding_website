import { AdminEntityCreateSchema, AdminEntityReorderSchema } from '@/utils/validation';
import { NextRequest, NextResponse } from 'next/server';
import { getEntityService } from '@/features/admin';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const GET = withApiMiddleware(async (request: NextRequest, context: { params: Promise<{ entity: string }> }) => {
  const { entity } = await context.params;
  const serviceData = await getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  const { searchParams } = new URL(request.url);

  // Parse and validate pagination parameters
  let limit = 50;
  if (searchParams.has('limit')) {
    const rawLimit = searchParams.get('limit');
    if (rawLimit === null || rawLimit.trim() === '' || !/^-?\d+$/.test(rawLimit.trim())) {
      throw new ApiError(400, 'Invalid limit parameter');
    }
    const parsedLimit = parseInt(rawLimit.trim(), 10);
    if (parsedLimit <= 0) {
      throw new ApiError(400, 'Invalid limit parameter');
    }
    // Cap limit at 100
    limit = Math.min(parsedLimit, 100);
  }

  let page = 1;
  if (searchParams.has('page')) {
    const rawPage = searchParams.get('page');
    if (rawPage === null || rawPage.trim() === '' || !/^-?\d+$/.test(rawPage.trim())) {
      throw new ApiError(400, 'Invalid page parameter');
    }
    const parsedPage = parseInt(rawPage.trim(), 10);
    if (parsedPage < 1) {
      throw new ApiError(400, 'Invalid page parameter');
    }
    page = parsedPage;
  }

  const cursor = searchParams.get('cursor')?.trim();

  let skip: number | undefined;
  if (searchParams.has('skip')) {
    const rawSkip = searchParams.get('skip');
    if (rawSkip === null || rawSkip.trim() === '' || !/^-?\d+$/.test(rawSkip.trim())) {
      throw new ApiError(400, 'Invalid skip parameter');
    }
    const parsedSkip = parseInt(rawSkip.trim(), 10);
    if (parsedSkip < 0) {
      throw new ApiError(400, 'Invalid skip parameter');
    }
    skip = parsedSkip;
  }

  const orderField = searchParams.get('orderBy') || 'createdAt';
  const orderDir = (searchParams.get('orderDir') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

  const queryArgs: any = {
    take: limit,
    orderBy: { [orderField]: orderDir },
  };

  if (cursor) {
    queryArgs.cursor = { id: cursor };
    queryArgs.skip = skip !== undefined ? skip : 1;
  } else {
    queryArgs.skip = skip !== undefined ? skip : (page - 1) * limit;
  }

  const [total, records] = await Promise.all([
    typeof serviceData.service?.count === 'function' ? serviceData.service.count() : 0,
    serviceData.service.findMany(queryArgs),
  ]);

  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

  const responseHeaders: Record<string, string> = {
    'X-Total-Count': String(total),
    'X-Page': String(page),
    'X-Limit': String(limit),
    'X-Total-Pages': String(totalPages),
    'X-Per-Page': String(limit),
    'X-Current-Page': String(page),
    'X-Has-Next-Page': String(page < totalPages),
    'X-Has-Prev-Page': String(page > 1),
    'Access-Control-Expose-Headers':
      'X-Total-Count, X-Page, X-Limit, X-Total-Pages, X-Per-Page, X-Current-Page, X-Has-Next-Page, X-Has-Prev-Page, X-Next-Cursor',
  };

  if (records.length > 0 && (records.length === limit || page < totalPages)) {
    if (records[records.length - 1]?.id) {
      responseHeaders['X-Next-Cursor'] = records[records.length - 1].id;
    }
  }

  return NextResponse.json(records, { headers: responseHeaders });
});

export const POST = withApiMiddleware(async (request: NextRequest, context: { params: Promise<{ entity: string }> }) => {
  const { entity } = await context.params;
  const serviceData = await getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  const body = await request.json();
  AdminEntityCreateSchema.safeParse(body);
  
  try {
    const newRecord = await serviceData.service.create(body);
    return NextResponse.json(newRecord, { status: 201 });
  } catch (error: any) {
    if (error.message && error.message.startsWith('Validation Error:')) {
      throw new ApiError(400, error.message.replace('Validation Error: ', ''));
    }
    throw error;
  }
});

export const PUT = withApiMiddleware(async (request: NextRequest, context: { params: Promise<{ entity: string }> }) => {
  const { entity } = await context.params;
  const serviceData = await getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  const body = await request.json();
  
  if (body.action === 'reorder') {
    const parseResult = AdminEntityReorderSchema.safeParse(body);
    if (!parseResult.success) {
      throw new ApiError(400, 'Invalid reorder payload');
    }
    try {
      await serviceData.service.reorder(parseResult.data.orderedIds);
      return NextResponse.json({ success: true });
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, error.message || 'Failed to reorder items');
    }
  }
  throw new ApiError(400, 'Invalid action');
});
