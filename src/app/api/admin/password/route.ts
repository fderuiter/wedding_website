import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { setAdminAuthCookie, signAdminToken } from '@/core/auth/auth.server';
import { loadSessionGuardConfig, resolveActiveAdminPasswordHash } from '@/core/auth/nodeSessionGuards';
import { hashPassword, verifyPassword } from '@/utils/password';
import { AdminPasswordChangeSchema } from '@/utils/validation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON body.');
  }

  const parseResult = AdminPasswordChangeSchema.safeParse(body);
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const { currentPassword, newPassword, confirmPassword } = parseResult.data;
  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    throw new ApiError(400, 'New password and confirmation do not match.');
  }

  const sessionConfig = await loadSessionGuardConfig();
  const activePasswordHash = resolveActiveAdminPasswordHash(sessionConfig);

  if (!activePasswordHash) {
    throw new ApiError(500, 'Admin password is not configured.');
  }

  const isCurrentValid = await verifyPassword(currentPassword, activePasswordHash);
  if (!isCurrentValid) {
    throw new ApiError(401, 'Current password is incorrect.');
  }

  const nextPasswordHash = await hashPassword(newPassword);
  const nextSessionVersion = sessionConfig.adminSessionVersion + 1;

  await prisma.appConfig.update({
    where: { id: 'global' },
    data: {
      adminPasswordHash: nextPasswordHash,
      adminSessionVersion: nextSessionVersion,
    },
  });

  const iat = Date.now();
  const exp = iat + 60 * 60 * 8 * 1000;
  const token = await signAdminToken({
    isAdmin: true,
    adminSessionVersion: nextSessionVersion,
    iat,
    exp,
  });

  const response = NextResponse.json({
    success: true,
    message: 'Admin password updated successfully.',
  });
  setAdminAuthCookie(response, token);
  return response;
});
