import { z } from 'zod';
import {
  AdminUpdateContributorInput,
  ContributorSchema,
  ContributorStatus,
  RegistryItemDTO,
} from './schemas';
import { formatCurrency } from '@/utils/intl';

export type RegistryItem = RegistryItemDTO;
export type ContributorRecord = z.infer<typeof ContributorSchema>;

export interface GuestClaimActions {
  confirmToken: string;
  cancelToken: string;
  status?: ContributorStatus;
}

export interface ContributorLifecycleResult {
  contributor: ContributorRecord;
  item: RegistryItemDTO | null;
  previousStatus: ContributorStatus;
  changed: boolean;
}

export interface ContributorDeleteResult {
  deletedId: string;
  item: RegistryItemDTO | null;
}

export interface StripeLedgerReconciliationResult {
  matched: boolean;
  changed: boolean;
  contributor: ContributorRecord | null;
  item: RegistryItemDTO | null;
  previousStatus: ContributorStatus | null;
  previousRefundedAmount: number;
  refundedAmount: number;
}

export interface ThankYouTemplateTokens {
  guestName?: string | null;
  giftName?: string | null;
  amount?: number | string | null;
}

export interface ThankYouTemplate {
  id: string;
  name: string;
  template: string;
}

export const THANK_YOU_TEMPLATES: ThankYouTemplate[] = [
  {
    id: 'physical-gift',
    name: 'Physical Gift',
    template:
      'Dear {{guestName}}, thank you so much for the wonderful {{giftName}}! We are so grateful for your thoughtfulness and love.',
  },
  {
    id: 'monetary-contribution',
    name: 'Monetary Contribution',
    template:
      'Dear {{guestName}}, thank you so much for your generous gift of {{amount}} towards our {{giftName}}! Your support means the world to us.',
  },
  {
    id: 'general-appreciation',
    name: 'General Appreciation',
    template:
      'Dear {{guestName}}, thank you so much for celebrating with us and for your generous {{giftName}}! We are so blessed to have you in our lives.',
  },
];

export function substituteThankYouTemplateTokens(
  template: string,
  tokens: ThankYouTemplateTokens
): string {
  const guestName = tokens.guestName?.trim() || 'Friend';
  const giftName = tokens.giftName?.trim() || 'wedding gift';
  const formattedAmount =
    typeof tokens.amount === 'number'
      ? formatCurrency(tokens.amount)
      : tokens.amount?.trim() || '$0.00';

  return template
    .replace(/\{\{\s*guestName\s*\}\}/g, guestName)
    .replace(/\{\{\s*giftName\s*\}\}/g, giftName)
    .replace(/\{\{\s*amount\s*\}\}/g, formattedAmount);
}

export interface GetItemsOptions {
  page?: number;
  limit?: number;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  includeContributors?: boolean;
  sortBy?: string;
}

export interface PaginatedRegistryItems {
  items: RegistryItemDTO[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export type CreateRegistryItemInput = Omit<
  RegistryItemDTO,
  'id' | 'contributors' | 'createdAt' | 'updatedAt' | 'amountContributed' | 'purchased' | 'isSample'
> & {
  isSample?: boolean;
  imageUrl?: string;
  imageAlt?: string | null;
  imageDecorative?: boolean;
};

export interface RegistryShippingAddress {
  recipientName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
  deliveryNotes: string;
}

export interface OrderTrackingDetails {
  retailerOrderNumber?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
}

export interface ContributorAddressDetails {
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
}

export interface IRegistryRepository {
  getAllItems(options?: GetItemsOptions): Promise<PaginatedRegistryItems>;
  getItemById(id: string, options?: { includeContributors?: boolean }): Promise<RegistryItemDTO | null>;
  createItem(data: CreateRegistryItemInput): Promise<RegistryItemDTO>;
  createBatchItems(items: CreateRegistryItemInput[]): Promise<RegistryItemDTO[]>;
  updateItem(id: string, data: Partial<RegistryItemDTO> & { imageUrl?: string; imageAlt?: string | null; imageDecorative?: boolean }): Promise<RegistryItemDTO>;
  deleteItem(id: string, author?: string): Promise<RegistryItemDTO>;
  contributeToItem(itemId: string, contribution: {
    name: string;
    email?: string | null;
    amount: number;
    code?: string;
    message?: string | null;
    coverFee?: boolean;
    stripePaymentIntentId?: string | null;
    stripeChargeId?: string | null;
    transactionTimestamp?: Date | string | null;
    retailerOrderNumber?: string | null;
    carrier?: string | null;
    trackingNumber?: string | null;
    addressLine1?: string | null;
    addressLine2?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
    country?: string | null;
  }): Promise<RegistryItemDTO>;
  claimContributorEmailSend?(
    contributorId: string,
    kind: 'confirmation' | 'alert'
  ): Promise<boolean>;
  releaseContributorEmailSend?(
    contributorId: string,
    kind: 'confirmation' | 'alert'
  ): Promise<void>;
  confirmContribution?(
    contributorId: string,
    author?: string
  ): Promise<ContributorLifecycleResult>;
  cancelReservedContribution?(
    contributorId: string,
    author?: string
  ): Promise<ContributorLifecycleResult>;
  voidContribution?(
    contributorId: string,
    author?: string
  ): Promise<ContributorLifecycleResult>;
  getContributorWithItem?(
    contributorId: string
  ): Promise<{ contributor: ContributorRecord; item: RegistryItemDTO | null } | null>;
  markContributorReminderSent?(
    contributorId: string
  ): Promise<ContributorRecord>;
  reconcileStripeAdjustment?(params: {
    stripeChargeId?: string | null;
    stripePaymentIntentId?: string | null;
    refundedCents: number;
    forceFullReversal?: boolean;
  }): Promise<StripeLedgerReconciliationResult>;
  unclaimItem?(
    itemId: string,
    options?: { confirmVerifiedPayment?: boolean },
    author?: string
  ): Promise<RegistryItemDTO>;
  updateContributor?(
    contributorId: string,
    data: Partial<AdminUpdateContributorInput>,
    author?: string
  ): Promise<{ contributor: ContributorRecord; item: RegistryItemDTO | null }>;
  deleteContributor?(
    contributorId: string,
    options?: { confirmVerifiedPayment?: boolean },
    author?: string
  ): Promise<ContributorDeleteResult>;
}

export interface ReconciledContributionReceipt {
  itemId: string;
  paymentIntentId: string;
  contributorName: string;
  contributorEmail: string | null;
  baseAmount: number;
  feeAmount: number;
  coverFee: boolean;
  totalChargeAmount: number;
  message: string | null;
  contributedAt?: string | null;
}

export interface ReconcilePaymentIntentResponse {
  reconciled: boolean;
  status: string;
  itemId: string;
  item?: RegistryItem;
  receipt?: ReconciledContributionReceipt;
  error?: string;
}

