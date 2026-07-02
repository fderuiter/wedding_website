import { BaseService } from '@/core/infrastructure/service';
import { BaseRepository } from '@/core/infrastructure/repository';
import { handleMediaFields } from '@/features/admin/utils';
import { coordinateSchema } from '@/utils/validation';

function validateCoordinates(data: any): string | null {
  const parsedLat = coordinateSchema.safeParse(data.latitude || 0);
  const parsedLon = coordinateSchema.safeParse(data.longitude || 0);
  if (!parsedLat.success && !parsedLon.success) {
    return 'Invalid coordinate format for latitude and longitude. Must be a numeric value or a placeholder.';
  }
  if (!parsedLat.success) {
    return 'Invalid coordinate format for latitude. Must be a numeric value or a placeholder.';
  }
  if (!parsedLon.success) {
    return 'Invalid coordinate format for longitude. Must be a numeric value or a placeholder.';
  }
  return null;
}

async function mapAttractionData(data: any): Promise<any> {
  const parsedLat = coordinateSchema.safeParse(data.latitude || 0);
  const parsedLon = coordinateSchema.safeParse(data.longitude || 0);
  const mapped = await handleMediaFields(data, 'imageId', 'imageUrl', 'imageAlt', 'imageDecorative');
  return {
    ...mapped,
    latitude: parsedLat.success ? parsedLat.data : 0,
    longitude: parsedLon.success ? parsedLon.data : 0,
  };
}

export class AttractionAdminService extends BaseService<any> {
    static ENTITY_KEY = 'attractions';
    
    constructor() {
        super(new BaseRepository('attraction'), 'Attraction');
    }

    async findMany(args?: any): Promise<any[]> {
        const customArgs = {
            ...args,
            include: { image: true, ...(args?.include || {}) }
        };
        return super.findMany(customArgs);
    }

    async create(data: any, author?: string): Promise<any> {
        const error = validateCoordinates(data);
        if (error) throw new Error(`Validation Error: ${error}`);
        
        const mappedData = await mapAttractionData(data);
        return super.create(mappedData, author);
    }

    async update(id: string, data: any, author?: string): Promise<any> {
        const error = validateCoordinates(data);
        if (error) throw new Error(`Validation Error: ${error}`);
        
        const mappedData = await mapAttractionData(data);
        return super.update(id, mappedData, author);
    }
}
export default AttractionAdminService;
