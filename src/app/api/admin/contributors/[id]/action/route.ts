import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { formatZodError } from '@/utils/validation';
import {
  AdminContributorActionSchema,
  dispatchConfirmedContributionAlert,
  dispatchPoliteReminderNotification,
  registryService,
  sanitizeRegistryItem,
} from '@/features/registry';

export const POST = withApiMiddleware(
  async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const { id } = await context.params;
    const contributorId = typeof id === 'string' ? id.trim() : '';
    if (!contributorId) {
      throw new ApiError(400, 'Contributor ID is required');
    }

    const body = await req.json();
    const parseResult = AdminContributorActionSchema.safeParse(body);
    if (!parseResult.success) {
      throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
    }

    const { action } = parseResult.data;

    if (action === 'confirm') {
      const result = await registryService.confirmContribution(contributorId, 'Admin');

      await dispatchConfirmedContributionAlert({
        contributor: result.contributor,
        item: result.item,
        requestUrl: req.url,
      });

      return NextResponse.json({
        action: 'confirm',
        changed: result.changed,
        contributor: {
          id: result.contributor.id,
          status: result.contributor.status,
          refundedAmount: result.contributor.refundedAmount,
          reminderEmailSentAt: result.contributor.reminderEmailSentAt ?? null,
        },
        item: result.item ? sanitizeRegistryItem(result.item) : null,
      });
    }

    if (action === 'remind') {
      const record = await registryService.getContributorWithItem(contributorId);
      if (!record) {
        throw new ApiError(404, 'Contributor not found');
      }

      if (record.contributor.status !== 'RESERVED') {
        throw new ApiError(
          409,
          `Polite reminders can only be sent for RESERVED contributions (current status: ${record.contributor.status}).`
        );
      }

      const reminderResult = await dispatchPoliteReminderNotification({
        contributor: record.contributor,
        item: record.item,
        requestUrl: req.url,
      });

      if (!reminderResult.sent) {
        throw new ApiError(
          400,
          reminderResult.error || 'Failed to send polite reminder email.'
        );
      }

      const updatedContributor = await registryService.markContributorReminderSent(
        contributorId
      );

      return NextResponse.json({
        action: 'remind',
        changed: true,
        contributor: {
          id: updatedContributor.id,
          status: updatedContributor.status,
          refundedAmount: updatedContributor.refundedAmount,
          reminderEmailSentAt: updatedContributor.reminderEmailSentAt ?? null,
        },
      });
    }

    const result = await registryService.voidContribution(contributorId, 'Admin');

    return NextResponse.json({
      action: 'void',
      changed: result.changed,
      contributor: {
        id: result.contributor.id,
        status: result.contributor.status,
        refundedAmount: result.contributor.refundedAmount,
        reminderEmailSentAt: result.contributor.reminderEmailSentAt ?? null,
      },
      item: result.item ? sanitizeRegistryItem(result.item) : null,
    });
  }
);
