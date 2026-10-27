import { GET, PUT } from '../admin/sub-events/access/route';
import { NextRequest } from 'next/server';
import { subEventService } from '@/features/sub-events/service';
import { isAdminRequest } from '@/core/auth/auth.server';

jest.mock('@/features/sub-events/service');
jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

describe('Admin Sub-Event Access Matrix Routes', () => {
  const mockGetAccessMatrix = subEventService.getAccessMatrix as jest.MockedFunction<typeof subEventService.getAccessMatrix>;
  const mockUpdateInvitationSubEventAccess = subEventService.updateInvitationSubEventAccess as jest.MockedFunction<typeof subEventService.updateInvitationSubEventAccess>;
  const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
  });

  it('GET returns sub-events access matrix with default query parameters', async () => {
    mockGetAccessMatrix.mockResolvedValue({
      subEvents: [],
      invitationCodes: [],
      pagination: { total: 0, page: 1, limit: 25, totalPages: 0 },
      filterOptions: { partyTags: [], partyGroups: [], householdNames: [] },
    });

    const res = await GET(
      new NextRequest('http://localhost:3000/api/admin/sub-events/access'),
      {}
    );
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(mockGetAccessMatrix).toHaveBeenCalledWith({
      page: 1,
      limit: 25,
      search: undefined,
      partyTag: undefined,
      partyGroup: undefined,
      householdName: undefined,
    });
  });

  it('GET returns sub-events access matrix with parsed query parameters', async () => {
    mockGetAccessMatrix.mockResolvedValue({
      subEvents: [{ id: 'se-1', title: 'Rehearsal Dinner', isPrivate: true, allowedInvitationCodeIds: ['inv-1'] }],
      invitationCodes: [{ id: 'inv-1', code: 'VIP1', guestName: 'Alice', allowedSubEventIds: ['se-1'] }],
      pagination: { total: 1, page: 2, limit: 50, totalPages: 1 },
      filterOptions: { partyTags: ['VIP'], partyGroups: [], householdNames: [] },
    });

    const res = await GET(
      new NextRequest('http://localhost:3000/api/admin/sub-events/access?page=2&limit=50&search=Alice&partyTag=VIP'),
      {}
    );
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.subEvents).toHaveLength(1);
    expect(json.data.invitationCodes).toHaveLength(1);
    expect(mockGetAccessMatrix).toHaveBeenCalledWith({
      page: 2,
      limit: 50,
      search: 'Alice',
      partyTag: 'VIP',
      partyGroup: undefined,
      householdName: undefined,
    });
  });

  it('PUT updates sub-event access assignments for invitation code', async () => {
    mockUpdateInvitationSubEventAccess.mockResolvedValue({
      success: true,
      invitationCodeId: 'inv-1',
      allowedSubEventIds: ['se-1', 'se-2'],
    });

    const req = new NextRequest('http://localhost:3000/api/admin/sub-events/access', {
      method: 'PUT',
      body: JSON.stringify({
        invitationCodeId: 'inv-1',
        allowedSubEventIds: ['se-1', 'se-2'],
      }),
    });

    const res = await PUT(req, {});
    const json = await res.json();

    expect(json.success).toBe(true);
    expect(json.data.allowedSubEventIds).toEqual(['se-1', 'se-2']);
    expect(mockUpdateInvitationSubEventAccess).toHaveBeenCalledWith('inv-1', ['se-1', 'se-2']);
  });

  it('PUT returns status 400 when request body is invalid', async () => {
    const req = new NextRequest('http://localhost:3000/api/admin/sub-events/access', {
      method: 'PUT',
      body: JSON.stringify({
        invalidField: 'test',
      }),
    });

    const res = await PUT(req, {});
    expect(res.status).toBe(400);
  });
});
