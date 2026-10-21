import { POST } from '../admin/sub-events/access/batch/route';
import { NextRequest } from 'next/server';
import { subEventService } from '@/features/sub-events/service';
import { isAdminRequest } from '@/core/auth/auth.server';

jest.mock('@/features/sub-events/service');
jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

describe('Admin Sub-Event Batch Access Route', () => {
  const mockBatchUpdateSubEventAccess = subEventService.batchUpdateSubEventAccess as jest.MockedFunction<typeof subEventService.batchUpdateSubEventAccess>;
  const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
  });

  it('POST executes batch access update and returns result', async () => {
    mockBatchUpdateSubEventAccess.mockResolvedValue({
      success: true,
      count: 5,
      updatedCount: 5,
      targetCodeCount: 5,
      subEventIds: ['se-rehearsal'],
      action: 'grant',
    });

    const req = new NextRequest('http://localhost:3000/api/admin/sub-events/access/batch', {
      method: 'POST',
      body: JSON.stringify({
        partyTags: ['Bridal Party'],
        subEventIds: ['se-rehearsal'],
        action: 'grant',
      }),
    });

    const res = await POST(req, {});
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.updatedCount).toBe(5);
    expect(mockBatchUpdateSubEventAccess).toHaveBeenCalledWith({
      partyTags: ['Bridal Party'],
      subEventIds: ['se-rehearsal'],
      action: 'grant',
    });
  });

  it('POST returns 400 for invalid payload (missing subEventIds or action)', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/sub-events/access/batch', {
      method: 'POST',
      body: JSON.stringify({
        partyTags: ['Bridal Party'],
      }),
    });

    const res = await POST(req, {});
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toContain('Invalid request body');
  });
});
