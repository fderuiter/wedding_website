/** @jest-environment node */

import { POST } from '../invitation-codes/merge/route';
import { NextRequest } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { InvitationCodeAdminService } from '@/features/registry';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/features/registry/invitation-code.admin.service');

const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
const MockInvitationCodeAdminService = InvitationCodeAdminService as jest.MockedClass<
  typeof InvitationCodeAdminService
>;

describe('POST /api/admin/invitation-codes/merge', () => {
  let mockServiceInstance: { mergeDuplicates: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
    mockServiceInstance = {
      mergeDuplicates: jest.fn(),
    };
    MockInvitationCodeAdminService.mockImplementation(
      () => mockServiceInstance as unknown as InvitationCodeAdminService
    );
  });

  test('returns 401 when request is unauthorized', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryId: 'inv-1', secondaryIds: ['inv-2'] }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test('returns 400 for malformed JSON body', async () => {
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad-json',
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid JSON payload.');
  });

  test('returns 400 when secondaryIds is empty or only contains primaryId', async () => {
    const emptyReq = new NextRequest('http://localhost/api/admin/invitation-codes/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryId: 'inv-1', secondaryIds: [] }),
    });
    const emptyRes = await POST(emptyReq);
    expect(emptyRes.status).toBe(400);

    const selfReq = new NextRequest('http://localhost/api/admin/invitation-codes/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryId: 'inv-1', secondaryIds: ['inv-1'] }),
    });
    const selfRes = await POST(selfReq);
    expect(selfRes.status).toBe(400);
    const selfBody = await selfRes.json();
    expect(selfBody.error).toContain('At least one distinct secondary guest ID is required');
  });

  test('returns 400 when service throws a Validation Error', async () => {
    mockServiceInstance.mergeDuplicates.mockRejectedValue(
      new Error('Validation Error: Invitation code(s) not found: inv-missing')
    );

    const req = new NextRequest('http://localhost/api/admin/invitation-codes/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryId: 'inv-1', secondaryIds: ['inv-missing'] }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invitation code(s) not found');
  });

  test('merges duplicate guest records and returns 200 with merged record summary', async () => {
    const mockMergeResult = {
      success: true as const,
      primaryRecord: {
        id: 'inv-1',
        code: 'ALICE100',
        guestName: 'Alice Smith',
        email: 'alice@example.com',
        partyTags: ['VIP', 'Family'],
      },
      mergedCount: 2,
      deletedSecondaryIds: ['inv-2', 'inv-3'],
      transferred: {
        contributors: 1,
        subEventAccesses: 2,
        subEventRsvps: 1,
        broadcastRecipients: 1,
        seatingAssigned: true,
      },
    };
    mockServiceInstance.mergeDuplicates.mockResolvedValue(mockMergeResult);

    const req = new NextRequest('http://localhost/api/admin/invitation-codes/merge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryId: 'inv-1', secondaryIds: ['inv-2', 'inv-3'] }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockMergeResult);
    expect(mockServiceInstance.mergeDuplicates).toHaveBeenCalledWith(
      'inv-1',
      ['inv-2', 'inv-3'],
      'Admin'
    );
  });
});
