import { BaseRepository, BaseService } from './core';

export interface EntityConfig {
  modelName: string;
  entityType: string;
  // declarative custom validation or mapping can be added here
  validateCreate?: (data: any) => string | null;
  validateUpdate?: (data: any) => string | null;
}

const entityConfigs: Record<string, EntityConfig> = {
  'wedding-party': {
    modelName: 'weddingPartyMember',
    entityType: 'WeddingPartyMember',
  },
  'attractions': {
    modelName: 'attraction',
    entityType: 'Attraction',
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
