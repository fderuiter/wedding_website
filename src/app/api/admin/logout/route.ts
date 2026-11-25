import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest, setAdminAuthCookie } from '@/core/auth/auth.server';
import { resolveTenantClaimsForSigning } from '@/core/auth/tenantClaims.node';
import { prisma } from '@/lib/prisma';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { AdminLogoutSchema } from '@/utils/validation';

export const POST = withApiMiddleware(async (req?: NextRequest) => {
  AdminLogoutSchema.safeParse({});
  const wasAuthenticated = req ? await isAdminRequest(req) : false;

  if (wasAuthenticated) {
    const tenantClaims = await resolveTenantClaimsForSigning(req);
    const targetId = tenantClaims.siteId || 'global';
    const delegate = (
      prisma as unknown as {
        appConfig?: {
          upsert?: (args: {
            where: { id: string };
            update: { adminTokenVersion: { increment: number } };
            create: { id: string; subdomain?: string; adminTokenVersion: number };
          }) => Promise<unknown>;
        };
      }
    )?.appConfig;

    if (typeof delegate?.upsert === 'function') {
      await delegate.upsert({
        where: { id: targetId },
        update: { adminTokenVersion: { increment: 1 } },
        create: {
          id: targetId,
          ...(tenantClaims.subdomain ? { subdomain: tenantClaims.subdomain } : {}),
          adminTokenVersion: 2,
        },
      });
    }
  }

  const response = NextResponse.json({ success: true });
  setAdminAuthCookie(response, '', 0, req);
  return response;
});
