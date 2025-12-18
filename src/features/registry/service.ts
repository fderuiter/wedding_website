import { registryRepository } from './repository';
import type { IRegistryRepository, RegistryItem } from './types';

/**
 * Handles business logic for registry-related operations.
 * All methods interact with the database via the injected RegistryRepository.
 */
export class RegistryService {
  private repository: IRegistryRepository;

  constructor(repository: IRegistryRepository) {
    this.repository = repository;
  }

  /**
   * Retrieves all registry items.
   * @returns A promise that resolves to an array of all registry items.
   */
  async getAllItems() {
    return this.repository.getAllItems();
  }

  /**
   * Retrieves a single registry item by its unique ID.
   * @param id - The UUID of the item to retrieve.
   * @returns A promise that resolves to the registry item object or null if not found.
   */
  async getItemById(id: string) {
    return this.repository.getItemById(id);
  }

  /**
   * Creates a new registry item.
   * @param data - The data for the new item.
   * @returns A promise that resolves to the newly created registry item.
   */
  async createItem(data: Omit<RegistryItem, 'id' | 'contributors' | 'createdAt' | 'updatedAt' | 'amountContributed' | 'purchased'>) {
    return this.repository.createItem(data);
  }

  /**
   * Updates an existing registry item.
   * @param id - The UUID of the item to update.
   * @param data - An object containing the fields to update.
   * @returns A promise that resolves to the updated registry item.
   */
  async updateItem(id: string, data: Partial<RegistryItem>) {
    return this.repository.updateItem(id, data);
  }

  /**
   * Deletes a registry item.
   * @param id - The UUID of the item to delete.
   * @returns A promise that resolves when the item has been deleted.
   */
  async deleteItem(id: string) {
    return this.repository.deleteItem(id);
  }

  /**
   * Adds a contribution to a registry item.
   * @param itemId - The UUID of the item to contribute to.
   * @param contribution - An object containing the contributor's name and the amount.
   * @returns A promise that resolves to the updated registry item.
   */
  async contributeToItem(
    itemId: string,
    contribution: { name: string; amount: number }
  ) {
    if (contribution.amount <= 0) {
      throw new Error('Contribution must be a positive number.');
    }

    const item = await this.repository.getItemById(itemId);

    if (!item) {
      throw new Error('Item not found');
    }

    if(item.purchased) {
      throw new Error('This item has already been purchased.');
    }

    const remainingAmount = item.price - item.amountContributed;
    if (contribution.amount > remainingAmount) {
      throw new Error('Contribution cannot be greater than the remaining amount.');
    }

    return this.repository.contributeToItem(itemId, contribution);
  }
}

// Export a default instance for backward compatibility/ease of use,
// injecting the concrete repository.
const registryServiceInstance = new RegistryService(registryRepository);

// Export static-like accessors to minimize refactoring impact on consumers for now,
// or better, just export the instance and update consumers.
// Let's export the instance as `RegistryService` to match the previous named export style
// but wait, `RegistryService` was a class.
// If I export `const RegistryService = new ...`, it conflicts with the class name.
// So I will export the class as `RegistryServiceClass` (or keep it as `RegistryService`)
// and export the instance as `registryService`.
// BUT, to satisfy the requirement of "fixing the violation", existing consumers
// were doing `RegistryService.getAllItems()`.
// I should update consumers to use `registryService.getAllItems()`.

export const registryService = registryServiceInstance;
