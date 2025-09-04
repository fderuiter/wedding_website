import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/utils/adminAuth.server';

/**
 * @api {get} /api/admin/me
 * @description Checks if the current user is an administrator.
 *
 * This function handles a GET request to determine the admin status of the current user.
 * It relies on the `isAdminRequest` utility, which inspects the request's cookies for a
 * valid admin authentication token.
 *
 * @param {NextRequest} req - The incoming Next.js request object.
 * @returns {Promise<NextResponse>} A promise that resolves to a `NextResponse` object
 * containing a JSON body with an `isAdmin` boolean property.
 */
export async function GET(req: NextRequest) {
  const isAdmin = await isAdminRequest(req);
  return NextResponse.json({ isAdmin });
}
