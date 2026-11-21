import { prisma } from '@/lib/prisma';
import { getAppConfig } from '@/lib/config';
import { ApiError } from '@/utils/ApiError';
import { generateSecureUUID } from '@/utils/uuid';
import {
  buildGuestRsvpUrl,
  escapeHtmlEntities,
  renderBroadcastTemplate,
  sanitizeEmailSubject,
} from './template';
import {
  filterTargetGuestsInMemory,
  getGuestPhone,
  hasBroadcastChannelContact,
} from './audience';

const RECIPIENT_CHUNK_SIZE = 250;
const DEFAULT_FALLBACK_ORIGIN = 'http://localhost:3000';

function resolveBroadcastBaseUrl(
  configBaseUrl: string | null | undefined,
  requestOrigin?: string
): { baseUrl: string; baseUrlWarning?: string } {
  const configured = (configBaseUrl || '').trim().replace(/\/+$/, '');
  if (configured) {
    return { baseUrl: configured };
  }

  const fallbackOrigin = (
    requestOrigin?.trim() ||
    DEFAULT_FALLBACK_ORIGIN
  ).replace(/\/+$/, '');

  const baseUrlWarning = `Site Base URL is empty in Settings; falling back to ${fallbackOrigin} for personalized RSVP links.`;
  console.warn(`[BroadcastService] ${baseUrlWarning}`);

  return {
    baseUrl: fallbackOrigin,
    baseUrlWarning,
  };
}
import { MultiChannelMessagingProvider } from './providers';
import {
  SendBroadcastInput,
  PreviewBroadcastInput,
  SendTestBroadcastInput,
  BroadcastTargetFilters,
  BroadcastHistoryItem,
  DispatchResult,
  BroadcastChannel,
  BroadcastTemplateContext,
} from './types';

type FinalBroadcastStatus = 'SENT' | 'PARTIALLY_SENT' | 'FAILED';

interface PreparedBroadcastRecipient {
  id: string;
  broadcastId: string;
  invitationCodeId: string | null;
  guestName: string;
  destination: string;
  status: string;
  error: string | null;
}

interface RecipientDispatchTarget {
  recipientId: string;
  destination: string;
  guestName: string;
  code?: string | null;
  householdName?: string | null;
}

interface RecipientBatchOutcome {
  target: RecipientDispatchTarget;
  result: DispatchResult;
}

export class BroadcastService {
  private static formatWeddingDate(weddingDate?: Date | string | null): string {
    return weddingDate
      ? new Date(weddingDate).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
      : '';
  }

  private static buildTemplateContext(
    guest: {
      guestName?: string | null;
      code?: string | null;
      householdName?: string | null;
    },
    config: { weddingDate?: Date | string | null; venueName?: string | null } | null | undefined,
    baseUrl: string
  ): BroadcastTemplateContext {
    const invitationCode = guest.code || '';
    return {
      guestName: guest.guestName ?? '',
      invitationCode,
      code: invitationCode,
      rsvpUrl: buildGuestRsvpUrl(baseUrl, invitationCode),
      baseUrl,
      householdName: guest.householdName || '',
      weddingDate: this.formatWeddingDate(config?.weddingDate),
      venueName: config?.venueName || '',
    };
  }

  private static renderMessageContent(params: {
    guest: {
      guestName?: string | null;
      code?: string | null;
      householdName?: string | null;
    };
    config: { weddingDate?: Date | string | null; venueName?: string | null } | null | undefined;
    baseUrl: string;
    channel: BroadcastChannel;
    body: string;
    subject?: string | null;
    escapeEmailBody?: boolean;
    isTest?: boolean;
  }): { body: string; subject: string | undefined } {
    const context = this.buildTemplateContext(params.guest, params.config, params.baseUrl);
    const isEmail = params.channel === 'EMAIL';
    const escapeHtml = isEmail && (params.escapeEmailBody ?? true);
    const renderedBody = renderBroadcastTemplate(params.body, context, { escapeHtml });

    if (params.isTest) {
      if (!isEmail) {
        return { body: renderedBody, subject: undefined };
      }
      const sanitizedSubject = params.subject
        ? sanitizeEmailSubject(renderBroadcastTemplate(params.subject, context))
        : '';
      const baseSubject = sanitizedSubject || 'Broadcast Test';
      const prefixedSubject = baseSubject.startsWith('[TEST]')
        ? baseSubject
        : `[TEST] ${baseSubject}`;
      return { body: renderedBody, subject: prefixedSubject };
    }

    if (!params.subject) {
      return { body: renderedBody, subject: undefined };
    }

    const rawSubject = renderBroadcastTemplate(params.subject, context);
    const renderedSubject = isEmail ? sanitizeEmailSubject(rawSubject) : rawSubject;
    return { body: renderedBody, subject: renderedSubject };
  }

  private static async dispatchChannelMessage(
    provider: MultiChannelMessagingProvider,
    channel: BroadcastChannel,
    to: string,
    body: string,
    subject?: string
  ): Promise<DispatchResult> {
    if (channel === 'EMAIL') {
      return provider.sendEmail({
        to,
        subject: subject ?? '',
        body,
      });
    }
    return provider.sendSms({
      to,
      body,
    });
  }

  private static deriveBroadcastStatus(
    sentCount: number,
    failedCount: number
  ): FinalBroadcastStatus {
    if (failedCount === 0) {
      return 'SENT';
    }
    return sentCount > 0 ? 'PARTIALLY_SENT' : 'FAILED';
  }

  private static async persistDispatchBatch(outcomes: RecipientBatchOutcome[]): Promise<void> {
    await Promise.all(
      outcomes.map(({ target, result }) =>
        result.success
          ? prisma.broadcastRecipient.update({
            where: { id: target.recipientId },
            data: {
              status: 'SENT',
              sentAt: new Date(),
            },
          })
          : prisma.broadcastRecipient.update({
            where: { id: target.recipientId },
            data: {
              status: 'FAILED',
              error: result.error || 'Dispatch failed',
            },
          })
      )
    );
  }

  private static async persistRetryBatch(outcomes: RecipientBatchOutcome[]): Promise<void> {
    const successfulRecipientIds = outcomes
      .filter((item) => item.result.success)
      .map((item) => item.target.recipientId);
    const failedBatchItems = outcomes.filter((item) => !item.result.success);

    const updatePromises: Promise<unknown>[] = [];

    if (successfulRecipientIds.length > 0) {
      updatePromises.push(
        prisma.broadcastRecipient.updateMany({
          where: { id: { in: successfulRecipientIds } },
          data: {
            status: 'SENT',
            error: null,
            sentAt: new Date(),
          },
        })
      );
    }

    for (const item of failedBatchItems) {
      updatePromises.push(
        prisma.broadcastRecipient.update({
          where: { id: item.target.recipientId },
          data: {
            status: 'FAILED',
            error: item.result.error || 'Retry failed',
          },
        })
      );
    }

    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
    }
  }

  private static async runThrottledRecipientBatches(params: {
    targets: RecipientDispatchTarget[];
    channel: BroadcastChannel;
    subject?: string | null;
    body: string;
    config: any;
    baseUrl: string;
    persistBatch: (_outcomes: RecipientBatchOutcome[]) => Promise<void>;
  }): Promise<{ sentCount: number; failedCount: number }> {
    const { targets, channel, subject, body, config, baseUrl, persistBatch } = params;
    const provider = new MultiChannelMessagingProvider(config);
    const batchSize = config.broadcastBatchSize ?? 50;
    const batchDelayMs = config.broadcastBatchDelayMs ?? 500;

    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize);

      const outcomes: RecipientBatchOutcome[] = await Promise.all(
        batch.map(async (target) => {
          const rendered = this.renderMessageContent({
            guest: target,
            config,
            baseUrl,
            channel,
            body,
            subject,
          });
          const result = await this.dispatchChannelMessage(
            provider,
            channel,
            target.destination,
            rendered.body,
            rendered.subject
          );
          return { target, result };
        })
      );

      for (const { result } of outcomes) {
        if (result.success) {
          sentCount++;
        } else {
          failedCount++;
        }
      }

      await persistBatch(outcomes);

      if (i + batchSize < targets.length && batchDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
      }
    }

    return { sentCount, failedCount };
  }
  /**
   * Resolves target invitation code records based on filter criteria.
   */
  static async resolveTargetGuests(filters?: BroadcastTargetFilters) {
    if (!filters) {
      const allRecords = await prisma.invitationCode.findMany();
      return Array.isArray(allRecords)
        ? filterTargetGuestsInMemory(allRecords)
        : allRecords;
    }

    const where: any = {};
    let isPublicSubEvent = false;

    if (filters.selectedIds && filters.selectedIds.length > 0) {
      where.id = { in: filters.selectedIds };
    } else {
      if (filters.partyTags && filters.partyTags.length > 0) {
        where.partyTags = { hasSome: filters.partyTags };
      }

      if (filters.householdName && filters.householdName.trim()) {
        where.householdName = {
          contains: filters.householdName.trim(),
          mode: 'insensitive',
        };
      }

      if (filters.status === 'redeemed') {
        where.used = true;
      } else if (filters.status === 'unused') {
        where.used = false;
      }

      if (filters.partyGroup && filters.partyGroup !== 'all') {
        where.partyGroup = filters.partyGroup;
      }

      if (filters.subEventId) {
        const subEvent =
          typeof (prisma as any).subEvent?.findUnique === 'function'
            ? await (prisma as any).subEvent.findUnique({
              where: { id: filters.subEventId },
              select: { id: true, isPrivate: true },
            })
            : undefined;

        isPublicSubEvent = Boolean(subEvent && subEvent.isPrivate === false);
        const rsvpStatus = filters.subEventRsvpStatus || 'all';
        const andClauses: any[] = [];

        if (!isPublicSubEvent) {
          andClauses.push({
            subEventAccesses: {
              some: {
                subEventId: filters.subEventId,
              },
            },
          });
        }

        if (rsvpStatus === 'pending') {
          andClauses.push({
            OR: [
              {
                subEventRsvps: {
                  none: {
                    subEventId: filters.subEventId,
                  },
                },
              },
              {
                subEventRsvps: {
                  some: {
                    subEventId: filters.subEventId,
                    status: 'pending',
                  },
                },
              },
            ],
          });
        } else if (rsvpStatus !== 'all') {
          andClauses.push({
            subEventRsvps: {
              some: {
                subEventId: filters.subEventId,
                status: rsvpStatus,
              },
            },
          });
        }

        if (andClauses.length === 1 && !('OR' in andClauses[0])) {
          Object.assign(where, andClauses[0]);
        } else if (andClauses.length > 0) {
          where.AND = andClauses;
        }
      }
    }

    const records = await prisma.invitationCode.findMany({ where });

    if (!Array.isArray(records)) {
      return records;
    }

    return filterTargetGuestsInMemory(records, filters, {
      applyDbPredicates: false,
      isPublicSubEvent,
    });
  }

  /**
   * Generates a preview rendered with context from a sample guest or defaults.
   */
  static async renderPreview(input: PreviewBroadcastInput) {
    const config = await getAppConfig('global');
    const { baseUrl, baseUrlWarning } = resolveBroadcastBaseUrl(
      (config as any)?.baseUrl,
      input.requestOrigin
    );
    let sampleGuest: any = null;
    let matchedGuests: any[] | null = null;

    if (input.sampleGuestId) {
      sampleGuest = await prisma.invitationCode.findUnique({
        where: { id: input.sampleGuestId },
      });
    }

    if (!input.sampleGuestId || input.targetFilters) {
      const matched = await this.resolveTargetGuests(input.targetFilters);
      if (Array.isArray(matched)) {
        matchedGuests = matched;
        if (!sampleGuest && matched.length > 0) {
          sampleGuest = matched[0];
        }
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

    const rendered = this.renderMessageContent({
      guest: {
        guestName: sampleGuest.guestName || 'Valued Guest',
        code: sampleGuest.code,
        householdName: sampleGuest.householdName,
      },
      config,
      baseUrl,
      channel: input.channel,
      body: input.body,
      subject: input.subject,
      escapeEmailBody: false,
    });

    const destination = input.channel === 'EMAIL'
      ? (sampleGuest.email || 'jane@example.com')
      : (getGuestPhone(sampleGuest) || '+15551234567');

    const audienceCounts =
      matchedGuests !== null
        ? {
          recipientCount: matchedGuests.length,
          matchedCount: matchedGuests.length,
          missingContactCount: matchedGuests.filter(
            (g) => !hasBroadcastChannelContact(g, input.channel)
          ).length,
        }
        : {};

    return {
      channel: input.channel,
      subject: rendered.subject,
      body: rendered.body,
      sampleGuestName: sampleGuest.guestName,
      destination,
      ...audienceCounts,
      ...(baseUrlWarning ? { baseUrlWarning } : {}),
    };
  }

  /**
   * Dispatches a single test broadcast message to a host destination.
   * Renders sample context without reading guest records or creating database entries.
   */
  static async sendTestBroadcast(input: SendTestBroadcastInput) {
    const config = await getAppConfig('global');
    const { baseUrl, baseUrlWarning } = resolveBroadcastBaseUrl(
      (config as any)?.baseUrl,
      input.requestOrigin
    );

    // Resolve destination: custom override or administrator contact details from application configuration
    const destination = (input.destination?.trim()) ||
      (input.channel === 'EMAIL' ? config.contactEmail : config.twilioFromNumber);

    if (!destination) {
      throw new Error(`Recipient ${input.channel === 'EMAIL' ? 'email address' : 'phone number'} is required. No destination specified or configured.`);
    }

    if (input.channel === 'EMAIL') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(destination)) {
        throw new Error('Invalid email address format for test destination.');
      }
    } else if (input.channel === 'SMS') {
      const e164Regex = /^\+[1-9]\d{1,14}$/;
      if (!e164Regex.test(destination)) {
        throw new Error('Invalid phone number format. Must be in E.164 format (e.g. +15551234567).');
      }
    }

    const rendered = this.renderMessageContent({
      guest: { guestName: 'Jane Doe', code: 'SAMPLE2026', householdName: 'Doe Family' },
      config,
      baseUrl,
      channel: input.channel,
      body: input.body,
      subject: input.subject,
      isTest: true,
    });

    const provider = new MultiChannelMessagingProvider(config);
    const result = await this.dispatchChannelMessage(
      provider,
      input.channel,
      destination,
      rendered.body,
      rendered.subject
    );

    if (!result.success) {
      throw new Error(result.error || `Failed to dispatch test ${input.channel.toLowerCase()}.`);
    }

    return {
      success: true,
      channel: input.channel,
      destination,
      subject: rendered.subject,
      body: rendered.body,
      ...(baseUrlWarning ? { baseUrlWarning } : {}),
    };
  }

  /**
   * Dispatches a broadcast message to target recipients in configurable batches, or schedules it for future dispatch.
   */
  static async sendBroadcast(input: SendBroadcastInput) {
    const config = await getAppConfig('global');
    const guests = await this.resolveTargetGuests(input.targetFilters);

    if (guests.length === 0) {
      throw new Error('No target recipients found matching the filter criteria.');
    }

    const scheduledDate = input.scheduledFor ? new Date(input.scheduledFor) : null;
    const isFutureScheduled = scheduledDate && !isNaN(scheduledDate.getTime()) && scheduledDate > new Date();

    if (isFutureScheduled) {
      const { baseUrlWarning } = resolveBroadcastBaseUrl(
        (config as any)?.baseUrl,
        input.requestOrigin
      );
      const broadcastMessage = await prisma.broadcastMessage.create({
        data: {
          channel: input.channel,
          subject: input.subject || null,
          body: input.body,
          targetFilters: (input.targetFilters as any) || {},
          status: 'SCHEDULED',
          scheduledFor: scheduledDate,
          totalRecipients: guests.length,
        },
        include: {
          recipients: true,
        },
      });
      return baseUrlWarning ? { ...broadcastMessage, baseUrlWarning } : broadcastMessage;
    }

    return this.executeDispatch(
      input.channel,
      input.subject,
      input.body,
      input.targetFilters,
      config,
      guests,
      scheduledDate || undefined,
      undefined,
      input.requestOrigin
    );
  }

  /**
   * Private helper to execute dispatch for a broadcast message.
   */
  private static async executeDispatch(
    channel: BroadcastChannel,
    subject: string | undefined | null,
    body: string,
    targetFilters: BroadcastTargetFilters | undefined,
    config: any,
    guests: any[],
    scheduledFor?: Date,
    existingBroadcastId?: string,
    requestOrigin?: string
  ) {
    const { baseUrl, baseUrlWarning } = resolveBroadcastBaseUrl(config?.baseUrl, requestOrigin);
    let broadcastMessage;
    if (existingBroadcastId) {
      broadcastMessage = await prisma.broadcastMessage.findUnique({ where: { id: existingBroadcastId } });
    } else {
      broadcastMessage = await prisma.broadcastMessage.create({
        data: {
          channel,
          subject: subject || null,
          body,
          targetFilters: (targetFilters as any) || {},
          status: 'SENDING',
          totalRecipients: guests.length,
          scheduledFor: scheduledFor || null,
        },
      });
    }

    if (!broadcastMessage) {
      throw new Error('Broadcast message record not found');
    }

    // Validate and prepare all recipient records in memory
    const recipientRecords: {
      recipient: PreparedBroadcastRecipient;
      guest: any;
    }[] = [];

    const preparedRecipients: PreparedBroadcastRecipient[] = [];

    for (const guest of guests) {
      const destination = channel === 'EMAIL'
        ? (guest.email || '')
        : getGuestPhone(guest);

      const isValid = Boolean(destination);
      const recipientId = generateSecureUUID();
      const recipientData = {
        id: recipientId,
        broadcastId: broadcastMessage.id,
        invitationCodeId: guest.id || null,
        guestName: guest.guestName,
        destination: destination || 'Missing Contact Info',
        status: isValid ? 'PENDING' : 'FAILED',
        error: isValid ? null : `Missing ${channel === 'EMAIL' ? 'email address' : 'phone number'}`,
      };

      preparedRecipients.push(recipientData);
      recipientRecords.push({ recipient: recipientData, guest });
    }

    // Persist recipients in fixed chunks using transactional bulk createMany
    if (preparedRecipients.length > 0) {
      const chunks: (typeof preparedRecipients)[] = [];
      for (let i = 0; i < preparedRecipients.length; i += RECIPIENT_CHUNK_SIZE) {
        chunks.push(preparedRecipients.slice(i, i + RECIPIENT_CHUNK_SIZE));
      }

      const insertChunk = async (client: any, chunk: typeof preparedRecipients) => {
        if (typeof client.broadcastRecipient?.createMany === 'function') {
          await client.broadcastRecipient.createMany({ data: chunk });
        } else if (typeof client.broadcastRecipient?.create === 'function') {
          for (const item of chunk) {
            await client.broadcastRecipient.create({ data: item });
          }
        }
      };

      if (typeof prisma.$transaction === 'function') {
        await prisma.$transaction(async (tx) => {
          for (const chunk of chunks) {
            await insertChunk(tx, chunk);
          }
        });
      } else {
        for (const chunk of chunks) {
          await insertChunk(prisma, chunk);
        }
      }
    }

    const initialFailedCount = recipientRecords.filter((r) => r.recipient.status === 'FAILED').length;
    const targets: RecipientDispatchTarget[] = recipientRecords
      .filter((r) => r.recipient.status === 'PENDING')
      .map(({ recipient, guest }) => ({
        recipientId: recipient.id,
        destination: recipient.destination,
        guestName: guest.guestName,
        code: guest.code,
        householdName: guest.householdName,
      }));

    const batchCounts = await this.runThrottledRecipientBatches({
      targets,
      channel,
      subject,
      body,
      config,
      baseUrl,
      persistBatch: (outcomes) => this.persistDispatchBatch(outcomes),
    });

    const sentCount = batchCounts.sentCount;
    const failedCount = initialFailedCount + batchCounts.failedCount;
    const finalStatus = this.deriveBroadcastStatus(sentCount, failedCount);

    const updatedMessage = await prisma.broadcastMessage.update({
      where: { id: broadcastMessage.id },
      data: {
        status: finalStatus,
        sentCount,
        failedCount,
        totalRecipients: guests.length,
        sentAt: new Date(),
      },
      include: {
        recipients: true,
      },
    });

    return baseUrlWarning && updatedMessage
      ? { ...updatedMessage, baseUrlWarning }
      : updatedMessage;
  }

  /**
   * Processes all due scheduled broadcasts whose scheduledFor timestamp is in the past or present.
   * Uses atomic status updates to prevent race conditions across parallel workers.
   */
  static async processScheduledBroadcasts(requestOrigin?: string) {
    const now = new Date();
    const config = await getAppConfig('global');

    const dueBroadcasts = await prisma.broadcastMessage.findMany({
      where: {
        status: 'SCHEDULED',
        scheduledFor: {
          lte: now,
        },
      },
    });

    const processed = [];

    for (const broadcast of dueBroadcasts) {
      // Atomic state update from SCHEDULED to SENDING
      const updateResult = await prisma.broadcastMessage.updateMany({
        where: {
          id: broadcast.id,
          status: 'SCHEDULED',
        },
        data: {
          status: 'SENDING',
        },
      });

      if (updateResult.count === 0) {
        // Concurrently processed by another worker
        continue;
      }

      // Resolve guests at execution time
      const guests = await this.resolveTargetGuests(broadcast.targetFilters as BroadcastTargetFilters);

      const result = await this.executeDispatch(
        (broadcast.channel as unknown) as BroadcastChannel,
        broadcast.subject,
        broadcast.body,
        broadcast.targetFilters as BroadcastTargetFilters,
        config,
        guests,
        broadcast.scheduledFor || undefined,
        broadcast.id,
        requestOrigin
      );

      processed.push(result);
    }

    return processed;
  }

  /**
   * Cancels a pending scheduled broadcast.
   */
  static async cancelScheduledBroadcast(id: string) {
    const broadcast = await prisma.broadcastMessage.findUnique({
      where: { id },
    });

    if (!broadcast) {
      throw new Error('Broadcast message not found.');
    }

    if (broadcast.status !== 'SCHEDULED') {
      throw new Error('Only pending scheduled broadcasts can be cancelled.');
    }

    return prisma.broadcastMessage.update({
      where: { id },
      data: {
        status: 'CANCELLED',
      },
      include: {
        recipients: true,
      },
    });
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
  static async retryFailedRecipients(
    broadcastId: string,
    recipientIds?: string[],
    requestOrigin?: string
  ) {
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

    const { baseUrl, baseUrlWarning } = resolveBroadcastBaseUrl(
      (config as any)?.baseUrl,
      requestOrigin
    );
    const targets: RecipientDispatchTarget[] = failedRecipients.map((recipient) => ({
      recipientId: recipient.id,
      destination: recipient.destination,
      guestName: recipient.guestName,
      code: recipient.invitationCode?.code,
      householdName: recipient.invitationCode?.householdName,
    }));

    await this.runThrottledRecipientBatches({
      targets,
      channel: broadcast.channel as BroadcastChannel,
      subject: broadcast.subject,
      body: broadcast.body,
      config,
      baseUrl,
      persistBatch: (outcomes) => this.persistRetryBatch(outcomes),
    });

    const [sentCount, failedCount] = await Promise.all([
      prisma.broadcastRecipient.count({
        where: { broadcastId, status: 'SENT' },
      }),
      prisma.broadcastRecipient.count({
        where: { broadcastId, status: 'FAILED' },
      }),
    ]);

    const finalStatus = this.deriveBroadcastStatus(sentCount, failedCount);

    const updatedBroadcast = await prisma.broadcastMessage.update({
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

    return baseUrlWarning && updatedBroadcast
      ? { ...updatedBroadcast, baseUrlWarning }
      : updatedBroadcast;
  }

  /**
   * Dispatches an automated host alert email to AppConfig.contactEmail when a guest
   * cannot find their invitation by name lookup.
   */
  static async sendGuestLookupAlert(params: {
    guestName: string;
    guestEmail: string;
    message?: string;
  }): Promise<{ delivered: true }> {
    const config = await getAppConfig('global');
    const contactEmail = typeof config?.contactEmail === 'string' ? config.contactEmail.trim() : '';
    const isValidContactEmail =
      contactEmail.length > 0 &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail) &&
      contactEmail.toLowerCase() !== 'hosts@wedding.example';

    if (!isValidContactEmail) {
      throw new ApiError(
        503,
        'Host contact email is not configured yet. Please reach out to the couple directly.'
      );
    }

    const cleanGuestName = params.guestName.trim();
    const cleanGuestEmail = params.guestEmail.trim();
    const cleanMessage = (params.message || '').trim();

    const subject = sanitizeEmailSubject(`[RSVP Name Lookup Help] ${cleanGuestName}`);
    const bodySections = [
      'A guest could not locate their wedding invitation by name and requested help:',
      `Guest Name: ${escapeHtmlEntities(cleanGuestName)}\nReply Email: ${escapeHtmlEntities(cleanGuestEmail)}\nSubmitted At: ${new Date().toISOString()}`,
    ];

    if (cleanMessage) {
      bodySections.push(`Guest Note:\n${escapeHtmlEntities(cleanMessage)}`);
    }

    const provider = new MultiChannelMessagingProvider(config);
    const result = await provider.sendEmail({
      to: contactEmail,
      subject: subject || '[RSVP Name Lookup Help] Guest Assistance Request',
      body: bodySections.join('\n\n'),
    });

    if (!result.success) {
      throw new ApiError(
        502,
        result.error || 'Unable to send host alert email right now. Please try again later.'
      );
    }

    return { delivered: true };
  }
}
