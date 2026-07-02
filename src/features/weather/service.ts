import { BaseService } from '@/core/infrastructure/service';
import { WeatherRepository } from './repository';
import { Weather } from './types';

export class WeatherService extends BaseService<Weather> {
  constructor(repo: WeatherRepository) {
    super(repo, 'Weather');
  }
}
