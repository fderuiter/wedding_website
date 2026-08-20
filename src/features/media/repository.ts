import { MediaDTO, MediaSchema } from './schemas';
import { createAuditSnapshot } from '@/lib/audit';
import { executeInTransaction } from '@/lib/transaction';

export class MediaRepository {
  constructor(public client?: any) {}

  private async getClient() {
    return this.client || (await import('@/lib/prisma')).prisma;
  }

  async getAllMedia() {
    const client = await this.getClient();
    const mediaList = await client.media.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return mediaList.map((m: any) => MediaSchema.parse(m));
  }

  async createMedia(data: Omit<MediaDTO, 'id' | 'createdAt' | 'updatedAt'>, author: string = 'System') {
    const client = await this.getClient();
    return executeInTransaction(client, async (tx) => {
      const media = await tx.media.create({ data });
      await createAuditSnapshot('Media', media.id, media, author, tx);
      return MediaSchema.parse(media);
    });
  }

  async updateMedia(id: string, data: Partial<Omit<MediaDTO, 'id' | 'createdAt' | 'updatedAt'>>, author: string = 'System') {
    const client = await this.getClient();
    return executeInTransaction(client, async (tx) => {
      const media = await tx.media.update({ where: { id }, data });
      await createAuditSnapshot('Media', id, media, author, tx);
      return MediaSchema.parse(media);
    });
  }

  async deleteMedia(id: string, author: string = 'System') {
    const client = await this.getClient();
    return executeInTransaction(client, async (tx) => {
      const media = await tx.media.delete({ where: { id } });
      await createAuditSnapshot('Media', id, { deleted: true, ...media }, author, tx);
      return MediaSchema.parse(media);
    });
  }
}

export const mediaRepository = new MediaRepository();
