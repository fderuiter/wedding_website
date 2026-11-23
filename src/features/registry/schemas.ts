import { z } from 'zod';
import { INVITATION_MAX_CATALOG_LIMIT } from '@/utils/invitationPagination';
// eslint-disable-next-line no-restricted-imports
import { createMediaAssociationSchema } from '@/features/media/schemas';
import {
  createLaxUrlSchema,
  deriveAdminInputSchema,
} from '@/utils/validationPrimitives';
import { parseOptionalDate } from '@/lib/backupPersistence';
import {
  INVITATION_CODE_MAX_LENGTH,
  GUEST_NAME_MAX_LENGTH,
  ADDRESS_LINE_MAX_LENGTH,
  CITY_MAX_LENGTH,
  STATE_MAX_LENGTH,
  ZIP_CODE_MAX_LENGTH,
  COUNTRY_MAX_LENGTH,
  PLUS_ONE_NAME_MAX_LENGTH,
  HOUSEHOLD_NAME_MAX_LENGTH,
  PARTY_GROUP_MAX_LENGTH,
  INVITATION_COLLISION_STRATEGIES,
  normalizePartyTags,
  type BatchInvitationCodeRecord,
} from '@/utils/invitationValidation';
import {
  REGISTRY_DEFAULT_PAGE_LIMIT,
  REGISTRY_MAX_CATALOG_LIMIT,
} from '@/utils/registryPagination';

const trimmedEmailPipe = z
  .string()
  .trim()
  .pipe(z.email('Invalid email address.'));
const optionalNullableEmailField = trimmedEmailPipe
  .optional()
  .or(z.literal(''))
  .nullable();
const trimmedMaxString = (max: number, label: string) =>
  z.string().trim().max(max, `${label} must be under ${max} characters.`);
const optionalNullableTrimmedField = (max: number, label: string) =>
  trimmedMaxString(max, label).optional().or(z.literal('')).nullable();
const nullableOptionalTrimmedField = (max: number, label: string) =>
  trimmedMaxString(max, label).nullable().optional().or(z.literal(''));
const requiredGuestNameField = z
  .string({ message: 'Guest name is required.' })
  .trim()
  .min(
    1,
    `Guest name is required and must be under ${GUEST_NAME_MAX_LENGTH} characters.`,
  )
  .max(
    GUEST_NAME_MAX_LENGTH,
    `Guest name is required and must be under ${GUEST_NAME_MAX_LENGTH} characters.`,
  );
const optionalAddressFields = {
  addressLine1: optionalNullableTrimmedField(
    ADDRESS_LINE_MAX_LENGTH,
    'Address Line 1',
  ),
  addressLine2: optionalNullableTrimmedField(
    ADDRESS_LINE_MAX_LENGTH,
    'Address Line 2',
  ),
  city: optionalNullableTrimmedField(CITY_MAX_LENGTH, 'City'),
  state: optionalNullableTrimmedField(STATE_MAX_LENGTH, 'State'),
  zipCode: optionalNullableTrimmedField(ZIP_CODE_MAX_LENGTH, 'Zip Code'),
  country: optionalNullableTrimmedField(COUNTRY_MAX_LENGTH, 'Country'),
};

export const RegistryQuerySchema = z.object({
  page: z.coerce
    .number()
    .int({ message: 'Page must be an integer.' })
    .min(1, 'Page must be at least 1.')
    .default(1),
  limit: z.coerce
    .number()
    .int({ message: 'Limit must be an integer.' })
    .min(1, 'Limit must be at least 1.')
    .max(
      REGISTRY_MAX_CATALOG_LIMIT,
      `Limit cannot exceed ${REGISTRY_MAX_CATALOG_LIMIT}.`,
    )
    .default(REGISTRY_DEFAULT_PAGE_LIMIT),
  category: z.string().optional(),
  minPrice: z.coerce
    .number({ message: 'minPrice must be a number.' })
    .min(0, 'minPrice must be non-negative.')
    .optional(),
  maxPrice: z.coerce
    .number({ message: 'maxPrice must be a number.' })
    .min(0, 'maxPrice must be non-negative.')
    .optional(),
  sortBy: z.string().optional(),
  sort: z.string().optional(),
});

export type RegistryQueryParams = z.infer<typeof RegistryQuerySchema>;

export const ContributorStatusEnum = z.enum(['RESERVED', 'CONFIRMED', 'CANCELLED', 'REFUNDED']);
export type ContributorStatus = z.infer<typeof ContributorStatusEnum>;

export const ContributorSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  email: z.string().nullable().optional(),
  isPlusOne: z.boolean().optional().default(false),
  amount: z.coerce
    .number({ message: 'Contribution amount must be a positive number.' })
    .positive('Contribution amount must be a positive number.'),
  refundedAmount: z.coerce
    .number()
    .min(0, 'Refunded amount cannot be negative.')
    .optional()
    .default(0),
  status: ContributorStatusEnum.optional().default('CONFIRMED'),
  coverFee: z.boolean().optional().default(false),
  feeAmount: z.coerce.number().optional().default(0),
  message: z.string().nullable().optional(),
  date: z
    .union([z.string(), z.date()])
    .transform((d) => new Date(d).toISOString()),
  thankYouStatus: z.string().optional().default('Unsent'),
  thankYouSentAt: z
    .union([z.string(), z.date()])
    .nullable()
    .optional()
    .transform((d) => (d ? new Date(d).toISOString() : null)),
  thankYouNote: z.string().nullable().optional(),
  stripePaymentIntentId: z.string().nullable().optional(),
  stripeChargeId: z.string().nullable().optional(),
  retailerOrderNumber: z.string().nullable().optional(),
  carrier: z.string().nullable().optional(),
  trackingNumber: z.string().nullable().optional(),
  transactionTimestamp: z
    .union([z.string(), z.date()])
    .nullable()
    .optional()
    .transform((d) => (d ? new Date(d).toISOString() : null)),
  confirmationEmailSentAt: z
    .union([z.string(), z.date()])
    .transform((d) => new Date(d).toISOString())
    .nullable()
    .optional(),
  alertEmailSentAt: z
    .union([z.string(), z.date()])
    .transform((d) => new Date(d).toISOString())
    .nullable()
    .optional(),
  reminderEmailSentAt: z
    .union([z.string(), z.date()])
    .transform((d) => new Date(d).toISOString())
    .nullable()
    .optional(),
  registryItemId: z.string().nullable().optional(),
  registryItem: z
    .object({
      id: z.string(),
      name: z.string(),
      category: z.string().optional(),
    })
    .nullable()
    .optional(),
  invitationCodeId: z.string().nullable().optional(),
  invitationCode: z
    .object({
      id: z.string().optional(),
      code: z.string().optional(),
      guestName: z.string().optional(),
      addressLine1: z.string().nullable().optional(),
      addressLine2: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      state: z.string().nullable().optional(),
      zipCode: z.string().nullable().optional(),
      country: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const GuestClaimQuerySchema = z.object({
  token: z.string({ message: 'Missing or invalid claim token.' }).trim().min(1, 'Missing or invalid claim token.'),
});

export const GuestClaimActionSchema = z.object({
  token: z.string({ message: 'Missing or invalid claim token.' }).trim().min(1, 'Missing or invalid claim token.'),
});

export const AdminContributorActionSchema = z.object({
  action: z.enum(['confirm', 'remind', 'void']),
});

export const UpdateThankYouNoteSchema = z.object({
  thankYouStatus: z.enum(['Unsent', 'Sent', 'Not Needed']).optional(),
  thankYouSentAt: z.union([z.string(), z.date()]).nullable().optional(),
  thankYouNote: z
    .string()
    .max(2000, 'Thank-you note must be under 2000 characters.')
    .nullable()
    .optional(),
});

export const BatchUpdateThankYouNotesSchema = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, 'At least one contributor record is required.'),
  status: z.enum(['Unsent', 'Sent', 'Not Needed']),
  thankYouSentAt: z.union([z.string(), z.date()]).nullable().optional(),
  thankYouNote: z
    .string()
    .max(2000, 'Thank-you note must be under 2000 characters.')
    .nullable()
    .optional(),
});

export const ContributionSchema = z
  .object(
    {
      itemId: z
        .string({ message: 'Missing or invalid itemId.' })
        .min(1, 'Missing or invalid itemId.'),
      name: z.string().trim().optional(),
      purchaserName: z.string().trim().optional(),
      email: optionalNullableEmailField,
      amount: z.coerce
        .number({ message: 'Contribution amount must be a positive number.' })
        .positive('Contribution amount must be a positive number.'),
      code: z.string().trim().optional(),
      message: z
        .string()
        .max(1000, 'Personal note must be under 1000 characters.')
        .optional()
        .nullable(),
      coverFee: z.boolean().optional().default(false),
      paymentIntentId: z.string().trim().optional(),
      retailerOrderNumber: optionalNullableTrimmedField(
        120,
        'Retailer order number',
      ),
      carrier: optionalNullableTrimmedField(100, 'Carrier'),
      trackingNumber: optionalNullableTrimmedField(120, 'Tracking number'),
    },
    { message: 'Invalid request body.' },
  )
  .superRefine((data, ctx) => {
    const resolvedName = data.name || data.purchaserName;
    if (
      !resolvedName ||
      resolvedName.trim().length === 0 ||
      resolvedName.trim().length > 100
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Name is required and must be under 100 characters.',
        path: ['name'],
      });
    }
  })
  .meta({
    description:
      'Gift contribution payload requiring itemId, a positive amount, and a contributor name (name or purchaserName, 1-100 characters).',
    anyOf: [
      {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
      {
        type: 'object',
        required: ['purchaserName'],
        properties: {
          purchaserName: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
    ],
  })
  .transform((data) => {
    const resolvedName = (data.name || data.purchaserName || '').trim();
    const normalizeOptional = (value?: string | null) =>
      value && value.trim().length > 0 ? value.trim() : undefined;
    return {
      ...data,
      name: resolvedName,
      ...(data.retailerOrderNumber !== undefined
        ? { retailerOrderNumber: normalizeOptional(data.retailerOrderNumber) }
        : {}),
      ...(data.carrier !== undefined
        ? { carrier: normalizeOptional(data.carrier) }
        : {}),
      ...(data.trackingNumber !== undefined
        ? { trackingNumber: normalizeOptional(data.trackingNumber) }
        : {}),
    };
  });

export const PaymentIntentRequestSchema = z.object({
  itemId: z
    .string({ message: 'Missing or invalid itemId.' })
    .min(1, 'Missing or invalid itemId.'),
  amount: z.coerce
    .number({ message: 'Contribution amount must be a positive number.' })
    .positive('Contribution amount must be a positive number.'),
  coverFee: z.boolean().optional().default(false),
  paymentIntentId: z.string().trim().optional(),
  clientSecret: z.string().trim().optional(),
  name: z.string().trim().optional(),
  email: optionalNullableEmailField,
  message: z
    .string()
    .max(1000, 'Personal note must be under 1000 characters.')
    .optional()
    .nullable(),
  code: z.string().trim().optional(),
});

export type PaymentIntentRequestDTO = z.infer<
  typeof PaymentIntentRequestSchema
>;

export const ItemTypeEnum = z.enum([
  'PHYSICAL',
  'CASH_FUND',
  'EXPERIENCE_FUND',
]);
export type ItemType = z.infer<typeof ItemTypeEnum>;

export const RegistryItemBaseSchema = z
  .object(
    {
      itemType: ItemTypeEnum.optional().default('PHYSICAL'),
      name: z
        .string({
          message: 'Item name is required and must be under 255 characters.',
        })
        .trim()
        .min(1, 'Item name is required and must be under 255 characters.')
        .max(255, 'Item name is required and must be under 255 characters.'),
      price: z.coerce
        .number({ message: 'Price must be a positive number.' })
        .positive('Price must be a positive number.'),
      quantity: z.coerce
        .number({ message: 'Quantity must be a positive integer.' })
        .int('Quantity must be a positive integer.')
        .positive('Quantity must be a positive integer.')
        .optional()
        .default(1),
      category: z
        .string({
          message: 'Category is required and must be under 255 characters.',
        })
        .trim()
        .min(1, 'Category is required and must be under 255 characters.')
        .max(255, 'Category is required and must be under 255 characters.'),
      description: z
        .string()
        .max(2000, 'Description must be under 2000 characters.')
        .optional()
        .or(z.literal('')),
      vendorUrl: createLaxUrlSchema('Vendor URL'),
      isGroupGift: z
        .union([z.boolean(), z.literal('on'), z.literal('off'), z.string()])
        .optional()
        .transform((v) => v === true || v === 'on' || v === 'true'),
      isMostWanted: z
        .union([z.boolean(), z.literal('on'), z.literal('off'), z.string()])
        .optional()
        .transform((v) => v === true || v === 'on' || v === 'true')
        .default(false),
      displayOrder: z.coerce
        .number({ message: 'Display order must be an integer.' })
        .int('Display order must be an integer.')
        .optional()
        .default(0),
      paymentHandleType: z
        .string()
        .max(100, 'Payment handle type must be under 100 characters.')
        .optional()
        .nullable()
        .or(z.literal('')),
      paymentHandle: z
        .string()
        .max(255, 'Payment handle must be under 255 characters.')
        .optional()
        .nullable()
        .or(z.literal('')),
    },
    { message: 'Invalid request body.' },
  )
  .extend(createMediaAssociationSchema('image').shape);

export const RegistryItemSchema = RegistryItemBaseSchema.extend({
  id: z.string(),
  itemType: ItemTypeEnum.default('PHYSICAL'),
  paymentHandleType: z.string().nullable().optional(),
  paymentHandle: z.string().nullable().optional(),
  isMostWanted: z.boolean().default(false),
  displayOrder: z.number().int().default(0),
  purchased: z.boolean().default(false),
  purchaserName: z.string().nullable().optional(),
  amountContributed: z.coerce.number().default(0),
  isSample: z.boolean().default(false),
  contributors: z.array(ContributorSchema).default([]),
});

export type RegistryItemDTO = z.infer<typeof RegistryItemSchema>;

export const RegistryItemCreateInputSchema = deriveAdminInputSchema(
  RegistryItemBaseSchema,
  false,
);
export const RegistryItemInputSchema = deriveAdminInputSchema(
  RegistryItemSchema,
  true,
);

export function translateSnapshotToActive(snapshotData: any) {
  if (!snapshotData) return null;
  return {
    itemType: snapshotData.itemType ?? 'PHYSICAL',
    paymentHandleType: snapshotData.paymentHandleType ?? null,
    paymentHandle: snapshotData.paymentHandle ?? null,
    name:
      snapshotData.name ??
      snapshotData.legacy_name ??
      snapshotData.title ??
      snapshotData.itemName ??
      '',
    description:
      snapshotData.description ??
      snapshotData.legacy_description ??
      snapshotData.details ??
      '',
    category:
      snapshotData.category ??
      snapshotData.legacy_category ??
      snapshotData.group ??
      'Uncategorized',
    price:
      snapshotData.price ??
      snapshotData.legacy_price ??
      snapshotData.cost ??
      snapshotData.priceAmount ??
      0,
    imageId:
      snapshotData.imageId ??
      snapshotData.legacy_imageId ??
      snapshotData.mediaId ??
      '',
    vendorUrl: snapshotData.vendorUrl ?? snapshotData.legacy_vendorUrl ?? null,
    quantity:
      snapshotData.quantity ??
      snapshotData.legacy_quantity ??
      snapshotData.qty ??
      snapshotData.itemCount ??
      1,
    isGroupGift:
      snapshotData.isGroupGift ?? snapshotData.legacy_isGroupGift ?? false,
    isMostWanted:
      snapshotData.isMostWanted ?? snapshotData.legacy_isMostWanted ?? false,
    displayOrder:
      snapshotData.displayOrder ?? snapshotData.legacy_displayOrder ?? 0,
    purchased: snapshotData.purchased || false,
    purchaserName: snapshotData.purchaserName,
    amountContributed: snapshotData.amountContributed || 0,
  };
}

const CONTRIBUTOR_NULLABLE_STRING_COLUMNS = [
  'email',
  'message',
  'thankYouNote',
  'stripePaymentIntentId',
  'stripeChargeId',
  'retailerOrderNumber',
  'carrier',
  'trackingNumber',
] as const;

const CONTRIBUTOR_NULLABLE_DATE_COLUMNS = [
  'thankYouSentAt',
  'transactionTimestamp',
  'confirmationEmailSentAt',
  'alertEmailSentAt',
  'reminderEmailSentAt',
] as const;

/**
 * Translate a persisted `Contributor` snapshot into separate Prisma `update`
 * and `create` payloads across all 24 mutable columns while keeping omitted
 * (`undefined`) fields `undefined` on `update` to preserve live DB values.
 */
export function translateContributorSnapshot(
  snapshotData: Record<string, unknown> | null | undefined,
  options?: {
    entityId?: string;
    registryItemId?: string | null;
    invitationCodeId?: string | null;
  },
): { update: Record<string, unknown>; create: Record<string, unknown> } | null {
  if (
    !snapshotData ||
    typeof snapshotData !== 'object' ||
    Array.isArray(snapshotData)
  ) {
    return null;
  }

  const update: Record<string, unknown> = {};
  const create: Record<string, unknown> = {
    ...(options?.entityId !== undefined ? { id: options.entityId } : {}),
  };

  if (snapshotData.name !== undefined) {
    const resolvedName =
      snapshotData.name === null ? '' : String(snapshotData.name);
    update.name = resolvedName;
    create.name = resolvedName;
  } else {
    create.name = '';
  }

  if (snapshotData.isPlusOne !== undefined && snapshotData.isPlusOne !== null) {
    const resolvedPlusOne = Boolean(snapshotData.isPlusOne);
    update.isPlusOne = resolvedPlusOne;
    create.isPlusOne = resolvedPlusOne;
  } else {
    create.isPlusOne = false;
  }

  if (snapshotData.amount !== undefined && snapshotData.amount !== null) {
    const resolvedAmount = Number(snapshotData.amount);
    update.amount = resolvedAmount;
    create.amount = resolvedAmount;
  } else {
    create.amount = 0;
  }

  if (
    snapshotData.refundedAmount !== undefined &&
    snapshotData.refundedAmount !== null
  ) {
    const parsedRefund = Number(snapshotData.refundedAmount);
    const resolvedRefundedAmount =
      Number.isFinite(parsedRefund) && parsedRefund >= 0 ? parsedRefund : 0;
    update.refundedAmount = resolvedRefundedAmount;
    create.refundedAmount = resolvedRefundedAmount;
  } else {
    create.refundedAmount = 0;
  }

  if (snapshotData.status !== undefined && snapshotData.status !== null) {
    const parsedStatus = ContributorStatusEnum.safeParse(
      String(snapshotData.status),
    );
    const resolvedContributorStatus = parsedStatus.success
      ? parsedStatus.data
      : 'CONFIRMED';
    update.status = resolvedContributorStatus;
    create.status = resolvedContributorStatus;
  } else {
    create.status = 'CONFIRMED';
  }

  if (snapshotData.coverFee !== undefined && snapshotData.coverFee !== null) {
    const resolvedCoverFee = Boolean(snapshotData.coverFee);
    update.coverFee = resolvedCoverFee;
    create.coverFee = resolvedCoverFee;
  } else {
    create.coverFee = false;
  }

  if (snapshotData.feeAmount !== undefined && snapshotData.feeAmount !== null) {
    const resolvedFeeAmount = Number(snapshotData.feeAmount);
    update.feeAmount = resolvedFeeAmount;
    create.feeAmount = resolvedFeeAmount;
  } else {
    create.feeAmount = 0;
  }

  if (
    snapshotData.date !== undefined &&
    snapshotData.date !== null &&
    snapshotData.date !== ''
  ) {
    const resolvedDate =
      parseOptionalDate(snapshotData.date) ?? new Date();
    update.date = resolvedDate;
    create.date = resolvedDate;
  } else {
    create.date = new Date();
  }

  if (
    snapshotData.thankYouStatus !== undefined &&
    snapshotData.thankYouStatus !== null
  ) {
    const rawStatus = String(snapshotData.thankYouStatus);
    const resolvedStatus = rawStatus.length > 0 ? rawStatus : 'Unsent';
    update.thankYouStatus = resolvedStatus;
    create.thankYouStatus = resolvedStatus;
  } else {
    create.thankYouStatus = 'Unsent';
  }

  for (const key of CONTRIBUTOR_NULLABLE_STRING_COLUMNS) {
    const raw = snapshotData[key];
    if (raw !== undefined) {
      const resolved = raw === null ? null : String(raw);
      update[key] = resolved;
      create[key] = resolved;
    } else {
      create[key] = null;
    }
  }

  for (const key of CONTRIBUTOR_NULLABLE_DATE_COLUMNS) {
    const raw = snapshotData[key];
    if (raw !== undefined) {
      const resolved = parseOptionalDate(raw);
      update[key] = resolved;
      create[key] = resolved;
    } else {
      create[key] = null;
    }
  }

  const rawRegistryItemId =
    options && 'registryItemId' in options
      ? options.registryItemId
      : snapshotData.registryItemId;
  if (rawRegistryItemId !== undefined) {
    const resolvedRegistryItemId =
      rawRegistryItemId === null ? null : String(rawRegistryItemId);
    update.registryItemId = resolvedRegistryItemId;
    create.registryItemId = resolvedRegistryItemId;
  } else {
    create.registryItemId = null;
  }

  const rawInvitationCodeId =
    options && 'invitationCodeId' in options
      ? options.invitationCodeId
      : snapshotData.invitationCodeId;
  if (rawInvitationCodeId !== undefined) {
    const resolvedInvitationCodeId =
      rawInvitationCodeId === null ? null : String(rawInvitationCodeId);
    update.invitationCodeId = resolvedInvitationCodeId;
    create.invitationCodeId = resolvedInvitationCodeId;
  } else {
    create.invitationCodeId = null;
  }

  return { update, create };
}

export const InvitationCodeSchema = z.object({
  id: z.string(),
  code: z
    .string()
    .trim()
    .min(1, 'Code is required.')
    .max(
      INVITATION_CODE_MAX_LENGTH,
      `Code must be under ${INVITATION_CODE_MAX_LENGTH} characters.`,
    ),
  guestName: requiredGuestNameField,
  email: trimmedEmailPipe.nullable().optional().or(z.literal('')),
  addressLine1: nullableOptionalTrimmedField(
    ADDRESS_LINE_MAX_LENGTH,
    'Address Line 1',
  ),
  addressLine2: nullableOptionalTrimmedField(
    ADDRESS_LINE_MAX_LENGTH,
    'Address Line 2',
  ),
  city: nullableOptionalTrimmedField(CITY_MAX_LENGTH, 'City'),
  state: nullableOptionalTrimmedField(STATE_MAX_LENGTH, 'State'),
  zipCode: nullableOptionalTrimmedField(ZIP_CODE_MAX_LENGTH, 'Zip Code'),
  country: nullableOptionalTrimmedField(COUNTRY_MAX_LENGTH, 'Country'),
  dietaryNotes: z.string().trim().nullable().optional(),
  plusOneAllocations: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional()
    .default(0),
  plusOneFirstName: nullableOptionalTrimmedField(
    PLUS_ONE_NAME_MAX_LENGTH,
    'Plus-one first name',
  ),
  plusOneLastName: nullableOptionalTrimmedField(
    PLUS_ONE_NAME_MAX_LENGTH,
    'Plus-one last name',
  ),
  householdName: nullableOptionalTrimmedField(
    HOUSEHOLD_NAME_MAX_LENGTH,
    'Household name',
  ),
  partyGroup: nullableOptionalTrimmedField(
    PARTY_GROUP_MAX_LENGTH,
    'Party group',
  ),
  partyTags: z.array(z.string().trim()).optional().default([]),
  extraFields: z.record(z.string(), z.any()).nullable().optional(),
  used: z.boolean().default(false),
  usedAt: z.union([z.string(), z.date()]).nullable().optional(),
  tableId: z.string().nullable().optional(),
  seatNumber: z.number().int().positive().nullable().optional(),
  isSample: z.boolean().default(false),
  createdAt: z.union([z.string(), z.date()]).optional(),
  updatedAt: z.union([z.string(), z.date()]).optional(),
});

export type InvitationCodeDTO = z.infer<typeof InvitationCodeSchema> & {
  subEventRsvps?: InvitationSubEventRsvpSummaryDTO[];
};

export const InvitationCodeInputSchema = deriveAdminInputSchema(
  InvitationCodeSchema,
  false,
).extend({
  code: InvitationCodeSchema.shape.code.optional().or(z.literal('')),
});
export const InvitationCodeUpdateInputSchema = deriveAdminInputSchema(
  InvitationCodeSchema,
  true,
);

const BatchImportInvitationCodeItemSchema = z.object({
  guestName: z
    .string({ message: 'Guest name is required.' })
    .trim()
    .min(1, 'Guest name is required.')
    .max(
      GUEST_NAME_MAX_LENGTH,
      `Guest name must be under ${GUEST_NAME_MAX_LENGTH} characters.`,
    ),
  code: z.string().trim().optional().or(z.literal('')),
  email: z.union([trimmedEmailPipe, z.literal(''), z.null()]).optional(),
  ...optionalAddressFields,
  dietaryNotes: z.string().trim().optional().or(z.literal('')).nullable(),
  plusOneAllocations: z.coerce
    .number()
    .int('Plus-one allocation must be an integer.')
    .nonnegative('Plus-one allocation must be non-negative.')
    .optional(),
  plusOneFirstName: optionalNullableTrimmedField(
    PLUS_ONE_NAME_MAX_LENGTH,
    'Plus-one first name',
  ),
  plusOneLastName: optionalNullableTrimmedField(
    PLUS_ONE_NAME_MAX_LENGTH,
    'Plus-one last name',
  ),
  householdName: optionalNullableTrimmedField(
    HOUSEHOLD_NAME_MAX_LENGTH,
    'Household name',
  ),
  partyGroup: optionalNullableTrimmedField(
    PARTY_GROUP_MAX_LENGTH,
    'Party group',
  ),
  partyTags: z
    .union([
      z.array(z.string()),
      z.string().transform((val) => normalizePartyTags(val)),
    ])
    .optional()
    .default([]),
  extraFields: z.record(z.string(), z.any()).optional().nullable(),
});

export const BatchDeleteInvitationCodesSchema = z.object({
  ids: z
    .array(z.string().min(1, 'ID cannot be empty.'))
    .min(1, 'At least one invitation code ID is required.'),
});

export type BatchDeleteInvitationCodesDTO = z.infer<
  typeof BatchDeleteInvitationCodesSchema
>;

export const BatchUpdateInvitationTagsSchema = z
  .object({
    ids: z
      .array(z.string().trim().min(1, 'ID cannot be empty.'))
      .min(1, 'At least one invitation code ID is required.')
      .max(
        5000,
        'Maximum of 5000 invitation code IDs allowed per batch request.',
      )
      .transform((ids) => Array.from(new Set(ids))),
    tags: z
      .array(z.string())
      .transform((tags) => normalizePartyTags(tags, { dedupe: true })),
    action: z.enum(['add', 'remove', 'replace']).default('add'),
  })
  .superRefine((data, ctx) => {
    if (
      (data.action === 'add' || data.action === 'remove') &&
      data.tags.length === 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['tags'],
        message:
          'At least one non-empty tag is required when adding or removing tags.',
      });
    }
  })
  .meta({
    description:
      "Batch party-tag update payload. Requires at least one non-empty tag in tags when action is 'add' (default) or 'remove'; an empty tags array is only permitted when action is 'replace'.",
    anyOf: [
      {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['replace'] },
        },
      },
      {
        type: 'object',
        required: ['tags'],
        properties: {
          tags: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1 },
        },
      },
    ],
  });

export type BatchUpdateInvitationTagsDTO = z.infer<
  typeof BatchUpdateInvitationTagsSchema
>;

export const BatchImportInvitationCodesSchema = z.object({
  records: z
    .array(BatchImportInvitationCodeItemSchema)
    .min(1, 'At least one record is required for batch import.'),
  collisionStrategy: z.enum(INVITATION_COLLISION_STRATEGIES).default('skip'),
});

export type BatchImportInvitationCodesDTO = z.infer<
  typeof BatchImportInvitationCodesSchema
>;

export const DryRunValidateBatchSchema = z.object({
  records: z
    .array(BatchImportInvitationCodeItemSchema)
    .min(1, 'At least one record is required for batch import validation.'),
  collisionStrategy: z.enum(INVITATION_COLLISION_STRATEGIES).default('skip'),
});

export type DryRunValidateBatchDTO = z.infer<typeof DryRunValidateBatchSchema>;

export interface DryRunValidatedRow extends Omit<
  BatchInvitationCodeRecord,
  'code' | 'partyTags' | 'extraFields'
> {
  rowIndex: number;
  code: string;
  partyTags?: string[];
  extraFields?: Record<string, unknown> | null;
  isValid: boolean;
  errors: string[];
  fieldErrors?: Record<string, string[]>;
  warnings: string[];
  isDuplicate: boolean;
  existingGuestName?: string | null;
  actionOutcome: 'create' | 'update' | 'skip' | 'reject' | 'invalid';
}

export interface DryRunValidationSummary {
  total: number;
  validCount: number;
  invalidCount: number;
  duplicateCount: number;
  updatedCount: number;
  skippedCount: number;
  createdCount: number;
}

export interface DryRunValidationResponse {
  success: boolean;
  summary: DryRunValidationSummary;
  rows: DryRunValidatedRow[];
}

export const GuestAddressUpdateSchema = z.object({
  code: z.string().trim().optional(),
  ...optionalAddressFields,
});

export type GuestAddressUpdateDTO = z.infer<typeof GuestAddressUpdateSchema>;

const phonePattern = /^\+?[\d\s().\/-]{7,30}$/;
const disallowedPublicTextPattern = /[<>]|\p{Cc}/u;

const publicGuestNameField = z
  .string({ message: 'Guest name is required.' })
  .refine((val) => !disallowedPublicTextPattern.test(val), {
    message: 'Guest name cannot contain HTML brackets or control characters.',
  })
  .trim()
  .min(
    1,
    `Guest name is required and must be under ${GUEST_NAME_MAX_LENGTH} characters.`,
  )
  .max(
    GUEST_NAME_MAX_LENGTH,
    `Guest name is required and must be under ${GUEST_NAME_MAX_LENGTH} characters.`,
  );

const publicHouseholdNameField = z
  .string()
  .refine((val) => !disallowedPublicTextPattern.test(val), {
    message:
      'Household name cannot contain HTML brackets or control characters.',
  })
  .trim()
  .max(
    HOUSEHOLD_NAME_MAX_LENGTH,
    `Household name must be under ${HOUSEHOLD_NAME_MAX_LENGTH} characters.`,
  )
  .optional()
  .or(z.literal(''))
  .nullable();

export const PublicAddressCollectSchema = z.object({
  guestName: publicGuestNameField,
  email: optionalNullableEmailField,
  phone: z
    .string()
    .trim()
    .max(30, 'Phone number must be under 30 characters.')
    .refine(
      (val) => {
        if (!val) return true;
        if (!phonePattern.test(val)) return false;
        const digits = val.replace(/\D/g, '');
        return digits.length >= 7;
      },
      { message: 'Invalid phone number format.' },
    )
    .transform((val) => {
      if (!val) return val;
      return val.replace(/[^\d+]/g, '');
    })
    .optional()
    .nullable(),
  mobile: z.string().optional().nullable(),
  phoneNumber: z.string().optional().nullable(),
  ...optionalAddressFields,
  householdName: publicHouseholdNameField,
  notes: z
    .string()
    .trim()
    .max(1000, 'Notes must be under 1000 characters.')
    .optional()
    .or(z.literal(''))
    .nullable(),
  website: z.string().optional().nullable(),
  honeypot: z.string().optional().nullable(),
});

export type PublicAddressCollectDTO = z.infer<
  typeof PublicAddressCollectSchema
>;

export const BatchScrapeUrlsSchema = z.object({
  urls: z
    .array(z.string().trim().max(2000, 'URL must be under 2000 characters.'))
    .min(1, 'At least one URL is required.')
    .max(20, 'Maximum of 20 URLs allowed per batch.'),
});

export type BatchScrapeUrlsDTO = z.infer<typeof BatchScrapeUrlsSchema>;

export const BatchCreateRegistryItemsSchema = z.object({
  items: z
    .array(RegistryItemBaseSchema)
    .min(1, 'At least one item is required.')
    .max(100, 'Maximum of 100 items per batch.'),
});

export type BatchCreateRegistryItemsDTO = z.infer<
  typeof BatchCreateRegistryItemsSchema
>;

export const MergeInvitationCodesSchema = z
  .object({
    primaryId: z
      .string({ message: 'Primary guest ID is required.' })
      .trim()
      .min(1, 'Primary guest ID is required.')
      .describe('Target primary invitation record ID that survives the merge.'),
    secondaryIds: z
      .array(z.string().trim().min(1, 'Secondary guest ID cannot be empty.'))
      .min(1, 'At least one secondary guest ID is required.')
      .max(100, 'Maximum of 100 secondary guest records allowed per merge.')
      .describe(
        'Deduplicated list of 1-100 secondary invitation record IDs to merge into primaryId; must include at least one ID distinct from primaryId.'
      )
      .transform((ids) => Array.from(new Set(ids))),
  })
  .superRefine((data, ctx) => {
    const distinctSecondaries = data.secondaryIds.filter(
      (id) => id !== data.primaryId,
    );
    if (distinctSecondaries.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['secondaryIds'],
        message:
          'At least one distinct secondary guest ID is required to merge.',
      });
    }
  })
  .meta({
    description:
      'Merges duplicate guest invitation records into primaryId. Precondition: secondaryIds must contain at least one guest record ID distinct from primaryId (entries matching primaryId are filtered out before merging).',
  })
  .transform((data) => ({
    primaryId: data.primaryId,
    secondaryIds: data.secondaryIds.filter((id) => id !== data.primaryId),
  }));

export type MergeInvitationCodesDTO = z.infer<
  typeof MergeInvitationCodesSchema
>;

export interface MergeInvitationCodesResult {
  success: boolean;
  record: InvitationCodeDTO;
  mergedCount: number;
  transferredCounts: {
    contributors: number;
    subEventAccesses: number;
    subEventRsvps: number;
    broadcastRecipients: number;
    seatTransferred: boolean;
  };
}

export const InvitationCatalogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(
      INVITATION_MAX_CATALOG_LIMIT,
      `Limit cannot exceed ${INVITATION_MAX_CATALOG_LIMIT}.`,
    )
    .default(INVITATION_MAX_CATALOG_LIMIT),
  search: z.string().trim().max(200).optional(),
  orderBy: z
    .enum([
      'createdAt',
      'guestName',
      'code',
      'householdName',
      'partyGroup',
      'usedAt',
    ])
    .default('createdAt'),
  orderDir: z.enum(['asc', 'desc']).default('desc'),
});

export type InvitationCatalogQueryDTO = z.infer<
  typeof InvitationCatalogQuerySchema
>;

export interface InvitationSubEventRsvpSummaryDTO {
  id: string;
  subEventId: string;
  subEventTitle: string;
  status: 'attending' | 'declined' | 'pending';
  plusOneCount: number;
  plusOneNames: string[];
  mealSelections: string[];
  dietaryNotes: string | null;
  customAnswers: Record<string, string>;
  updatedAt?: string;
}
