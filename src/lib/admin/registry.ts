import { BaseRepository, BaseService } from './core';
import { coordinateSchema } from '@/utils/validation';

export interface EntityConfig {
  modelName: string;
  entityType: string;
  // declarative custom validation or mapping can be added here
  validateCreate?: (data: any) => string | null;
  validateUpdate?: (data: any) => string | null;
  mapData?: (data: any) => any;
}

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

function mapAttractionData(data: any): any {
  const parsedLat = coordinateSchema.safeParse(data.latitude || 0);
  const parsedLon = coordinateSchema.safeParse(data.longitude || 0);
  return {
    ...data,
    latitude: parsedLat.success ? parsedLat.data : 0,
    longitude: parsedLon.success ? parsedLon.data : 0,
  };
}

const entityConfigs: Record<string, EntityConfig> = {
  'wedding-party': {
    modelName: 'weddingPartyMember',
    entityType: 'WeddingPartyMember',
  },
  'attractions': {
    modelName: 'attraction',
    entityType: 'Attraction',
    validateCreate: validateCoordinates,
    validateUpdate: validateCoordinates,
    mapData: mapAttractionData,
  },
  'registry-items': {
    modelName: 'registryItem',
    entityType: 'RegistryItem',
  },
  'content-nodes': {
    modelName: 'contentNode',
    entityType: 'ContentNode',
  }
};

/**
 * Retrieve the service and configuration for a registered admin entity key.
 *
 * @param entityKey - The registry key identifying the entity (e.g., 'wedding-party', 'attractions', 'registry-items', 'content-nodes')
 * @returns An object containing `service` (a BaseService instance) and `config` (the EntityConfig) for the given key, or `null` if the key is not registered
 */
export function getEntityService(entityKey: string) {
  const config = entityConfigs[entityKey];
  if (!config) return null;

  const repo = new BaseRepository(config.modelName);
  return {
    service: new BaseService(repo, config.entityType),
    config
  };
}
