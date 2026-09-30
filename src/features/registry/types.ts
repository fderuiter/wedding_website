import { RegistryItemDTO } from './schemas';

export type RegistryItem = RegistryItemDTO;

export interface IRegistryRepository {
  getAllItems(options?: { includeContributors?: boolean }): Promise<RegistryItemDTO[]>;
  getItemById(id: string, options?: { includeContributors?: boolean }): Promise<RegistryItemDTO | null>;
  createItem(data: Omit<RegistryItemDTO, 'id' | 'contributors' | 'createdAt' | 'updatedAt' | 'amountContributed' | 'purchased'> & { imageUrl?: string; imageAlt?: string | null; imageDecorative?: boolean }): Promise<RegistryItemDTO>;
  updateItem(id: string, data: Partial<RegistryItemDTO> & { imageUrl?: string; imageAlt?: string | null; imageDecorative?: boolean }): Promise<RegistryItemDTO>;
  deleteItem(id: string, author?: string): Promise<RegistryItemDTO>;
  contributeToItem(itemId: string, contribution: { name: string; amount: number; code?: string }): Promise<RegistryItemDTO>;
}
