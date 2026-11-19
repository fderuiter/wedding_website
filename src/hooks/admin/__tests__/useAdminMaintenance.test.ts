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
        invitationCode: 0,
        subEvent: 0,
        subEventAccess: 0,
        subEventRsvp: 0,
        broadcastMessage: 0,
        broadcastRecipient: 0,
        snapshotVersion: 0,
      },
      totalRecords: 4,
    });
  });

  test('computes accurate non-zero pre-flight counts for guests, seating, sub-events, RSVPs, broadcasts, and snapshots', async () => {
    const { result } = renderHook(() => useAdminMaintenance());
    const v2Backup = {
      ...getValidBackupData(),
      version: '2.0',
      schemaVersion: '2.0',
      seatingTable: [{ id: 'st-1', name: 'Head Table', capacity: 8 }],
      invitationCode: [
        {
          id: 'inv-1',
          code: 'FAM2026',
          guestName: 'Jordan Lee',
          tableId: 'st-1',
          seatNumber: 1,
          createdAt: '2026-10-16T12:00:00.000Z',
          updatedAt: '2026-10-16T12:00:00.000Z',
        },
      ],
      subEvent: [
        {
          id: 'se-1',
          title: 'Welcome Dinner',
          startTime: '2026-10-17T18:00:00.000Z',
          createdAt: '2026-10-16T12:00:00.000Z',
          updatedAt: '2026-10-16T12:00:00.000Z',
        },
      ],
      subEventAccess: [
        {
          id: 'sea-1',
          subEventId: 'se-1',
          invitationCodeId: 'inv-1',
          createdAt: '2026-10-16T12:00:00.000Z',
        },
      ],
      subEventRsvp: [
        {
          id: 'rsvp-1',
          subEventId: 'se-1',
          invitationCodeId: 'inv-1',
          status: 'attending',
          plusOneCount: 1,
          createdAt: '2026-10-16T12:00:00.000Z',
          updatedAt: '2026-10-16T12:00:00.000Z',
        },
      ],
      broadcastMessage: [
        {
          id: 'bm-1',
          channel: 'EMAIL',
          subject: 'Schedule Update',
          body: 'See you Friday!',
          createdAt: '2026-10-16T12:00:00.000Z',
          updatedAt: '2026-10-16T12:00:00.000Z',
        },
      ],
      broadcastRecipient: [
        {
          id: 'br-1',
          broadcastId: 'bm-1',
          invitationCodeId: 'inv-1',
          guestName: 'Jordan Lee',
          destination: 'jordan@example.com',
          createdAt: '2026-10-16T12:00:00.000Z',
          updatedAt: '2026-10-16T12:00:00.000Z',
        },
      ],
      snapshotVersion: [
        {
          id: 'sv-1',
          entityType: 'AppConfig',
          entityId: 'global',
          data: { id: 'global' },
          createdAt: '2026-10-16T12:00:00.000Z',
        },
      ],
    };

    const file = new File([JSON.stringify(v2Backup)], 'v2-backup.json', {
      type: 'application/json',
    });

    let isValid = false;
    await act(async () => {
      isValid = await result.current.validateFile(file);
    });

    expect(isValid).toBe(true);
    expect(result.current.preflightSummary?.schemaVersion).toBe('2.0');
    expect(result.current.preflightSummary?.counts).toMatchObject({
      seatingTable: 1,
      invitationCode: 1,
      subEvent: 1,
      subEventAccess: 1,
      subEventRsvp: 1,
      broadcastMessage: 1,
      broadcastRecipient: 1,
      snapshotVersion: 1,
    });
    expect(result.current.preflightSummary?.totalRecords).toBe(12);
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

  test('importData executes multi-stage restoration and posts only schema-validated output', async () => {
    (apiClient.post as jest.Mock).mockResolvedValue({ success: true });

    const { result } = renderHook(() => useAdminMaintenance());
    const legacyPayload = {
      ...getValidBackupData(),
      appConfig: [
        {
          ...getValidBackupData().appConfig[0],
          multisiteEnabled: true,
          typographyScale: { display: '3rem' },
          modules: { rsvp: true },
        },
      ],
    };
    const file = new File([JSON.stringify(legacyPayload)], 'backup.json', { type: 'application/json' });

    await act(async () => {
      await result.current.importData(file);
    });

    expect(result.current.importStage).toBe('complete');
    expect(apiClient.post).toHaveBeenCalledTimes(1);
    const postedPayload = (apiClient.post as jest.Mock).mock.calls[0][1];
    expect(postedPayload.appConfig[0].multisiteEnabled).toBeUndefined();
    expect(postedPayload.appConfig[0].typographyScale).toBeUndefined();
    expect(postedPayload.appConfig[0].modules).toBeUndefined();
    expect(mockInvalidateQueries).toHaveBeenCalled();
  });
});
