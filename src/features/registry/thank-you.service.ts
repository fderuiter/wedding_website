import { prisma } from '@/lib/prisma';
import { createAuditSnapshot, createBatchAuditSnapshots } from '@/lib/audit';
import { executeInTransaction } from '@/lib/transaction';
import { ContributorSchema } from './schemas';
import { ApiError } from '@/utils/ApiError';
import { generateCsvContent } from '@/utils/csv';
import { generatePdfLabelSheet, LabelTemplate } from '@/utils/pdfLabelGenerator';

export interface ThankYouNotesFilterOptions {
  status?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ProgressMetrics {
  total: number;
  sent: number;
  unsent: number;
  notNeeded: number;
  thanked: number;
  completionPercentage: number;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export class ThankYouService {
  constructor(private client: any = prisma) {}

  /**
   * Retrieves contributor thank-you records with pagination, status/search filters pushed down to DB,
   * and summary progress metrics computed via database aggregations.
   */
  async getThankYouNotes(options: ThankYouNotesFilterOptions = {}) {
    const { status, search } = options;
    const page = Math.max(1, options.page ? Number(options.page) : 1);
    const pageSize = Math.max(1, options.pageSize ? Number(options.pageSize) : 50);
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where: any = {};

    if (status && status.trim() && status.toLowerCase() !== 'all') {
      const targetStatus = status.trim().toLowerCase().replace(/_/g, ' ');
      if (targetStatus === 'sent') {
        where.thankYouStatus = { equals: 'Sent', mode: 'insensitive' };
      } else if (targetStatus === 'unsent') {
        where.thankYouStatus = { equals: 'Unsent', mode: 'insensitive' };
      } else if (targetStatus === 'not needed' || targetStatus === 'notneeded') {
        where.thankYouStatus = {
          in: ['Not Needed', 'not_needed', 'notneeded'],
          mode: 'insensitive',
        };
      } else {
        where.thankYouStatus = { equals: status.trim(), mode: 'insensitive' };
      }
    }

    if (search && search.trim()) {
      const query = search.trim();
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { registryItem: { name: { contains: query, mode: 'insensitive' } } },
      ];
    }

    // Compute status progress aggregations, total matching filtered items, and paginated records concurrently
    const [statusGroups, totalFilteredCount, rawContributors] = await Promise.all([
      this.client.contributor.groupBy({
        by: ['thankYouStatus'],
        _count: { _all: true },
      }),
      this.client.contributor.count({ where }),
      this.client.contributor.findMany({
        where,
        skip,
        take,
        include: {
          registryItem: {
            select: {
              id: true,
              name: true,
              category: true,
            },
          },
          invitationCode: {
            select: {
              id: true,
              code: true,
              guestName: true,
              addressLine1: true,
              addressLine2: true,
              city: true,
              state: true,
              zipCode: true,
              country: true,
            },
          },
        },
        orderBy: {
          date: 'desc',
        },
      }),
    ]);

    // Calculate metrics over all recorded gift contributions from database aggregations
    let sentCount = 0;
    let unsentCount = 0;
    let notNeededCount = 0;
    let total = 0;

    for (const group of statusGroups) {
      const count =
        typeof group._count === 'number'
          ? group._count
          : (group._count?._all ?? group._count?.id ?? group._count?.thankYouStatus ?? 0);
      total += count;

      const st = (group.thankYouStatus || 'Unsent').trim().toLowerCase().replace(/_/g, ' ');
      if (st === 'sent') {
        sentCount += count;
      } else if (st === 'not needed' || st === 'notneeded') {
        notNeededCount += count;
      } else {
        unsentCount += count;
      }
    }

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

    // Schema validation operates ONLY on the paginated subset returned by the database
    const items = rawContributors.map((c: any) => ContributorSchema.parse(c));

    const totalPages = Math.ceil(totalFilteredCount / pageSize) || 1;

    return {
      items,
      metrics,
      pagination: {
        page,
        pageSize,
        totalItems: totalFilteredCount,
        totalPages,
      },
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
        invitationCode: {
          select: {
            id: true,
            code: true,
            guestName: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            state: true,
            zipCode: true,
            country: true,
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
        invitationCode: {
          select: {
            id: true,
            code: true,
            guestName: true,
            addressLine1: true,
            addressLine2: true,
            city: true,
            state: true,
            zipCode: true,
            country: true,
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
          invitationCode: {
            select: {
              id: true,
              code: true,
              guestName: true,
              addressLine1: true,
              addressLine2: true,
              city: true,
              state: true,
              zipCode: true,
              country: true,
            },
          },
        },
      });

      await createBatchAuditSnapshots('Contributor', updatedRecords, author, txClient);

      return updatedRecords.map((r: any) => ContributorSchema.parse(r));
    };

    return executeInTransaction(this.client, runBatch);
  }

  /**
   * Exports thank-you note records matching filter criteria as an RFC 4180 CSV string.
   */
  async exportThankYouNotesCsv(options: ThankYouNotesFilterOptions = {}): Promise<string> {
    const { items } = await this.getThankYouNotes({
      ...options,
      page: options.page || 1,
      pageSize: options.pageSize || 1000000,
    });

    const headers = [
      'Contributor Name',
      'Email',
      'Guest Message',
      'Gift Item',
      'Category',
      'Contribution Amount',
      'Contribution Date',
      'Thank-You Status',
      'Sent Date',
      'Note Draft',
    ];

    const records = items.map((item: any) => ({
      'Contributor Name': item.name || '',
      'Email': item.email || '',
      'Guest Message': item.message || '',
      'Gift Item': item.registryItem?.name || 'General Registry',
      'Category': item.registryItem?.category || '',
      'Contribution Amount': item.amount !== undefined && item.amount !== null ? item.amount : '',
      'Contribution Date': item.date ? item.date : '',
      'Thank-You Status': item.thankYouStatus || 'Unsent',
      'Sent Date': item.thankYouSentAt || '',
      'Note Draft': item.thankYouNote || '',
    }));

    return generateCsvContent(records, headers);
  }

  /**
   * Exports thank-you note contributor addresses matching filter criteria as a printable Avery PDF label sheet.
   */
  async exportThankYouNotesPdf(
    options: ThankYouNotesFilterOptions & { template?: LabelTemplate } = {}
  ): Promise<Buffer> {
    const { items } = await this.getThankYouNotes({
      ...options,
      page: options.page || 1,
      pageSize: options.pageSize || 1000000,
    });

    const template = options.template || 'avery_5160';
    return generatePdfLabelSheet(items, template);
  }

  /**
   * Alias for exportThankYouNotesPdf for backwards compatibility / alternate interface naming.
   */
  async exportThankYouNotesLabels(
    options: ThankYouNotesFilterOptions & { template?: LabelTemplate } = {}
  ): Promise<Buffer> {
    return this.exportThankYouNotesPdf(options);
  }
}

export const thankYouService = new ThankYouService();
