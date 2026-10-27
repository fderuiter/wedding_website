import { prisma } from '@/lib/prisma';
import { getAppConfig } from '@/lib/config';
import { createAuditSnapshot, createBatchAuditSnapshots } from '@/lib/audit';
import { executeInTransaction } from '@/lib/transaction';
import { ContributorSchema } from './schemas';
import { ApiError } from '@/utils/ApiError';
import { escapeCsvCell } from '@/utils/csv';
import { generatePdfLabelSheetStream, LabelTemplate, LabelThemeOptions, AddressContributorInput } from '@/utils/pdfLabelGenerator';

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

  private buildWhereClause(options: ThankYouNotesFilterOptions = {}): any {
    const { status, search } = options;
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

    return where;
  }

  /**
   * Retrieves contributor thank-you records with pagination, status/search filters pushed down to DB,
   * and summary progress metrics computed via database aggregations.
   */
  async getThankYouNotes(options: ThankYouNotesFilterOptions = {}) {
    const page = Math.max(1, options.page ? Number(options.page) : 1);
    const pageSize = Math.max(1, options.pageSize ? Number(options.pageSize) : 50);
    const skip = (page - 1) * pageSize;
    const take = pageSize;

    const where = this.buildWhereClause(options);

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
   * Exports thank-you note records matching filter criteria as an RFC 4180 CSV Web ReadableStream.
   */
  exportThankYouNotesCsv(options: ThankYouNotesFilterOptions = {}): ReadableStream<Uint8Array> {
    const where = this.buildWhereClause(options);
    const client = this.client;
    const batchSize = 1000;
    const encoder = new TextEncoder();

    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
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
          const headerRow = headers.map(escapeCsvCell).join(',') + '\n';
          controller.enqueue(encoder.encode(headerRow));

          let cursor: string | undefined = undefined;

          while (true) {
            const records: any[] = await client.contributor.findMany({
              where,
              take: batchSize,
              orderBy: { id: 'asc' },
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
              select: {
                id: true,
                name: true,
                email: true,
                message: true,
                amount: true,
                date: true,
                thankYouStatus: true,
                thankYouSentAt: true,
                thankYouNote: true,
                registryItem: {
                  select: {
                    name: true,
                    category: true,
                  },
                },
              },
            });

            if (!records || records.length === 0) {
              break;
            }

            let chunkCsv = '';
            for (const item of records) {
              const formattedDate = item.date
                ? (item.date instanceof Date ? item.date.toISOString() : String(item.date))
                : '';
              const formattedSentAt = item.thankYouSentAt
                ? (item.thankYouSentAt instanceof Date ? item.thankYouSentAt.toISOString() : String(item.thankYouSentAt))
                : '';

              const row = [
                escapeCsvCell(item.name || ''),
                escapeCsvCell(item.email || ''),
                escapeCsvCell(item.message || ''),
                escapeCsvCell(item.registryItem?.name || 'General Registry'),
                escapeCsvCell(item.registryItem?.category || ''),
                escapeCsvCell(item.amount !== undefined && item.amount !== null ? item.amount : ''),
                escapeCsvCell(formattedDate),
                escapeCsvCell(item.thankYouStatus || 'Unsent'),
                escapeCsvCell(formattedSentAt),
                escapeCsvCell(item.thankYouNote || ''),
              ].join(',') + '\n';

              chunkCsv += row;
            }

            controller.enqueue(encoder.encode(chunkCsv));

            if (records.length < batchSize) {
              break;
            }

            const lastId = records[records.length - 1]?.id;
            if (!lastId || lastId === cursor) {
              break;
            }
            cursor = lastId;
          }

          controller.close();
        } catch (err) {
          controller.error(err instanceof Error ? err : new Error(String(err)));
        }
      },
    });
  }

  /**
   * Exports thank-you note contributor addresses matching filter criteria as a printable Avery PDF label sheet Web ReadableStream.
   */
  exportThankYouNotesPdf(
    options: ThankYouNotesFilterOptions & { template?: LabelTemplate; themeOptions?: LabelThemeOptions } = {}
  ): ReadableStream<Uint8Array> {
    const where = this.buildWhereClause(options);
    const client = this.client;
    const batchSize = 1000;
    const template = options.template || 'avery_5160';
    let resolvedThemeOptions: LabelThemeOptions | undefined = options.themeOptions;

    const chunkFetcher = async (cursor?: string) => {
      const records: (AddressContributorInput & { id: string })[] = await client.contributor.findMany({
        where,
        take: batchSize,
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          name: true,
          invitationCode: {
            select: {
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

      const nextCursor = records.length > 0 ? records[records.length - 1].id : null;
      return { items: records, nextCursor };
    };

    if (!resolvedThemeOptions) {
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            const appConfig = await getAppConfig();
            resolvedThemeOptions = {
              fontHeading: appConfig.themeTokens?.['--font-heading'],
              fontBody: appConfig.themeTokens?.['--font-body'],
              textColor: appConfig.themeTokens?.['--print-text'],
              primaryColor: appConfig.colorPrimary || appConfig.themeTokens?.['--heading-color'],
              themeTokens: appConfig.themeTokens,
            };
          } catch {
            resolvedThemeOptions = {};
          }

          const pdfStream = generatePdfLabelSheetStream(chunkFetcher, template, resolvedThemeOptions);
          const reader = pdfStream.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) controller.enqueue(value);
          }
          controller.close();
        },
      });
    }

    return generatePdfLabelSheetStream(chunkFetcher, template, resolvedThemeOptions);
  }

  /**
   * Alias for exportThankYouNotesPdf for backwards compatibility / alternate interface naming.
   */
  exportThankYouNotesLabels(
    options: ThankYouNotesFilterOptions & { template?: LabelTemplate; themeOptions?: LabelThemeOptions } = {}
  ): ReadableStream<Uint8Array> {
    return this.exportThankYouNotesPdf(options);
  }
}

export const thankYouService = new ThankYouService();
