import { NextResponse } from 'next/server';
import { getEntityService } from '@/lib/admin/registry';
import { isAdminRequest } from '@/utils/adminAuth.server';

/**
 * Retrieves a single record for the specified entity id, restricted to admin users.
 *
 * @param request - Incoming HTTP request
 * @param context - Object whose `params` promise resolves to `{ entity, id }` route parameters
 * @returns A JSON HTTP response: the found record with status 200; `401` with `{ error: 'Unauthorized' }` when the caller is not an admin; `404` with `{ error: 'Entity not found' }` when the entity service is missing or `{ error: 'Not found' }` when the record does not exist; `500` with `{ error: <message> }` on internal errors.
 */
export async function GET(request: Request, context: { params: Promise<{ entity: string, id: string }> }) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { entity, id } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  try {
    const record = await serviceData.service.findById(id);
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(record);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch' }, { status: 500 });
  }
}

/**
 * Update a specific entity record by ID; requires an authorized admin request.
 *
 * @param request - The incoming HTTP request containing the update payload as JSON.
 * @param context - Route context whose `params` promise resolves to `{ entity, id }`.
 * @returns A NextResponse with the updated record as JSON on success; on error returns a JSON error object and an appropriate HTTP status (401 for unauthorized, 404 for unknown entity or missing record, 400 for validation errors, 500 for server errors).
 */
export async function PUT(request: Request, context: { params: Promise<{ entity: string, id: string }> }) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { entity, id } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  try {
    const body = await request.json();
    
    if (serviceData.config.validateUpdate) {
      const error = serviceData.config.validateUpdate(body);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }

    const updatedRecord = await serviceData.service.update(id, body);
    return NextResponse.json(updatedRecord);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to update' }, { status: 500 });
  }
}

/**
 * Handles an admin-only DELETE request to remove a record for a given entity and id.
 *
 * @param request - The incoming HTTP request.
 * @param context - An object whose `params` promise resolves to `{ entity, id }` from the route.
 * @returns A JSON HTTP response containing the deleted record on success; otherwise a JSON error object with status `401` (unauthorized), `404` (entity or record not found), or `500` (server error).
 */
export async function DELETE(request: Request, context: { params: Promise<{ entity: string, id: string }> }) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { entity, id } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  try {
    const deletedRecord = await serviceData.service.delete(id);
    return NextResponse.json(deletedRecord);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to delete' }, { status: 500 });
  }
}
