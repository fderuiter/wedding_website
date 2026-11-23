import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { handleMediaFields } from '@/features/admin';
import { getAppConfig } from '@/lib/config';
import { geocodeBestMatch } from '@/lib/geocoding';
import { hasValidCoordinates, isNonPlaceholderVenueText } from '@/utils/maps';
import { AttractionInputSchema, AttractionDTO } from './schemas';

async function mapAttractionData(data: any, client?: any, author?: string): Promise<any> {
  const mapped = await handleMediaFields(data, 'imageId', 'imageUrl', 'imageAlt', 'imageDecorative', client, author);

  if (
    mapped &&
    typeof mapped === 'object' &&
    mapped.latitude !== undefined &&
    mapped.longitude !== undefined &&
    !hasValidCoordinates(mapped.latitude, mapped.longitude)
  ) {
    const rawDirections = typeof mapped.directions === 'string' ? mapped.directions.trim() : '';
    const isDirectionsText =
      isNonPlaceholderVenueText(rawDirections) &&
      !rawDirections.startsWith('http://') &&
      !rawDirections.startsWith('https://') &&
      !rawDirections.startsWith('//') &&
      !rawDirections.startsWith('/');

    let venueCity = '';
    let venueState = '';
    if (!isDirectionsText && isNonPlaceholderVenueText(mapped.name)) {
      try {
        const config = await getAppConfig();
        venueCity = config.venueCity || '';
        venueState = config.venueState || '';
      } catch {
        // Ignore config lookup errors in isolated contexts
      }
    }

    const match = await geocodeBestMatch(
      isDirectionsText
        ? [mapped.name, rawDirections]
        : [mapped.name, venueCity, venueState]
    );

    if (match) {
      mapped.latitude = match.latitude;
      mapped.longitude = match.longitude;
    }
  }

  return mapped;
}

export class AttractionAdminService extends BaseService<AttractionDTO> {
  static ENTITY_KEY = 'attractions';
  
  protected defaultQueryArgs = {
    include: { image: true }
  };
    
  constructor() {
    super(new BaseRepository<AttractionDTO>('attraction'), 'Attraction', AttractionInputSchema);
  }

  protected async preSave(data: any, client?: any, author?: string): Promise<any> {
    return await mapAttractionData(data, client, author);
  }
}
