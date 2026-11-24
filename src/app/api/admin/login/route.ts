import { AdminLoginSchema } from '@/utils/validation';
import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword } from '@/utils/password';
import {
  ADMIN_COOKIE,
  setAdminAuthCookie,
  signAdminToken,
  verifyAdminToken,
} from '@/core/auth/auth.server';
import { readRequestCookie } from '@/core/auth/tokenCookieHelpers';
import { env } from '@/env';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { getAppConfig, isSetupCompleted } from '@/lib/config';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const body = await req.json();
  const parseResult = AdminLoginSchema.safeParse(body);
  
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const { password } = parseResult.data;
  
  const adminPassword = env.ADMIN_PASSWORD;

  if (!adminPassword) {
    throw new ApiError(500, 'Admin password not set.');
  }

  const isMatch = await verifyPassword(password, adminPassword);

  if (!isMatch) {
    throw new ApiError(401, 'Invalid password.');
  }

  let requiresSetup = false;
  try {
    const config = await getAppConfig();
    requiresSetup = !isSetupCompleted(config);
  } catch {
    requiresSetup = false;
  }

  let token: string | null = null;
  if (typeof readRequestCookie === 'function' && typeof verifyAdminToken === 'function') {
    const existingToken = await readRequestCookie(ADMIN_COOKIE, req, { suppressErrors: true });
    if (existingToken) {
      const existingPayload = await verifyAdminToken(existingToken);
      if (existingPayload && existingPayload.isAdmin === true) {
        token = existingToken;
      }
    }
  }

  if (!token) {
    const iat = Date.now();
    const exp = iat + 60 * 60 * 8 * 1000;
    token = await signAdminToken({ isAdmin: true, iat, exp });
  }

  const response = NextResponse.json({ success: true, requiresSetup });
  setAdminAuthCookie(response, token);
  return response;
});
