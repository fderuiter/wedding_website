import { z } from 'zod';
import { getAppConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { formatCurrency } from '@/utils/intl';
import { signContributorActionToken } from './lib/contributorToken';
import { registryRepository } from './repository';
import { registryService } from './service';
import type { IRegistryRepository } from './types';
import { hasAddressCollectionTag } from './utils/invitation';
import { getPaymentUrl, resolveEffectivePaymentHandle } from './utils/paymentUrls';

const VALID_EMAIL_SCHEMA = z.email();
const ACTIVE_EMAIL_PROVIDERS = new Set(['smtp', 'resend', 'sendgrid']);
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

interface ContributorCandidate {
  id?: string;
  name?: string;
  email?: string | null;
  amount?: number;
  refundedAmount?: number;
  status?: string;
  coverFee?: boolean;
  feeAmount?: number;
  message?: string | null;
  date?: Date | string;
  stripePaymentIntentId?: string | null;
  transactionTimestamp?: Date | string | null;
  retailerOrderNumber?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
  invitationCodeId?: string | null;
  invitationCode?: {
    id?: string;
    code?: string;
    email?: string | null;
    isSample?: boolean;
    partyTags?: unknown;
  } | null;
}

interface ItemSnapshot {
  id?: string;
  name?: string;
  itemType?: string;
  price?: number;
  quantity?: number;
  amountContributed?: number;
  purchased?: boolean;
  vendorUrl?: string | null;
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
    retailerOrderNumber?: string | null;
    carrier?: string | null;
    trackingNumber?: string | null;
  };
  config?: Record<string, any> | null;
  requestUrl?: string;
  repository?: IRegistryRepository;
  isReservation?: boolean;
  verifiedInvitationCode?: string;
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

async function releaseSendTimestamp(
  contributor: ContributorCandidate,
  kind: 'confirmation' | 'alert',
  repository: IRegistryRepository | undefined,
  dbClient: any
): Promise<void> {
  const field = kind === 'confirmation' ? 'confirmationEmailSentAt' : 'alertEmailSentAt';
  try {
    if (contributor.id) {
      if (repository && typeof repository.releaseContributorEmailSend === 'function') {
        await repository.releaseContributorEmailSend(contributor.id, kind);
        return;
      }
      if (typeof registryService?.releaseContributorEmailSend === 'function') {
        await registryService.releaseContributorEmailSend(contributor.id, kind);
        return;
      }
      if (typeof registryRepository?.releaseContributorEmailSend === 'function') {
        await registryRepository.releaseContributorEmailSend(contributor.id, kind);
        return;
      }
      if (typeof dbClient?.contributor?.updateMany === 'function') {
        await dbClient.contributor.updateMany({
          where: { id: contributor.id },
          data: { [field]: null },
        });
        return;
      }
    }

    if (
      contributor.stripePaymentIntentId &&
      typeof dbClient?.contributor?.updateMany === 'function'
    ) {
      await dbClient.contributor.updateMany({
        where: { stripePaymentIntentId: contributor.stripePaymentIntentId },
        data: { [field]: null },
      });
    }
  } catch {
    // Best-effort timestamp release; never throw from notification pipeline
  }
}

function buildGuestConfirmationEmail(options: {
  contributorName: string;
  itemName: string;
  isPayableGroupGift: boolean;
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
  isReserved?: boolean;
  confirmActionUrl?: string;
  cancelActionUrl?: string;
  escapeHtmlEntities: (text: string) => string;
  sanitizeEmailSubject: (subject: string) => string;
}): { subject: string; body: string } {
  const {
    contributorName,
    itemName,
    isPayableGroupGift,
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
    isReserved = false,
    confirmActionUrl,
    cancelActionUrl,
    escapeHtmlEntities,
    sanitizeEmailSubject,
  } = options;

  const isSelfReportedFundTransfer =
    isPayableGroupGift && !stripePaymentIntentId && Boolean(paymentHandle);
  const subject = sanitizeEmailSubject(
    isSelfReportedFundTransfer
      ? `Gift Transfer Recorded: ${itemName}`
      : isReserved
        ? `Gift Reservation Recorded: ${itemName}`
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

  let reservationActionsBlock = '';
  if (isReserved && confirmActionUrl && cancelActionUrl) {
    const safeConfirmUrl = escapeHtmlEntities(confirmActionUrl);
    const safeCancelUrl = escapeHtmlEntities(cancelActionUrl);
    reservationActionsBlock = `
      <div style="margin:16px 0;padding:16px;background-color:#eff6ff;border:1px solid #93c5fd;border-radius:8px;color:#1e3a8a;">
        <p style="margin:0 0 8px 0;font-weight:700;">Confirm or Cancel Your Reservation</p>
        <p style="margin:0 0 12px 0;">
          We are holding this gift for you so other guests do not buy a duplicate. Once you finish your purchase or payment, please confirm below, or cancel if your plans change.
        </p>
        <div>
          <a href="${safeConfirmUrl}" style="display:inline-block;margin-right:10px;margin-bottom:6px;padding:10px 16px;background-color:#15803d;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">
            Confirm Gift Sent
          </a>
          <a href="${safeCancelUrl}" style="display:inline-block;margin-bottom:6px;padding:10px 16px;background-color:#ffffff;color:#991b1b;border:1px solid #dc2626;text-decoration:none;border-radius:6px;font-weight:600;">
            Cancel Reservation
          </a>
        </div>
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
            : isReserved
              ? `We reserved your gift claim for <strong>${safeItemName}</strong> while you complete your purchase.`
              : `Your gift toward <strong>${safeItemName}</strong> has been confirmed.`
        }
      </p>
      ${transferReminderBlock}
      ${reservationActionsBlock}
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
  isReserved?: boolean;
  guestMessage: string | null;
  retailerOrderNumber?: string | null;
  carrier?: string | null;
  trackingNumber?: string | null;
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
    isReserved = false,
    guestMessage,
    retailerOrderNumber,
    carrier,
    trackingNumber,
    dashboardUrl,
    escapeHtmlEntities,
    sanitizeEmailSubject,
  } = options;

  const subject = sanitizeEmailSubject(
    isReserved
      ? `New Registry Reservation: ${itemName} from ${contributorName}`
      : `New Registry Gift: ${itemName} from ${contributorName}`
  );
  const safeContributorName = escapeHtmlEntities(contributorName || 'Anonymous Guest');
  const safeItemName = escapeHtmlEntities(itemName);
  const safePaymentType = escapeHtmlEntities(paymentTypeLabel);
  const safeNote = guestMessage && guestMessage.trim()
    ? escapeHtmlEntities(guestMessage.trim())
    : 'No personal note included.';
  const safeDashboardUrl = escapeHtmlEntities(dashboardUrl);

  const safeOrderNumber =
    retailerOrderNumber && retailerOrderNumber.trim()
      ? escapeHtmlEntities(retailerOrderNumber.trim())
      : '';
  const safeCarrier =
    carrier && carrier.trim() ? escapeHtmlEntities(carrier.trim()) : '';
  const safeTrackingNumber =
    trackingNumber && trackingNumber.trim()
      ? escapeHtmlEntities(trackingNumber.trim())
      : '';

  const orderTrackingRows = [
    safeOrderNumber
      ? `<tr>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:600;">Retailer Order #</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-family:monospace;">${safeOrderNumber}</td>
          </tr>`
      : '',
    safeCarrier
      ? `<tr>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:600;">Shipping Carrier</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;">${safeCarrier}</td>
          </tr>`
      : '',
    safeTrackingNumber
      ? `<tr>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:600;">Tracking Number</td>
            <td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-family:monospace;">${safeTrackingNumber}</td>
          </tr>`
      : '',
  ]
    .filter(Boolean)
    .join('\n          ');

  const amountSummary =
    coverFee && feeAmount > 0
      ? `${escapeHtmlEntities(formatCurrency(baseAmount))} (+${escapeHtmlEntities(formatCurrency(feeAmount))} processing fee covered)`
      : escapeHtmlEntities(formatCurrency(baseAmount));

  const body = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#1f2937;line-height:1.5;">
      <h2 style="margin:0 0 12px 0;color:#111827;">${
        isReserved ? 'New Registry Reservation Recorded' : 'New Registry Contribution Recorded'
      }</h2>
      <p style="margin:0 0 16px 0;">
        <strong>${safeContributorName}</strong> ${
          isReserved
            ? 'reserved a gift on your wedding registry (pending external completion).'
            : 'recorded a gift on your wedding registry.'
        }
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
          ${orderTrackingRows}
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

    const isReserved =
      Boolean(params.isReservation) ||
      (typeof savedContributor.status === 'string' &&
        savedContributor.status.toUpperCase() === 'RESERVED');

    let recipientGuestEmail = '';
    if (isReserved) {
      let verifiedHouseholdRecord: {
        email?: string | null;
        isSample?: boolean;
        partyTags?: unknown;
      } | null = savedContributor.invitationCode ?? null;

      if (
        !verifiedHouseholdRecord &&
        savedContributor.invitationCodeId &&
        typeof dbClient?.invitationCode?.findUnique === 'function'
      ) {
        verifiedHouseholdRecord = await dbClient.invitationCode.findUnique({
          where: { id: savedContributor.invitationCodeId },
        });
      }

      if (
        !verifiedHouseholdRecord &&
        params.verifiedInvitationCode &&
        typeof dbClient?.invitationCode?.findUnique === 'function'
      ) {
        verifiedHouseholdRecord = await dbClient.invitationCode.findUnique({
          where: {
            code: params.verifiedInvitationCode.trim().toUpperCase(),
            isSample: false,
          },
        });
      }

      const verifiedHouseholdEmail =
        !verifiedHouseholdRecord?.isSample &&
        !hasAddressCollectionTag(verifiedHouseholdRecord?.partyTags) &&
        isValidEmail(verifiedHouseholdRecord?.email)
          ? verifiedHouseholdRecord.email.trim()
          : '';

      if (
        verifiedHouseholdEmail &&
        (!guestEmailRaw ||
          guestEmailRaw.toLowerCase() === verifiedHouseholdEmail.toLowerCase())
      ) {
        recipientGuestEmail = verifiedHouseholdEmail;
      }
    } else if (isValidEmail(guestEmailRaw)) {
      recipientGuestEmail = guestEmailRaw;
    }

    const hasValidGuestEmail = Boolean(recipientGuestEmail);
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
    const isPayableGroupGift = Boolean(isFund || isGroupGift);
    const effectiveHandle = resolveEffectivePaymentHandle(
      {
        paymentHandle: resolvedItem?.paymentHandle ?? targetItem?.paymentHandle,
        paymentHandleType: resolvedItem?.paymentHandleType ?? targetItem?.paymentHandleType,
      },
      activeConfig
    );
    const paymentHandle = effectiveHandle.paymentHandle || '';
    const paymentHandleType = effectiveHandle.paymentHandleType || '';

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
    const retailerOrderNumber =
      savedContributor.retailerOrderNumber ?? contribution.retailerOrderNumber ?? null;
    const carrier = savedContributor.carrier ?? contribution.carrier ?? null;
    const trackingNumber =
      savedContributor.trackingNumber ?? contribution.trackingNumber ?? null;
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

    let confirmActionUrl: string | undefined;
    let cancelActionUrl: string | undefined;
    if (isReserved && savedContributor.id) {
      try {
        const [confirmToken, cancelToken] = await Promise.all([
          signContributorActionToken({
            contributorId: savedContributor.id,
            action: 'confirm',
          }),
          signContributorActionToken({
            contributorId: savedContributor.id,
            action: 'cancel',
          }),
        ]);
        const claimPrefix = baseUrl ? `${baseUrl}/guest/claim` : '/guest/claim';
        confirmActionUrl = `${claimPrefix}?token=${encodeURIComponent(confirmToken)}`;
        cancelActionUrl = `${claimPrefix}?token=${encodeURIComponent(cancelToken)}`;
      } catch (tokenErr: unknown) {
        logger.warn('Unable to sign contributor claim action links', {
          itemId,
          contributorId: savedContributor.id,
          reason: tokenErr instanceof Error ? tokenErr.message : 'Token signing failed',
        });
      }
    }

    const sensitiveLiterals = [
      guestEmailRaw,
      recipientGuestEmail,
      coupleEmailRaw,
      contributorName,
      guestMessage,
      retailerOrderNumber,
      carrier,
      trackingNumber,
    ];
    const {
      MultiChannelMessagingProvider,
      escapeHtmlEntities,
      sanitizeEmailSubject,
    } = await import('@/features/broadcast');
    const messagingProvider = new MultiChannelMessagingProvider(activeConfig);

    const emailBranches: Array<Promise<void>> = [];

    if (hasValidGuestEmail) {
      emailBranches.push(
        (async () => {
          let claimedGuestEmail = false;
          try {
            claimedGuestEmail = await claimSendTimestamp(
              savedContributor,
              'confirmation',
              repository,
              dbClient
            );
            if (claimedGuestEmail) {
              const { subject, body } = buildGuestConfirmationEmail({
                contributorName,
                itemName,
                isPayableGroupGift,
                paymentHandle,
                paymentHandleType,
                baseAmount,
                coverFee,
                feeAmount,
                totalCharged,
                stripePaymentIntentId,
                isReserved,
                confirmActionUrl,
                cancelActionUrl,
                referenceId,
                formattedDate,
                registryUrl,
                escapeHtmlEntities,
                sanitizeEmailSubject,
              });
              const result = await messagingProvider.sendEmail({
                to: recipientGuestEmail,
                subject,
                body,
              });
              if (!result.success) {
                await releaseSendTimestamp(savedContributor, 'confirmation', repository, dbClient);
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
            if (claimedGuestEmail) {
              await releaseSendTimestamp(savedContributor, 'confirmation', repository, dbClient);
            }
            logger.warn('Unexpected error sending registry guest confirmation email', {
              itemId,
              contributorId: savedContributor.id,
              recipientRole: 'guest',
              provider: providerName,
              reason: sanitizeProviderFailureReason(guestErr, sensitiveLiterals),
            });
          }
        })()
      );
    }

    if (hasValidCoupleEmail) {
      emailBranches.push(
        (async () => {
          let claimedAlertEmail = false;
          try {
            claimedAlertEmail = await claimSendTimestamp(
              savedContributor,
              'alert',
              repository,
              dbClient
            );
            if (claimedAlertEmail) {
              let paymentTypeLabel = 'Physical Gift Claim';
              if (stripePaymentIntentId) {
                paymentTypeLabel = 'Card Checkout';
              } else if (isPayableGroupGift && paymentHandle) {
                paymentTypeLabel = paymentHandleType
                  ? `Direct Transfer (${paymentHandleType})`
                  : 'Direct Transfer';
              } else if (isGroupGift) {
                paymentTypeLabel = 'Group Gift Contribution';
              }
              if (isReserved) {
                paymentTypeLabel = `${paymentTypeLabel} (Reserved)`;
              }

              const { subject, body } = buildCoupleAlertEmail({
                contributorName,
                itemName,
                baseAmount,
                coverFee,
                feeAmount,
                paymentTypeLabel,
                isReserved,
                guestMessage,
                retailerOrderNumber,
                carrier,
                trackingNumber,
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
                await releaseSendTimestamp(savedContributor, 'alert', repository, dbClient);
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
            if (claimedAlertEmail) {
              await releaseSendTimestamp(savedContributor, 'alert', repository, dbClient);
            }
            logger.warn('Unexpected error sending registry couple alert email', {
              itemId,
              contributorId: savedContributor.id,
              recipientRole: 'couple',
              provider: providerName,
              reason: sanitizeProviderFailureReason(alertErr, sensitiveLiterals),
            });
          }
        })()
      );
    }

    if (emailBranches.length > 0) {
      await Promise.allSettled(emailBranches);
    }
  } catch (err: unknown) {
    logger.warn('Registry notification pipeline encountered an unexpected error', {
      itemId,
      reason: sanitizeProviderFailureReason(err, [
        contribution.email,
        typeof params.config?.contactEmail === 'string' ? params.config.contactEmail : undefined,
        contribution.name,
        contribution.message,
        contribution.retailerOrderNumber,
        contribution.carrier,
        contribution.trackingNumber,
      ]),
    });
  }
}

/**
 * Dispatches the delayed couple alert email once a RESERVED gift claim is confirmed
 * by either the guest (via signed confirmation form) or an admin.
 */
export async function dispatchConfirmedContributionAlert(params: {
  contributor: ContributorCandidate;
  item?: ItemSnapshot | null;
  config?: Record<string, any> | null;
  requestUrl?: string;
  repository?: IRegistryRepository;
}): Promise<void> {
  const { contributor, item, requestUrl, repository } = params;

  let claimedAlertEmail = false;
  let dbClient: any = prisma;
  try {
    const activeConfig = params.config ?? (await getAppConfig());
    if (!isEmailProviderConfigured(activeConfig)) {
      return;
    }

    const coupleEmailRaw =
      typeof activeConfig.contactEmail === 'string' ? activeConfig.contactEmail.trim() : '';
    if (!isValidEmail(coupleEmailRaw)) {
      return;
    }

    dbClient = (repository as any)?.client ?? prisma;
    claimedAlertEmail = await claimSendTimestamp(
      contributor,
      'alert',
      repository,
      dbClient
    );
    if (!claimedAlertEmail) {
      return;
    }

    const providerName = String(activeConfig.emailProvider || 'smtp').trim().toLowerCase();
    const contributorName = (contributor.name || 'Anonymous Guest').trim();
    const itemName = (item?.name || 'Registry Gift').trim();
    const itemType = item?.itemType || 'PHYSICAL';
    const isFund = itemType === 'CASH_FUND' || itemType === 'EXPERIENCE_FUND';
    const isGroupGift = Boolean(item?.isGroupGift);
    const isPayableGroupGift = Boolean(isFund || isGroupGift);
    const effectiveHandle = resolveEffectivePaymentHandle(
      {
        paymentHandle: item?.paymentHandle,
        paymentHandleType: item?.paymentHandleType,
      },
      activeConfig
    );
    const paymentHandle = effectiveHandle.paymentHandle || '';
    const paymentHandleType = effectiveHandle.paymentHandleType || '';
    const baseAmount = typeof contributor.amount === 'number' ? contributor.amount : 0;
    const stripePaymentIntentId = contributor.stripePaymentIntentId ?? null;
    const coverFee = Boolean(contributor.coverFee);
    const feeAmount =
      stripePaymentIntentId && coverFee
        ? typeof contributor.feeAmount === 'number' && contributor.feeAmount > 0
          ? contributor.feeAmount
          : Math.round(baseAmount * 0.025 * 100) / 100
        : 0;

    let paymentTypeLabel = 'Physical Gift Claim';
    if (stripePaymentIntentId) {
      paymentTypeLabel = 'Card Checkout';
    } else if (isPayableGroupGift && paymentHandle) {
      paymentTypeLabel = paymentHandleType
        ? `Direct Transfer (${paymentHandleType})`
        : 'Direct Transfer';
    } else if (isGroupGift) {
      paymentTypeLabel = 'Group Gift Contribution';
    }

    const baseUrl = resolveBaseUrl(activeConfig, requestUrl);
    const dashboardUrl = `${baseUrl}/admin/dashboard/thank-you-notes`;
    const sensitiveLiterals = [
      coupleEmailRaw,
      contributor.email,
      contributorName,
      contributor.message,
      contributor.retailerOrderNumber,
      contributor.carrier,
      contributor.trackingNumber,
    ];

    const {
      MultiChannelMessagingProvider,
      escapeHtmlEntities,
      sanitizeEmailSubject,
    } = await import('@/features/broadcast');
    const messagingProvider = new MultiChannelMessagingProvider(activeConfig);

    const { subject, body } = buildCoupleAlertEmail({
      contributorName,
      itemName,
      baseAmount,
      coverFee,
      feeAmount,
      paymentTypeLabel,
      guestMessage: contributor.message ?? null,
      retailerOrderNumber: contributor.retailerOrderNumber ?? null,
      carrier: contributor.carrier ?? null,
      trackingNumber: contributor.trackingNumber ?? null,
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
      await releaseSendTimestamp(contributor, 'alert', repository, dbClient);
      logger.warn('Failed to send confirmed contribution couple alert email', {
        itemId: item?.id,
        contributorId: contributor.id,
        recipientRole: 'couple',
        provider: providerName,
        reason: sanitizeProviderFailureReason(result.error, sensitiveLiterals),
      });
    }
  } catch (err: unknown) {
    if (claimedAlertEmail) {
      await releaseSendTimestamp(contributor, 'alert', repository, dbClient);
    }
    logger.warn('Unexpected error sending confirmed contribution couple alert email', {
      itemId: item?.id,
      contributorId: contributor.id,
      reason: sanitizeProviderFailureReason(err, [
        contributor.email,
        contributor.name,
        contributor.message,
      ]),
    });
  }
}

/**
 * Sends a polite reminder email to a guest with an unverified RESERVED contribution,
 * including fresh signed confirmation and cancellation links.
 */
export async function dispatchPoliteReminderNotification(params: {
  contributor: ContributorCandidate;
  item?: ItemSnapshot | null;
  config?: Record<string, any> | null;
  requestUrl?: string;
}): Promise<{ sent: boolean; error?: string }> {
  const { contributor, item, requestUrl } = params;
  const guestEmailRaw = (contributor.email || '').trim();
  if (!isValidEmail(guestEmailRaw)) {
    return {
      sent: false,
      error: 'Contributor does not have a valid email address on file.',
    };
  }

  if (!contributor.id) {
    return {
      sent: false,
      error: 'Contributor identifier is required to generate reminder links.',
    };
  }

  try {
    const activeConfig = params.config ?? (await getAppConfig());
    if (!isEmailProviderConfigured(activeConfig)) {
      return {
        sent: false,
        error: 'Email provider is not configured on this deployment.',
      };
    }

    const providerName = String(activeConfig.emailProvider || 'smtp').trim().toLowerCase();
    const contributorName = (contributor.name || 'Guest').trim();
    const itemName = (item?.name || 'Registry Gift').trim();
    const baseAmount = typeof contributor.amount === 'number' ? contributor.amount : 0;
    const itemType = item?.itemType || 'PHYSICAL';
    const isFund = itemType === 'CASH_FUND' || itemType === 'EXPERIENCE_FUND';
    const isPayableGroupGift = Boolean(isFund || item?.isGroupGift);
    const effectiveHandle = resolveEffectivePaymentHandle(
      {
        paymentHandle: item?.paymentHandle,
        paymentHandleType: item?.paymentHandleType,
      },
      activeConfig
    );
    const paymentHandle = effectiveHandle.paymentHandle || '';
    const paymentHandleType = effectiveHandle.paymentHandleType || '';
    const paymentDeepLink =
      isPayableGroupGift && paymentHandle && paymentHandleType
        ? getPaymentUrl(paymentHandleType, paymentHandle)
        : null;

    const [confirmToken, cancelToken] = await Promise.all([
      signContributorActionToken({ contributorId: contributor.id, action: 'confirm' }),
      signContributorActionToken({ contributorId: contributor.id, action: 'cancel' }),
    ]);

    const baseUrl = resolveBaseUrl(activeConfig, requestUrl);
    const claimPrefix = baseUrl ? `${baseUrl}/guest/claim` : '/guest/claim';
    const confirmActionUrl = `${claimPrefix}?token=${encodeURIComponent(confirmToken)}`;
    const cancelActionUrl = `${claimPrefix}?token=${encodeURIComponent(cancelToken)}`;

    const {
      MultiChannelMessagingProvider,
      escapeHtmlEntities,
      sanitizeEmailSubject,
    } = await import('@/features/broadcast');
    const messagingProvider = new MultiChannelMessagingProvider(activeConfig);

    const safeName = escapeHtmlEntities(contributorName);
    const safeItemName = escapeHtmlEntities(itemName);
    const safeAmount = escapeHtmlEntities(formatCurrency(baseAmount));
    const safeConfirmUrl = escapeHtmlEntities(confirmActionUrl);
    const safeCancelUrl = escapeHtmlEntities(cancelActionUrl);
    const safeHandle = escapeHtmlEntities(paymentHandle);
    const safeHandleType = escapeHtmlEntities(paymentHandleType || 'Direct Transfer');
    const safePaymentDeepLink = paymentDeepLink ? escapeHtmlEntities(paymentDeepLink) : '';
    const safeVendorUrl = item?.vendorUrl ? escapeHtmlEntities(item.vendorUrl) : '';

    const subject = sanitizeEmailSubject(`Friendly Reminder: Your Wedding Gift Reservation (${itemName})`);

    const paymentReminderHtml =
      isPayableGroupGift && paymentHandle
        ? `
          <div style="margin: 16px 0; padding: 14px 16px; background-color: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
            <p style="margin: 0 0 6px; font-size: 14px; color: #334155;">
              <strong>${safeHandleType}:</strong> ${safeHandle} (${safeAmount})
            </p>
            ${
              safePaymentDeepLink
                ? `<p style="margin: 0; font-size: 13px;"><a href="${safePaymentDeepLink}" style="color: #0f172a; font-weight: 600;">Open ${safeHandleType}</a></p>`
                : ''
            }
          </div>
        `
        : safeVendorUrl
          ? `
            <p style="margin: 14px 0; font-size: 14px; color: #334155;">
              Retailer listing: <a href="${safeVendorUrl}" style="color: #0f172a; font-weight: 600;">View item</a>
            </p>
          `
          : '';

    const body = `
      <div style="font-family: Georgia, serif; color: #1e293b; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <h2 style="margin: 0 0 12px; font-size: 22px; color: #0f172a;">Checking in on your gift reservation</h2>
        <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #334155;">
          Hi ${safeName}, thank you again for reserving <strong>${safeItemName}</strong> (${safeAmount}) on our wedding registry!
          We wanted to check in politely so we can keep our gift list accurate for other guests.
        </p>
        ${paymentReminderHtml}
        <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6; color: #334155;">
          If you have already sent your transfer or completed your order, please confirm below. If your plans changed, you can release the reservation with one click so another guest can choose it.
        </p>
        <div style="margin: 20px 0;">
          <a href="${safeConfirmUrl}" style="display: inline-block; margin: 0 12px 8px 0; padding: 10px 18px; background-color: #0f172a; color: #ffffff; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Confirm Gift Sent
          </a>
          <a href="${safeCancelUrl}" style="display: inline-block; margin: 0 0 8px; padding: 10px 18px; background-color: #ffffff; color: #991b1b; border: 1px solid #fecaca; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Release Reservation
          </a>
        </div>
      </div>
    `.trim();

    const result = await messagingProvider.sendEmail({
      to: guestEmailRaw,
      subject,
      body,
    });
    if (!result.success) {
      logger.warn('Failed to send registry polite reminder email', {
        itemId: item?.id,
        contributorId: contributor.id,
        provider: providerName,
        reason: sanitizeProviderFailureReason(result.error, [guestEmailRaw, contributorName]),
      });
      return {
        sent: false,
        error: 'Failed to send reminder email via configured provider.',
      };
    }

    return { sent: true };
  } catch (err: unknown) {
    logger.warn('Unexpected error sending registry polite reminder email', {
      itemId: item?.id,
      contributorId: contributor.id,
      reason: sanitizeProviderFailureReason(err, [guestEmailRaw, contributor.name]),
    });
    return {
      sent: false,
      error: 'Unexpected error sending reminder email.',
    };
  }
}

/**
 * Notifies the couple when a Stripe refund or dispute adjusts a registry contribution
 * and recalculates the parent gift item's ledger balance.
 */
export async function dispatchLedgerAdjustmentNotification(params: {
  eventType: 'partial_refund' | 'refund' | 'dispute';
  contributor: ContributorCandidate;
  item?: ItemSnapshot | null;
  refundedAmount: number;
  config?: Record<string, any> | null;
  requestUrl?: string;
}): Promise<void> {
  const { eventType, contributor, item, refundedAmount, requestUrl } = params;

  try {
    const activeConfig = params.config ?? (await getAppConfig());
    if (!isEmailProviderConfigured(activeConfig)) {
      return;
    }

    const coupleEmailRaw =
      typeof activeConfig.contactEmail === 'string' ? activeConfig.contactEmail.trim() : '';
    if (!isValidEmail(coupleEmailRaw)) {
      return;
    }

    const providerName = String(activeConfig.emailProvider || 'smtp').trim().toLowerCase();
    const contributorName = (contributor.name || 'Anonymous Guest').trim();
    const itemName = (item?.name || 'Registry Gift').trim();
    const originalAmount = typeof contributor.amount === 'number' ? contributor.amount : 0;
    const clampedReversed = Math.min(originalAmount, Math.max(0, refundedAmount));
    const netAmount = Math.max(0, Math.round((originalAmount - clampedReversed) * 100) / 100);
    const updatedItemTotal =
      typeof item?.amountContributed === 'number' ? item.amountContributed : netAmount;

    const baseUrl = resolveBaseUrl(activeConfig, requestUrl);
    const registryAdminUrl = `${baseUrl}/admin/dashboard/registry`;

    const {
      MultiChannelMessagingProvider,
      escapeHtmlEntities,
      sanitizeEmailSubject,
    } = await import('@/features/broadcast');
    const messagingProvider = new MultiChannelMessagingProvider(activeConfig);

    const eventHeadline =
      eventType === 'dispute'
        ? 'Card Dispute Opened'
        : eventType === 'refund'
          ? 'Full Refund Processed'
          : 'Partial Refund Processed';

    const subject = sanitizeEmailSubject(`Registry Ledger Update: ${eventHeadline} — ${itemName}`);
    const safeHeadline = escapeHtmlEntities(eventHeadline);
    const safeContributor = escapeHtmlEntities(contributorName);
    const safeItemName = escapeHtmlEntities(itemName);
    const safeOriginal = escapeHtmlEntities(formatCurrency(originalAmount));
    const safeReversed = escapeHtmlEntities(formatCurrency(clampedReversed));
    const safeNet = escapeHtmlEntities(formatCurrency(netAmount));
    const safeItemTotal = escapeHtmlEntities(formatCurrency(updatedItemTotal));
    const safeAdminUrl = escapeHtmlEntities(registryAdminUrl);
    const availabilityCopy = item?.purchased
      ? 'Remains fulfilled'
      : 'Reopened for guest contributions';

    const body = `
      <div style="font-family: Georgia, serif; color: #1e293b; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
        <h2 style="margin: 0 0 12px; font-size: 22px; color: #0f172a;">${safeHeadline}</h2>
        <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #334155;">
          Stripe reported a ledger adjustment for <strong>${safeContributor}</strong> on <strong>${safeItemName}</strong>.
          Your registry totals have been updated automatically while preserving your contributor history.
        </p>
        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
          <table role="presentation" style="width: 100%; border-collapse: collapse; font-size: 14px;">
            <tr>
              <td style="padding: 4px 0; color: #64748b;">Original Contribution</td>
              <td style="padding: 4px 0; text-align: right; color: #0f172a;">${safeOriginal}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #64748b;">Reversed / Refunded</td>
              <td style="padding: 4px 0; text-align: right; color: #991b1b; font-weight: 600;">-${safeReversed}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #64748b;">Net Contributor Amount</td>
              <td style="padding: 4px 0; text-align: right; color: #0f172a; font-weight: 600;">${safeNet}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0 0; border-top: 1px solid #e2e8f0; color: #64748b;">Updated Gift Funding Total</td>
              <td style="padding: 6px 0 0; border-top: 1px solid #e2e8f0; text-align: right; color: #0f172a; font-weight: 600;">${safeItemTotal}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #64748b;">Gift Status</td>
              <td style="padding: 4px 0; text-align: right; color: #334155;">${escapeHtmlEntities(availabilityCopy)}</td>
            </tr>
          </table>
        </div>
        <p style="margin: 0; font-size: 14px;">
          <a href="${safeAdminUrl}" style="color: #0f172a; font-weight: 600; text-decoration: underline;">
            Review Registry Ledger
          </a>
        </p>
      </div>
    `.trim();

    const result = await messagingProvider.sendEmail({
      to: coupleEmailRaw,
      subject,
      body,
    });
    if (!result.success) {
      logger.warn('Failed to send registry ledger adjustment notification', {
        itemId: item?.id,
        contributorId: contributor.id,
        eventType,
        provider: providerName,
        reason: sanitizeProviderFailureReason(result.error, [coupleEmailRaw, contributorName]),
      });
    }
  } catch (err: unknown) {
    logger.warn('Unexpected error sending registry ledger adjustment notification', {
      itemId: item?.id,
      contributorId: contributor.id,
      eventType,
      reason: sanitizeProviderFailureReason(err, [contributor.email, contributor.name]),
    });
  }
}
