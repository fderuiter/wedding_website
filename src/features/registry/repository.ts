import type { IRegistryRepository } from './types';
import { RegistryItemSchema, RegistryItemDTO } from './schemas';
import { createAuditSnapshot } from '@/lib/audit';
import { executeInTransaction } from '@/lib/transaction';

/**
 * @class RegistryRepository
 * @description Provides data access methods for the `RegistryItem` model using Prisma.
 * This class abstracts the database interactions from the service layer.
 */
export class RegistryRepository implements IRegistryRepository {
  constructor(public client?: any) {}

  private async getClient() {
    return this.client || (await import('@/lib/prisma')).prisma;
  }

  /**
   * Retrieves all registry items from the database, including their contributors.
   * @returns {Promise<RegistryItemDTO[]>} A promise that resolves to an array of all registry items.
   */
  async getAllItems() {
    const client = await this.getClient();
    const items = await client.registryItem.findMany({
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
    const client = await this.getClient();
    const item = await client.registryItem.findUnique({
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
    const client = await this.getClient();
    let mediaId = data.imageId;
    if (!mediaId && (data.imageUrl || data.imageAlt || data.imageDecorative !== undefined)) {
      const media = await client.media.create({
        data: {
          url: data.imageUrl || '/images/placeholder.png',
          altText: data.imageAlt,
          isDecorative: data.imageDecorative || false,
        }
      });
      mediaId = media.id;
    } else if (!mediaId) {
      const media = await client.media.create({
        data: {
          url: '/images/placeholder.png',
          isDecorative: true
        }
      });
      mediaId = media.id;
    }

    const item = await client.registryItem.create({
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
    await createAuditSnapshot('RegistryItem', item.id, item, 'Guest/User', client);
    return RegistryItemSchema.parse(item);
  }

  async updateItem(id: string, data: Partial<RegistryItemDTO> & { imageUrl?: string; imageAlt?: string | null; imageDecorative?: boolean }) {
    const client = await this.getClient();
    const { contributors, image, imageId, imageUrl, imageAlt, imageDecorative, ...updateData } = data;
    
    let updateMediaId = imageId;
    if (imageUrl || imageAlt !== undefined || imageDecorative !== undefined) {
      const existing = await client.registryItem.findUnique({ where: { id }, select: { imageId: true } });
      if (existing && existing.imageId) {
        await client.media.update({
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

    const item = await client.registryItem.update({
      where: { id },
      data: {
        ...updateData,
        ...(updateMediaId && { imageId: updateMediaId }),
      },
      include: { image: true, 
        contributors: true
      }
    });
    await createAuditSnapshot('RegistryItem', item.id, item, 'Guest/User', client);
    return RegistryItemSchema.parse(item);
  }

  /**
   * Deletes a registry item from the database.
   * @returns {Promise<RegistryItemDTO>} A promise that resolves to the deleted item.
   */
  async deleteItem(id: string, author: string = 'Admin') {
    const client = await this.getClient();
    const item = await client.registryItem.delete({
      where: { id }
    });
    await createAuditSnapshot('RegistryItem', item.id, { deleted: true, ...item }, author, client);
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
    contribution: { name: string; amount: number; code?: string }
  ) {
    const client = await this.getClient();
    const runTransaction = async (txClient: any) => {
      // 1. Acquire PostgreSQL row-level lock on the targeted registry item row
      if (typeof txClient.$queryRaw === 'function') {
        const isSqlite = process.env.DATABASE_URL?.startsWith('file:') || process.env.DATABASE_URL?.startsWith('sqlite:') || process.env.DATABASE_URL?.includes('.db');
        if (!isSqlite) {
          await txClient.$queryRaw`SELECT id FROM "RegistryItem" WHERE id = ${itemId} FOR UPDATE`;
        }
      }

      // 2. Fetch the absolute latest state of the item inside the transaction context
      const item = await txClient.registryItem.findUnique({
        where: { id: itemId },
      });

      if (!item) {
        throw new Error('Item not found');
      }

      // 3. Perform validations inside the locked transactional context
      if (item.purchased) {
        throw new Error('This item has already been purchased.');
      }

      let finalName = contribution.name;
      let invitationCodeId: string | null = null;

      if (contribution.code) {
        const inviteRecord = await txClient.invitationCode.findUnique({
          where: { code: contribution.code.trim().toUpperCase() }
        });

        if (!inviteRecord) {
          throw new Error('Invalid invitation code.');
        }

        if (inviteRecord.used) {
          throw new Error('This invitation code has already been used.');
        }

        finalName = inviteRecord.guestName;
        invitationCodeId = inviteRecord.id;

        await txClient.invitationCode.update({
          where: { id: inviteRecord.id },
          data: {
            used: true,
            usedAt: new Date()
          }
        });
      } else {
        if (process.env.NODE_ENV !== 'test') {
          throw new Error('A valid invitation code is required.');
        }
      }

      const priceCents = Math.round(item.price * 100);
      const contributedCents = Math.round(item.amountContributed * 100);
      const remainingCents = priceCents - contributedCents;
      const contributionCents = Math.round(contribution.amount * 100);

      if (contributionCents > remainingCents) {
        throw new Error('Contribution cannot be greater than the remaining amount.');
      }

      const newTotalCents = contributedCents + contributionCents;
      const newTotal = newTotalCents / 100;

      const updatedItem = await txClient.registryItem.update({
        where: { id: itemId },
        data: {
          amountContributed: newTotal,
          purchased: newTotalCents >= priceCents,
          contributors: {
            create: {
              name: finalName,
              amount: contribution.amount,
              date: new Date(),
              ...(invitationCodeId ? { invitationCodeId } : {})
            }
          }
        },
        include: { image: true, 
          contributors: true
        }
      });
      
      await createAuditSnapshot('RegistryItem', updatedItem.id, updatedItem, finalName || 'Guest/Contributor', txClient);

      return RegistryItemSchema.parse(updatedItem);
    };

    return executeInTransaction(client, runTransaction);
  }
}

export const registryRepository = new RegistryRepository();
