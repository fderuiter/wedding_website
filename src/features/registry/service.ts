import { RegistryRepository } from './repository';
import type { RegistryItem } from './types';

/**
 * Handles business logic for registry-related operations.
 * All methods interact with the database via the RegistryRepository.
 */
export class RegistryService {
  /**
   * Retrieves all registry items.
   * @returns A promise that resolves to an array of all registry items.
   */
  static async getAllItems() {
    return RegistryRepository.getAllItems();
  }

  /**
   * Retrieves a single registry item by its unique ID.
   * @param id - The UUID of the item to retrieve.
   * @returns A promise that resolves to the registry item object or null if not found.
   */
  static async getItemById(id: string) {
    return RegistryRepository.getItemById(id);
  }

  /**
   * Creates a new registry item.
   * @param data - The data for the new item.
   * @returns A promise that resolves to the newly created registry item.
   */
  static async createItem(data: Omit<RegistryItem, 'id' | 'contributors' | 'createdAt' | 'updatedAt' | 'amountContributed' | 'purchased'>) {
    return RegistryRepository.createItem(data);
  }

  /**
   * Updates an existing registry item.
   * @param id - The UUID of the item to update.
   * @param data - An object containing the fields to update.
   * @returns A promise that resolves to the updated registry item.
   */
  static async updateItem(id: string, data: Partial<RegistryItem>) {
    return RegistryRepository.updateItem(id, data);
  }

  /**
   * Deletes a registry item.
   * @param id - The UUID of the item to delete.
   * @returns A promise that resolves when the item has been deleted.
   */
  static async deleteItem(id: string) {
    return RegistryRepository.deleteItem(id);
  }

  /**
   * Adds a contribution to a registry item.
   * @param itemId - The UUID of the item to contribute to.
   * @param contribution - An object containing the contributor's name and the amount.
   * @returns A promise that resolves to the updated registry item.
   */
  static async contributeToItem(
    itemId: string,
    contribution: { name: string; amount: number }
  ) {
    if (contribution.amount <= 0) {
      throw new Error('Contribution must be a positive number.');
    }

    const item = await RegistryRepository.getItemById(itemId);

    if (!item) {
      throw new Error('Item not found');
    }

    const remainingAmount = item.price - item.amountContributed;
    if (contribution.amount > remainingAmount) {
      throw new Error('Contribution cannot be greater than the remaining amount.');
    }

    return RegistryRepository.contributeToItem(itemId, contribution);
  }
}
