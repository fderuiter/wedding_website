import { MediaDTO } from '@/features/media';

/**
 * Factory for creating mock Media DTO objects.
 */
export function createMockMedia(overrides?: Partial<MediaDTO>): MediaDTO {
  return {
    id: 'media-123',
    url: 'https://example.com/test-image.jpg',
    altText: 'Test Alt Text',
    isDecorative: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

/**
 * Factory for creating mock Registry Item raw payloads with image association fields.
 */
export function createMockRegistryPayload(overrides?: Record<string, any>): Record<string, any> {
  return {
    title: 'Kitchen Stand Mixer',
    price: 299.99,
    quantity: 1,
    category: 'Kitchen',
    url: 'https://example.com/mixer',
    imageId: null,
    imageUrl: 'https://example.com/mixer.jpg',
    imageAlt: 'Red Stand Mixer',
    imageDecorative: false,
    image: { id: 'media-registry-1', url: 'https://example.com/mixer.jpg' },
    ...overrides,
  };
}

/**
 * Factory for creating mock Attraction raw payloads with image association fields.
 */
export function createMockAttractionPayload(overrides?: Record<string, any>): Record<string, any> {
  return {
    title: 'Botanical Gardens',
    description: 'Beautiful local flora and walking trails.',
    category: 'Sightseeing',
    address: '123 Park Ave, Cityville',
    imageId: null,
    imageUrl: 'https://example.com/gardens.jpg',
    imageAlt: 'Greenhouse blooming flowers',
    imageDecorative: false,
    image: { id: 'media-attraction-1', url: 'https://example.com/gardens.jpg' },
    ...overrides,
  };
}

/**
 * Factory for creating mock Wedding Party raw payloads with photo association fields.
 */
export function createMockWeddingPartyPayload(overrides?: Record<string, any>): Record<string, any> {
  return {
    name: 'John Smith',
    role: 'Best Man',
    bio: 'Friend of the groom since childhood.',
    order: 1,
    photoId: null,
    photoUrl: 'https://example.com/john.jpg',
    photoAlt: 'Portrait of John Smith',
    photoDecorative: false,
    photo: { id: 'media-photo-1', url: 'https://example.com/john.jpg' },
    ...overrides,
  };
}
