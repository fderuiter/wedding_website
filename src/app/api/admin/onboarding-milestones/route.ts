import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig, isSiteInitialized } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { prisma } from '@/lib/prisma';

/**
 * Evaluates administrative onboarding setup milestones using aggregate database counts
 * and application configuration checks, excluding sample records (`isSample: true`).
 */
export const GET = withApiMiddleware(async (req: NextRequest) => {
  const isAdmin = await isAdminRequest(req);
  if (!isAdmin) {
    throw new ApiError(401, 'Unauthorized');
  }

  const config = await getAppConfig();
  const registryEnabled = isFeatureEnabled('registry', config?.modules);

  const [guestCount, registryCount, seatingCount, faqNodes] = await Promise.all([
    prisma.invitationCode.count({
      where: {
        isSample: false,
        NOT: {
          partyTags: {
            has: 'address-collection',
          },
        },
      },
    }),
    registryEnabled
      ? prisma.registryItem.count({ where: { isSample: false } })
      : Promise.resolve(0),
    prisma.seatingTable.count({ where: { isSample: false } }),
    prisma.contentNode?.findMany
      ? prisma.contentNode.findMany({
        where: { type: 'FAQ' },
        select: { data: true },
      })
      : Promise.resolve([]),
  ]);

  const nonSampleVisibleFaqCount = Array.isArray(faqNodes)
    ? faqNodes.filter((node) => {
      const data =
        node?.data && typeof node.data === 'object' && !Array.isArray(node.data)
          ? (node.data as Record<string, unknown>)
          : {};
      if (data.isSample === true || data.isSample === 'true') return false;
      if (data.isVisible === false || data.isVisible === 'false') return false;
      const question = typeof data.question === 'string' ? data.question.trim() : '';
      const answer = typeof data.answer === 'string' ? data.answer.trim() : '';
      return Boolean(question && answer);
    }).length
    : 0;

  const partner1 = (config?.partner1Name || config?.brideName || '').trim();
  const partner2 = (config?.partner2Name || config?.groomName || '').trim();
  const baseUrl = (config?.baseUrl || '').trim();
  const rawVenueName = (config?.venueName || '').trim();
  const normalizedVenueName = rawVenueName.toUpperCase();
  const hasVenueName =
    Boolean(rawVenueName) &&
    normalizedVenueName !== 'TBD' &&
    normalizedVenueName !== 'TBD VENUE';
  const hasWeddingDate =
    config?.weddingDate !== null &&
    config?.weddingDate !== undefined &&
    String(config.weddingDate).trim() !== '' &&
    !Number.isNaN(new Date(config.weddingDate).getTime());
  const weddingDetailsCompleted =
    Boolean(partner1 && partner2 && baseUrl) &&
    hasWeddingDate &&
    hasVenueName &&
    isSiteInitialized(config);

  const guestListCompleted = guestCount > 0;
  const registryCompleted = registryCount > 0;
  const seatingCompleted = seatingCount > 0;
  const faqCompleted = nonSampleVisibleFaqCount > 0;

  const milestones = [
    {
      id: 'wedding-details',
      title: 'Wedding Details',
      description: 'Verify partner names, wedding date, venue details, and your public website URL.',
      completed: weddingDetailsCompleted,
      href: '/admin/dashboard/settings',
      actionLabel: weddingDetailsCompleted ? 'Edit Wedding Details' : 'Configure Wedding Details',
    },
    {
      id: 'guest-list',
      title: 'Guest List',
      description: 'Import or add guest invitations so guests can RSVP.',
      completed: guestListCompleted,
      href: '/admin/dashboard/invitation-codes',
      actionLabel: guestListCompleted ? 'Manage Guest List' : 'Add Guest List',
    },
    ...(registryEnabled
      ? [
        {
          id: 'registry',
          title: 'Gift Registry',
          description: 'Add gifts or cash funds to your wedding registry.',
          completed: registryCompleted,
          href: '/registry/add-item',
          actionLabel: registryCompleted ? 'Add More Gifts' : 'Add Registry Gifts',
        },
      ]
      : []),
    {
      id: 'seating-layout',
      title: 'Seating Layout',
      description: 'Create reception tables and organize your seating chart.',
      completed: seatingCompleted,
      href: '/admin/dashboard/seating-chart',
      actionLabel: seatingCompleted ? 'Edit Seating Layout' : 'Create Seating Layout',
    },
    {
      id: 'faq-setup',
      title: 'Wedding Q&A (FAQs)',
      description: 'Publish guest Q&A answers for attire, RSVP deadlines, travel, and accommodations.',
      completed: faqCompleted,
      href: '/admin/dashboard/content',
      actionLabel: faqCompleted ? 'Manage Wedding Q&A' : 'Add Starter FAQs',
    },
  ];

  const totalCount = milestones.length;
  const completedCount = milestones.filter((milestone) => milestone.completed).length;
  const pendingCount = totalCount - completedCount;
  const allComplete = completedCount === totalCount;

  return NextResponse.json(
    {
      success: true,
      completedCount,
      pendingCount,
      totalCount,
      allComplete,
      milestones,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
});
