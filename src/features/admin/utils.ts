export async function handleMediaFields(
  data: any,
  idField: string,
  urlField: string,
  altField: string,
  decField: string,
  client?: any,
  author: string = 'Admin'
) {
  const getDb = async () => {
    if (client) return client;
    if (process.env.JEST_WORKER_ID) {
      const req = eval('require');
      return req('@/lib/prisma').prisma;
    }
    const { prisma } = await (0, eval)('import("../../lib/prisma")');
    return prisma;
  };
  const getMediaRepoClass = async () => {
    if (process.env.JEST_WORKER_ID) {
      const req = eval('require');
      return req('@/features/media').MediaRepository;
    }
    const { MediaRepository } = await (0, eval)('import("../media")');
    return MediaRepository;
  };

  const db = await getDb();
  const MediaRepository = await getMediaRepoClass();
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
