import { prisma } from '@/lib/prisma';
import type { IRegistryRepository } from '@/features/registry/types';
import { RegistryItemSchema, RegistryItemDTO } from './schemas';

/**
 * @class RegistryRepository
 * @description Provides data access methods for the `RegistryItem` model using Prisma.
 * This class abstracts the database interactions from the service layer.
 */
export class RegistryRepository implements IRegistryRepository {
  /**
   * Retrieves all registry items from the database, including their contributors.
   * @returns {Promise<RegistryItemDTO[]>} A promise that resolves to an array of all registry items.
   */
  async getAllItems() {
    const items = await prisma.registryItem.findMany({
      include: {
        contributors: true
      }
    });
    return items.map((item: any) => RegistryItemSchema.parse(item));
  }

  /**
   * Retrieves a single registry item by its ID, including its contributors.
   * @param {string} id - The unique identifier of the item.
   * @returns {Promise<RegistryItemDTO | null>} A promise that resolves to the registry item or null if not found.
   */
  async getItemById(id: string) {
    const item = await prisma.registryItem.findUnique({
      where: { id },
      include: {
        contributors: true
      }
    });
    return item ? RegistryItemSchema.parse(item) : null;
  }

  /**
   * Creates a new registry item in the database.
   * @param {Omit<RegistryItemDTO, 'id' | 'contributors' | 'createdAt' | 'updatedAt' | 'amountContributed' | 'purchased'>} data - The data for the new item.
   * @returns {Promise<RegistryItemDTO>} A promise that resolves to the newly created registry item.
   */
  async createItem(data: Omit<RegistryItemDTO, 'id' | 'contributors' | 'createdAt' | 'updatedAt' | 'amountContributed' | 'purchased'>) {
    const item = await prisma.registryItem.create({
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
    return RegistryItemSchema.parse(item);
  }

  /**
   * Updates an existing registry item in the database.
   * @param {string} id - The unique identifier of the item to update.
   * @param {Partial<RegistryItemDTO>} data - The data to update.
   * @returns {Promise<RegistryItemDTO>} A promise that resolves to the updated registry item.
   */
  async updateItem(id: string, data: Partial<RegistryItemDTO>) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { contributors, ...updateData } = data;
    const item = await prisma.registryItem.update({
      where: { id },
      data: updateData,
      include: {
        contributors: true
      }
    });
    return RegistryItemSchema.parse(item);
  }

  /**
   * Deletes a registry item from the database.
   * @param {string} id - The unique identifier of the item to delete.
   * @returns {Promise<RegistryItemDTO>} A promise that resolves to the deleted item.
   */
  async deleteItem(id: string) {
    const item = await prisma.registryItem.delete({
      where: { id }
    });
    return RegistryItemSchema.parse(item);
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
   * @returns {Promise<RegistryItemDTO>} A promise that resolves to the updated registry item.
   * @throws {Error} If the item is not found.
   */
  async contributeToItem(
    itemId: string,
    contribution: { name: string; amount: number }
  ) {
    return prisma.$transaction(async (tx: any) => {
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

      return RegistryItemSchema.parse(updatedItem);
    });
  }
}

export const registryRepository = new RegistryRepository();
