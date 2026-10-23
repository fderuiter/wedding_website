import { prisma } from '@/lib/prisma';
import { MediaDTO, MediaSchema } from './schemas';
import { executeInTransaction } from '@/lib/transaction';
import { createAuditSnapshot } from '@/lib/audit';

export interface MediaPaginationOptions {
  page?: number;
  limit?: number;
}

export interface PaginatedMediaResult {
  data: MediaDTO[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class MediaRepository {
  constructor(public client: any = prisma) {}

  async getAllMedia(options: MediaPaginationOptions = {}): Promise<PaginatedMediaResult> {
    let page = Math.floor(Number(options.page));
    if (isNaN(page) || page < 1) {
      page = 1;
    }

    let limit = Math.floor(Number(options.limit));
    if (isNaN(limit) || limit < 1) {
      limit = 20;
    }
    if (limit > 100) {
      limit = 100;
    }

    const skip = (page - 1) * limit;
    const take = limit;

    const [total, mediaList] = await Promise.all([
      this.client.media.count(),
      this.client.media.findMany({
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const data = mediaList.map((m: any) => MediaSchema.parse(m));
    const totalPages = total > 0 ? Math.ceil(total / limit) : 0;

    return {
      data,
      total,
      page,
      limit,
      totalPages,
    };
  }

  async createMedia(data: Omit<MediaDTO, 'id' | 'createdAt' | 'updatedAt' | 'isSample'> & { isSample?: boolean }, author: string = 'System') {
    return executeInTransaction(this.client, async (tx) => {
      const media = await tx.media.create({ data });
      await createAuditSnapshot('Media', media.id, media, author, tx);
      return MediaSchema.parse(media);
    });
  }

  async updateMedia(id: string, data: Partial<Omit<MediaDTO, 'id' | 'createdAt' | 'updatedAt' | 'isSample'> & { isSample?: boolean }>, author: string = 'System') {
    return executeInTransaction(this.client, async (tx) => {
      const media = await tx.media.update({ where: { id }, data });
      await createAuditSnapshot('Media', id, media, author, tx);
      return MediaSchema.parse(media);
    });
  }

  async deleteMedia(id: string, author: string = 'System') {
    return executeInTransaction(this.client, async (tx) => {
      const media = await tx.media.delete({ where: { id } });
      await createAuditSnapshot('Media', id, { deleted: true, ...media }, author, tx);
      return MediaSchema.parse(media);
    });
  }
}

export const mediaRepository = new MediaRepository();
