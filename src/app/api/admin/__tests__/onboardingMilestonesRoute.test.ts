/** @jest-environment node */

import { NextRequest } from 'next/server';
import { GET } from '../onboarding-milestones/route';
import { resetRateLimitsForTesting } from '@/utils/rateLimit';
import { synthesizeSetupStarterCopy } from '@/lib/setupCopy';
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
    subEvent: {
      count: jest.fn(),
    },
    contentNode: {
      findMany: jest.fn(),
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
    (prisma.subEvent.count as jest.Mock).mockResolvedValue(0);
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

  it('evaluates non-sample aggregate counts, tightened venue details, and story-and-schedule accurately', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockGetAppConfig.mockResolvedValue({
      id: 'global',
      partner1Name: '',
      partner2Name: '',
      brideName: '',
      groomName: '',
      venueName: '',
      venueCity: '',
      venueState: '',
      storyText: '',
      baseUrl: '',
    } as unknown as AppConfigDTO);
    (prisma.invitationCode.count as jest.Mock).mockResolvedValue(0);
    (prisma.registryItem.count as jest.Mock).mockResolvedValue(0);
    (prisma.seatingTable.count as jest.Mock).mockResolvedValue(0);
    (prisma.subEvent.count as jest.Mock).mockResolvedValue(0);
    (prisma.contentNode.findMany as jest.Mock).mockResolvedValue([
      {
        type: 'FAQ',
        tags: ['FAQ'],
        data: {
          question: 'Sample FAQ?',
          answer: 'Sample answer',
          isSample: true,
          isVisible: true,
        },
      },
      {
        type: 'FAQ',
        tags: ['FAQ'],
        data: {
          question: 'Hidden Draft FAQ?',
          answer: 'Hidden answer',
          isVisible: false,
        },
      },
    ]);

    const res = await GET(makeRequest(true), {});
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.completedCount).toBe(0);
    expect(body.pendingCount).toBe(6);
    expect(body.totalCount).toBe(6);
    expect(body.allComplete).toBe(false);

    expect(prisma.invitationCode.count).toHaveBeenCalledWith({ where: { isSample: false } });
    expect(prisma.registryItem.count).toHaveBeenCalledWith({ where: { isSample: false } });
    expect(prisma.seatingTable.count).toHaveBeenCalledWith({ where: { isSample: false } });
    expect(prisma.subEvent.count).toHaveBeenCalledWith({ where: { isPrivate: false } });
    expect(prisma.contentNode.findMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { type: 'FAQ' },
          { type: 'Schedule' },
          { type: 'Logistics' },
          { tags: { has: 'Schedule' } },
          { tags: { has: 'schedule' } },
        ],
      },
      select: { type: true, tags: true, data: true },
    });

    expect(body.milestones).toEqual([
      expect.objectContaining({
        id: 'wedding-details',
        title: 'Wedding Details',
        completed: false,
        href: '/admin/dashboard/settings',
      }),
      expect.objectContaining({
        id: 'story-and-schedule',
        title: 'Story & Schedule',
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
      expect.objectContaining({
        id: 'faq-setup',
        title: 'Wedding Q&A (FAQs)',
        completed: false,
        href: '/admin/dashboard/content',
      }),
    ]);
  });

  it('marks wedding-details incomplete when venue fields are TBD or blank, and story-and-schedule incomplete for auto-synthesized starter story', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    const starterCopy = synthesizeSetupStarterCopy({
      partner1Name: 'Taylor',
      partner2Name: 'Jordan',
      weddingDate: '2028-09-18',
      venueName: '',
      venueCity: '',
      venueState: '',
    });

    mockGetAppConfig.mockResolvedValue({
      id: 'global',
      partner1Name: 'Taylor',
      partner2Name: 'Jordan',
      venueName: 'TBD',
      venueCity: '',
      venueState: '',
      storyText: starterCopy.storyText,
      baseUrl: 'https://taylorandjordan.example.org',
    } as unknown as AppConfigDTO);
    (prisma.invitationCode.count as jest.Mock).mockResolvedValue(5);
    (prisma.registryItem.count as jest.Mock).mockResolvedValue(0);
    (prisma.seatingTable.count as jest.Mock).mockResolvedValue(2);
    // Even if a public SubEvent exists, starter storyText keeps story-and-schedule incomplete
    (prisma.subEvent.count as jest.Mock).mockResolvedValue(1);
    (prisma.contentNode.findMany as jest.Mock).mockResolvedValue([]);

    const res = await GET(makeRequest(true), {});
    const body = await res.json();

    expect(body.completedCount).toBe(2);
    expect(body.pendingCount).toBe(4);
    expect(body.allComplete).toBe(false);
    expect(body.milestones.find((m: OnboardingMilestone) => m.id === 'wedding-details')?.completed).toBe(false);
    expect(body.milestones.find((m: OnboardingMilestone) => m.id === 'story-and-schedule')?.completed).toBe(false);
    expect(body.milestones.find((m: OnboardingMilestone) => m.id === 'guest-list')?.completed).toBe(true);
    expect(body.milestones.find((m: OnboardingMilestone) => m.id === 'registry')?.completed).toBe(false);
    expect(body.milestones.find((m: OnboardingMilestone) => m.id === 'seating-layout')?.completed).toBe(true);
    expect(body.milestones.find((m: OnboardingMilestone) => m.id === 'faq-setup')?.completed).toBe(false);
  });

  it('reports allComplete=true when all six milestones are satisfied with non-placeholder venue, custom story, public schedule, and non-sample data', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    mockGetAppConfig.mockResolvedValue({
      id: 'global',
      partner1Name: 'Taylor',
      partner2Name: 'Jordan',
      brideName: 'Taylor',
      groomName: 'Jordan',
      venueName: 'The Botanical Conservatory',
      venueCity: 'Austin',
      venueState: 'TX',
      storyText: 'We met at a neighborhood coffee shop in 2020 and got engaged under the oaks.',
      baseUrl: 'https://taylorandjordan.example.org',
      weddingDate: new Date('2027-06-20T16:00:00.000Z'),
    } as unknown as AppConfigDTO);
    (prisma.invitationCode.count as jest.Mock).mockResolvedValue(12);
    (prisma.registryItem.count as jest.Mock).mockResolvedValue(8);
    (prisma.seatingTable.count as jest.Mock).mockResolvedValue(4);
    (prisma.subEvent.count as jest.Mock).mockResolvedValue(2);
    (prisma.contentNode.findMany as jest.Mock).mockResolvedValue([
      {
        type: 'FAQ',
        tags: ['FAQ'],
        data: {
          question: 'What is the dress code?',
          answer: 'Cocktail attire.',
          isVisible: true,
        },
      },
    ]);

    const res = await GET(makeRequest(true), {});
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.completedCount).toBe(6);
    expect(body.pendingCount).toBe(0);
    expect(body.totalCount).toBe(6);
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
      venueName: 'The Botanical Conservatory',
      venueCity: 'Austin',
      venueState: 'TX',
      storyText: 'Custom wedding story written by Taylor and Jordan.',
      baseUrl: 'https://taylorandjordan.example.org',
      weddingDate: new Date('2027-06-20T16:00:00.000Z'),
      modules: { registry: false },
    } as unknown as AppConfigDTO);
    (prisma.invitationCode.count as jest.Mock).mockResolvedValue(12);
    (prisma.seatingTable.count as jest.Mock).mockResolvedValue(4);
    (prisma.subEvent.count as jest.Mock).mockResolvedValue(0);
    (prisma.contentNode.findMany as jest.Mock).mockResolvedValue([
      {
        type: 'FAQ',
        tags: ['FAQ'],
        data: {
          question: 'Is parking available?',
          answer: 'Yes, free on-site parking.',
          isVisible: true,
        },
      },
      {
        type: 'Schedule',
        tags: ['Homepage', 'Schedule'],
        data: {
          title: 'Garden Ceremony',
          isPrivate: false,
          isSample: false,
        },
      },
    ]);

    const res = await GET(makeRequest(true), {});
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(prisma.registryItem.count).not.toHaveBeenCalled();
    expect(body.totalCount).toBe(5);
    expect(body.completedCount).toBe(5);
    expect(body.pendingCount).toBe(0);
    expect(body.allComplete).toBe(true);
    expect(body.milestones.map((m: OnboardingMilestone) => m.id)).toEqual([
      'wedding-details',
      'story-and-schedule',
      'guest-list',
      'seating-layout',
      'faq-setup',
    ]);
  });

  it('keeps wedding-details incomplete when venueName is blank or TBD or weddingDate is missing', async () => {
    mockIsAdminRequest.mockResolvedValue(true);
    (prisma.invitationCode.count as jest.Mock).mockResolvedValue(0);
    (prisma.registryItem.count as jest.Mock).mockResolvedValue(0);
    (prisma.seatingTable.count as jest.Mock).mockResolvedValue(0);
    (prisma.contentNode.findMany as jest.Mock).mockResolvedValue([]);

    for (const incompleteFields of [
      { weddingDate: new Date('2027-06-20T16:00:00.000Z'), venueName: '', venueCity: 'Seattle', venueState: 'WA' },
      { weddingDate: new Date('2027-06-20T16:00:00.000Z'), venueName: '  tbd  ', venueCity: 'Seattle', venueState: 'WA' },
      { weddingDate: null, venueName: 'The Botanical Conservatory', venueCity: 'Seattle', venueState: 'WA' },
    ]) {
      mockGetAppConfig.mockResolvedValue({
        id: 'global',
        partner1Name: 'Taylor',
        partner2Name: 'Jordan',
        brideName: 'Taylor',
        groomName: 'Jordan',
        baseUrl: 'https://taylorandjordan.example.org',
        ...incompleteFields,
      } as unknown as AppConfigDTO);

      const res = await GET(makeRequest(true), {});
      const body = await res.json();
      const weddingDetails = body.milestones.find(
        (m: OnboardingMilestone) => m.id === 'wedding-details'
      );
      expect(weddingDetails?.completed).toBe(false);
    }
  });
});
