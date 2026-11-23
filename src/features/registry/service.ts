import { registryRepository } from './repository';
import type { AdminUpdateContributorInput } from './schemas';
import type {
  ContributorDeleteResult,
  ContributorLifecycleResult,
  ContributorRecord,
  CreateRegistryItemInput,
  GetItemsOptions,
  IRegistryRepository,
  PaginatedRegistryItems,
  RegistryItem,
  StripeLedgerReconciliationResult,
} from './types';

/**
 * Handles business logic for registry-related operations.
 * All methods interact with the database via the injected RegistryRepository.
 */
class RegistryService {
  private repository: IRegistryRepository;

  constructor(repository: IRegistryRepository) {
    this.repository = repository;
  }

  /**
   * Retrieves paginated registry items.
   * @param options - Optional query parameters, e.g. pagination, filters, includeContributors.
   * @returns A promise that resolves to paginated registry items with metadata.
   */
  async getAllItems(options?: GetItemsOptions): Promise<PaginatedRegistryItems> {
    return this.repository.getAllItems(options);
  }

  /**
   * Retrieves a single registry item by its unique ID.
   * @param id - The UUID of the item to retrieve.
   * @param options - Optional query parameters, e.g. includeContributors.
   * @returns A promise that resolves to the registry item object or null if not found.
   */
  async getItemById(id: string, options?: { includeContributors?: boolean }) {
    return this.repository.getItemById(id, options);
  }

  /**
   * Creates a new registry item.
   * @param data - The data for the new item.
   * @returns A promise that resolves to the newly created registry item.
   */
  async createItem(data: CreateRegistryItemInput) {
    return this.repository.createItem(data);
  }

  /**
   * Creates a batch of registry items within an atomic transaction.
   * @param items - Array of item data objects.
   * @returns A promise that resolves to the array of created registry items.
   */
  async createBatchItems(items: CreateRegistryItemInput[]) {
    return this.repository.createBatchItems(items);
  }

  /**
   * Updates an existing registry item.
   * @param id - The UUID of the item to update.
   * @param data - An object containing the fields to update.
   * @returns A promise that resolves to the updated registry item.
   */
  async updateItem(id: string, data: Partial<RegistryItem> & { imageUrl?: string; imageAlt?: string | null; imageDecorative?: boolean }) {
    return this.repository.updateItem(id, data);
  }

  /**
   * Deletes a registry item.
   * @param id - The UUID of the item to delete.
   * @returns A promise that resolves when the item has been deleted.
   */
  async deleteItem(id: string, author: string = 'Admin') {
    return this.repository.deleteItem(id, author);
  }

  /**
   * Adds a contribution to a registry item.
   * @param itemId - The UUID of the item to contribute to.
   * @param contribution - An object containing the contributor's name and the amount.
   * @returns A promise that resolves to the updated registry item.
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
    if (!contribution || typeof contribution.amount !== 'number' || contribution.amount <= 0) {
      throw new Error('Contribution must be a positive number.');
    }

    return this.repository.contributeToItem(itemId, contribution);
  }

  /**
   * Atomically claims a contributor confirmation or couple alert timestamp.
   */
  async claimContributorEmailSend(
    contributorId: string,
    kind: 'confirmation' | 'alert'
  ): Promise<boolean> {
    if (typeof this.repository.claimContributorEmailSend === 'function') {
      return this.repository.claimContributorEmailSend(contributorId, kind);
    }
    if (typeof registryRepository.claimContributorEmailSend === 'function') {
      return registryRepository.claimContributorEmailSend(contributorId, kind);
    }
    return false;
  }

  /**
   * Confirms a RESERVED contributor claim and returns the updated contributor and item.
   */
  async confirmContribution(
    contributorId: string,
    author: string = 'Guest'
  ): Promise<ContributorLifecycleResult> {
    if (typeof this.repository.confirmContribution === 'function') {
      return this.repository.confirmContribution(contributorId, author);
    }
    return registryRepository.confirmContribution!(contributorId, author);
  }

  /**
   * Cancels a RESERVED contributor claim (guest action) and recalculates item capacity.
   */
  async cancelReservedContribution(
    contributorId: string,
    author: string = 'Guest'
  ): Promise<ContributorLifecycleResult> {
    if (typeof this.repository.cancelReservedContribution === 'function') {
      return this.repository.cancelReservedContribution(contributorId, author);
    }
    return registryRepository.cancelReservedContribution!(contributorId, author);
  }

  /**
   * Voids a contributor claim non-destructively (admin action) and recalculates item capacity.
   */
  async voidContribution(
    contributorId: string,
    author: string = 'Admin'
  ): Promise<ContributorLifecycleResult> {
    if (typeof this.repository.voidContribution === 'function') {
      return this.repository.voidContribution(contributorId, author);
    }
    return registryRepository.voidContribution!(contributorId, author);
  }

  /**
   * Retrieves a contributor alongside its parent RegistryItem.
   */
  async getContributorWithItem(
    contributorId: string
  ): Promise<{ contributor: ContributorRecord; item: RegistryItem | null } | null> {
    if (typeof this.repository.getContributorWithItem === 'function') {
      return this.repository.getContributorWithItem(contributorId);
    }
    return registryRepository.getContributorWithItem!(contributorId);
  }

  /**
   * Records that a polite reminder email was sent for a RESERVED contributor.
   */
  async markContributorReminderSent(contributorId: string): Promise<ContributorRecord> {
    if (typeof this.repository.markContributorReminderSent === 'function') {
      return this.repository.markContributorReminderSent(contributorId);
    }
    return registryRepository.markContributorReminderSent!(contributorId);
  }

  /**
   * Reconciles a Stripe partial/full refund or dispute idempotently against the contributor ledger.
   */
  async reconcileStripeAdjustment(params: {
    stripeChargeId?: string | null;
    stripePaymentIntentId?: string | null;
    refundedCents: number;
    forceFullReversal?: boolean;
  }): Promise<StripeLedgerReconciliationResult> {
    if (typeof this.repository.reconcileStripeAdjustment === 'function') {
      return this.repository.reconcileStripeAdjustment(params);
    }
    return registryRepository.reconcileStripeAdjustment!(params);
  }

  /**
   * Releases an item claim and voids active contributor rows in a locked transaction.
   */
  async unclaimItem(
    itemId: string,
    options?: { confirmVerifiedPayment?: boolean },
    author: string = 'Admin'
  ): Promise<RegistryItem> {
    if (typeof this.repository.unclaimItem === 'function') {
      return this.repository.unclaimItem(itemId, options, author);
    }
    return registryRepository.unclaimItem!(itemId, options, author);
  }

  /**
   * Updates a contributor record and recomputes the parent item ledger atomically.
   */
  async updateContributor(
    contributorId: string,
    data: Partial<AdminUpdateContributorInput>,
    author: string = 'Admin'
  ): Promise<{ contributor: ContributorRecord; item: RegistryItem | null }> {
    if (typeof this.repository.updateContributor === 'function') {
      return this.repository.updateContributor(contributorId, data, author);
    }
    return registryRepository.updateContributor!(contributorId, data, author);
  }

  /**
   * Deletes a contributor record and recomputes the parent item ledger atomically.
   */
  async deleteContributor(
    contributorId: string,
    options?: { confirmVerifiedPayment?: boolean },
    author: string = 'Admin'
  ): Promise<ContributorDeleteResult> {
    if (typeof this.repository.deleteContributor === 'function') {
      return this.repository.deleteContributor(contributorId, options, author);
    }
    return registryRepository.deleteContributor!(contributorId, options, author);
  }
}

export const registryService = new RegistryService(registryRepository);

