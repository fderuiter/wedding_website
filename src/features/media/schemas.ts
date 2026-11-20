import { z } from 'zod';
import { isSafeMediaOrPhotoUrl } from '@/utils/validation';

const mediaUrlInputSchema = z
  .string()
  .trim()
  .min(1, 'Media URL is required')
  .max(2000, 'Media URL must be under 2000 characters')
  .refine(
    (val) =>
      isSafeMediaOrPhotoUrl(val) &&
      (val.startsWith('/') ||
        val.startsWith('http://') ||
        val.startsWith('https://') ||
        val.startsWith('data:image/')),
    { message: 'Invalid media URL format' }
  );

export const MediaSchema = z.object({
  id: z.string(),
  url: z.string(),
  altText: z.string().nullable(),
  isDecorative: z.boolean(),
  isSample: z.boolean().optional().default(false),
  publishToGallery: z.boolean().optional(),
  createdAt: z.union([z.date(), z.string()]).optional(),
  updatedAt: z.union([z.date(), z.string()]).optional(),
});

export type MediaDTO = z.infer<typeof MediaSchema>;

export const MediaCreateSchema = z.object({
  url: mediaUrlInputSchema,
  altText: z.string().nullable(),
  isDecorative: z.boolean().default(false),
  publishToGallery: z.boolean().optional(),
});

export const MediaUpdateSchema = MediaCreateSchema.partial();

const ImageAssociationSchema = z.object({
  imageId: z.string().nullable().optional(),
  imageUrl: z.string()
    .max(2000, 'Image URL must be under 2000 characters')
    .optional()
    .nullable()
    .or(z.literal('')),
  imageAlt: z.string().optional().nullable(),
  imageDecorative: z.boolean().optional(),
  image: MediaSchema.nullable().optional(),
});

const PhotoAssociationSchema = z.object({
  photoId: z.string().nullable().optional(),
  photoUrl: z.string()
    .max(2000, 'Photo URL must be under 2000 characters')
    .optional()
    .nullable()
    .or(z.literal('')),
  photoAlt: z.string().optional().nullable(),
  photoDecorative: z.boolean().optional(),
  photo: MediaSchema.nullable().optional(),
});

export function createMediaAssociationSchema(prefix: 'image'): typeof ImageAssociationSchema;
export function createMediaAssociationSchema(prefix: 'photo'): typeof PhotoAssociationSchema;
export function createMediaAssociationSchema(prefix: 'image' | 'photo') {
  return prefix === 'image' ? ImageAssociationSchema : PhotoAssociationSchema;
}

