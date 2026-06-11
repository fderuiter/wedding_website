import { NextResponse } from 'next/server';
import { getEntityService } from '@/lib/admin/registry';
import { isAdminRequest } from '@/utils/adminAuth.server';

/**
 * Fetches a list of records for the entity specified in the route parameters, with optional ordering from query parameters.
 *
 * Supports query parameters `orderBy` (defaults to `createdAt`) and `orderDir` (defaults to `desc`). For entities with type `WeddingPartyMember` the results are ordered by `{ order: 'asc' }`.
 *
 * @param context - Route context whose `params` resolves to an object containing `entity`, the name of the target entity.
 * @returns A JSON HTTP response containing the fetched records array on success; on failure returns a JSON error object with an appropriate status code (401 if unauthorized, 404 if the entity is not found, 500 on server error).
 */
export async function GET(request: Request, context: { params: Promise<{ entity: string }> }) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { entity } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  try {
    const { searchParams } = new URL(request.url);
    const orderField = searchParams.get('orderBy') || 'createdAt';
    const orderDir = searchParams.get('orderDir') || 'desc';
    
    // Some entities use order field for natural sorting
    let orderBy: any = { [orderField]: orderDir };
    if (serviceData.config.entityType === 'WeddingPartyMember') {
       orderBy = { order: 'asc' };
    }
    
    const records = await serviceData.service.findMany({ orderBy });
    return NextResponse.json(records);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch' }, { status: 500 });
  }
}

/**
 * Create a new record for the entity specified in the route parameters.
 *
 * If the entity's config provides `validateCreate`, the request body is validated and a `400` is returned with the validation error when validation fails. The handler also returns `401` for unauthorized requests, `404` if the entity is not found, and `500` for unexpected failures.
 *
 * @returns The created record as JSON when successful (HTTP 201).
 */
export async function POST(request: Request, context: { params: Promise<{ entity: string }> }) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { entity } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  try {
    const body = await request.json();
    
    if (serviceData.config.validateCreate) {
      const error = serviceData.config.validateCreate(body);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }

    const mappedBody = serviceData.config.mapData ? serviceData.config.mapData(body) : body;
    const newRecord = await serviceData.service.create(mappedBody);
    return NextResponse.json(newRecord, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to create' }, { status: 500 });
  }
}

/**
 * Handle collection-level bulk actions for the specified entity (currently supports reorder).
 *
 * @param request - The incoming HTTP request containing a JSON body with the action payload.
 * @param context - Route context whose `params.entity` identifies the target entity.
 * @returns A JSON Response:
 * - Success: `{ success: true }` with status 200 when reorder completes.
 * - Client errors:
 *   - `{ error: 'Invalid action' }` with status 400 for unsupported action/shape.
 *   - `{ error: 'Entity not found' }` with status 404 when the entity has no registered service.
 *   - `{ error: 'Unauthorized' }` with status 401 when the requester is not an admin.
 * - Server error: `{ error: string }` with status 500 on unexpected failures.
 */
export async function PUT(request: Request, context: { params: Promise<{ entity: string }> }) {
  // Use PUT on collection for bulk operations like reorder
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { entity } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  try {
    const body = await request.json();
    if (body.action === 'reorder' && Array.isArray(body.orderedIds)) {
      await serviceData.service.reorder(body.orderedIds);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to update collection' }, { status: 500 });
  }
}
