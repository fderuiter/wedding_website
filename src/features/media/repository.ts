import { MediaDTO, MediaSchema } from './schemas';

async function getPrisma() {
  if (typeof window !== 'undefined') {
    throw new Error('Prisma repository cannot be executed on the client');
  }
  if (process.env.JEST_WORKER_ID) {
    const req = eval('require');
    return req('@/lib/prisma').prisma;
  }
  const { prisma } = await (0, eval)('import("../../lib/prisma")');
  return prisma;
}

async function getAuditSnapshot() {
  if (typeof window !== 'undefined') {
    throw new Error('Audit snapshot cannot be executed on the client');
  }
  if (process.env.JEST_WORKER_ID) {
    const req = eval('require');
    return req('@/lib/audit').createAuditSnapshot;
  }
  const { createAuditSnapshot } = await (0, eval)('import("../../lib/audit")');
  return createAuditSnapshot;
}

export class MediaRepository {
  constructor(public client?: any) {}

  private async getClient() {
    return this.client || (await getPrisma());
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
    const createAuditSnapshot = await getAuditSnapshot();
    const { executeInTransaction } = await import('@/lib/transaction');
    return executeInTransaction(client, async (tx) => {
      const media = await tx.media.create({ data });
      await createAuditSnapshot('Media', media.id, media, author, tx);
      return MediaSchema.parse(media);
    });
  }

  async updateMedia(id: string, data: Partial<Omit<MediaDTO, 'id' | 'createdAt' | 'updatedAt'>>, author: string = 'System') {
    const client = await this.getClient();
    const createAuditSnapshot = await getAuditSnapshot();
    const { executeInTransaction } = await import('@/lib/transaction');
    return executeInTransaction(client, async (tx) => {
      const media = await tx.media.update({ where: { id }, data });
      await createAuditSnapshot('Media', id, media, author, tx);
      return MediaSchema.parse(media);
    });
  }

  async deleteMedia(id: string, author: string = 'System') {
    const client = await this.getClient();
    const createAuditSnapshot = await getAuditSnapshot();
    const { executeInTransaction } = await import('@/lib/transaction');
    return executeInTransaction(client, async (tx) => {
      const media = await tx.media.delete({ where: { id } });
      await createAuditSnapshot('Media', id, { deleted: true, ...media }, author, tx);
      return MediaSchema.parse(media);
    });
  }
}
