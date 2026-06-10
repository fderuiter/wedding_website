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

export function getEntityService(entityKey: string) {
  const config = entityConfigs[entityKey];
  if (!config) return null;

  const repo = new BaseRepository(config.modelName);
  return {
    service: new BaseService(repo, config.entityType),
    config
  };
}
