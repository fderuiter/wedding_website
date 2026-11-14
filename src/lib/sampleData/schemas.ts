import { z } from 'zod';

export const SampleDataGenerateSchema = z.object({
  archetype: z.enum(['classic', 'destination', 'romantic']).optional().default('classic'),
  modules: z.array(z.string()).optional(),
});
