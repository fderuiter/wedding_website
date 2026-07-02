import { z } from 'zod';

export const WeatherSchema = z.object({
  id: z.string(),
});
