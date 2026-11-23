import { z } from 'zod';
import {
  ContributorSchema,
  type RegistryItem,
  type CreateRegistryItemInput,
  type InvitationCodeDTO,
} from '@/features/registry';

export type ContributorFixture = z.infer<typeof ContributorSchema>;

/**
 * Factory for creating typed Contributor DTO fixtures matching ContributorSchema.
 */
export function createMockContributor(
  overrides?: Partial<ContributorFixture>
): ContributorFixture {
  return {
    name: 'Guest Contributor',
    isPlusOne: false,
    amount: 100,
    refundedAmount: 0,
    status: 'CONFIRMED',
    coverFee: false,
    feeAmount: 0,
    date: '2026-01-01T00:00:00.000Z',
    thankYouStatus: 'Unsent',
    thankYouSentAt: null,
    transactionTimestamp: null,
    ...overrides,
  };
}

/**
 * Factory for creating typed RegistryItem DTO fixtures matching RegistryItemSchema.
 */
export function createMockRegistryItem(
  overrides?: Partial<RegistryItem>
): RegistryItem {
  return {
    id: 'item-1',
    itemType: 'PHYSICAL',
    name: 'Test Item',
    description: 'Test description',
    category: 'Home',
    price: 100,
    quantity: 1,
    vendorUrl: null,
    isGroupGift: false,
    isMostWanted: false,
    displayOrder: 0,
    purchased: false,
    amountContributed: 0,
    isSample: false,
    contributors: [],
    ...overrides,
  };
}

/**
 * Factory for creating typed CreateRegistryItemInput fixtures for repository/service tests.
 */
export function createMockCreateRegistryItemInput(
  overrides?: Partial<CreateRegistryItemInput>
): CreateRegistryItemInput {
  return {
    itemType: 'PHYSICAL',
    name: 'Test Item',
    price: 100,
    quantity: 1,
    category: 'Kitchen',
    vendorUrl: null,
    isGroupGift: false,
    isMostWanted: false,
    displayOrder: 0,
    ...overrides,
  };
}

/**
 * Factory for creating typed InvitationCodeDTO fixtures matching InvitationCodeSchema.
 */
export function createMockInvitationCode(
  overrides?: Partial<InvitationCodeDTO>
): InvitationCodeDTO {
  return {
    id: 'inv-1',
    code: 'CODE1',
    guestName: 'Test Guest',
    plusOneAllocations: 0,
    partyTags: [],
    plusOneSeatNumbers: [],
    used: false,
    isSample: false,
    ...overrides,
  };
}
