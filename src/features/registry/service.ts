import { registryRepository } from './repository';
import type { IRegistryRepository, RegistryItem } from './types';

/**
 * Handles business logic for registry-related operations.
 * All methods interact with the database via the injected RegistryRepository.
 */
class RegistryService {
  private repository: IRegistryRepository;

  constructor(repository: IRegistryRepository) {
    this.repository = repository;
  }

  /**
   * Retrieves all registry items.
   * @param options - Optional query parameters, e.g. includeContributors.
   * @returns A promise that resolves to an array of all registry items.
   */
  async getAllItems(options?: { includeContributors?: boolean }) {
    return this.repository.getAllItems(options);
  }

  /**
   * Retrieves a single registry item by its unique ID.
   * @param id - The UUID of the item to retrieve.
   * @param options - Optional query parameters, e.g. includeContributors.
   * @returns A promise that resolves to the registry item object or null if not found.
   */
  async getItemById(id: string, options?: { includeContributors?: boolean }) {
    return this.repository.getItemById(id, options);
  }

  /**
   * Creates a new registry item.
   * @param data - The data for the new item.
   * @returns A promise that resolves to the newly created registry item.
   */
  async createItem(data: Omit<RegistryItem, 'id' | 'contributors' | 'createdAt' | 'updatedAt' | 'amountContributed' | 'purchased'> & { imageUrl?: string; imageAlt?: string | null; imageDecorative?: boolean }) {
    return this.repository.createItem(data);
  }

  /**
   * Updates an existing registry item.
   * @param id - The UUID of the item to update.
   * @param data - An object containing the fields to update.
   * @returns A promise that resolves to the updated registry item.
   */
  async updateItem(id: string, data: Partial<RegistryItem> & { imageUrl?: string; imageAlt?: string | null; imageDecorative?: boolean }) {
    return this.repository.updateItem(id, data);
  }

  /**
   * Deletes a registry item.
   * @param id - The UUID of the item to delete.
   * @returns A promise that resolves when the item has been deleted.
   */
  async deleteItem(id: string, author: string = 'Admin') {
    return this.repository.deleteItem(id, author);
  }

  /**
   * Adds a contribution to a registry item.
   * @param itemId - The UUID of the item to contribute to.
   * @param contribution - An object containing the contributor's name and the amount.
   * @returns A promise that resolves to the updated registry item.
   */
  async contributeToItem(
    itemId: string,
    contribution: { name: string; amount: number; code?: string }
  ) {
    if (!contribution || typeof contribution.amount !== 'number' || contribution.amount <= 0) {
      throw new Error('Contribution must be a positive number.');
    }

    return this.repository.contributeToItem(itemId, contribution);
  }
}

export const registryService = new RegistryService(registryRepository);

