import { prisma } from '@/lib/prisma';
import { createAuditSnapshot } from '@/lib/audit';
import { executeInTransaction } from '@/lib/transaction';
import { ContributorSchema } from './schemas';
import { ApiError } from '@/utils/ApiError';

export interface ThankYouNotesFilterOptions {
  status?: string;
  search?: string;
}

export interface ProgressMetrics {
  total: number;
  sent: number;
  unsent: number;
  notNeeded: number;
  thanked: number;
  completionPercentage: number;
}

export class ThankYouService {
  constructor(private client: any = prisma) {}

  /**
   * Retrieves all contributor thank-you records with filtering, search, and progress metrics.
   */
  async getThankYouNotes(options: ThankYouNotesFilterOptions = {}) {
    const { status, search } = options;

    // Fetch all contributors with registry item details
    const allContributors = await this.client.contributor.findMany({
      include: {
        registryItem: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
      },
      orderBy: {
        date: 'desc',
      },
    });

    // Calculate metrics over all recorded gift contributions
    let sentCount = 0;
    let unsentCount = 0;
    let notNeededCount = 0;

    for (const c of allContributors) {
      const st = (c.thankYouStatus || 'Unsent').trim().toLowerCase();
      if (st === 'sent') {
        sentCount++;
      } else if (st === 'not needed' || st === 'not_needed' || st === 'notneeded') {
        notNeededCount++;
      } else {
        unsentCount++;
      }
    }

    const total = allContributors.length;
    const thanked = sentCount + notNeededCount;
    const completionPercentage = total > 0 ? Math.round((thanked / total) * 100) : 0;

    const metrics: ProgressMetrics = {
      total,
      sent: sentCount,
      unsent: unsentCount,
      notNeeded: notNeededCount,
      thanked,
      completionPercentage,
    };

    // Apply filtering
    let filtered = allContributors;

    if (status && status.trim() && status.toLowerCase() !== 'all') {
      const targetStatus = status.trim().toLowerCase().replace(/_/g, ' ');
      filtered = filtered.filter((c: any) => {
        const cStatus = (c.thankYouStatus || 'unsent').trim().toLowerCase().replace(/_/g, ' ');
        if (targetStatus === 'unsent') return cStatus === 'unsent';
        if (targetStatus === 'sent') return cStatus === 'sent';
        if (targetStatus === 'not needed' || targetStatus === 'notneeded') {
          return cStatus === 'not needed' || cStatus === 'notneeded';
        }
        return cStatus === targetStatus;
      });
    }

    if (search && search.trim()) {
      const query = search.trim().toLowerCase();
      filtered = filtered.filter((c: any) => {
        const contributorName = (c.name || '').toLowerCase();
        const giftName = (c.registryItem?.name || '').toLowerCase();
        return contributorName.includes(query) || giftName.includes(query);
      });
    }

    const items = filtered.map((c: any) => ContributorSchema.parse(c));

    return {
      items,
      metrics,
    };
  }

  /**
   * Updates an individual contributor's thank-you status, sent timestamp, or note draft.
   */
  async updateThankYouNote(
    id: string,
    data: { thankYouStatus?: string; thankYouSentAt?: Date | string | null; thankYouNote?: string | null },
    author: string = 'Admin'
  ) {
    const existing = await this.client.contributor.findUnique({
      where: { id },
      include: {
        registryItem: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
      },
    });

    if (!existing) {
      throw new ApiError(404, 'Contributor record not found');
    }

    const updateData: any = {};

    if (data.thankYouStatus !== undefined) {
      updateData.thankYouStatus = data.thankYouStatus;

      if (data.thankYouStatus === 'Sent' && data.thankYouSentAt === undefined) {
        updateData.thankYouSentAt = new Date();
      } else if (data.thankYouStatus === 'Unsent' && data.thankYouSentAt === undefined) {
        updateData.thankYouSentAt = null;
      }
    }

    if (data.thankYouSentAt !== undefined) {
      updateData.thankYouSentAt = data.thankYouSentAt ? new Date(data.thankYouSentAt) : null;
    }

    if (data.thankYouNote !== undefined) {
      updateData.thankYouNote = data.thankYouNote;
    }

    const updated = await this.client.contributor.update({
      where: { id },
      data: updateData,
      include: {
        registryItem: {
          select: {
            id: true,
            name: true,
            category: true,
          },
        },
      },
    });

    await createAuditSnapshot('Contributor', updated.id, updated, author, this.client);

    return ContributorSchema.parse(updated);
  }

  /**
   * Performs bulk status updates on multiple selected contributor records.
   */
  async batchUpdateThankYouNotes(
    ids: string[],
    status: string,
    options?: { thankYouSentAt?: Date | string | null; thankYouNote?: string | null },
    author: string = 'Admin'
  ) {
    if (!ids || ids.length === 0) {
      throw new ApiError(400, 'At least one contributor record is required for batch update');
    }

    let defaultSentAt: Date | null = null;
    if (status === 'Sent') {
      defaultSentAt = options?.thankYouSentAt ? new Date(options.thankYouSentAt) : new Date();
    } else if (options?.thankYouSentAt !== undefined) {
      defaultSentAt = options.thankYouSentAt ? new Date(options.thankYouSentAt) : null;
    }

    const updatePayload: any = {
      thankYouStatus: status,
      thankYouSentAt: defaultSentAt,
    };

    if (options?.thankYouNote !== undefined) {
      updatePayload.thankYouNote = options.thankYouNote;
    }

    const runBatch = async (txClient: any) => {
      await txClient.contributor.updateMany({
        where: { id: { in: ids } },
        data: updatePayload,
      });

      const updatedRecords = await txClient.contributor.findMany({
        where: { id: { in: ids } },
        include: {
          registryItem: {
            select: {
              id: true,
              name: true,
              category: true,
            },
          },
        },
      });

      for (const record of updatedRecords) {
        await createAuditSnapshot('Contributor', record.id, record, author, txClient);
      }

      return updatedRecords.map((r: any) => ContributorSchema.parse(r));
    };

    return executeInTransaction(this.client, runBatch);
  }
}

export const thankYouService = new ThankYouService();
