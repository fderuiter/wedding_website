import { prisma } from '@/lib/prisma';
import { createAuditSnapshot } from '@/lib/audit';
import { MediaSchema } from '@/features/media/schemas';

export async function handleMediaFields(
  data: any,
  idField: string,
  urlField: string,
  altField: string,
  decField: string,
  client: any = prisma,
  author: string = 'Admin'
) {
  const db = client || prisma;
  let mediaId = data[idField];
  const url = data[urlField];
  const alt = data[altField];
  const dec = data[decField];
  
  if (url || alt !== undefined || dec !== undefined) {
    if (mediaId) {
      const media = await db.media.update({
        where: { id: mediaId },
        data: {
          ...(url !== undefined && { url }),
          ...(alt !== undefined && { altText: alt }),
          ...(dec !== undefined && { isDecorative: dec }),
        }
      });
      MediaSchema.parse(media);
      await createAuditSnapshot('Media', mediaId, media, author, db);
    } else {
      const media = await db.media.create({
        data: {
          url: url || '/images/placeholder.png',
          altText: alt || null,
          isDecorative: dec || false,
        }
      });
      mediaId = media.id;
      MediaSchema.parse(media);
      await createAuditSnapshot('Media', mediaId, media, author, db);
    }
  } else if (!mediaId) {
    const media = await db.media.create({
      data: {
        url: '/images/placeholder.png',
        isDecorative: true
      }
    });
    mediaId = media.id;
    MediaSchema.parse(media);
    await createAuditSnapshot('Media', mediaId, media, author, db);
  }
  
  const mapped = { ...data, [idField]: mediaId };
  delete mapped[urlField];
  delete mapped[altField];
  delete mapped[decField];
  delete mapped.photo;
  delete mapped.image;
  return mapped;
}
