import { prisma } from '@/lib/prisma';
import { createAuditSnapshot } from '@/lib/audit';
import type { IRegistryRepository } from '@/features/registry/types';
import { RegistryItemSchema, RegistryItemDTO } from './schemas';

/**
 * @class RegistryRepository
 * @description Provides data access methods for the `RegistryItem` model using Prisma.
 * This class abstracts the database interactions from the service layer.
 */
export class RegistryRepository implements IRegistryRepository {
  constructor(public client: any = prisma) {}

  withClient(client: any): this {
    return new (this.constructor as any)(client);
  }

  /**
   * Retrieves all registry items from the database, including their contributors.
   * @returns {Promise<RegistryItemDTO[]>} A promise that resolves to an array of all registry items.
   */
  async getAllItems() {
    const items = await this.client.registryItem.findMany({
      include: { image: true, 
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
    const item = await this.client.registryItem.findUnique({
      where: { id },
      include: { image: true, 
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
  async createItem(data: Omit<RegistryItemDTO, 'id' | 'contributors' | 'createdAt' | 'updatedAt' | 'amountContributed' | 'purchased'> & { imageUrl?: string; imageAlt?: string | null; imageDecorative?: boolean }) {
    let mediaId = data.imageId;
    if (!mediaId && (data.imageUrl || data.imageAlt || data.imageDecorative !== undefined)) {
      const media = await this.client.media.create({
        data: {
          url: data.imageUrl || '/images/placeholder.png',
          altText: data.imageAlt,
          isDecorative: data.imageDecorative || false,
        }
      });
      mediaId = media.id;
    } else if (!mediaId) {
      const media = await this.client.media.create({
        data: {
          url: '/images/placeholder.png',
          isDecorative: true
        }
      });
      mediaId = media.id;
    }

    const item = await this.client.registryItem.create({
      data: {
        name: data.name,
        price: data.price,
        quantity: data.quantity,
        category: data.category,
        description: data.description || '',
        imageId: mediaId,
        vendorUrl: data.vendorUrl || null,
        isGroupGift: data.isGroupGift,
        contributors: {
          create: []
        }
      },
      include: { image: true, 
        contributors: true
      }
    });
    await createAuditSnapshot('RegistryItem', item.id, item, 'Guest/User', this.client);
    return RegistryItemSchema.parse(item);
  }

  async updateItem(id: string, data: Partial<RegistryItemDTO> & { imageUrl?: string; imageAlt?: string | null; imageDecorative?: boolean }) {
    const { contributors, image, imageId, imageUrl, imageAlt, imageDecorative, ...updateData } = data;
    
    let updateMediaId = imageId;
    if (imageUrl || imageAlt !== undefined || imageDecorative !== undefined) {
      const existing = await this.client.registryItem.findUnique({ where: { id }, select: { imageId: true } });
      if (existing && existing.imageId) {
        await this.client.media.update({
          where: { id: existing.imageId },
          data: {
            ...(imageUrl !== undefined && { url: imageUrl }),
            ...(imageAlt !== undefined && { altText: imageAlt }),
            ...(imageDecorative !== undefined && { isDecorative: imageDecorative }),
          }
        });
        updateMediaId = existing.imageId;
      }
    }

    const item = await this.client.registryItem.update({
      where: { id },
      data: {
        ...updateData,
        ...(updateMediaId && { imageId: updateMediaId }),
      },
      include: { image: true, 
        contributors: true
      }
    });
    await createAuditSnapshot('RegistryItem', item.id, item, 'Guest/User', this.client);
    return RegistryItemSchema.parse(item);
  }

  /**
   * Deletes a registry item from the database.
   * @returns {Promise<RegistryItemDTO>} A promise that resolves to the deleted item.
   */
  async deleteItem(id: string) {
    const item = await this.client.registryItem.delete({
      where: { id }
    });
    await createAuditSnapshot('RegistryItem', item.id, { deleted: true, ...item }, 'Guest/User', this.client);
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
    const runTransaction = async (txClient: any) => {
      const item = await txClient.registryItem.findUnique({
        where: { id: itemId },
      });

      if (!item) {
        // This should ideally not be reached if service layer validation is correct
        throw new Error('Item not found');
      }

      const newTotal = item.amountContributed + contribution.amount;

      const updatedItem = await txClient.registryItem.update({
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
        include: { image: true, 
          contributors: true
        }
      });
      
      await createAuditSnapshot('RegistryItem', updatedItem.id, updatedItem, contribution.name || 'Guest/Contributor', txClient);

      return RegistryItemSchema.parse(updatedItem);
    };

    if ('$transaction' in this.client) {
      return this.client.$transaction(runTransaction);
    }
    return runTransaction(this.client);
  }
}

export const registryRepository = new RegistryRepository();
