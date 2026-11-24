import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { parseJsonRequestBody } from '@/utils/contentType';
import {
  DryRunValidateBatchSchema,
  DryRunValidateBatchDTO,
  InvitationCodeAdminService,
} from '@/features/registry';
import {
  BatchInvitationCodeRecord,
  INVITATION_COLLISION_STRATEGIES,
  normalizePartyTags,
} from '@/utils/invitationValidation';
import { formatZodError } from '@/utils/validation';

const DryRunEnvelopeFallbackSchema = z.object({
  records: z
    .array(z.record(z.string(), z.unknown()))
    .min(1, 'At least one record is required for batch import validation.'),
  collisionStrategy: z.enum(INVITATION_COLLISION_STRATEGIES).default('skip'),
});

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const body = await parseJsonRequestBody(req);
  const parseResult = DryRunValidateBatchSchema.safeParse(body);

  let records: BatchInvitationCodeRecord[];
  let collisionStrategy: DryRunValidateBatchDTO['collisionStrategy'];

  if (parseResult.success) {
    records = parseResult.data.records;
    collisionStrategy = parseResult.data.collisionStrategy;
  } else {
    const envelopeResult = DryRunEnvelopeFallbackSchema.safeParse(body);
    if (!envelopeResult.success) {
      throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
    }
    collisionStrategy = envelopeResult.data.collisionStrategy;
    records = envelopeResult.data.records.map((raw) => {
      const rawTags = raw.partyTags;
      const partyTags = Array.isArray(rawTags)
        ? rawTags.map((t) => String(t))
        : typeof rawTags === 'string'
          ? normalizePartyTags(rawTags)
          : [];
      const rawPlusOnes = raw.plusOneAllocations;
      const plusOneAllocations =
        typeof rawPlusOnes === 'number'
          ? rawPlusOnes
          : typeof rawPlusOnes === 'string' && rawPlusOnes.trim() !== ''
            ? Number(rawPlusOnes)
            : undefined;

      return {
        guestName: typeof raw.guestName === 'string' ? raw.guestName : '',
        code: typeof raw.code === 'string' ? raw.code : undefined,
        email: typeof raw.email === 'string' || raw.email === null ? raw.email : undefined,
        addressLine1: typeof raw.addressLine1 === 'string' || raw.addressLine1 === null ? raw.addressLine1 : undefined,
        addressLine2: typeof raw.addressLine2 === 'string' || raw.addressLine2 === null ? raw.addressLine2 : undefined,
        city: typeof raw.city === 'string' || raw.city === null ? raw.city : undefined,
        state: typeof raw.state === 'string' || raw.state === null ? raw.state : undefined,
        zipCode: typeof raw.zipCode === 'string' || raw.zipCode === null ? raw.zipCode : undefined,
        country: typeof raw.country === 'string' || raw.country === null ? raw.country : undefined,
        dietaryNotes: typeof raw.dietaryNotes === 'string' || raw.dietaryNotes === null ? raw.dietaryNotes : undefined,
        plusOneAllocations,
        plusOneFirstName:
          typeof raw.plusOneFirstName === 'string' || raw.plusOneFirstName === null
            ? raw.plusOneFirstName
            : undefined,
        plusOneLastName:
          typeof raw.plusOneLastName === 'string' || raw.plusOneLastName === null
            ? raw.plusOneLastName
            : undefined,
        householdName:
          typeof raw.householdName === 'string' || raw.householdName === null
            ? raw.householdName
            : undefined,
        partyGroup:
          typeof raw.partyGroup === 'string' || raw.partyGroup === null ? raw.partyGroup : undefined,
        partyTags,
        extraFields:
          raw.extraFields && typeof raw.extraFields === 'object' && !Array.isArray(raw.extraFields)
            ? (raw.extraFields as Record<string, unknown>)
            : undefined,
      };
    });
  }

  const service = new InvitationCodeAdminService();

  try {
    const result = await service.dryRunValidateBatch(records, collisionStrategy);
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    if (error.message && error.message.includes('Validation Error:')) {
      throw new ApiError(400, error.message.replace('Validation Error: ', ''));
    }
    throw error;
  }
});
