import { z } from 'zod';

export const DIETARY_TAG_OPTIONS = [
  'gluten-free',
  'vegetarian',
  'vegan',
  'dairy-free',
  'nut-free',
  'halal',
  'kosher',
  'kids',
] as const;

export type DietaryTagOption = (typeof DIETARY_TAG_OPTIONS)[number];

export const MAX_RSVP_PLUS_ONE_COUNT = 20;

export const MealOptionSchema = z.object({
  id: z.string().trim().min(1, 'Meal option ID is required.').max(100),
  label: z.string().trim().min(1, 'Meal option label is required.').max(120),
  description: z.string().trim().max(300).optional(),
  dietaryTags: z.array(z.string().trim().min(1).max(50)).optional().default([]),
});

export type MealOptionDTO = z.infer<typeof MealOptionSchema>;

export const CustomRsvpQuestionSchema = z
  .object({
    id: z.string().trim().min(1, 'Question ID is required.').max(100),
    prompt: z.string().trim().min(1, 'Question prompt is required.').max(300),
    type: z.enum(['text', 'choice']).default('text'),
    required: z.boolean().optional().default(false),
    options: z.array(z.string().trim().min(1).max(150)).optional().default([]),
  })
  .superRefine((question, ctx) => {
    if (question.type === 'choice' && question.options.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Multiple-choice questions require at least one option.',
      });
    }
  });

export type CustomRsvpQuestionDTO = z.infer<typeof CustomRsvpQuestionSchema>;

export function normalizeMealOptions(raw: unknown): MealOptionDTO[] {
  if (!Array.isArray(raw)) return [];
  const parsed: MealOptionDTO[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const result = MealOptionSchema.safeParse(entry);
    if (!result.success) continue;
    const id = result.data.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    const uniqueTags = Array.from(
      new Set(
        result.data.dietaryTags
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      )
    );
    parsed.push({
      id,
      label: result.data.label.trim(),
      description: (result.data.description ?? '').trim(),
      dietaryTags: uniqueTags,
    });
  }
  return parsed;
}

export function normalizeCustomQuestions(raw: unknown): CustomRsvpQuestionDTO[] {
  if (!Array.isArray(raw)) return [];
  const parsed: CustomRsvpQuestionDTO[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const result = CustomRsvpQuestionSchema.safeParse(entry);
    if (!result.success) continue;
    const id = result.data.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    const uniqueOptions =
      result.data.type === 'choice'
        ? Array.from(new Set(result.data.options.map((o) => o.trim()).filter(Boolean)))
        : [];
    if (result.data.type === 'choice' && uniqueOptions.length === 0) continue;
    parsed.push({
      id,
      prompt: result.data.prompt.trim(),
      type: result.data.type,
      required: Boolean(result.data.required),
      options: uniqueOptions,
    });
  }
  return parsed;
}

export function normalizeMealSelections(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => (typeof item === 'string' ? item.trim() : ''));
}

export function normalizeCustomAnswers(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    const trimmedKey = key.trim();
    if (!trimmedKey || typeof val !== 'string') continue;
    const trimmedVal = val.trim();
    if (trimmedVal) {
      out[trimmedKey] = trimmedVal;
    }
  }
  return out;
}

export function normalizePlusOneNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => (typeof item === 'string' ? item.trim() : ''));
}
