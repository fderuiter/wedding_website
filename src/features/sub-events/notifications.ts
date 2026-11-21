import { z } from 'zod';
import { signGuestItineraryToken } from '@/core/auth/guestInviteSession';
import { getAppConfig } from '@/lib/config';
import { logger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import type { SubEventRsvpSubmissionItem } from './schemas';
import { subEventService, type ScheduleEventWithRsvp } from './service';

const VALID_EMAIL_SCHEMA = z.email();
const ACTIVE_EMAIL_PROVIDERS = new Set(['smtp', 'resend', 'sendgrid']);
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export interface DispatchRsvpNotificationsParams {
  code: string;
  guestName?: string | null;
  submittedEmail?: string | null;
  submissions: SubEventRsvpSubmissionItem[];
  updatedRsvps?: unknown[];
  hasRsvpChanges?: boolean;
  config?: Record<string, any> | null;
  requestUrl?: string;
}

interface EventSummaryEntry {
  id: string;
  title: string;
  status: 'attending' | 'declined' | 'pending';
  dateTimeLabel: string;
  locationLabel: string;
  plusOneCount: number;
  plusOneNames: string[];
  dietaryNotes: string;
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

function formatEventScheduleWindow(
  startTime: string | Date | null | undefined,
  endTime: string | Date | null | undefined,
  timezone?: string
): string {
  if (!startTime) {
    return 'Date & time TBD';
  }
  const startDate = startTime instanceof Date ? startTime : new Date(startTime);
  if (isNaN(startDate.getTime())) {
    return 'Date & time TBD';
  }

  const tz = typeof timezone === 'string' && timezone.trim() ? timezone.trim() : 'UTC';
  const formatWithTz = (targetTz: string) => {
    const dateFormatter = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      timeZone: targetTz,
    });
    const timeFormatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: targetTz,
    });

    const dateStr = dateFormatter.format(startDate);
    const startStr = timeFormatter.format(startDate);

    if (endTime) {
      const endDate = endTime instanceof Date ? endTime : new Date(endTime);
      if (!isNaN(endDate.getTime())) {
        const endStr = timeFormatter.format(endDate);
        return `${dateStr} · ${startStr} – ${endStr} (${targetTz})`;
      }
    }
    return `${dateStr} · ${startStr} (${targetTz})`;
  };

  try {
    return formatWithTz(tz);
  } catch {
    return formatWithTz('UTC');
  }
}

function buildHouseholdScheduleSummaries(
  schedule: ScheduleEventWithRsvp[],
  submissions: SubEventRsvpSubmissionItem[],
  timezone?: string
): EventSummaryEntry[] {
  const submissionByEventId = new Map<string, SubEventRsvpSubmissionItem>();
  for (const sub of submissions) {
    submissionByEventId.set(sub.subEventId, sub);
  }

  const writableSchedule = schedule.filter((evt) => !evt.isReadOnly);

  if (writableSchedule.length > 0) {
    return writableSchedule.map((evt) => {
      const latestSub = submissionByEventId.get(evt.id);
      const status = latestSub?.status ?? evt.userRsvp?.status ?? 'pending';
      const rawPlusOnes = latestSub
        ? (latestSub.plusOneCount ?? 0)
        : (evt.userRsvp?.plusOneCount ?? 0);
      const plusOneCount = status === 'declined' ? 0 : Math.max(0, rawPlusOnes);
      const rawPlusOneNames =
        latestSub?.plusOneNames ?? evt.userRsvp?.plusOneNames ?? [];
      const plusOneNames =
        status === 'declined' || plusOneCount === 0
          ? []
          : rawPlusOneNames
            .map((n) => (typeof n === 'string' ? n.trim() : ''))
            .filter(Boolean)
            .slice(0, plusOneCount);
      const rawDietary =
        latestSub !== undefined
          ? (latestSub.dietaryNotes ?? '')
          : (evt.userRsvp?.dietaryNotes ?? '');
      const locationLabel = (evt.locationName || evt.location || '').trim() || 'Location TBD';

      return {
        id: evt.id,
        title: evt.title || 'Wedding Event',
        status,
        dateTimeLabel: formatEventScheduleWindow(evt.startTime, evt.endTime, timezone),
        locationLabel,
        plusOneCount,
        plusOneNames,
        dietaryNotes: rawDietary.trim(),
      };
    });
  }

  return submissions.map((sub) => {
    const plusOneCount = sub.status === 'declined' ? 0 : Math.max(0, sub.plusOneCount ?? 0);
    const plusOneNames =
      sub.status === 'declined' || plusOneCount === 0
        ? []
        : (sub.plusOneNames ?? [])
          .map((n) => (typeof n === 'string' ? n.trim() : ''))
          .filter(Boolean)
          .slice(0, plusOneCount);
    return {
      id: sub.subEventId,
      title: sub.subEventId,
      status: sub.status,
      dateTimeLabel: 'Scheduled Event',
      locationLabel: 'Venue details on schedule',
      plusOneCount,
      plusOneNames,
      dietaryNotes: (sub.dietaryNotes || '').trim(),
    };
  });
}

function renderEventSectionHtml(
  heading: string,
  badgeColor: string,
  events: EventSummaryEntry[],
  escapeHtmlEntities: (text: string) => string
): string {
  const safeHeading = escapeHtmlEntities(heading);
  if (events.length === 0) {
    return `
      <div style="margin:16px 0;">
        <h3 style="margin:0 0 6px 0;font-size:15px;color:${badgeColor};">${safeHeading} (0)</h3>
        <p style="margin:0;font-size:13px;color:#6b7280;">None</p>
      </div>
    `.trim();
  }

  const rows = events
    .map((evt) => {
      const safeTitle = escapeHtmlEntities(evt.title);
      const safeDateTime = escapeHtmlEntities(evt.dateTimeLabel);
      const safeLocation = escapeHtmlEntities(evt.locationLabel);
      const plusOneSummary =
        evt.plusOneCount > 0
          ? evt.plusOneNames.length > 0
            ? `${evt.plusOneCount} (${escapeHtmlEntities(evt.plusOneNames.join(', '))})`
            : String(evt.plusOneCount)
          : '0';
      const safeDietary = evt.dietaryNotes
        ? escapeHtmlEntities(evt.dietaryNotes)
        : 'None noted';

      return `
        <div style="padding:12px 14px;margin:0 0 8px 0;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
          <div style="font-weight:700;color:#111827;margin-bottom:4px;">${safeTitle}</div>
          <div style="font-size:13px;color:#374151;"><strong>When:</strong> ${safeDateTime}</div>
          <div style="font-size:13px;color:#374151;"><strong>Where:</strong> ${safeLocation}</div>
          <div style="font-size:13px;color:#374151;"><strong>Plus-One Guests:</strong> ${plusOneSummary}</div>
          <div style="font-size:13px;color:#374151;"><strong>Dietary Notes:</strong> ${safeDietary}</div>
        </div>
      `.trim();
    })
    .join('');

  return `
    <div style="margin:16px 0;">
      <h3 style="margin:0 0 8px 0;font-size:15px;color:${badgeColor};">${safeHeading} (${events.length})</h3>
      ${rows}
    </div>
  `.trim();
}

function buildGuestConfirmationEmail(options: {
  displayName: string;
  coupleNames: string;
  events: EventSummaryEntry[];
  returnRsvpUrl: string;
  itineraryDownloadUrl: string | null;
  escapeHtmlEntities: (text: string) => string;
  sanitizeEmailSubject: (subject: string) => string;
}): { subject: string; body: string } {
  const {
    displayName,
    coupleNames,
    events,
    returnRsvpUrl,
    itineraryDownloadUrl,
    escapeHtmlEntities,
    sanitizeEmailSubject,
  } = options;

  const subject = sanitizeEmailSubject(
    coupleNames ? `Your RSVP Confirmation — ${coupleNames}` : 'Your Wedding RSVP Confirmation'
  );

  const safeDisplayName = escapeHtmlEntities(displayName || 'Guest');
  const safeReturnUrl = escapeHtmlEntities(returnRsvpUrl);
  const safeItineraryUrl = itineraryDownloadUrl ? escapeHtmlEntities(itineraryDownloadUrl) : '';

  const acceptedEvents = events.filter((e) => e.status === 'attending');
  const declinedEvents = events.filter((e) => e.status === 'declined');
  const pendingEvents = events.filter((e) => e.status === 'pending');

  const acceptedHtml = renderEventSectionHtml(
    'Accepted Events',
    '#047857',
    acceptedEvents,
    escapeHtmlEntities
  );
  const declinedHtml = renderEventSectionHtml(
    'Declined Events',
    '#be123c',
    declinedEvents,
    escapeHtmlEntities
  );
  const pendingHtml = renderEventSectionHtml(
    'Pending Events',
    '#b45309',
    pendingEvents,
    escapeHtmlEntities
  );

  const itineraryButtonHtml = safeItineraryUrl
    ? `
      <a href="${safeItineraryUrl}" style="display:inline-block;margin:0 12px 10px 0;padding:10px 18px;background-color:#047857;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">
        Download Combined Itinerary (.ics)
      </a>
    `.trim()
    : '';

  const body = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:620px;margin:0 auto;color:#1f2937;line-height:1.5;">
      <h2 style="margin:0 0 12px 0;color:#111827;">Thank you for your RSVP, ${safeDisplayName}!</h2>
      <p style="margin:0 0 16px 0;">
        We have saved your latest wedding schedule responses. Below is a summary of your household's schedule.
      </p>
      ${acceptedHtml}
      ${declinedHtml}
      ${pendingHtml}
      <div style="margin:24px 0 0 0;">
        ${itineraryButtonHtml}
        <a href="${safeReturnUrl}" style="display:inline-block;margin:0 0 10px 0;padding:10px 18px;background-color:#b91c1c;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">
          View or Update Your RSVP
        </a>
      </div>
    </div>
  `.trim();

  return { subject, body };
}

function buildCoupleRsvpAlertEmail(options: {
  guestName: string;
  householdName: string | null;
  updatedEvents: EventSummaryEntry[];
  dashboardUrl: string;
  escapeHtmlEntities: (text: string) => string;
  sanitizeEmailSubject: (subject: string) => string;
}): { subject: string; body: string } {
  const {
    guestName,
    householdName,
    updatedEvents,
    dashboardUrl,
    escapeHtmlEntities,
    sanitizeEmailSubject,
  } = options;

  const displayHousehold =
    householdName && householdName.trim() && householdName.trim() !== guestName.trim()
      ? `${guestName.trim()} (${householdName.trim()})`
      : guestName.trim() || 'Guest Household';

  const subject = sanitizeEmailSubject(`RSVP Update: ${displayHousehold}`);
  const safeHousehold = escapeHtmlEntities(displayHousehold);
  const safeDashboardUrl = escapeHtmlEntities(dashboardUrl);

  const eventRows = updatedEvents
    .map((evt) => {
      const safeTitle = escapeHtmlEntities(evt.title);
      const statusText =
        evt.status === 'attending'
          ? 'Attending'
          : evt.status === 'declined'
            ? 'Declined'
            : 'Pending';
      const plusOneSummary =
        evt.plusOneCount > 0
          ? evt.plusOneNames.length > 0
            ? `${evt.plusOneCount} (${escapeHtmlEntities(evt.plusOneNames.join(', '))})`
            : String(evt.plusOneCount)
          : '0';
      const safeDietary = evt.dietaryNotes
        ? escapeHtmlEntities(evt.dietaryNotes)
        : 'None noted';

      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;">${safeTitle}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${statusText}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${plusOneSummary}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${safeDietary}</td>
        </tr>
      `.trim();
    })
    .join('');

  const body = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:620px;margin:0 auto;color:#1f2937;line-height:1.5;">
      <h2 style="margin:0 0 12px 0;color:#111827;">Guest RSVP Response Saved</h2>
      <p style="margin:0 0 16px 0;">
        <strong>${safeHousehold}</strong> submitted or updated their wedding RSVP responses.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;font-size:13px;">
        <thead>
          <tr style="background-color:#f3f4f6;text-align:left;">
            <th style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Event</th>
            <th style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Status</th>
            <th style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Plus-Ones</th>
            <th style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">Dietary Notes</th>
          </tr>
        </thead>
        <tbody>
          ${eventRows}
        </tbody>
      </table>
      <p style="margin:20px 0 0 0;">
        <a href="${safeDashboardUrl}" style="display:inline-block;padding:10px 18px;background-color:#111827;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">
          Open Admin Dashboard
        </a>
      </p>
    </div>
  `.trim();

  return { subject, body };
}

/**
 * Dispatches inline, non-blocking guest confirmation and couple alert HTML emails after an RSVP save.
 * Logs sanitized warnings with PII redacted if provider credentials are missing or delivery fails.
 */
export async function dispatchRsvpNotifications(
  params: DispatchRsvpNotificationsParams
): Promise<void> {
  const { code, submissions, requestUrl } = params;

  try {
    const normalizedCode = typeof code === 'string' ? code.trim().toUpperCase() : '';
    if (!normalizedCode || !Array.isArray(submissions) || submissions.length === 0) {
      return;
    }

    const activeConfig = params.config ?? (await getAppConfig());
    if (!isEmailProviderConfigured(activeConfig)) {
      return;
    }

    const providerName = String(activeConfig.emailProvider || 'smtp').trim().toLowerCase();

    let inviteRecord: {
      guestName?: string | null;
      householdName?: string | null;
      email?: string | null;
    } | null = null;
    try {
      const delegate = (prisma as any)?.invitationCode;
      if (delegate && typeof delegate.findUnique === 'function') {
        inviteRecord = await delegate.findUnique({
          where: { code: normalizedCode, isSample: false },
          select: {
            guestName: true,
            householdName: true,
            email: true,
          },
        });
      }
    } catch {
      inviteRecord = null;
    }

    const resolvedGuestName = (
      inviteRecord?.guestName ||
      params.guestName ||
      'Wedding Guest'
    ).trim();
    const resolvedHouseholdName =
      typeof inviteRecord?.householdName === 'string' && inviteRecord.householdName.trim()
        ? inviteRecord.householdName.trim()
        : null;

    let guestEmailCandidate = '';
    if (params.submittedEmail !== undefined) {
      guestEmailCandidate =
        typeof params.submittedEmail === 'string' ? params.submittedEmail.trim() : '';
    } else if (typeof inviteRecord?.email === 'string') {
      guestEmailCandidate = inviteRecord.email.trim();
    } else if (typeof subEventService.getSavedEmailForGuest === 'function') {
      try {
        guestEmailCandidate = (await subEventService.getSavedEmailForGuest(normalizedCode)) || '';
      } catch {
        guestEmailCandidate = '';
      }
    }

    const coupleEmailRaw =
      typeof activeConfig.contactEmail === 'string' ? activeConfig.contactEmail.trim() : '';

    const shouldSendGuestEmail = isValidEmail(guestEmailCandidate);
    const shouldSendCoupleEmail =
      params.hasRsvpChanges !== false && isValidEmail(coupleEmailRaw);

    if (!shouldSendGuestEmail && !shouldSendCoupleEmail) {
      return;
    }

    let schedule: ScheduleEventWithRsvp[] = [];
    if (typeof subEventService.getScheduleForGuest === 'function') {
      try {
        const fetched = await subEventService.getScheduleForGuest(normalizedCode);
        if (Array.isArray(fetched)) {
          schedule = fetched;
        }
      } catch {
        schedule = [];
      }
    }

    const allEvents = buildHouseholdScheduleSummaries(
      schedule,
      submissions,
      activeConfig.timezone
    );
    const submittedIds = new Set(submissions.map((s) => s.subEventId));
    const updatedEvents = allEvents.filter((evt) => submittedIds.has(evt.id));
    const alertEvents = updatedEvents.length > 0 ? updatedEvents : allEvents;

    const baseUrl = resolveBaseUrl(activeConfig, requestUrl);
    const dashboardUrl = `${baseUrl}/admin/dashboard/invitation-codes`;

    const sensitiveLiterals: Array<string | null | undefined> = [
      guestEmailCandidate,
      coupleEmailRaw,
      resolvedGuestName,
      resolvedHouseholdName,
      normalizedCode,
      code,
      ...allEvents.map((e) => e.dietaryNotes),
      ...allEvents.flatMap((e) => e.plusOneNames),
    ];

    const {
      MultiChannelMessagingProvider,
      escapeHtmlEntities,
      sanitizeEmailSubject,
      buildGuestRsvpUrl,
    } = await import('@/features/broadcast');
    const messagingProvider = new MultiChannelMessagingProvider(activeConfig);

    if (shouldSendGuestEmail) {
      try {
        const returnRsvpUrl = buildGuestRsvpUrl(baseUrl, normalizedCode);
        const hasAttendingEvent = allEvents.some((evt) => evt.status === 'attending');
        let itineraryDownloadUrl: string | null = null;
        if (hasAttendingEvent) {
          const itineraryToken = await signGuestItineraryToken({
            code: normalizedCode,
            guestName: resolvedGuestName,
          });
          itineraryDownloadUrl = `${baseUrl}/api/schedule/ics?token=${encodeURIComponent(itineraryToken)}`;
        }

        const configRecord = activeConfig as Record<string, unknown>;
        const partner1 =
          typeof configRecord.partner1Name === 'string' ? configRecord.partner1Name.trim() : '';
        const partner2 =
          typeof configRecord.partner2Name === 'string' ? configRecord.partner2Name.trim() : '';
        const coupleNames =
          typeof configRecord.coupleNames === 'string' && configRecord.coupleNames.trim()
            ? configRecord.coupleNames.trim()
            : partner1 && partner2
              ? `${partner1} & ${partner2}`
              : partner1 || partner2;

        const { subject, body } = buildGuestConfirmationEmail({
          displayName: resolvedGuestName,
          coupleNames,
          events: allEvents,
          returnRsvpUrl,
          itineraryDownloadUrl,
          escapeHtmlEntities,
          sanitizeEmailSubject,
        });

        const result = await messagingProvider.sendEmail({
          to: guestEmailCandidate,
          subject,
          body,
        });

        if (!result.success) {
          logger.warn('Failed to send RSVP guest confirmation email', {
            recipientRole: 'guest',
            provider: providerName,
            reason: sanitizeProviderFailureReason(result.error, sensitiveLiterals),
          });
        }
      } catch (guestErr: unknown) {
        logger.warn('Unexpected error sending RSVP guest confirmation email', {
          recipientRole: 'guest',
          provider: providerName,
          reason: sanitizeProviderFailureReason(guestErr, sensitiveLiterals),
        });
      }
    }

    if (shouldSendCoupleEmail) {
      try {
        const { subject, body } = buildCoupleRsvpAlertEmail({
          guestName: resolvedGuestName,
          householdName: resolvedHouseholdName,
          updatedEvents: alertEvents,
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
          logger.warn('Failed to send RSVP couple alert email', {
            recipientRole: 'couple',
            provider: providerName,
            reason: sanitizeProviderFailureReason(result.error, sensitiveLiterals),
          });
        }
      } catch (alertErr: unknown) {
        logger.warn('Unexpected error sending RSVP couple alert email', {
          recipientRole: 'couple',
          provider: providerName,
          reason: sanitizeProviderFailureReason(alertErr, sensitiveLiterals),
        });
      }
    }
  } catch (err: unknown) {
    logger.warn('RSVP notification pipeline encountered an unexpected error', {
      reason: sanitizeProviderFailureReason(err, [
        params.submittedEmail,
        params.guestName,
        params.code,
        ...(Array.isArray(params.submissions)
          ? params.submissions.map((s) => s?.dietaryNotes)
          : []),
      ]),
    });
  }
}
