/** @jest-environment node */

import { NextRequest } from 'next/server';
import { GET } from '../onboarding-milestones/route';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import type { OnboardingMilestone } from '@/components/admin/OnboardingChecklist';
import type { AppConfigDTO } from '@/features/content';

jest.mock('@/core/auth/auth.server', () => ({
  isAdminRequest: jest.fn(),
}));

jest.mock('@/lib/config', () => {
  const actual = jest.requireActual('@/lib/config');
  return {
    ...actual,
    getAppConfig: jest.fn(),
  };
});

jest.mock('@/lib/prisma', () => ({
  prisma: {
    invitationCode: {
      count: jest.fn(),
    },
    registryItem: {
      count: jest.fn(),
    },
    seatingTable: {
      count: jest.fn(),
    },
  },
}));

import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';

const mockIsAdminRequest = isAdminRequest as jest.MockedFunction<typeof isAdminRequest>;
const mockGetAppConfig = getAppConfig as jest.MockedFunction<typeof getAppConfig>;

function makeRequest(authenticated = true) {
  return new NextRequest('http://localhost/api/admin/onboarding-milestones', {
    method: 'GET',
    headers: authenticated
      ? { cookie: 'admin_auth=valid-token' }
      : undefined,
  });
}

describe('GET /api/admin/onboarding-milestones', () => {
  const originalE2ETest = process.env.E2E_TEST;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRateLimitsForTesting();
    delete process.env.E2E_TEST;
  });

  afterAll(() => {
    if (originalE2ETest !== undefined) {
      process.env.E2E_TEST = originalE2ETest;
    } else {
      delete process.env.E2E_TEST;
    }
  });

  it('rejects unauthenticated requests with 401 Unauthorized', async () => {
    mockIsAdminRequest.mockResolvedValue(false);

    const res = await GET(makeRequest(false), {});
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
    expect(prisma.invitationCode.count).not.toHaveBeenCalled();
  });

  it('evaluates non-sample aggregate counts and unconfigured wedding details accurately', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockGetAppConfig.mockResolvedValue({
      id: 'global',
      partner1Name: '',
      partner2Name: '',
      brideName: '',
      groomName: '',
      baseUrl: '',
    } as unknown as AppConfigDTO);
    (prisma.invitationCode.count as jest.Mock).mockResolvedValue(0);
    (prisma.registryItem.count as jest.Mock).mockResolvedValue(0);
    (prisma.seatingTable.count as jest.Mock).mockResolvedValue(0);

    const res = await GET(makeRequest(true), {});
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.completedCount).toBe(0);
    expect(body.pendingCount).toBe(4);
    expect(body.totalCount).toBe(4);
    expect(body.allComplete).toBe(false);

    expect(prisma.invitationCode.count).toHaveBeenCalledWith({ where: { isSample: false } });
    expect(prisma.registryItem.count).toHaveBeenCalledWith({ where: { isSample: false } });
    expect(prisma.seatingTable.count).toHaveBeenCalledWith({ where: { isSample: false } });

    expect(body.milestones).toEqual([
      expect.objectContaining({
        id: 'wedding-details',
        title: 'Wedding Details',
        completed: false,
        href: '/admin/dashboard/settings',
      }),
      expect.objectContaining({
        id: 'guest-list',
        title: 'Guest List',
        completed: false,
        href: '/admin/dashboard/invitation-codes',
      }),
      expect.objectContaining({
        id: 'registry',
        title: 'Gift Registry',
        completed: false,
        href: '/registry/add-item',
      }),
      expect.objectContaining({
        id: 'seating-layout',
        title: 'Seating Layout',
        completed: false,
        href: '/admin/dashboard/seating-chart',
      }),
    ]);
  });

  it('marks wedding-details incomplete for placeholder partner names or wedding.example URL', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockGetAppConfig.mockResolvedValue({
      id: 'global',
      partner1Name: 'Partner 1',
      partner2Name: 'Partner 2',
      baseUrl: 'https://wedding.example.com',
    } as unknown as AppConfigDTO);
    (prisma.invitationCode.count as jest.Mock).mockResolvedValue(5);
    (prisma.registryItem.count as jest.Mock).mockResolvedValue(0);
    (prisma.seatingTable.count as jest.Mock).mockResolvedValue(2);

    const res = await GET(makeRequest(true), {});
    const body = await res.json();

    expect(body.completedCount).toBe(2);
    expect(body.pendingCount).toBe(2);
    expect(body.allComplete).toBe(false);
    expect(body.milestones.find((m: OnboardingMilestone) => m.id === 'wedding-details')?.completed).toBe(false);
    expect(body.milestones.find((m: OnboardingMilestone) => m.id === 'guest-list')?.completed).toBe(true);
    expect(body.milestones.find((m: OnboardingMilestone) => m.id === 'registry')?.completed).toBe(false);
    expect(body.milestones.find((m: OnboardingMilestone) => m.id === 'seating-layout')?.completed).toBe(true);
  });

  it('reports allComplete=true when all four milestones are satisfied with non-sample data', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockGetAppConfig.mockResolvedValue({
      id: 'global',
      partner1Name: 'Taylor',
      partner2Name: 'Jordan',
      brideName: 'Taylor',
      groomName: 'Jordan',
      baseUrl: 'https://taylorandjordan.example.org',
    } as unknown as AppConfigDTO);
    (prisma.invitationCode.count as jest.Mock).mockResolvedValue(12);
    (prisma.registryItem.count as jest.Mock).mockResolvedValue(8);
    (prisma.seatingTable.count as jest.Mock).mockResolvedValue(4);

    const res = await GET(makeRequest(true), {});
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.completedCount).toBe(4);
    expect(body.pendingCount).toBe(0);
    expect(body.totalCount).toBe(4);
    expect(body.allComplete).toBe(true);
    expect(body.milestones.every((m: OnboardingMilestone) => m.completed)).toBe(true);
  });

  it('omits registry milestone and skips registryItem.count when registry module is disabled', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockGetAppConfig.mockResolvedValue({
      id: 'global',
      partner1Name: 'Taylor',
      partner2Name: 'Jordan',
      brideName: 'Taylor',
      groomName: 'Jordan',
      baseUrl: 'https://taylorandjordan.example.org',
      modules: { registry: false },
    } as unknown as AppConfigDTO);
    (prisma.invitationCode.count as jest.Mock).mockResolvedValue(12);
    (prisma.seatingTable.count as jest.Mock).mockResolvedValue(4);

    const res = await GET(makeRequest(true), {});
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(prisma.registryItem.count).not.toHaveBeenCalled();
    expect(body.totalCount).toBe(3);
    expect(body.completedCount).toBe(3);
    expect(body.pendingCount).toBe(0);
    expect(body.allComplete).toBe(true);
    expect(body.milestones.map((m: OnboardingMilestone) => m.id)).toEqual([
      'wedding-details',
      'guest-list',
      'seating-layout',
    ]);
  });
});
