import { MediaRepository } from '@/features/media';

export async function handleMediaFields(
  data: any,
  idField: string,
  urlField: string,
  altField: string,
  decField: string,
  client?: any,
  author: string = 'Admin'
) {
  const db = client || (await import('@/lib/prisma')).prisma;
  const mediaRepo = new MediaRepository(db);
  let mediaId = data[idField];
  const url = data[urlField];
  const alt = data[altField];
  const dec = data[decField];
  
  if (url || alt !== undefined || dec !== undefined) {
    if (mediaId) {
      await mediaRepo.updateMedia(mediaId, {
        ...(url !== undefined && { url }),
        ...(alt !== undefined && { altText: alt }),
        ...(dec !== undefined && { isDecorative: dec }),
      }, author);
    } else {
      const media = await mediaRepo.createMedia({
        url: url || '/images/placeholder.png',
        altText: alt || null,
        isDecorative: dec || false,
      }, author);
      mediaId = media.id;
    }
  } else if (!mediaId) {
    const media = await mediaRepo.createMedia({
      url: '/images/placeholder.png',
      altText: null,
      isDecorative: true
    }, author);
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
