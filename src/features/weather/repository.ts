import { BaseRepository } from '@/core/infrastructure/repository';
import { Weather } from './types';

export class WeatherRepository extends BaseRepository<Weather> {
  constructor() {
    super('weather');
  }
}
