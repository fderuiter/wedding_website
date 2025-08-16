import { prisma } from '@/lib/prisma';
import type { RegistryItem } from '@/types/registry';

/**
 * Handles business logic for registry-related operations.
 * All methods interact with the database via the Prisma client.
 */
export class RegistryService {
  /**
   * Retrieves all registry items from the database.
   * @returns A promise that resolves to an array of all registry items, including their contributors.
   */
  static async getAllItems() {
    return prisma.registryItem.findMany({
      include: {
        contributors: true
      }
    });
  }

  /**
   * Retrieves a single registry item by its unique ID.
   * @param id - The UUID of the item to retrieve.
   * @returns A promise that resolves to the registry item object or null if not found.
   */
  static async getItemById(id: string) {
    return prisma.registryItem.findUnique({
      where: { id },
      include: {
        contributors: true
      }
    });
  }

  /**
   * Creates a new registry item in the database.
   * @param data - The data for the new item, excluding the 'id' and 'contributors' fields.
   * @returns A promise that resolves to the newly created registry item.
   */
  static async createItem(data: Omit<RegistryItem, 'id' | 'contributors' | 'createdAt' | 'updatedAt' | 'amountContributed' | 'purchased'>) {
    return prisma.registryItem.create({
      data: {
        ...data,
        contributors: {
          create: []
        }
      },
      include: {
        contributors: true
      }
    });
  }

  /**
   * Updates an existing registry item.
   * @param id - The UUID of the item to update.
   * @param data - An object containing the fields to update.
   * @returns A promise that resolves to the updated registry item.
   */
  static async updateItem(id: string, data: Partial<RegistryItem>) {
    // Destructure contributors out, as it needs special handling and is not updated directly here.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { contributors, ...updateData } = data;
    return prisma.registryItem.update({
      where: { id },
      data: updateData,
      include: {
        contributors: true // Ensure contributors are included in the returned object.
      }
    });
  }

  /**
   * Deletes a registry item from the database.
   * @param id - The UUID of the item to delete.
   * @returns A promise that resolves when the item has been deleted.
   */
  static async deleteItem(id: string) {
    return prisma.registryItem.delete({
      where: { id }
    });
  }

  /**
   * Adds a contribution to a registry item within a database transaction.
   * This ensures that the item's total contribution amount and the new contributor record are updated atomically.
   * @param itemId - The UUID of the item to contribute to.
   * @param contribution - An object containing the contributor's name and the amount.
   * @returns A promise that resolves to the updated registry item.
   * @throws Will throw an error if the item is not found.
   */
  static async contributeToItem(
    itemId: string,
    contribution: { name: string; amount: number }
  ) {
    return prisma.$transaction(async (tx) => {
      // Retrieve the current state of the item.
      const item = await tx.registryItem.findUnique({
        where: { id: itemId },
        include: { contributors: true }
      });

      if (!item) {
        throw new Error('Item not found');
      }

      const newTotal = item.amountContributed + contribution.amount;
      
      // Update the item's total contribution and add the new contributor.
      const updatedItem = await tx.registryItem.update({
        where: { id: itemId },
        data: {
          amountContributed: newTotal,
          // Mark as purchased if the total contribution meets or exceeds the price.
          purchased: newTotal >= item.price,
          contributors: {
            create: {
              name: contribution.name,
              amount: contribution.amount,
              date: new Date()
            }
          }
        },
        include: {
          contributors: true
        }
      });

      return updatedItem;
    });
  }
}
