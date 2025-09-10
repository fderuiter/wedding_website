import { prisma } from '@/lib/prisma';
import type { RegistryItem } from '@/features/registry/types';

export class RegistryRepository {
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

      const remainingAmount = item.price - item.amountContributed;
      if (contribution.amount > remainingAmount) {
        throw new Error('Contribution cannot be greater than the remaining amount.');
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
