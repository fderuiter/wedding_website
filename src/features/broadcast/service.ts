import { prisma } from '@/lib/prisma';
import { getAppConfig } from '@/lib/config';
import { renderBroadcastTemplate } from './template';
import { MultiChannelMessagingProvider } from './providers';
import {
  SendBroadcastInput,
  PreviewBroadcastInput,
  BroadcastTargetFilters,
  BroadcastHistoryItem,
  DispatchResult,
} from './types';

export class BroadcastService {
  /**
   * Resolves target invitation code records based on filter criteria.
   */
  static async resolveTargetGuests(filters?: BroadcastTargetFilters) {
    if (!filters) {
      return prisma.invitationCode.findMany();
    }

    const where: any = {};

    if (filters.selectedIds && filters.selectedIds.length > 0) {
      where.id = { in: filters.selectedIds };
      return prisma.invitationCode.findMany({ where });
    }

    if (filters.partyTags && filters.partyTags.length > 0) {
      where.partyTags = { hasSome: filters.partyTags };
    }

    if (filters.householdName && filters.householdName.trim()) {
      where.householdName = {
        contains: filters.householdName.trim(),
        mode: 'insensitive',
      };
    }

    if (filters.attendanceStatus && filters.attendanceStatus !== 'all') {
      if (filters.attendanceStatus === 'attending') {
        where.used = true;
      } else if (filters.attendanceStatus === 'declined' || filters.attendanceStatus === 'pending') {
        where.used = false;
      }
    }

    if (filters.subEventId) {
      if (filters.subEventRsvpStatus && filters.subEventRsvpStatus !== 'all') {
        where.subEventRsvps = {
          some: {
            subEventId: filters.subEventId,
            status: filters.subEventRsvpStatus,
          },
        };
      } else {
        where.subEventAccesses = {
          some: {
            subEventId: filters.subEventId,
          },
        };
      }
    }

    if (filters.searchQuery && filters.searchQuery.trim()) {
      const q = filters.searchQuery.trim();
      where.OR = [
        { guestName: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { householdName: { contains: q, mode: 'insensitive' } },
      ];
    }

    return prisma.invitationCode.findMany({ where });
  }

  /**
   * Generates a preview rendered with context from a sample guest or defaults.
   */
  static async renderPreview(input: PreviewBroadcastInput) {
    const config = await getAppConfig('global');
    let sampleGuest: any = null;

    if (input.sampleGuestId) {
      sampleGuest = await prisma.invitationCode.findUnique({
        where: { id: input.sampleGuestId },
      });
    }

    if (!sampleGuest && input.targetFilters) {
      const matched = await this.resolveTargetGuests(input.targetFilters);
      if (matched.length > 0) {
        sampleGuest = matched[0];
      }
    }

    if (!sampleGuest) {
      sampleGuest = {
        guestName: 'Jane Doe',
        code: 'JANE2026',
        householdName: 'Doe Family',
        email: 'jane@example.com',
      };
    }

    const context = {
      guestName: sampleGuest.guestName || 'Valued Guest',
      invitationCode: sampleGuest.code || '',
      householdName: sampleGuest.householdName || '',
      weddingDate: config.weddingDate ? new Date(config.weddingDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '',
      venueName: config.venueName || '',
    };

    const renderedBody = renderBroadcastTemplate(input.body, context);
    const renderedSubject = input.subject ? renderBroadcastTemplate(input.subject, context) : undefined;

    const destination = input.channel === 'EMAIL'
      ? (sampleGuest.email || 'jane@example.com')
      : (sampleGuest.extraFields?.phone || sampleGuest.extraFields?.mobile || '+15551234567');

    return {
      channel: input.channel,
      subject: renderedSubject,
      body: renderedBody,
      sampleGuestName: sampleGuest.guestName,
      destination,
    };
  }

  /**
   * Dispatches a broadcast message to target recipients in configurable batches.
   */
  static async sendBroadcast(input: SendBroadcastInput) {
    const config = await getAppConfig('global');
    const guests = await this.resolveTargetGuests(input.targetFilters);

    if (guests.length === 0) {
      throw new Error('No target recipients found matching the filter criteria.');
    }

    // Create BroadcastMessage record
    const broadcastMessage = await prisma.broadcastMessage.create({
      data: {
        channel: input.channel,
        subject: input.subject || null,
        body: input.body,
        targetFilters: (input.targetFilters as any) || {},
        status: 'SENDING',
        totalRecipients: guests.length,
      },
    });

    // Create Recipient records
    const recipientRecords = [];
    for (const guest of guests) {
      const destination = input.channel === 'EMAIL'
        ? (guest.email || '')
        : ((guest.extraFields as any)?.phone || (guest.extraFields as any)?.mobile || '');

      const recipient = await prisma.broadcastRecipient.create({
        data: {
          broadcastId: broadcastMessage.id,
          invitationCodeId: guest.id,
          guestName: guest.guestName,
          destination: destination || 'Missing Contact Info',
          status: destination ? 'PENDING' : 'FAILED',
          error: destination ? null : `Missing ${input.channel === 'EMAIL' ? 'email address' : 'phone number'}`,
        },
      });
      recipientRecords.push({ recipient, guest });
    }

    const provider = new MultiChannelMessagingProvider(config);
    const batchSize = config.broadcastBatchSize || 50;
    const batchDelayMs = config.broadcastBatchDelayMs || 500;

    let sentCount = 0;
    let failedCount = recipientRecords.filter(r => r.recipient.status === 'FAILED').length;

    // Process pending recipients in batches
    const pendingItems = recipientRecords.filter(r => r.recipient.status === 'PENDING');

    for (let i = 0; i < pendingItems.length; i += batchSize) {
      const batch = pendingItems.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async ({ recipient, guest }) => {
          const context = {
            guestName: guest.guestName,
            invitationCode: guest.code,
            householdName: guest.householdName || '',
            weddingDate: config.weddingDate ? new Date(config.weddingDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '',
            venueName: config.venueName || '',
          };

          const personalizedBody = renderBroadcastTemplate(input.body, context);
          const personalizedSubject = input.subject ? renderBroadcastTemplate(input.subject, context) : '';

          let result: DispatchResult;
          if (input.channel === 'EMAIL') {
            result = await provider.sendEmail({
              to: recipient.destination,
              subject: personalizedSubject,
              body: personalizedBody,
            });
          } else {
            result = await provider.sendSms({
              to: recipient.destination,
              body: personalizedBody,
            });
          }

          if (result.success) {
            sentCount++;
            await prisma.broadcastRecipient.update({
              where: { id: recipient.id },
              data: {
                status: 'SENT',
                sentAt: new Date(),
              },
            });
          } else {
            failedCount++;
            await prisma.broadcastRecipient.update({
              where: { id: recipient.id },
              data: {
                status: 'FAILED',
                error: result.error || 'Dispatch failed',
              },
            });
          }
        })
      );

      if (i + batchSize < pendingItems.length && batchDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
      }
    }

    const finalStatus = failedCount === 0
      ? 'SENT'
      : sentCount > 0
        ? 'PARTIALLY_SENT'
        : 'FAILED';

    const updatedMessage = await prisma.broadcastMessage.update({
      where: { id: broadcastMessage.id },
      data: {
        status: finalStatus,
        sentCount,
        failedCount,
        sentAt: new Date(),
      },
      include: {
        recipients: true,
      },
    });

    return updatedMessage;
  }

  /**
   * Retrieves broadcast history records.
   */
  static async getBroadcastHistory(): Promise<BroadcastHistoryItem[]> {
    return prisma.broadcastMessage.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        recipients: true,
      },
    }) as any;
  }

  /**
   * Retries dispatches for failed recipients in a broadcast.
   */
  static async retryFailedRecipients(broadcastId: string, recipientIds?: string[]) {
    const config = await getAppConfig('global');
    const broadcast = await prisma.broadcastMessage.findUnique({
      where: { id: broadcastId },
      include: { recipients: { include: { invitationCode: true } } },
    });

    if (!broadcast) {
      throw new Error('Broadcast message not found.');
    }

    const failedRecipients = broadcast.recipients.filter((r) => {
      if (recipientIds && recipientIds.length > 0) {
        return recipientIds.includes(r.id);
      }
      return r.status === 'FAILED';
    });

    if (failedRecipients.length === 0) {
      return broadcast;
    }

    const provider = new MultiChannelMessagingProvider(config);
    let newlySent = 0;
    let stillFailed = 0;

    for (const recipient of failedRecipients) {
      const guest = recipient.invitationCode || {
        guestName: recipient.guestName,
        code: '',
        householdName: '',
      };

      const context = {
        guestName: recipient.guestName,
        invitationCode: guest.code || '',
        householdName: guest.householdName || '',
        weddingDate: config.weddingDate ? new Date(config.weddingDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '',
        venueName: config.venueName || '',
      };

      const personalizedBody = renderBroadcastTemplate(broadcast.body, context);
      const personalizedSubject = broadcast.subject ? renderBroadcastTemplate(broadcast.subject, context) : '';

      let result: DispatchResult;
      if (broadcast.channel === 'EMAIL') {
        result = await provider.sendEmail({
          to: recipient.destination,
          subject: personalizedSubject,
          body: personalizedBody,
        });
      } else {
        result = await provider.sendSms({
          to: recipient.destination,
          body: personalizedBody,
        });
      }

      if (result.success) {
        newlySent++;
        await prisma.broadcastRecipient.update({
          where: { id: recipient.id },
          data: {
            status: 'SENT',
            error: null,
            sentAt: new Date(),
          },
        });
      } else {
        stillFailed++;
        await prisma.broadcastRecipient.update({
          where: { id: recipient.id },
          data: {
            error: result.error || 'Retry failed',
          },
        });
      }
    }

    const updatedRecipients = await prisma.broadcastRecipient.findMany({
      where: { broadcastId },
    });

    const sentCount = updatedRecipients.filter((r) => r.status === 'SENT').length;
    const failedCount = updatedRecipients.filter((r) => r.status === 'FAILED').length;

    const finalStatus = failedCount === 0
      ? 'SENT'
      : sentCount > 0
        ? 'PARTIALLY_SENT'
        : 'FAILED';

    return prisma.broadcastMessage.update({
      where: { id: broadcastId },
      data: {
        status: finalStatus,
        sentCount,
        failedCount,
      },
      include: {
        recipients: true,
      },
    });
  }
}
