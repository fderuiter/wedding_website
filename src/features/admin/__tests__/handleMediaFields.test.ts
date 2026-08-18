/** @jest-environment node */

import { handleMediaFields } from '../utils';
import {
  createMockMedia,
  createMockRegistryPayload,
  createMockAttractionPayload,
  createMockWeddingPartyPayload,
} from '@/testing/factories/mediaFactory';

const mockCreateMedia = jest.fn();
const mockUpdateMedia = jest.fn();

jest.mock('@/features/media', () => {
  return {
    MediaRepository: jest.fn().mockImplementation(() => ({
      createMedia: (...args: any[]) => mockCreateMedia(...args),
      updateMedia: (...args: any[]) => mockUpdateMedia(...args),
    })),
  };
});

describe('handleMediaFields - Administrative Media Processing Utility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Creation Branching', () => {
    it('creates new media when media fields are present and no mediaId is provided', async () => {
      const payload = createMockRegistryPayload({ imageId: undefined, image: undefined });
      const createdMedia = createMockMedia({ id: 'new-media-id-1' });
      mockCreateMedia.mockResolvedValue(createdMedia);

      const result = await handleMediaFields(
        payload,
        'imageId',
        'imageUrl',
        'imageAlt',
        'imageDecorative',
        null,
        'TestAdmin'
      );

      expect(mockCreateMedia).toHaveBeenCalledTimes(1);
      expect(mockCreateMedia).toHaveBeenCalledWith(
        {
          url: 'https://example.com/mixer.jpg',
          altText: 'Red Stand Mixer',
          isDecorative: false,
        },
        'TestAdmin'
      );
      expect(result.imageId).toBe('new-media-id-1');
    });

    it('creates default placeholder media when no mediaId and no media fields are provided', async () => {
      const payload = { title: 'No Media Item' };
      const placeholderMedia = createMockMedia({
        id: 'placeholder-media-id',
        url: '/images/placeholder.png',
        altText: null,
        isDecorative: true,
      });
      mockCreateMedia.mockResolvedValue(placeholderMedia);

      const result = await handleMediaFields(
        payload,
        'imageId',
        'imageUrl',
        'imageAlt',
        'imageDecorative',
        null,
        'SystemAdmin'
      );

      expect(mockCreateMedia).toHaveBeenCalledTimes(1);
      expect(mockCreateMedia).toHaveBeenCalledWith(
        {
          url: '/images/placeholder.png',
          altText: null,
          isDecorative: true,
        },
        'SystemAdmin'
      );
      expect(result.imageId).toBe('placeholder-media-id');
    });

    it('handles partial media fields during creation (e.g. url provided without alt or dec)', async () => {
      const payload = {
        title: 'Partial Media Item',
        imageUrl: 'https://example.com/partial.jpg',
      };
      const createdMedia = createMockMedia({ id: 'partial-media-id', url: 'https://example.com/partial.jpg' });
      mockCreateMedia.mockResolvedValue(createdMedia);

      const result = await handleMediaFields(
        payload,
        'imageId',
        'imageUrl',
        'imageAlt',
        'imageDecorative',
        null,
        'AdminUser'
      );

      expect(mockCreateMedia).toHaveBeenCalledWith(
        {
          url: 'https://example.com/partial.jpg',
          altText: null,
          isDecorative: false,
        },
        'AdminUser'
      );
      expect(result.imageId).toBe('partial-media-id');
    });
  });

  describe('Modification Branching', () => {
    it('updates existing media when mediaId and media fields are provided', async () => {
      const payload = createMockAttractionPayload({
        imageId: 'existing-attraction-media-id',
        imageUrl: 'https://example.com/updated-gardens.jpg',
        imageAlt: 'Updated Botanical Gardens Alt',
        imageDecorative: true,
      });
      mockUpdateMedia.mockResolvedValue(
        createMockMedia({
          id: 'existing-attraction-media-id',
          url: 'https://example.com/updated-gardens.jpg',
          altText: 'Updated Botanical Gardens Alt',
          isDecorative: true,
        })
      );

      const result = await handleMediaFields(
        payload,
        'imageId',
        'imageUrl',
        'imageAlt',
        'imageDecorative',
        null,
        'UpdaterUser'
      );

      expect(mockUpdateMedia).toHaveBeenCalledTimes(1);
      expect(mockUpdateMedia).toHaveBeenCalledWith(
        'existing-attraction-media-id',
        {
          url: 'https://example.com/updated-gardens.jpg',
          altText: 'Updated Botanical Gardens Alt',
          isDecorative: true,
        },
        'UpdaterUser'
      );
      expect(mockCreateMedia).not.toHaveBeenCalled();
      expect(result.imageId).toBe('existing-attraction-media-id');
    });

    it('updates only defined fields when mediaId is present and partial media fields are updated', async () => {
      const payload = {
        photoId: 'photo-123',
        photoAlt: 'New Alt Only',
      };
      mockUpdateMedia.mockResolvedValue(createMockMedia({ id: 'photo-123', altText: 'New Alt Only' }));

      const result = await handleMediaFields(
        payload,
        'photoId',
        'photoUrl',
        'photoAlt',
        'photoDecorative',
        null,
        'PhotoEditor'
      );

      expect(mockUpdateMedia).toHaveBeenCalledWith(
        'photo-123',
        {
          altText: 'New Alt Only',
        },
        'PhotoEditor'
      );
      expect(result.photoId).toBe('photo-123');
    });

    it('retains existing mediaId and makes no mediaRepo calls when mediaId exists and no media fields are provided', async () => {
      const payload = {
        name: 'Jane Doe',
        photoId: 'existing-photo-id',
      };

      const result = await handleMediaFields(
        payload,
        'photoId',
        'photoUrl',
        'photoAlt',
        'photoDecorative',
        null,
        'Admin'
      );

      expect(mockCreateMedia).not.toHaveBeenCalled();
      expect(mockUpdateMedia).not.toHaveBeenCalled();
      expect(result.photoId).toBe('existing-photo-id');
    });
  });

  describe('Raw Field Key Stripping', () => {
    it('strips Registry raw media form keys (imageUrl, imageAlt, imageDecorative, photo, image) cleanly', async () => {
      const payload = createMockRegistryPayload({
        photo: { url: 'https://example.com/raw-photo.jpg' }, // Extra raw field
        image: { id: 'img-1' },
      });
      mockCreateMedia.mockResolvedValue(createMockMedia({ id: 'registry-media-id' }));

      const result = await handleMediaFields(
        payload,
        'imageId',
        'imageUrl',
        'imageAlt',
        'imageDecorative'
      );

      expect(result).toEqual({
        title: 'Kitchen Stand Mixer',
        price: 299.99,
        quantity: 1,
        category: 'Kitchen',
        url: 'https://example.com/mixer',
        imageId: 'registry-media-id',
      });
      expect(result.imageUrl).toBeUndefined();
      expect(result.imageAlt).toBeUndefined();
      expect(result.imageDecorative).toBeUndefined();
      expect(result.image).toBeUndefined();
      expect(result.photo).toBeUndefined();
    });

    it('strips Attraction raw media form keys cleanly', async () => {
      const payload = createMockAttractionPayload({
        photo: 'raw-photo-field',
      });
      mockCreateMedia.mockResolvedValue(createMockMedia({ id: 'attraction-media-id' }));

      const result = await handleMediaFields(
        payload,
        'imageId',
        'imageUrl',
        'imageAlt',
        'imageDecorative'
      );

      expect(result.imageId).toBe('attraction-media-id');
      expect(result.imageUrl).toBeUndefined();
      expect(result.imageAlt).toBeUndefined();
      expect(result.imageDecorative).toBeUndefined();
      expect(result.image).toBeUndefined();
      expect(result.photo).toBeUndefined();
      expect(result.title).toBe('Botanical Gardens');
    });

    it('strips Wedding Party raw media form keys (photoUrl, photoAlt, photoDecorative, photo, image) cleanly', async () => {
      const payload = createMockWeddingPartyPayload({
        image: 'raw-image-field',
      });
      mockCreateMedia.mockResolvedValue(createMockMedia({ id: 'wedding-party-media-id' }));

      const result = await handleMediaFields(
        payload,
        'photoId',
        'photoUrl',
        'photoAlt',
        'photoDecorative'
      );

      expect(result.photoId).toBe('wedding-party-media-id');
      expect(result.photoUrl).toBeUndefined();
      expect(result.photoAlt).toBeUndefined();
      expect(result.photoDecorative).toBeUndefined();
      expect(result.photo).toBeUndefined();
      expect(result.image).toBeUndefined();
      expect(result.name).toBe('John Smith');
    });
  });

  describe('Transactional Branching & Error Scenarios', () => {
    it('passes transaction client to MediaRepository and propagates errors on creation failure', async () => {
      const mockTxClient = { isTransaction: true };
      const payload = createMockRegistryPayload();
      mockCreateMedia.mockRejectedValue(new Error('Transaction Rollback: Media Create Error'));

      await expect(
        handleMediaFields(
          payload,
          'imageId',
          'imageUrl',
          'imageAlt',
          'imageDecorative',
          mockTxClient,
          'TxAuthor'
        )
      ).rejects.toThrow('Transaction Rollback: Media Create Error');
    });

    it('passes transaction client to MediaRepository and propagates errors on update failure', async () => {
      const mockTxClient = { isTransaction: true };
      const payload = createMockRegistryPayload({ imageId: 'media-to-update' });
      mockUpdateMedia.mockRejectedValue(new Error('Transaction Rollback: Media Update Error'));

      await expect(
        handleMediaFields(
          payload,
          'imageId',
          'imageUrl',
          'imageAlt',
          'imageDecorative',
          mockTxClient,
          'TxAuthor'
        )
      ).rejects.toThrow('Transaction Rollback: Media Update Error');
    });
  });
});
