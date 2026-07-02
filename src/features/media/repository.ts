import { prisma } from '@/lib/prisma';
import { MediaDTO, MediaSchema } from './schemas';

export class MediaRepository {
  async getAllMedia() {
    const mediaList = await prisma.media.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return mediaList.map(m => MediaSchema.parse(m));
  }

  async getMediaById(id: string) {
    const media = await prisma.media.findUnique({ where: { id } });
    return media ? MediaSchema.parse(media) : null;
  }

  async createMedia(data: Omit<MediaDTO, 'id' | 'createdAt' | 'updatedAt'>) {
    const media = await prisma.media.create({ data });
    return MediaSchema.parse(media);
  }

  async updateMedia(id: string, data: Partial<Omit<MediaDTO, 'id' | 'createdAt' | 'updatedAt'>>) {
    const media = await prisma.media.update({ where: { id }, data });
    return MediaSchema.parse(media);
  }

  async deleteMedia(id: string) {
    const media = await prisma.media.delete({ where: { id } });
    return MediaSchema.parse(media);
  }
}

export const mediaRepository = new MediaRepository();
