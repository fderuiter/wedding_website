import { RegistryItemDTO, ContributorDTO } from './schemas';

export type Contributor = ContributorDTO;
export type RegistryItem = RegistryItemDTO;

export interface IRegistryRepository {
  getAllItems(): Promise<RegistryItemDTO[]>;
  getItemById(id: string): Promise<RegistryItemDTO | null>;
  createItem(data: Omit<RegistryItemDTO, 'id' | 'contributors' | 'createdAt' | 'updatedAt' | 'amountContributed' | 'purchased'> & { imageUrl?: string; imageAlt?: string | null; imageDecorative?: boolean }): Promise<RegistryItemDTO>;
  updateItem(id: string, data: Partial<RegistryItemDTO> & { imageUrl?: string; imageAlt?: string | null; imageDecorative?: boolean }): Promise<RegistryItemDTO>;
  deleteItem(id: string, author?: string): Promise<RegistryItemDTO>;
  contributeToItem(itemId: string, contribution: { name: string; amount: number }): Promise<RegistryItemDTO>;
}
