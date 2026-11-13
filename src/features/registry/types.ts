import { RegistryItemDTO } from './schemas';
import { formatCurrency } from '@/utils/intl';

export type RegistryItem = RegistryItemDTO;

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

export const DEFAULT_THANK_YOU_TEMPLATES = THANK_YOU_TEMPLATES;

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

export interface IRegistryRepository {
  getAllItems(options?: GetItemsOptions): Promise<PaginatedRegistryItems>;
  getItemById(id: string, options?: { includeContributors?: boolean }): Promise<RegistryItemDTO | null>;
  createItem(data: Omit<RegistryItemDTO, 'id' | 'contributors' | 'createdAt' | 'updatedAt' | 'amountContributed' | 'purchased' | 'isSample'> & { isSample?: boolean; imageUrl?: string; imageAlt?: string | null; imageDecorative?: boolean }): Promise<RegistryItemDTO>;
  updateItem(id: string, data: Partial<RegistryItemDTO> & { imageUrl?: string; imageAlt?: string | null; imageDecorative?: boolean }): Promise<RegistryItemDTO>;
  deleteItem(id: string, author?: string): Promise<RegistryItemDTO>;
  contributeToItem(itemId: string, contribution: { name: string; email?: string | null; amount: number; code?: string; message?: string | null; coverFee?: boolean }): Promise<RegistryItemDTO>;
}
