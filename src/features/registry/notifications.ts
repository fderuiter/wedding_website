import { z } from 'zod';
import { getAppConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { formatCurrency } from '@/utils/intl';
import { registryRepository } from './repository';
import { registryService } from './service';
import type { IRegistryRepository } from './types';
import { getPaymentUrl } from './utils/paymentUrls';

const VALID_EMAIL_SCHEMA = z.email();
const ACTIVE_EMAIL_PROVIDERS = new Set(['smtp', 'resend', 'sendgrid']);
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

interface ContributorCandidate {
  id?: string;
  name?: string;
  email?: string | null;
  amount?: number;
  coverFee?: boolean;
  feeAmount?: number;
  message?: string | null;
  date?: Date | string;
  stripePaymentIntentId?: string | null;
  transactionTimestamp?: Date | string | null;
}

interface ItemSnapshot {
  id?: string;
  name?: string;
  itemType?: string;
  isGroupGift?: boolean;
  paymentHandle?: string | null;
  paymentHandleType?: string | null;
  contributors?: ContributorCandidate[];
}

interface DispatchContributionNotificationsParams {
  itemId: string;
  targetItem?: ItemSnapshot | null;
  updatedItem?: ItemSnapshot | null;
  contribution: {
    name: string;
    email?: string | null;
    amount: number;
    message?: string | null;
    coverFee?: boolean;
    stripePaymentIntentId?: string | null;
    transactionTimestamp?: Date | string | null;
  };
  config?: Record<string, any> | null;
  requestUrl?: string;
  repository?: IRegistryRepository;
}

function isEmailProviderConfigured(config: Record<string, any> | null | undefined): boolean {
  const raw =
    typeof config?.emailProvider === 'string' ? config.emailProvider.trim().toLowerCase() : '';
  return ACTIVE_EMAIL_PROVIDERS.has(raw);
}

function isValidEmail(value: string | null | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return VALID_EMAIL_SCHEMA.safeParse(trimmed).success;
}

function resolveBaseUrl(
  config: Record<string, any> | null | undefined,
  requestUrl?: string
): string {
  const configured = typeof config?.baseUrl === 'string' ? config.baseUrl.trim() : '';
  if (configured.startsWith('http://') || configured.startsWith('https://')) {
    return configured.replace(/\/+$/, '');
  }
  if (requestUrl) {
    try {
      return new URL(requestUrl).origin.replace(/\/+$/, '');
    } catch {
      // Ignore malformed request URLs
    }
  }
  return '';
}

function formatContributionDate(
  rawDate: Date | string | null | undefined,
  timezone?: string
): string {
  const parsed = rawDate ? new Date(rawDate) : new Date();
  const effectiveDate = isNaN(parsed.getTime()) ? new Date() : parsed;
  const tz = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'UTC';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: tz,
    }).format(effectiveDate);
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(effectiveDate);
  }
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeProviderFailureReason(
  rawReason: unknown,
  sensitiveValues: Array<string | null | undefined>
): string {
  const baseMessage =
    rawReason instanceof Error
      ? rawReason.message
      : typeof rawReason === 'string'
        ? rawReason
        : 'Email dispatch failed';

  let sanitized = baseMessage.replace(EMAIL_PATTERN, '[REDACTED_EMAIL]');
  for (const candidate of sensitiveValues) {
    const trimmed = typeof candidate === 'string' ? candidate.trim() : '';
    if (trimmed.length >= 2) {
      sanitized = sanitized.replace(new RegExp(escapeRegExp(trimmed), 'gi'), '[REDACTED]');
    }
  }
  return sanitized.slice(0, 300);
}

async function resolveSavedContributor(
  params: DispatchContributionNotificationsParams,
  dbClient: any
): Promise<ContributorCandidate | null> {
  const { targetItem, updatedItem, contribution } = params;
  const updatedContributors = Array.isArray(updatedItem?.contributors)
    ? updatedItem!.contributors!
    : [];

  if (contribution.stripePaymentIntentId) {
    const matchedInItem = updatedContributors.find(
      (c) => c?.stripePaymentIntentId === contribution.stripePaymentIntentId
    );
    if (matchedInItem) {
      return matchedInItem;
    }
    if (typeof dbClient?.contributor?.findFirst === 'function') {
      const fromDb = await dbClient.contributor.findFirst({
        where: { stripePaymentIntentId: contribution.stripePaymentIntentId },
      });
      if (fromDb) {
        return fromDb;
      }
    }
    if (updatedItem) {
      return {
        name: contribution.name,
        email: contribution.email,
        amount: contribution.amount,
        coverFee: contribution.coverFee,
        message: contribution.message,
        stripePaymentIntentId: contribution.stripePaymentIntentId,
        transactionTimestamp: contribution.transactionTimestamp,
      };
    }
    return null;
  }

  const previousIds = new Set(
    (Array.isArray(targetItem?.contributors) ? targetItem!.contributors! : [])
      .map((c) => c?.id)
      .filter((id): id is string => Boolean(id))
  );

  const newlyAdded = updatedContributors.filter((c) => c?.id && !previousIds.has(c.id));
  if (newlyAdded.length > 0) {
    return newlyAdded[newlyAdded.length - 1];
  }

  for (let i = updatedContributors.length - 1; i >= 0; i -= 1) {
    const candidate = updatedContributors[i];
    if (
      candidate &&
      candidate.name === contribution.name &&
      candidate.amount === contribution.amount
    ) {
      return candidate;
    }
  }

  if (updatedContributors.length > 0) {
    return updatedContributors[updatedContributors.length - 1];
  }

  return null;
}

async function claimSendTimestamp(
  contributor: ContributorCandidate,
  kind: 'confirmation' | 'alert',
  repository: IRegistryRepository | undefined,
  dbClient: any
): Promise<boolean> {
  if (contributor.id) {
    if (repository && typeof repository.claimContributorEmailSend === 'function') {
      return repository.claimContributorEmailSend(contributor.id, kind);
    }
    if (typeof registryService?.claimContributorEmailSend === 'function') {
      return registryService.claimContributorEmailSend(contributor.id, kind);
    }
    if (typeof registryRepository?.claimContributorEmailSend === 'function') {
      return registryRepository.claimContributorEmailSend(contributor.id, kind);
    }
  }

  if (
    contributor.stripePaymentIntentId &&
    typeof dbClient?.contributor?.updateMany === 'function'
  ) {
    const field = kind === 'confirmation' ? 'confirmationEmailSentAt' : 'alertEmailSentAt';
    const res = await dbClient.contributor.updateMany({
      where: {
        stripePaymentIntentId: contributor.stripePaymentIntentId,
        [field]: null,
      },
      data: {
        [field]: new Date(),
      },
    });
    return Boolean(res && res.count === 1);
  }

  return false;
}

function buildGuestConfirmationEmail(options: {
  contributorName: string;
  itemName: string;
  isFund: boolean;
  paymentHandle: string;
  paymentHandleType: string;
  baseAmount: number;
  coverFee: boolean;
  feeAmount: number;
  totalCharged: number;
  stripePaymentIntentId: string | null;
  referenceId: string;
  formattedDate: string;
  registryUrl: string;
  escapeHtmlEntities: (text: string) => string;
  sanitizeEmailSubject: (subject: string) => string;
}): { subject: string; body: string } {
  const {
    contributorName,
    itemName,
    isFund,
    paymentHandle,
    paymentHandleType,
    baseAmount,
    coverFee,
    feeAmount,
    totalCharged,
    stripePaymentIntentId,
    referenceId,
    formattedDate,
    registryUrl,
    escapeHtmlEntities,
    sanitizeEmailSubject,
  } = options;

  const isSelfReportedFundTransfer = isFund && !stripePaymentIntentId;
  const subject = sanitizeEmailSubject(
    isSelfReportedFundTransfer
      ? `Gift Transfer Recorded: ${itemName}`
      : `Gift Confirmation: ${itemName}`
  );

  const safeGuestName = escapeHtmlEntities(contributorName || 'Friend');
  const safeItemName = escapeHtmlEntities(itemName);
  const safeDate = escapeHtmlEntities(formattedDate);
  const safeReferenceId = escapeHtmlEntities(referenceId);
  const safeRegistryUrl = escapeHtmlEntities(registryUrl);

  const formattedBase = escapeHtmlEntities(formatCurrency(baseAmount));
  const formattedTotal = escapeHtmlEntities(formatCurrency(totalCharged));
  const formattedFee = escapeHtmlEntities(formatCurrency(feeAmount));

  let feeCoverageText: string;
  if (stripePaymentIntentId && coverFee) {
    feeCoverageText = `Covered by guest (+${formattedFee} processing fee; ${formattedTotal} total charged)`;
  } else if (stripePaymentIntentId) {
    feeCoverageText = `Standard processing fee not added (${formattedBase} total charged)`;
  } else {
    feeCoverageText = 'No processing fee ($0.00)';
  }

  let transferReminderBlock = '';
  if (isSelfReportedFundTransfer) {
    const handleLabel = escapeHtmlEntities(paymentHandleType || 'Direct Transfer');
    const safeHandle = escapeHtmlEntities(paymentHandle || 'configured payment handle');
    const externalUrl = getPaymentUrl(paymentHandleType || null, paymentHandle || null);
    const safeExternalUrl =
      externalUrl && (externalUrl.startsWith('https://') || externalUrl.startsWith('http://'))
        ? escapeHtmlEntities(externalUrl)
        : '';

    transferReminderBlock = `
      <div style="margin:16px 0;padding:14px 16px;background-color:#fffbeb;border:1px solid #f59e0b;border-radius:8px;color:#78350f;">
        <p style="margin:0 0 8px 0;font-weight:700;">Reminder: Please finish sending your transfer externally</p>
        <p style="margin:0;">
          No card was charged on this website. If you have not sent your funds yet, please send
          <strong>${formattedBase}</strong> via <strong>${handleLabel}</strong> to
          <code>${safeHandle}</code>${
            safeExternalUrl
              ? ` (<a href="${safeExternalUrl}" style="color:#b45309;font-weight:600;">Open ${handleLabel}</a>)`
              : ''
          }.
        </p>
      </div>
    `;
  }

  const body = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.5;">
      <h2 style="margin:0 0 12px 0;color:#111827;">Thank you for your gift, ${safeGuestName}!</h2>
      <p style="margin:0 0 16px 0;">
        ${
          isSelfReportedFundTransfer
            ? `We recorded your self-reported contribution toward <strong>${safeItemName}</strong>.`
            : `Your gift toward <strong>${safeItemName}</strong> has been confirmed.`
        }
      </p>
      ${transferReminderBlock}
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
        <tbody>
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:600;">Item</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${safeItemName}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:600;">Gift Amount</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${formattedBase}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:600;">Fee Coverage</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${feeCoverageText}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:600;">Date</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${safeDate}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:600;">Reference ID</td>
            <td style="padding:10px 14px;font-family:monospace;">${safeReferenceId}</td>
          </tr>
        </tbody>
      </table>
      <p style="margin:20px 0 0 0;">
        <a href="${safeRegistryUrl}" style="display:inline-block;padding:10px 18px;background-color:#b91c1c;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">
          Browse More on the Registry
        </a>
      </p>
    </div>
  `.trim();

  return { subject, body };
}

function buildCoupleAlertEmail(options: {
  contributorName: string;
  itemName: string;
  baseAmount: number;
  coverFee: boolean;
  feeAmount: number;
  paymentTypeLabel: string;
  guestMessage: string | null;
  dashboardUrl: string;
  escapeHtmlEntities: (text: string) => string;
  sanitizeEmailSubject: (subject: string) => string;
}): { subject: string; body: string } {
  const {
    contributorName,
    itemName,
    baseAmount,
    coverFee,
    feeAmount,
    paymentTypeLabel,
    guestMessage,
    dashboardUrl,
    escapeHtmlEntities,
    sanitizeEmailSubject,
  } = options;

  const subject = sanitizeEmailSubject(`New Registry Gift: ${itemName} from ${contributorName}`);
  const safeContributorName = escapeHtmlEntities(contributorName || 'Anonymous Guest');
  const safeItemName = escapeHtmlEntities(itemName);
  const safePaymentType = escapeHtmlEntities(paymentTypeLabel);
  const safeNote = guestMessage && guestMessage.trim()
    ? escapeHtmlEntities(guestMessage.trim())
    : 'No personal note included.';
  const safeDashboardUrl = escapeHtmlEntities(dashboardUrl);

  const amountSummary =
    coverFee && feeAmount > 0
      ? `${escapeHtmlEntities(formatCurrency(baseAmount))} (+${escapeHtmlEntities(formatCurrency(feeAmount))} processing fee covered)`
      : escapeHtmlEntities(formatCurrency(baseAmount));

  const body = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.5;">
      <h2 style="margin:0 0 12px 0;color:#111827;">New Registry Contribution Recorded</h2>
      <p style="margin:0 0 16px 0;">
        <strong>${safeContributorName}</strong> recorded a gift on your wedding registry.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
        <tbody>
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:600;">Contributor</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${safeContributorName}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:600;">Item</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${safeItemName}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:600;">Amount</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${amountSummary}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:600;">Payment Type</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${safePaymentType}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;font-weight:600;">Guest Note</td>
            <td style="padding:10px 14px;">${safeNote}</td>
          </tr>
        </tbody>
      </table>
      <p style="margin:20px 0 0 0;">
        <a href="${safeDashboardUrl}" style="display:inline-block;padding:10px 18px;background-color:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">
          View Gift in Dashboard
        </a>
      </p>
    </div>
  `.trim();

  return { subject, body };
}

/**
 * Dispatches post-contribution guest confirmation and couple alert emails inline.
 * Uses atomic timestamp claims on Contributor to guarantee idempotency across
 * concurrent browser callbacks and Stripe webhooks, and never throws on errors.
 */
export async function dispatchContributionNotifications(
  params: DispatchContributionNotificationsParams
): Promise<void> {
  const { itemId, targetItem, updatedItem, contribution, requestUrl, repository } = params;

  try {
    const activeConfig = params.config ?? (await getAppConfig());
    if (!isEmailProviderConfigured(activeConfig)) {
      return;
    }

    const dbClient = (repository as any)?.client ?? prisma;
    const savedContributor = await resolveSavedContributor(params, dbClient);
    if (!savedContributor) {
      return;
    }

    const providerName = String(activeConfig.emailProvider || 'smtp').trim().toLowerCase();
    const guestEmailRaw = (savedContributor.email ?? contribution.email ?? '')?.trim() || '';
    const coupleEmailRaw =
      typeof activeConfig.contactEmail === 'string' ? activeConfig.contactEmail.trim() : '';

    const hasValidGuestEmail = isValidEmail(guestEmailRaw);
    const hasValidCoupleEmail = isValidEmail(coupleEmailRaw);

    if (!hasValidGuestEmail && !hasValidCoupleEmail) {
      return;
    }

    let resolvedItem: ItemSnapshot | null | undefined = updatedItem ?? targetItem;
    if (
      (!resolvedItem?.name || (!resolvedItem?.itemType && !targetItem?.itemType)) &&
      typeof registryService?.getItemById === 'function'
    ) {
      try {
        const fetchedItem = await registryService.getItemById(itemId);
        if (fetchedItem) {
          resolvedItem = { ...fetchedItem, ...resolvedItem };
        }
      } catch {
        // Proceed with available item snapshot
      }
    }

    const contributorName = (savedContributor.name || contribution.name || 'Anonymous Guest').trim();
    const itemName = (resolvedItem?.name || targetItem?.name || 'Registry Gift').trim();
    const itemType = resolvedItem?.itemType || targetItem?.itemType || 'PHYSICAL';
    const isFund = itemType === 'CASH_FUND' || itemType === 'EXPERIENCE_FUND';
    const isGroupGift = Boolean(resolvedItem?.isGroupGift ?? targetItem?.isGroupGift);
    const paymentHandle =
      (resolvedItem?.paymentHandle ?? targetItem?.paymentHandle ?? '')?.trim() || '';
    const paymentHandleType =
      (resolvedItem?.paymentHandleType ?? targetItem?.paymentHandleType ?? '')?.trim() || '';

    const baseAmount =
      typeof savedContributor.amount === 'number' ? savedContributor.amount : contribution.amount;
    const stripePaymentIntentId =
      savedContributor.stripePaymentIntentId ?? contribution.stripePaymentIntentId ?? null;
    const coverFee = Boolean(savedContributor.coverFee ?? contribution.coverFee);
    const feeAmount =
      stripePaymentIntentId && coverFee
        ? typeof savedContributor.feeAmount === 'number' && savedContributor.feeAmount > 0
          ? savedContributor.feeAmount
          : Math.round(baseAmount * 0.025 * 100) / 100
        : 0;
    const totalCharged = Math.round((baseAmount + feeAmount) * 100) / 100;
    const guestMessage = savedContributor.message ?? contribution.message ?? null;
    const rawDate =
      savedContributor.transactionTimestamp ||
      savedContributor.date ||
      contribution.transactionTimestamp ||
      new Date();
    const formattedDate = formatContributionDate(rawDate, activeConfig.timezone);
    const referenceId = stripePaymentIntentId || savedContributor.id || itemId;

    const baseUrl = resolveBaseUrl(activeConfig, requestUrl);
    const registryUrl = `${baseUrl}/registry`;
    const dashboardUrl = `${baseUrl}/admin/dashboard/thank-you-notes`;

    const sensitiveLiterals = [guestEmailRaw, coupleEmailRaw, contributorName, guestMessage];
    const {
      MultiChannelMessagingProvider,
      escapeHtmlEntities,
      sanitizeEmailSubject,
    } = await import('@/features/broadcast');
    const messagingProvider = new MultiChannelMessagingProvider(activeConfig);

    if (hasValidGuestEmail) {
      try {
        const claimedGuestEmail = await claimSendTimestamp(
          savedContributor,
          'confirmation',
          repository,
          dbClient
        );
        if (claimedGuestEmail) {
          const { subject, body } = buildGuestConfirmationEmail({
            contributorName,
            itemName,
            isFund,
            paymentHandle,
            paymentHandleType,
            baseAmount,
            coverFee,
            feeAmount,
            totalCharged,
            stripePaymentIntentId,
            referenceId,
            formattedDate,
            registryUrl,
            escapeHtmlEntities,
            sanitizeEmailSubject,
          });
          const result = await messagingProvider.sendEmail({
            to: guestEmailRaw,
            subject,
            body,
          });
          if (!result.success) {
            logger.warn('Failed to send registry guest confirmation email', {
              itemId,
              contributorId: savedContributor.id,
              recipientRole: 'guest',
              provider: providerName,
              reason: sanitizeProviderFailureReason(result.error, sensitiveLiterals),
            });
          }
        }
      } catch (guestErr: unknown) {
        logger.warn('Unexpected error sending registry guest confirmation email', {
          itemId,
          contributorId: savedContributor.id,
          recipientRole: 'guest',
          provider: providerName,
          reason: sanitizeProviderFailureReason(guestErr, sensitiveLiterals),
        });
      }
    }

    if (hasValidCoupleEmail) {
      try {
        const claimedAlertEmail = await claimSendTimestamp(
          savedContributor,
          'alert',
          repository,
          dbClient
        );
        if (claimedAlertEmail) {
          let paymentTypeLabel = 'Physical Gift Claim';
          if (stripePaymentIntentId) {
            paymentTypeLabel = 'Card Checkout';
          } else if (isFund) {
            paymentTypeLabel = paymentHandleType
              ? `Direct Transfer (${paymentHandleType})`
              : 'Direct Transfer';
          } else if (isGroupGift) {
            paymentTypeLabel = 'Group Gift Contribution';
          }

          const { subject, body } = buildCoupleAlertEmail({
            contributorName,
            itemName,
            baseAmount,
            coverFee,
            feeAmount,
            paymentTypeLabel,
            guestMessage,
            dashboardUrl,
            escapeHtmlEntities,
            sanitizeEmailSubject,
          });
          const result = await messagingProvider.sendEmail({
            to: coupleEmailRaw,
            subject,
            body,
          });
          if (!result.success) {
            logger.warn('Failed to send registry couple alert email', {
              itemId,
              contributorId: savedContributor.id,
              recipientRole: 'couple',
              provider: providerName,
              reason: sanitizeProviderFailureReason(result.error, sensitiveLiterals),
            });
          }
        }
      } catch (alertErr: unknown) {
        logger.warn('Unexpected error sending registry couple alert email', {
          itemId,
          contributorId: savedContributor.id,
          recipientRole: 'couple',
          provider: providerName,
          reason: sanitizeProviderFailureReason(alertErr, sensitiveLiterals),
        });
      }
    }
  } catch (err: unknown) {
    logger.warn('Registry notification pipeline encountered an unexpected error', {
      itemId,
      reason: sanitizeProviderFailureReason(err, [
        contribution.email,
        contribution.name,
        contribution.message,
      ]),
    });
  }
}
