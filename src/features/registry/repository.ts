import { prisma } from '@/lib/prisma';
import type { RegistryItem } from '@/features/registry/types';

/**
 * @class RegistryRepository
 * @description Provides data access methods for the `RegistryItem` model using Prisma.
 * This class abstracts the database interactions from the service layer.
 */
export class RegistryRepository {
  /**
   * Retrieves all registry items from the database, including their contributors.
   * @returns {Promise<RegistryItem[]>} A promise that resolves to an array of all registry items.
   */
  static async getAllItems() {
    return prisma.registryItem.findMany({
      include: {
        contributors: true
      }
    });
  }

  /**
   * Retrieves a single registry item by its ID, including its contributors.
   * @param {string} id - The unique identifier of the item.
   * @returns {Promise<RegistryItem | null>} A promise that resolves to the registry item or null if not found.
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
   * @param {Omit<RegistryItem, 'id' | 'contributors' | 'createdAt' | 'updatedAt' | 'amountContributed' | 'purchased'>} data - The data for the new item.
   * @returns {Promise<RegistryItem>} A promise that resolves to the newly created registry item.
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
   * Updates an existing registry item in the database.
   * @param {string} id - The unique identifier of the item to update.
   * @param {Partial<RegistryItem>} data - The data to update.
   * @returns {Promise<RegistryItem>} A promise that resolves to the updated registry item.
   */
  static async updateItem(id: string, data: Partial<RegistryItem>) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { contributors, ...updateData } = data;
    return prisma.registryItem.update({
      where: { id },
      data: updateData,
      include: {
        contributors: true
      }
    });
  }

  /**
   * Deletes a registry item from the database.
   * @param {string} id - The unique identifier of the item to delete.
   * @returns {Promise<RegistryItem>} A promise that resolves to the deleted item.
   */
  static async deleteItem(id: string) {
    return prisma.registryItem.delete({
      where: { id }
    });
  }

  /**
   * Records a contribution for a registry item.
   * This method updates the item's total contributed amount, checks if it's fully funded,
   * and creates a new contributor record, all within a transaction.
   *
   * @param {string} itemId - The unique identifier of the item.
   * @param {object} contribution - The contribution details.
   * @param {string} contribution.name - The name of the contributor.
   * @param {number} contribution.amount - The amount contributed.
   * @returns {Promise<RegistryItem>} A promise that resolves to the updated registry item.
   * @throws {Error} If the item is not found.
   */
  static async contributeToItem(
    itemId: string,
    contribution: { name: string; amount: number }
  ) {
    return prisma.$transaction(async (tx) => {
      const item = await tx.registryItem.findUnique({
        where: { id: itemId },
      });

      if (!item) {
        // This should ideally not be reached if service layer validation is correct
        throw new Error('Item not found');
      }

      const newTotal = item.amountContributed + contribution.amount;

      const updatedItem = await tx.registryItem.update({
        where: { id: itemId },
        data: {
          amountContributed: newTotal,
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
