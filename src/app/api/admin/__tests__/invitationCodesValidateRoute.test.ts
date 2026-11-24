/** @jest-environment node */

import { POST } from '../invitation-codes/validate/route';
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

describe('POST /api/admin/invitation-codes/validate', () => {
  let mockServiceInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdminRequest.mockResolvedValue(true);
    mockServiceInstance = {
      dryRunValidateBatch: jest.fn(),
    };
    MockInvitationCodeAdminService.mockImplementation(() => mockServiceInstance);
  });

  test('returns 401 if request is unauthorized', async () => {
    mockIsAdminRequest.mockResolvedValue(false);
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [{ guestName: 'John Doe', code: 'JOHN100' }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  test('returns 400 for invalid body schema (empty records)', async () => {
    const req = new NextRequest('http://localhost/api/admin/invitation-codes/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('At least one record is required');
  });

  test('executes dry-run validation and returns 200 OK with summary and row details', async () => {
    const mockResult = {
      success: true,
      summary: {
        total: 2,
        validCount: 2,
        invalidCount: 0,
        duplicateCount: 1,
        updatedCount: 0,
        skippedCount: 1,
        createdCount: 1,
      },
      rows: [
        {
          rowIndex: 1,
          guestName: 'Alice Smith',
          code: 'ALICE100',
          email: 'alice@example.com',
          isValid: true,
          errors: [],
          warnings: ['Code "ALICE100" already exists in database for guest "Alice Johnson". Will be skipped.'],
          isDuplicate: true,
          existingGuestName: 'Alice Johnson',
          actionOutcome: 'skip',
        },
        {
          rowIndex: 2,
          guestName: 'Bob Brown',
          code: 'BOB200',
          isValid: true,
          errors: [],
          warnings: [],
          isDuplicate: false,
          actionOutcome: 'create',
        },
      ],
    };
    mockServiceInstance.dryRunValidateBatch.mockResolvedValue(mockResult);

    const payload = {
      records: [
        { guestName: 'Alice Smith', code: 'ALICE100', email: 'alice@example.com' },
        { guestName: 'Bob Brown', code: 'BOB200' },
      ],
      collisionStrategy: 'skip' as const,
    };

    const req = new NextRequest('http://localhost/api/admin/invitation-codes/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockResult);
    expect(mockServiceInstance.dryRunValidateBatch).toHaveBeenCalledWith(
      payload.records.map((r) => ({ partyTags: [], ...r })),
      'skip'
    );
  });

  test('passes mixed valid and row-invalid CSV records to dryRunValidateBatch instead of rejecting the entire batch with 400', async () => {
    const mockResult = {
      success: true,
      summary: {
        total: 2,
        validCount: 1,
        invalidCount: 1,
        duplicateCount: 1,
        updatedCount: 1,
        skippedCount: 0,
        createdCount: 0,
      },
      rows: [
        {
          rowIndex: 1,
          guestName: 'Jane Doe',
          code: 'JANE2026',
          email: 'jane@example.com',
          isValid: true,
          errors: [],
          warnings: [],
          isDuplicate: true,
          existingGuestName: 'Jane Doe',
          actionOutcome: 'update',
        },
        {
          rowIndex: 2,
          guestName: 'Broken Row',
          code: '',
          email: 'not-an-email',
          isValid: false,
          errors: ['Invalid email format.'],
          warnings: [],
          isDuplicate: false,
          actionOutcome: 'invalid',
        },
      ],
    };
    mockServiceInstance.dryRunValidateBatch.mockResolvedValue(mockResult);

    const req = new NextRequest('http://localhost/api/admin/invitation-codes/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        records: [
          { guestName: 'Jane Doe', email: 'jane@example.com' },
          { guestName: 'Broken Row', email: 'not-an-email' },
        ],
        collisionStrategy: 'update',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(mockResult);
    expect(mockServiceInstance.dryRunValidateBatch).toHaveBeenCalledTimes(1);
  });
});
