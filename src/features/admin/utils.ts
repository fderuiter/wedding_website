import { prisma } from '@/lib/prisma';

export async function handleMediaFields(data: any, idField: string, urlField: string, altField: string, decField: string) {
  let mediaId = data[idField];
  const url = data[urlField];
  const alt = data[altField];
  const dec = data[decField];
  
  if (url || alt !== undefined || dec !== undefined) {
    if (mediaId) {
      await prisma.media.update({
        where: { id: mediaId },
        data: {
          ...(url !== undefined && { url }),
          ...(alt !== undefined && { altText: alt }),
          ...(dec !== undefined && { isDecorative: dec }),
        }
      });
    } else {
      const media = await prisma.media.create({
        data: {
          url: url || '/images/placeholder.png',
          altText: alt || null,
          isDecorative: dec || false,
        }
      });
      mediaId = media.id;
    }
  } else if (!mediaId) {
    const media = await prisma.media.create({
      data: {
        url: '/images/placeholder.png',
        isDecorative: true
      }
    });
    mediaId = media.id;
  }
  
  const mapped = { ...data, [idField]: mediaId };
  delete mapped[urlField];
  delete mapped[altField];
  delete mapped[decField];
  delete mapped.photo;
  delete mapped.image;
  return mapped;
}
