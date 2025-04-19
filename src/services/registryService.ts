import { prisma } from '@/lib/prisma';
import type { RegistryItem } from '@/types/registry';

export class RegistryService {
  static async getAllItems() {
    return prisma.registryItem.findMany({
      include: {
        contributors: true
      }
    });
  }

  static async getItemById(id: string) {
    return prisma.registryItem.findUnique({
      where: { id },
      include: {
        contributors: true
      }
    });
  }

  static async createItem(data: Omit<RegistryItem, 'id' | 'contributors'>) {
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

  static async updateItem(id: string, data: Partial<RegistryItem>) {
    // Destructure contributors out, as it needs special handling or shouldn't be updated here.
    // Mark contributors as unused if not needed further in this function.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { contributors, ...updateData } = data;
    return prisma.registryItem.update({
      where: { id },
      // Pass the rest of the data for update.
      data: updateData,
      include: {
        contributors: true // Still include contributors in the response.
      }
    });
  }

  static async deleteItem(id: string) {
    return prisma.registryItem.delete({
      where: { id }
    });
  }

  static async contributeToItem(
    itemId: string,
    contribution: { name: string; amount: number }
  ) {
    return prisma.$transaction(async (tx) => {
      const item = await tx.registryItem.findUnique({
        where: { id: itemId },
        include: { contributors: true }
      });

      if (!item) {
        throw new Error('Item not found');
      }

      const newTotal = item.amountContributed + contribution.amount;
      
      // Update the item with new contribution
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
