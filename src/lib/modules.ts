import { z } from 'zod';

const FeatureIdSchema = z.enum([
  'registry',
  'groupGifting',
  'guestPasscode',
  'weather',
  'weddingParty',
  'attractions',
  'gallery',
  'countdown',
  'addToCalendar',
  'interactive3D',
]);

export type FeatureId = z.infer<typeof FeatureIdSchema>;

export interface FeatureMetadata {
  id: FeatureId;
  title: string;
  description: string;
  category: 'core' | 'engagement' | 'information' | 'experience';
  dependencies?: FeatureId[];
}

export const FEATURE_METADATA: Record<FeatureId, FeatureMetadata> = {
  registry: {
    id: 'registry',
    title: 'Gift Registry',
    description: 'Custom gift registry system for guests to view and contribute to items.',
    category: 'core',
  },
  groupGifting: {
    id: 'groupGifting',
    title: 'Group Gifting',
    description: 'Allows guests to make partial monetary contributions towards high-value registry items.',
    category: 'core',
    dependencies: ['registry'],
  },
  guestPasscode: {
    id: 'guestPasscode',
    title: 'Guest Passcode Access Gate',
    description: 'Protects the wedding website behind a guest passcode login requirement.',
    category: 'core',
  },
  weather: {
    id: 'weather',
    title: 'Weather Forecast',
    description: 'Provides live weather forecast integration for the wedding date & venue location.',
    category: 'information',
  },
  weddingParty: {
    id: 'weddingParty',
    title: 'Wedding Party Roster',
    description: 'Displays biographies and photos for members of the wedding party.',
    category: 'information',
  },
  attractions: {
    id: 'attractions',
    title: 'Local Attractions & Things to Do',
    description: 'Guide for out-of-town guests with recommendations, directions, and categories.',
    category: 'information',
  },
  gallery: {
    id: 'gallery',
    title: 'Photo Gallery & Media',
    description: 'Photo gallery displaying event photos and custom media uploads.',
    category: 'engagement',
  },
  countdown: {
    id: 'countdown',
    title: 'Homepage Countdown Timer',
    description: 'Live countdown timer to the wedding date on the homepage.',
    category: 'engagement',
  },
  addToCalendar: {
    id: 'addToCalendar',
    title: 'Add to Calendar Widget',
    description: 'ICS/Google Calendar generator for ceremony and reception event details.',
    category: 'engagement',
  },
  interactive3D: {
    id: 'interactive3D',
    title: 'Interactive 3D Experiences',
    description: 'Interactive 3D canvas and Heart page experience using React Three Fiber.',
    category: 'experience',
  },
};

export const FEATURE_DEPENDENCIES: Partial<Record<FeatureId, FeatureId[]>> = {
  groupGifting: ['registry'],
};

export const ModuleConfigSchema = z.object({
  registry: z.boolean().default(true),
  groupGifting: z.boolean().default(true),
  guestPasscode: z.boolean().default(true),
  weather: z.boolean().default(true),
  weddingParty: z.boolean().default(true),
  attractions: z.boolean().default(true),
  gallery: z.boolean().default(true),
  countdown: z.boolean().default(true),
  addToCalendar: z.boolean().default(true),
  interactive3D: z.boolean().default(true),
});

export type ModuleConfig = z.infer<typeof ModuleConfigSchema>;

export const DEFAULT_MODULE_CONFIG: ModuleConfig = {
  registry: true,
  groupGifting: true,
  guestPasscode: true,
  weather: true,
  weddingParty: true,
  attractions: true,
  gallery: true,
  countdown: true,
  addToCalendar: true,
  interactive3D: true,
};

/**
 * Resolves and validates module configuration, enforcing explicit feature dependencies.
 *
 * Dependency rules:
 * - If `registry` is false, `groupGifting` is automatically resolved to false.
 */
export function resolveModuleConfig(input?: unknown): ModuleConfig {
  let parsedInput: Record<string, unknown> = {};

  if (typeof input === 'string') {
    try {
      parsedInput = JSON.parse(input);
    } catch {
      parsedInput = {};
    }
  } else if (input && typeof input === 'object') {
    parsedInput = input as Record<string, unknown>;
  }

  const result = ModuleConfigSchema.safeParse(parsedInput);
  const config = result.success ? result.data : { ...DEFAULT_MODULE_CONFIG };

  // Explicit Dependency Enforcement
  if (FEATURE_DEPENDENCIES.groupGifting?.includes('registry') && !config.registry) {
    config.groupGifting = false;
  }

  return config;
}

/**
 * Check if a specific feature module is enabled in the effective configuration.
 */
export function isFeatureEnabled(featureId: FeatureId, config?: unknown): boolean {
  if (!FeatureIdSchema.safeParse(featureId).success) {
    return false;
  }
  const resolved = resolveModuleConfig(config);
  return Boolean(resolved[featureId]);
}

/**
 * Get a list of currently disabled feature module IDs.
 */
export function getDisabledFeatures(config?: unknown): FeatureId[] {
  const resolved = resolveModuleConfig(config);
  return (Object.keys(FEATURE_METADATA) as FeatureId[]).filter(
    (id) => !resolved[id]
  );
}

/**
 * Validate proposed module config updates, returning error messages for any broken dependencies.
 */
export function validateModuleDependencies(
  proposed: Partial<ModuleConfig>
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (proposed.groupGifting === true && proposed.registry === false) {
    errors.push("Feature 'groupGifting' requires feature 'registry' to be enabled.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
