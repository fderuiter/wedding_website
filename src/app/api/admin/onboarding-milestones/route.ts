import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig, isSiteInitialized } from '@/lib/config';
import { hasCustomStoryText, hasNonPlaceholderVenueDetails } from '@/lib/setupCopy';
import { isFeatureEnabled } from '@/lib/modules';
import { prisma } from '@/lib/prisma';

function isScheduleContentNodeRecord(node: {
  type?: unknown;
  tags?: unknown;
  data?: unknown;
}): boolean {
  const data =
    node?.data && typeof node.data === 'object' && !Array.isArray(node.data)
      ? (node.data as Record<string, unknown>)
      : {};
  if (data.isSample === true || data.isSample === 'true') return false;
  if (data.isPrivate === true || data.isPrivate === 'true') return false;

  const tags = Array.isArray(node?.tags) ? node.tags : [];
  const hasScheduleTag = tags.includes('Schedule') || tags.includes('schedule');
  const hasStartTime = typeof data.startTime === 'string' && data.startTime.trim().length > 0;
  const hasCeremonyTitle =
    typeof data.ceremonyTitle === 'string' && data.ceremonyTitle.trim().length > 0;

  return (
    node?.type === 'Schedule' ||
    hasScheduleTag ||
    hasStartTime ||
    (node?.type === 'Logistics' && hasCeremonyTitle)
  );
}

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

  const [guestCount, registryCount, seatingCount, publicSubEventCount, candidateContentNodes] =
    await Promise.all([
      prisma.invitationCode.count({ where: { isSample: false } }),
      registryEnabled
        ? prisma.registryItem.count({ where: { isSample: false } })
        : Promise.resolve(0),
      prisma.seatingTable.count({ where: { isSample: false } }),
      prisma.subEvent?.count
        ? prisma.subEvent.count({ where: { isPrivate: false } })
        : Promise.resolve(0),
      prisma.contentNode?.findMany
        ? prisma.contentNode.findMany({
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
        })
        : Promise.resolve([]),
    ]);

  const nonSampleVisibleFaqCount = Array.isArray(candidateContentNodes)
    ? candidateContentNodes.filter((node) => {
      if (node?.type !== undefined && node.type !== 'FAQ') return false;
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

  const hasPublicScheduleContentNode = Array.isArray(candidateContentNodes)
    ? candidateContentNodes.some((node) => isScheduleContentNodeRecord(node))
    : false;
  const hasPublicScheduleEvent = publicSubEventCount > 0 || hasPublicScheduleContentNode;
  const customStoryConfigured = hasCustomStoryText(config);

  const partner1 = (config?.partner1Name || config?.brideName || '').trim();
  const partner2 = (config?.partner2Name || config?.groomName || '').trim();
  const baseUrl = (config?.baseUrl || '').trim();
  const weddingDetailsCompleted =
    Boolean(partner1 && partner2 && baseUrl) &&
    isSiteInitialized(config) &&
    hasNonPlaceholderVenueDetails(config);
  const storyAndScheduleCompleted = customStoryConfigured && hasPublicScheduleEvent;

  const guestListCompleted = guestCount > 0;
  const registryCompleted = registryCount > 0;
  const seatingCompleted = seatingCount > 0;
  const faqCompleted = nonSampleVisibleFaqCount > 0;

  const milestones = [
    {
      id: 'wedding-details',
      title: 'Wedding Details',
      description: 'Verify partner names, wedding venue details, and your public website URL.',
      completed: weddingDetailsCompleted,
      href: '/admin/dashboard/settings',
      actionLabel: weddingDetailsCompleted ? 'Edit Wedding Details' : 'Configure Wedding Details',
    },
    {
      id: 'story-and-schedule',
      title: 'Story & Schedule',
      description: 'Share your custom couple story and publish at least one public schedule event.',
      completed: storyAndScheduleCompleted,
      href: !customStoryConfigured ? '/admin/dashboard/settings' : '/admin/dashboard/sub-events',
      actionLabel: storyAndScheduleCompleted
        ? 'Edit Story & Schedule'
        : !customStoryConfigured
          ? 'Write Our Story'
          : 'Add Schedule Event',
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
