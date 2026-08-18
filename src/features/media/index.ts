export * from './schemas';

export class MediaRepository {
  private repoPromise?: Promise<any>;

  constructor(private client?: any) {}

  private async getRepo() {
    if (!this.repoPromise) {
      if (typeof window !== 'undefined') {
        throw new Error('MediaRepository cannot be used on client');
      }
      if (process.env.JEST_WORKER_ID) {
        const req = eval('require');
        this.repoPromise = Promise.resolve(req('./repository')).then((m: any) => new m.MediaRepository(this.client));
      } else {
        this.repoPromise = (0, eval)('import("./repository")').then((m: any) => new m.MediaRepository(this.client));
      }
    }
    return this.repoPromise;
  }

  async getAllMedia() {
    const repo = await this.getRepo();
    return repo.getAllMedia();
  }

  async createMedia(data: any, author: string = 'System') {
    const repo = await this.getRepo();
    return repo.createMedia(data, author);
  }

  async updateMedia(id: string, data: any, author: string = 'System') {
    const repo = await this.getRepo();
    return repo.updateMedia(id, data, author);
  }

  async deleteMedia(id: string, author: string = 'System') {
    const repo = await this.getRepo();
    return repo.deleteMedia(id, author);
  }
}

export const mediaRepository = new MediaRepository();
