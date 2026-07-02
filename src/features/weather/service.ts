import { BaseService } from '@/features/admin';
import { WeatherRepository } from './repository';
import { Weather } from './types';

export class WeatherService extends BaseService<Weather> {
  constructor(repo: WeatherRepository) {
    super(repo, 'Weather');
  }
}
