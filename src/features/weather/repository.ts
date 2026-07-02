import { BaseRepository } from '@/core/infrastructure/repository';
import { Weather } from './types';
import { prisma } from '@/lib/prisma';

export class WeatherRepository extends BaseRepository<Weather> {
  constructor(client: any = prisma) {
    super('weather', client);
  }

  withClient(client: any): this {
    return new (this.constructor as any)(client);
  }
}
