import { prisma } from '@/lib/prisma';
import { createAuditSnapshot } from '@/lib/audit';
import { executeInTransaction } from '@/lib/transaction';
import { ApiError } from '@/utils/ApiError';
import {
  REGISTRY_DEFAULT_PAGE_LIMIT,
  REGISTRY_MAX_CATALOG_LIMIT,
} from '@/utils/registryPagination';
import {
  buildArchetypeSeedData,
  findSeededContributorWithItem,
  findSeededRegistryItemById,
  isStaticExportBuild,
} from '@/lib/sampleData/builder';
import type {
  IRegistryRepository,
  GetItemsOptions,
  PaginatedRegistryItems,
  CreateRegistryItemInput,
  ContributorLifecycleResult,
  ContributorRecord,
  StripeLedgerReconciliationResult,
} from './types';
import {
  ContributorSchema,
  ContributorStatus,
  RegistryItemSchema,
  RegistryItemDTO,
} from './schemas';

/**
 * @class RegistryRepository
 * @description Provides data access methods for the `RegistryItem` model using Prisma.
 * This class abstracts the database interactions from the service layer.
 */
class RegistryRepository implements IRegistryRepository {
  constructor(public client: any = prisma) {}

  /**
   * Retrieves paginated registry items from the database with optional filtering.
   * @param {GetItemsOptions} [options] - Options for pagination, relation loading, and filters.
   * @returns {Promise<PaginatedRegistryItems>} A promise that resolves to paginated registry items with metadata.
   */
  async getAllItems(options: GetItemsOptions = {}): Promise<PaginatedRegistryItems> {
    const {
      page = 1,
      limit = REGISTRY_DEFAULT_PAGE_LIMIT,
      category,
      minPrice,
      maxPrice,
      includeContributors = false,
      sortBy,
    } = options;

    const normalizedPage = Math.max(1, Math.floor(page || 1));
    const normalizedLimit = Math.min(
      REGISTRY_MAX_CATALOG_LIMIT,
      Math.max(1, Math.floor(limit || REGISTRY_DEFAULT_PAGE_LIMIT))
    );
    const skip = (normalizedPage - 1) * normalizedLimit;
    const take = normalizedLimit;

    if (isStaticExportBuild()) {
      let seeded = buildArchetypeSeedData('classic').registryItems.map((item) =>
        includeContributors ? item : { ...item, contributors: [] }
      );

      if (category && category.trim()) {
        const targetCategory = category.trim();
        seeded = seeded.filter((item) => item.category === targetCategory);
      }
      if (minPrice !== undefined) {
        seeded = seeded.filter((item) => item.price >= minPrice);
      }
      if (maxPrice !== undefined) {
        seeded = seeded.filter((item) => item.price <= maxPrice);
      }

      if (sortBy === 'price-asc') {
        seeded.sort((a, b) => a.price - b.price);
      } else if (sortBy === 'price-desc') {
        seeded.sort((a, b) => b.price - a.price);
      } else {
        seeded.sort((a, b) => {
          const priorityDiff = Number(Boolean(b.isMostWanted)) - Number(Boolean(a.isMostWanted));
          if (priorityDiff !== 0) return priorityDiff;
          return (a.displayOrder ?? 0) - (b.displayOrder ?? 0);
        });
      }

      const total = seeded.length;
      const items = seeded
        .slice(skip, skip + take)
        .map((entry) => RegistryItemSchema.parse(entry));
      const totalPages = Math.ceil(total / normalizedLimit);

      return {
        items,
        total,
        page: normalizedPage,
        limit: normalizedLimit,
        totalPages,
      };
    }

    const where: any = {};
    if (category && category.trim()) {
      where.category = category.trim();
    }
    if (minPrice !== undefined || maxPrice !== undefined) {
      where.price = {};
      if (minPrice !== undefined) {
        where.price.gte = minPrice;
      }
      if (maxPrice !== undefined) {
        where.price.lte = maxPrice;
      }
    }

    let orderBy: any[] = [];
    if (sortBy === 'price-asc') {
      orderBy = [{ price: 'asc' }];
    } else if (sortBy === 'price-desc') {
      orderBy = [{ price: 'desc' }];
    } else {
      orderBy = [
        { isMostWanted: 'desc' },
        { displayOrder: 'asc' },
        { createdAt: 'desc' },
      ];
    }

    const include: { image: boolean; contributors?: boolean } = { image: true };
    if (includeContributors) {
      include.contributors = true;
    }

    const queryWhere = Object.keys(where).length > 0 ? { where } : {};

    const rawTotal = typeof this.client.registryItem?.count === 'function'
      ? await this.client.registryItem.count(queryWhere)
      : undefined;

    const items = await this.client.registryItem.findMany({
      ...queryWhere,
      include,
      orderBy,
      skip,
      take,
    });

    const parsedItems = items.map((item: any) => RegistryItemSchema.parse(item));
    const total = typeof rawTotal === 'number' ? rawTotal : parsedItems.length;
    const totalPages = Math.ceil(total / normalizedLimit);

    return {
      items: parsedItems,
      total,
      page: normalizedPage,
      limit: normalizedLimit,
      totalPages,
    };
  }

  /**
   * Retrieves a single registry item by its ID.
   * @param {string} id - The unique identifier of the item.
   * @param {object} [options] - Options for relation loading.
   * @param {boolean} [options.includeContributors=false] - Whether to include relational contributor records.
   * @returns {Promise<RegistryItemDTO | null>} A promise that resolves to the registry item or null if not found.
   */
  async getItemById(id: string, options: { includeContributors?: boolean } = {}) {
    const { includeContributors = false } = options;
    if (isStaticExportBuild()) {
      const seededItem = findSeededRegistryItemById(id, { includeContributors });
      return seededItem ? RegistryItemSchema.parse(seededItem) : null;
    }

    const include: { image: boolean; contributors?: boolean } = { image: true };
    if (includeContributors) {
      include.contributors = true;
    }
    const item = await this.client.registryItem.findUnique({
      where: { id },
      include,
    });
    return item ? RegistryItemSchema.parse(item) : null;
  }

  private async persistItem(
    client: any,
    data: CreateRegistryItemInput,
    options: {
      auditAuthor: string;
      fallbackCategory: string | undefined;
    }
  ): Promise<RegistryItemDTO> {
    let mediaId = data.imageId;
    if (!mediaId && (data.imageUrl || data.imageAlt || data.imageDecorative !== undefined)) {
      const media = await client.media.create({
        data: {
          url: data.imageUrl || '/images/placeholder.png',
          altText: data.imageAlt,
          isDecorative: data.imageDecorative || false,
        },
      });
      mediaId = media.id;
    } else if (!mediaId) {
      const media = await client.media.create({
        data: {
          url: '/images/placeholder.png',
          isDecorative: true,
        },
      });
      mediaId = media.id;
    }

    const itemType = data.itemType || 'PHYSICAL';
    const isFund = itemType === 'CASH_FUND' || itemType === 'EXPERIENCE_FUND';

    const item = await client.registryItem.create({
      data: {
        itemType,
        paymentHandleType: data.paymentHandleType || null,
        paymentHandle: data.paymentHandle || null,
        name: data.name,
        price: data.price,
        quantity: isFund ? 1 : (data.quantity ?? 1),
        category:
          options.fallbackCategory !== undefined
            ? data.category || options.fallbackCategory
            : data.category,
        description: data.description || '',
        imageId: mediaId,
        vendorUrl: data.vendorUrl || null,
        isGroupGift: isFund ? true : (data.isGroupGift ?? false),
        isMostWanted: data.isMostWanted ?? false,
        displayOrder: data.displayOrder ?? 0,
        contributors: {
          create: [],
        },
      },
      include: {
        image: true,
        contributors: true,
      },
    });

    await createAuditSnapshot('RegistryItem', item.id, item, options.auditAuthor, client);
    return RegistryItemSchema.parse(item);
  }

  /**
   * Creates a new registry item in the database.
   * @param {Omit<RegistryItemDTO, 'id' | 'contributors' | 'createdAt' | 'updatedAt' | 'amountContributed' | 'purchased'>} data - The data for the new item.
   * @returns {Promise<RegistryItemDTO>} A promise that resolves to the newly created registry item.
   */
  async createItem(data: CreateRegistryItemInput) {
    return this.persistItem(this.client, data, {
      auditAuthor: 'Guest/User',
      fallbackCategory: undefined,
    });
  }

  /**
   * Creates multiple registry items atomically within a database transaction.
   * If any item insertion fails, all mutations are rolled back.
   *
   * @param {Array} items - Array of registry items to insert.
   * @returns {Promise<RegistryItemDTO[]>} A promise resolving to the created items.
   */
  async createBatchItems(items: CreateRegistryItemInput[]): Promise<RegistryItemDTO[]> {
    const runTransaction = async (txClient: any) => {
      const createdItems: RegistryItemDTO[] = [];

      for (const data of items) {
        const createdItem = await this.persistItem(txClient, data, {
          auditAuthor: 'Admin',
          fallbackCategory: 'Uncategorized',
        });
        createdItems.push(createdItem);
      }

      return createdItems;
    };

    return executeInTransaction(this.client, runTransaction);
  }

  async updateItem(id: string, data: Partial<RegistryItemDTO> & { imageUrl?: string; imageAlt?: string | null; imageDecorative?: boolean }) {
    const { contributors: _contributors, image: _image, imageId, imageUrl, imageAlt, imageDecorative, ...updateData } = data;
    
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
  async deleteItem(id: string, author: string = 'Admin') {
    const item = await this.client.registryItem.delete({
      where: { id }
    });
    await createAuditSnapshot('RegistryItem', item.id, { deleted: true, ...item }, author, this.client);
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
    contribution: {
      name: string;
      email?: string | null;
      amount: number;
      code?: string;
      message?: string | null;
      coverFee?: boolean;
      stripePaymentIntentId?: string | null;
      stripeChargeId?: string | null;
      transactionTimestamp?: Date | string | null;
      retailerOrderNumber?: string | null;
      carrier?: string | null;
      trackingNumber?: string | null;
    }
  ) {
    const runTransaction = async (txClient: any) => {
      // 1. Acquire PostgreSQL row-level lock on the targeted registry item row
      if (typeof txClient.$queryRaw === 'function') {
        await txClient.$queryRaw`SELECT id FROM "RegistryItem" WHERE id = ${itemId} FOR UPDATE`;
      }

      // Check for idempotent duplicate if a Stripe PaymentIntent ID is provided
      if (contribution.stripePaymentIntentId) {
        const existing = await txClient.contributor?.findFirst?.({
          where: { stripePaymentIntentId: contribution.stripePaymentIntentId },
        });
        if (existing) {
          if (existing.registryItemId !== itemId) {
            throw new ApiError(
              400,
              'Stripe PaymentIntent has already been used for another registry item.'
            );
          }
          const existingItem = await txClient.registryItem.findUnique({
            where: { id: itemId },
            include: { image: true, contributors: true },
          });
          return RegistryItemSchema.parse(existingItem);
        }
      }

      // 2. Fetch the absolute latest state of the item inside the transaction context
      const item = await txClient.registryItem.findUnique({
        where: { id: itemId },
      });

      if (!item) {
        throw new Error('Item not found');
      }

      if (item.isSample) {
        throw new Error('Sample registry items do not accept contributions or payments.');
      }

      // 3. Perform validations inside the locked transactional context
      if (item.purchased) {
        throw new Error('This item has already been purchased.');
      }

      let finalName = contribution.name;
      let invitationCodeId: string | null = null;

      if (contribution.code && contribution.code.trim()) {
        const inviteRecord = await txClient.invitationCode.findUnique({
          where: { code: contribution.code.trim().toUpperCase(), isSample: false }
        });

        if (!inviteRecord || inviteRecord.isSample) {
          throw new Error('Invalid invitation code.');
        }

        finalName = contribution.name || inviteRecord.guestName;
        invitationCodeId = inviteRecord.id;

        await txClient.invitationCode.update({
          where: { id: inviteRecord.id },
          data: {
            used: true,
            usedAt: new Date()
          }
        });
      }

      const isFund = item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND';
      const quantity = isFund ? 1 : Math.max(1, Math.floor(item.quantity || 1));
      const unitPriceCents = Math.round(item.price * 100);
      const totalTargetCents = unitPriceCents * quantity;
      const contributedCents = Math.round(item.amountContributed * 100);
      const remainingCents = totalTargetCents - contributedCents;
      const contributionCents = Math.round(contribution.amount * 100);

      if (contributionCents > remainingCents) {
        throw new Error('Contribution cannot be greater than the remaining amount.');
      }

      const isGroupGift = Boolean(isFund || item.isGroupGift);
      if (!isGroupGift && unitPriceCents > 0) {
        if (contributionCents < unitPriceCents || contributionCents % unitPriceCents !== 0) {
          throw new ApiError(400, 'Contribution amount must match a whole number of available units.');
        }
      }

      const coverFee = Boolean(contribution.coverFee);
      const feeAmount = coverFee ? Math.round(contribution.amount * 0.025 * 100) / 100 : 0;

      const newTotalCents = contributedCents + contributionCents;
      const newTotal = newTotalCents / 100;

      const messageToSave = contribution.message && contribution.message.trim() ? contribution.message.trim() : null;
      const emailToSave = contribution.email && contribution.email.trim() ? contribution.email.trim() : null;
      const retailerOrderNumberToSave =
        contribution.retailerOrderNumber && contribution.retailerOrderNumber.trim()
          ? contribution.retailerOrderNumber.trim()
          : null;
      const carrierToSave =
        contribution.carrier && contribution.carrier.trim()
          ? contribution.carrier.trim()
          : null;
      const trackingNumberToSave =
        contribution.trackingNumber && contribution.trackingNumber.trim()
          ? contribution.trackingNumber.trim()
          : null;
      const transactionDate = contribution.transactionTimestamp ? new Date(contribution.transactionTimestamp) : new Date();

      const updatedPurchaserName = !isGroupGift
        ? item.purchaserName
          ? `${item.purchaserName}, ${finalName}`
          : finalName
        : item.purchaserName;
      const initialStatus: ContributorStatus = contribution.stripePaymentIntentId
        ? 'CONFIRMED'
        : 'RESERVED';

      const updatedItem = await txClient.registryItem.update({
        where: { id: itemId },
        data: {
          amountContributed: newTotal,
          purchased: newTotalCents >= totalTargetCents,
          ...(!isGroupGift && updatedPurchaserName !== undefined
            ? { purchaserName: updatedPurchaserName }
            : {}),
          contributors: {
            create: {
              name: finalName,
              email: emailToSave,
              amount: contribution.amount,
              status: initialStatus,
              coverFee,
              feeAmount,
              message: messageToSave,
              date: transactionDate,
              ...(retailerOrderNumberToSave ? { retailerOrderNumber: retailerOrderNumberToSave } : {}),
              ...(carrierToSave ? { carrier: carrierToSave } : {}),
              ...(trackingNumberToSave ? { trackingNumber: trackingNumberToSave } : {}),
              ...(contribution.stripePaymentIntentId ? { stripePaymentIntentId: contribution.stripePaymentIntentId } : {}),
              ...(contribution.stripeChargeId ? { stripeChargeId: contribution.stripeChargeId } : {}),
              ...(contribution.transactionTimestamp ? { transactionTimestamp: new Date(contribution.transactionTimestamp) } : {}),
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

    try {
      return await executeInTransaction(this.client, runTransaction);
    } catch (err: unknown) {
      const errorCode =
        typeof err === 'object' && err !== null && 'code' in err
          ? (err as { code?: unknown }).code
          : undefined;
      if (errorCode === 'P2002' && contribution.stripePaymentIntentId) {
        const existing = await this.client.contributor?.findFirst?.({
          where: { stripePaymentIntentId: contribution.stripePaymentIntentId },
        });
        if (existing) {
          if (existing.registryItemId !== itemId) {
            throw new ApiError(
              400,
              'Stripe PaymentIntent has already been used for another registry item.'
            );
          }
          const existingItem = await this.client.registryItem.findUnique({
            where: { id: itemId },
            include: { image: true, contributors: true },
          });
          if (existingItem) {
            return RegistryItemSchema.parse(existingItem);
          }
        }
      }
      throw err;
    }
  }

  /**
   * Atomically claims an outbound email timestamp on a Contributor record so
   * concurrent browser callbacks and Stripe webhooks never send duplicate emails.
   */
  async claimContributorEmailSend(
    contributorId: string,
    kind: 'confirmation' | 'alert'
  ): Promise<boolean> {
    if (!contributorId || typeof this.client?.contributor?.updateMany !== 'function') {
      return false;
    }

    const field = kind === 'confirmation' ? 'confirmationEmailSentAt' : 'alertEmailSentAt';
    const result = await this.client.contributor.updateMany({
      where: {
        id: contributorId,
        [field]: null,
      },
      data: {
        [field]: new Date(),
      },
    });

    return Boolean(result && result.count === 1);
  }

  private normalizeStatus(rawStatus: unknown): ContributorStatus {
    const normalized = typeof rawStatus === 'string' ? rawStatus.trim().toUpperCase() : 'CONFIRMED';
    if (
      normalized === 'RESERVED' ||
      normalized === 'CONFIRMED' ||
      normalized === 'CANCELLED' ||
      normalized === 'REFUNDED'
    ) {
      return normalized;
    }
    return 'CONFIRMED';
  }

  private async recomputeItemLedger(
    txClient: any,
    itemId: string | null | undefined
  ): Promise<RegistryItemDTO | null> {
    if (!itemId) {
      return null;
    }

    if (typeof txClient.$queryRaw === 'function') {
      await txClient.$queryRaw`SELECT id FROM "RegistryItem" WHERE id = ${itemId} FOR UPDATE`;
    }

    const item = await txClient.registryItem.findUnique({
      where: { id: itemId },
      include: { image: true, contributors: true },
    });

    if (!item) {
      return null;
    }

    const isFund = item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND';
    const quantity = isFund ? 1 : Math.max(1, Math.floor(item.quantity || 1));
    const unitPriceCents = Math.round(item.price * 100);
    const totalTargetCents = unitPriceCents * quantity;
    const isGroupGift = Boolean(isFund || item.isGroupGift);

    const contributorsList: any[] = Array.isArray(item.contributors) ? [...item.contributors] : [];
    contributorsList.sort((a, b) => {
      const aTime = a?.date ? new Date(a.date).getTime() : 0;
      const bTime = b?.date ? new Date(b.date).getTime() : 0;
      return aTime - bTime;
    });

    let activeNetCents = 0;
    const activeNames: string[] = [];

    for (const contributor of contributorsList) {
      const status = this.normalizeStatus(contributor?.status);
      if (status !== 'RESERVED' && status !== 'CONFIRMED') {
        continue;
      }

      const grossCents = Math.max(0, Math.round((Number(contributor?.amount) || 0) * 100));
      const refundedCents = Math.max(0, Math.round((Number(contributor?.refundedAmount) || 0) * 100));
      const netCents = Math.max(0, grossCents - refundedCents);

      activeNetCents += netCents;
      if (netCents > 0 && typeof contributor?.name === 'string' && contributor.name.trim()) {
        activeNames.push(contributor.name.trim());
      }
    }

    const nextAmountContributed = activeNetCents / 100;
    const nextPurchased = totalTargetCents > 0 ? activeNetCents >= totalTargetCents : false;
    const nextPurchaserName = !isGroupGift
      ? activeNames.length > 0
        ? activeNames.join(', ')
        : null
      : item.purchaserName ?? null;

    const updatedItem = await txClient.registryItem.update({
      where: { id: itemId },
      data: {
        amountContributed: nextAmountContributed,
        purchased: nextPurchased,
        ...(!isGroupGift ? { purchaserName: nextPurchaserName } : {}),
      },
      include: { image: true, contributors: true },
    });

    return RegistryItemSchema.parse(updatedItem);
  }

  async getContributorWithItem(
    contributorId: string
  ): Promise<{ contributor: ContributorRecord; item: RegistryItemDTO | null } | null> {
    if (!contributorId) return null;
    if (isStaticExportBuild()) {
      const found = findSeededContributorWithItem(contributorId);
      if (!found) return null;
      return {
        contributor: ContributorSchema.parse(found.contributor),
        item: found.item ? RegistryItemSchema.parse(found.item) : null,
      };
    }

    const contributor = await this.client.contributor.findUnique({
      where: { id: contributorId },
    });
    if (!contributor) {
      return null;
    }

    let item: RegistryItemDTO | null = null;
    if (contributor.registryItemId) {
      const rawItem = await this.client.registryItem.findUnique({
        where: { id: contributor.registryItemId },
        include: { image: true, contributors: true },
      });
      if (rawItem) {
        item = RegistryItemSchema.parse(rawItem);
      }
    }

    return {
      contributor: ContributorSchema.parse(contributor),
      item,
    };
  }

  async markContributorReminderSent(contributorId: string): Promise<ContributorRecord> {
    const updated = await this.client.contributor.update({
      where: { id: contributorId },
      data: { reminderEmailSentAt: new Date() },
    });
    return ContributorSchema.parse(updated);
  }

  async confirmContribution(
    contributorId: string,
    author: string = 'Guest'
  ): Promise<ContributorLifecycleResult> {
    return executeInTransaction(this.client, async (txClient: any) => {
      const existing = await txClient.contributor.findUnique({
        where: { id: contributorId },
      });
      if (!existing) {
        throw new ApiError(404, 'Contribution record not found.');
      }

      const previousStatus = this.normalizeStatus(existing.status);
      if (previousStatus === 'CANCELLED' || previousStatus === 'REFUNDED') {
        throw new ApiError(
          409,
          `Cannot confirm a contribution that is already ${previousStatus.toLowerCase()}.`
        );
      }

      if (previousStatus === 'CONFIRMED') {
        const currentItem = existing.registryItemId
          ? await txClient.registryItem.findUnique({
            where: { id: existing.registryItemId },
            include: { image: true, contributors: true },
          })
          : null;
        return {
          contributor: ContributorSchema.parse(existing),
          item: currentItem ? RegistryItemSchema.parse(currentItem) : null,
          previousStatus,
          changed: false,
        };
      }

      const updated = await txClient.contributor.update({
        where: { id: contributorId },
        data: { status: 'CONFIRMED' },
      });
      await createAuditSnapshot('Contributor', updated.id, updated, author, txClient);

      const item = await this.recomputeItemLedger(txClient, updated.registryItemId);
      if (item) {
        await createAuditSnapshot('RegistryItem', item.id, item, author, txClient);
      }

      return {
        contributor: ContributorSchema.parse(updated),
        item,
        previousStatus,
        changed: true,
      };
    });
  }

  async cancelReservedContribution(
    contributorId: string,
    author: string = 'Guest'
  ): Promise<ContributorLifecycleResult> {
    return executeInTransaction(this.client, async (txClient: any) => {
      const existing = await txClient.contributor.findUnique({
        where: { id: contributorId },
      });
      if (!existing) {
        throw new ApiError(404, 'Contribution record not found.');
      }

      const previousStatus = this.normalizeStatus(existing.status);
      if (previousStatus === 'CANCELLED') {
        const currentItem = existing.registryItemId
          ? await txClient.registryItem.findUnique({
            where: { id: existing.registryItemId },
            include: { image: true, contributors: true },
          })
          : null;
        return {
          contributor: ContributorSchema.parse(existing),
          item: currentItem ? RegistryItemSchema.parse(currentItem) : null,
          previousStatus,
          changed: false,
        };
      }

      if (previousStatus !== 'RESERVED') {
        throw new ApiError(
          409,
          'This gift has already been confirmed and cannot be cancelled via reservation link. Please contact the couple if you need assistance.'
        );
      }

      const shouldMarkThankYouNotNeeded =
        (existing.thankYouStatus || 'Unsent').trim().toLowerCase() === 'unsent';

      const updated = await txClient.contributor.update({
        where: { id: contributorId },
        data: {
          status: 'CANCELLED',
          ...(shouldMarkThankYouNotNeeded ? { thankYouStatus: 'Not Needed' } : {}),
        },
      });
      await createAuditSnapshot('Contributor', updated.id, updated, author, txClient);

      const item = await this.recomputeItemLedger(txClient, updated.registryItemId);
      if (item) {
        await createAuditSnapshot('RegistryItem', item.id, item, author, txClient);
      }

      return {
        contributor: ContributorSchema.parse(updated),
        item,
        previousStatus,
        changed: true,
      };
    });
  }

  async voidContribution(
    contributorId: string,
    author: string = 'Admin'
  ): Promise<ContributorLifecycleResult> {
    return executeInTransaction(this.client, async (txClient: any) => {
      const existing = await txClient.contributor.findUnique({
        where: { id: contributorId },
      });
      if (!existing) {
        throw new ApiError(404, 'Contribution record not found.');
      }

      const previousStatus = this.normalizeStatus(existing.status);
      if (previousStatus === 'CANCELLED' || previousStatus === 'REFUNDED') {
        const currentItem = existing.registryItemId
          ? await txClient.registryItem.findUnique({
            where: { id: existing.registryItemId },
            include: { image: true, contributors: true },
          })
          : null;
        return {
          contributor: ContributorSchema.parse(existing),
          item: currentItem ? RegistryItemSchema.parse(currentItem) : null,
          previousStatus,
          changed: false,
        };
      }

      const shouldMarkThankYouNotNeeded =
        (existing.thankYouStatus || 'Unsent').trim().toLowerCase() === 'unsent';

      const updated = await txClient.contributor.update({
        where: { id: contributorId },
        data: {
          status: 'CANCELLED',
          ...(shouldMarkThankYouNotNeeded ? { thankYouStatus: 'Not Needed' } : {}),
        },
      });
      await createAuditSnapshot('Contributor', updated.id, updated, author, txClient);

      const item = await this.recomputeItemLedger(txClient, updated.registryItemId);
      if (item) {
        await createAuditSnapshot('RegistryItem', item.id, item, author, txClient);
      }

      return {
        contributor: ContributorSchema.parse(updated),
        item,
        previousStatus,
        changed: true,
      };
    });
  }

  async reconcileStripeAdjustment(params: {
    stripeChargeId?: string | null;
    stripePaymentIntentId?: string | null;
    refundedCents: number;
    forceFullReversal?: boolean;
  }): Promise<StripeLedgerReconciliationResult> {
    const chargeId = params.stripeChargeId?.trim() || '';
    const paymentIntentId = params.stripePaymentIntentId?.trim() || '';

    return executeInTransaction(this.client, async (txClient: any) => {
      let located = chargeId
        ? await txClient.contributor.findFirst({ where: { stripeChargeId: chargeId } })
        : null;
      if (!located && paymentIntentId) {
        located = await txClient.contributor.findFirst({
          where: { stripePaymentIntentId: paymentIntentId },
        });
      }

      if (!located) {
        return {
          matched: false,
          changed: false,
          contributor: null,
          item: null,
          previousStatus: null,
          previousRefundedAmount: 0,
          refundedAmount: 0,
        };
      }

      if (located.registryItemId && typeof txClient.$queryRaw === 'function') {
        await txClient.$queryRaw`SELECT id FROM "RegistryItem" WHERE id = ${located.registryItemId} FOR UPDATE`;
      }

      const existing =
        (await txClient.contributor.findUnique({ where: { id: located.id } })) ?? located;

      const grossCents = Math.max(0, Math.round((Number(existing.amount) || 0) * 100));
      const prevRefundedCents = Math.max(
        0,
        Math.round((Number(existing.refundedAmount) || 0) * 100)
      );
      const previousStatus = this.normalizeStatus(existing.status);

      const requestedCents = params.forceFullReversal
        ? grossCents
        : Math.max(0, Math.round(params.refundedCents));
      const targetRefundedCents = Math.min(
        grossCents,
        Math.max(prevRefundedCents, requestedCents)
      );
      const nextRefundedAmount = targetRefundedCents / 100;
      const isFullyRefunded = grossCents > 0 && targetRefundedCents >= grossCents;
      const nextStatus: ContributorStatus = isFullyRefunded
        ? 'REFUNDED'
        : previousStatus === 'CANCELLED' || previousStatus === 'REFUNDED'
          ? previousStatus
          : 'CONFIRMED';

      const chargeNeedsBackfill = Boolean(chargeId && !existing.stripeChargeId);
      const changed =
        targetRefundedCents !== prevRefundedCents || nextStatus !== previousStatus;

      if (!changed && !chargeNeedsBackfill) {
        const currentItem = existing.registryItemId
          ? await txClient.registryItem.findUnique({
            where: { id: existing.registryItemId },
            include: { image: true, contributors: true },
          })
          : null;
        return {
          matched: true,
          changed: false,
          contributor: ContributorSchema.parse(existing),
          item: currentItem ? RegistryItemSchema.parse(currentItem) : null,
          previousStatus,
          previousRefundedAmount: prevRefundedCents / 100,
          refundedAmount: nextRefundedAmount,
        };
      }

      const shouldMarkThankYouNotNeeded =
        isFullyRefunded &&
        (existing.thankYouStatus || 'Unsent').trim().toLowerCase() === 'unsent';

      const updated = await txClient.contributor.update({
        where: { id: existing.id },
        data: {
          refundedAmount: nextRefundedAmount,
          status: nextStatus,
          ...(chargeNeedsBackfill ? { stripeChargeId: chargeId } : {}),
          ...(shouldMarkThankYouNotNeeded ? { thankYouStatus: 'Not Needed' } : {}),
        },
      });
      await createAuditSnapshot('Contributor', updated.id, updated, 'Stripe Webhook', txClient);

      const item = await this.recomputeItemLedger(txClient, updated.registryItemId);
      if (item && changed) {
        await createAuditSnapshot('RegistryItem', item.id, item, 'Stripe Webhook', txClient);
      }

      return {
        matched: true,
        changed,
        contributor: ContributorSchema.parse(updated),
        item,
        previousStatus,
        previousRefundedAmount: prevRefundedCents / 100,
        refundedAmount: nextRefundedAmount,
      };
    });
  }
}

export function createRegistryRepository(client: any = prisma): IRegistryRepository {
  return new RegistryRepository(client);
}

export const registryRepository = createRegistryRepository();
