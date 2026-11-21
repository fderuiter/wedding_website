import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { loadSessionGuardConfig, resolveActiveAdminPasswordHash } from '@/core/auth/nodeSessionGuards';
import { hashPassword, verifyAdminPasswordResetToken } from '@/utils/password';
import { AdminPasswordResetConfirmSchema } from '@/utils/validation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { env } from '@/env';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON body.');
  }

  const parseResult = AdminPasswordResetConfirmSchema.safeParse(body);
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const { token, newPassword, confirmPassword } = parseResult.data;
  if (confirmPassword !== undefined && newPassword !== confirmPassword) {
    throw new ApiError(400, 'New password and confirmation do not match.');
  }

  if (!env.ADMIN_PASSWORD) {
    throw new ApiError(500, 'Admin password secret is not configured.');
  }

  const sessionConfig = await loadSessionGuardConfig();
  const verification = verifyAdminPasswordResetToken(token, {
    envAdminPassword: env.ADMIN_PASSWORD,
    activePasswordHash: resolveActiveAdminPasswordHash(sessionConfig),
    adminSessionVersion: sessionConfig.adminSessionVersion,
  });

  if (!verification.valid) {
    throw new ApiError(400, verification.error);
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

  return NextResponse.json({
    success: true,
    message: 'Admin password has been reset. You can now sign in with your new password.',
  });
});
