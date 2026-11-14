import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { createValidatedRoute } from '@/utils/createValidatedRoute';
import { ApiError } from '@/utils/ApiError';
import { isAdminRequest } from '@/core/auth/auth.server';
import {
  getSampleDataStatus,
  generateSampleData,
  purgeSampleData,
} from '@/lib/sampleData/generator';
import { isSiteInitialized, getAppConfig } from '@/lib/config';
import { SampleDataGenerateSchema } from '@/lib/sampleData/schemas';

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const isAdmin = await isAdminRequest(req);
  if (!isAdmin) {
    throw new ApiError(401, 'Unauthorized access.');
  }

  const status = await getSampleDataStatus();
  return NextResponse.json({
    success: true,
    ...status,
  });
});

export const POST = createValidatedRoute({
  schema: SampleDataGenerateSchema,
  handler: async (req: NextRequest, { body }) => {
    const config = await getAppConfig();
    const initialized = isSiteInitialized(config);
    const isAdmin = await isAdminRequest(req);

    // Allow sample generation if admin or if site is in setup mode
    if (initialized && !isAdmin) {
      throw new ApiError(403, 'Forbidden');
    }

    const result = await generateSampleData({
      archetype: body.archetype,
      modules: body.modules,
    });

    return NextResponse.json(result);
  },
});

export const DELETE = withApiMiddleware(async (req: NextRequest) => {
  const isAdmin = await isAdminRequest(req);
  if (!isAdmin) {
    throw new ApiError(401, 'Unauthorized access.');
  }

  const result = await purgeSampleData();
  return NextResponse.json(result);
});
