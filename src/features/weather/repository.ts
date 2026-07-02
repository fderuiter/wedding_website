import { BaseRepository } from '@/features/admin';
import { Weather } from './types';

export class WeatherRepository extends BaseRepository<Weather> {
  constructor() {
    super('weather');
  }
}
