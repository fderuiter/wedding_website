import { prisma } from '@/lib/prisma';
import { MediaDTO, MediaSchema } from './schemas';

class MediaRepository {
  constructor(public client: any = prisma) {}

  withClient(client: any): this {
    return new (this.constructor as any)(client);
  }

  async getAllMedia() {
    const mediaList = await this.client.media.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return mediaList.map((m: any) => MediaSchema.parse(m));
  }

  async getMediaById(id: string) {
    const media = await this.client.media.findUnique({ where: { id } });
    return media ? MediaSchema.parse(media) : null;
  }

  async createMedia(data: Omit<MediaDTO, 'id' | 'createdAt' | 'updatedAt'>) {
    const media = await this.client.media.create({ data });
    return MediaSchema.parse(media);
  }

  async updateMedia(id: string, data: Partial<Omit<MediaDTO, 'id' | 'createdAt' | 'updatedAt'>>) {
    const media = await this.client.media.update({ where: { id }, data });
    return MediaSchema.parse(media);
  }

  async deleteMedia(id: string) {
    const media = await this.client.media.delete({ where: { id } });
    return MediaSchema.parse(media);
  }
}

export const mediaRepository = new MediaRepository();
