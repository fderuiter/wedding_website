import { AdminLoginSchema } from '@/utils/validation';
import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword } from '@/utils/password';
import {
  ADMIN_COOKIE,
  setAdminAuthCookie,
  signAdminToken,
  verifyAdminToken,
} from '@/core/auth/auth.server';
import {
  resolveTenantClaimsForSigning,
  verifyNodeTenantClaims,
} from '@/core/auth/tenantClaims.node';
import { findVerifiedRequestCookie } from '@/core/auth/tokenCookieHelpers';
import { env } from '@/env';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { parseJsonRequestBody } from '@/utils/contentType';
import { getAppConfig, isSetupCompleted } from '@/lib/config';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const body = await parseJsonRequestBody(req);
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
  let resolvedConfig:
    | { id?: string; subdomain?: string | null; adminTokenVersion?: number | null }
    | undefined;
  try {
    const config = await getAppConfig();
    resolvedConfig = config;
    requiresSetup = !isSetupCompleted(config);
  } catch {
    requiresSetup = false;
  }

  const activeAdminTokenVersion =
    typeof resolvedConfig?.adminTokenVersion === 'number' &&
    Number.isInteger(resolvedConfig.adminTokenVersion) &&
    resolvedConfig.adminTokenVersion >= 1
      ? resolvedConfig.adminTokenVersion
      : 1;

  let token: string | null = null;
  if (typeof findVerifiedRequestCookie === 'function' && typeof verifyAdminToken === 'function') {
    const verifiedExisting = await findVerifiedRequestCookie(
      ADMIN_COOKIE,
      req,
      async (candidate) => {
        const existingPayload = await verifyAdminToken(candidate);
        if (
          existingPayload &&
          existingPayload.isAdmin === true &&
          existingPayload.v === activeAdminTokenVersion &&
          (await verifyNodeTenantClaims(existingPayload, req))
        ) {
          return existingPayload;
        }
        return null;
      },
      { suppressErrors: true }
    );
    if (verifiedExisting) {
      token = verifiedExisting.token;
    }
  }

  if (!token) {
    const tenantClaims = await resolveTenantClaimsForSigning(req, resolvedConfig);
    const iat = Date.now();
    const exp = iat + 60 * 60 * 8 * 1000;
    token = await signAdminToken({
      isAdmin: true,
      v: activeAdminTokenVersion,
      ...tenantClaims,
      iat,
      exp,
    });
  }

  const response = NextResponse.json({ success: true, requiresSetup });
  setAdminAuthCookie(response, token, undefined, req);
  return response;
});
