import { prisma } from '@/lib/prisma';
import { MediaDTO, MediaSchema } from './schemas';
import { executeInTransaction } from '@/lib/transaction';
import { createAuditSnapshot } from '@/lib/audit';

export class MediaRepository {
  constructor(public client: any = prisma) {}

  async getAllMedia() {
    const mediaList = await this.client.media.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return mediaList.map((m: any) => MediaSchema.parse(m));
  }

  async createMedia(data: Omit<MediaDTO, 'id' | 'createdAt' | 'updatedAt'>, author: string = 'System') {
    return executeInTransaction(this.client, async (tx) => {
      const media = await tx.media.create({ data });
      await createAuditSnapshot('Media', media.id, media, author, tx);
      return MediaSchema.parse(media);
    });
  }

  async updateMedia(id: string, data: Partial<Omit<MediaDTO, 'id' | 'createdAt' | 'updatedAt'>>, author: string = 'System') {
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
