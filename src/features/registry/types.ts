import { RegistryItemDTO } from './schemas';

export type RegistryItem = RegistryItemDTO;

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
  contributeToItem(itemId: string, contribution: { name: string; amount: number; code?: string; message?: string | null; coverFee?: boolean }): Promise<RegistryItemDTO>;
}
