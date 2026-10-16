import { renderHook, act } from '@testing-library/react';
import { useAdminMaintenance } from '../useAdminMaintenance';
import { apiClient } from '@/features/admin';
import { useQueryClient } from '@tanstack/react-query';

jest.mock('@/features/admin/apiClient', () => ({
  apiClient: {
    post: jest.fn(),
  },
}));

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: jest.fn(),
}));

describe('useAdminMaintenance Hook Unit Tests', () => {
  const mockInvalidateQueries = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    (useQueryClient as jest.Mock).mockReturnValue({
      invalidateQueries: mockInvalidateQueries,
    });
  });

  const getValidBackupData = () => ({
    exportedAt: '2026-10-16T12:00:00.000Z',
    version: '1.0',
    schemaVersion: '1.0',
    appConfig: [
      {
        id: 'global',
        partner1Name: 'Alice',
        partner2Name: 'Bob',
        createdAt: '2026-10-16T12:00:00.000Z',
        updatedAt: '2026-10-16T12:00:00.000Z',
      },
    ],
    media: [
      {
        id: 'media-1',
        url: 'https://example.com/photo.png',
        createdAt: '2026-10-16T12:00:00.000Z',
        updatedAt: '2026-10-16T12:00:00.000Z',
      },
    ],
    registryItem: [
      {
        id: 'reg-1',
        name: 'Blender',
        description: 'Smoothie maker',
        category: 'Kitchen',
        price: 99.99,
        imageId: 'img-1',
        quantity: 1,
        createdAt: '2026-10-16T12:00:00.000Z',
        updatedAt: '2026-10-16T12:00:00.000Z',
      },
    ],
    contributor: [
      {
        id: 'contrib-1',
        name: 'Grandma Smith',
        createdAt: '2026-10-16T12:00:00.000Z',
        updatedAt: '2026-10-16T12:00:00.000Z',
      },
    ],
  });

  test('validates valid backup file and computes summary record counts', async () => {
    const { result } = renderHook(() => useAdminMaintenance());
    const validData = getValidBackupData();
    const blob = new Blob([JSON.stringify(validData)], { type: 'application/json' });
    const file = new File([blob], 'valid-backup.json', { type: 'application/json' });

    let isValid = false;
    await act(async () => {
      isValid = await result.current.validateFile(file);
    });

    expect(isValid).toBe(true);
    expect(result.current.preflightState).toBe('valid');
    expect(result.current.diagnostics).toEqual([]);
    expect(result.current.preflightSummary).toEqual({
      fileName: 'valid-backup.json',
      fileSize: file.size,
      exportedAt: expect.any(String),
      version: '1.0',
      schemaVersion: '1.0',
      counts: {
        appConfig: 1,
        media: 1,
        registryItem: 1,
        contributor: 1,
        weddingPartyMember: 0,
        attraction: 0,
        contentNode: 0,
        seatingTable: 0,
      },
      totalRecords: 4,
    });
  });

  test('captures syntax errors for malformed JSON files', async () => {
    const { result } = renderHook(() => useAdminMaintenance());
    const file = new File(['{ invalid json markup '], 'corrupted.json', { type: 'application/json' });

    let isValid = false;
    await act(async () => {
      isValid = await result.current.validateFile(file);
    });

    expect(isValid).toBe(false);
    expect(result.current.preflightState).toBe('invalid');
    expect(result.current.diagnostics.length).toBeGreaterThan(0);
    expect(result.current.diagnostics[0].path).toBe('JSON Syntax Error');
  });

  test('captures path diagnostics for schema validation failures', async () => {
    const { result } = renderHook(() => useAdminMaintenance());
    const invalidData = getValidBackupData();
    invalidData.registryItem[0].price = -50; // Invalid price

    const file = new File([JSON.stringify(invalidData)], 'invalid-schema.json', { type: 'application/json' });

    let isValid = false;
    await act(async () => {
      isValid = await result.current.validateFile(file);
    });

    expect(isValid).toBe(false);
    expect(result.current.preflightState).toBe('invalid');
    expect(result.current.diagnostics).toContainEqual(
      expect.objectContaining({
        path: 'registryItem.0.price',
      })
    );
  });

  test('importData executes multi-stage restoration and invalidates query cache', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useAdminMaintenance());
    const validData = getValidBackupData();
    const file = new File([JSON.stringify(validData)], 'backup.json', { type: 'application/json' });

    await act(async () => {
      await result.current.importData(file);
    });

    expect(result.current.importStage).toBe('complete');
    expect(apiClient.post).toHaveBeenCalledWith('/api/admin/maintenance/import', expect.any(Object));
    expect(mockInvalidateQueries).toHaveBeenCalled();
  });
});
