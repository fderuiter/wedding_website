# Guest Broadcasts & Messaging

This specification documents the architecture, provider adapters, audience resolution rules, scheduling lifecycle, and template sanitization controls for outbound guest email and SMS broadcasts in `src/features/broadcast/`.

> **Operational Warning — Default `smtp` and `none` Providers Are No-Op Stubs**
>
> Out of the box, `AppConfig` defaults to `emailProvider = "smtp"` and `smsProvider = "none"`. In `MultiChannelMessagingProvider` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L58-L205)):
> - **`emailProvider = "smtp"` (`sendSmtpEmail` at [src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L197-L205))**: Immediately returns `{ success: true }` **without opening a TCP/SMTP socket or delivering mail** (regardless of whether `smtpHost` is set). `testConnection` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L250-L276)) likewise returns `{ success: true }` whenever `smtpHost` is non-empty (and `smtpPass` is present if `smtpUser` is set) without probing an SMTP server.
> - **`smsProvider = "none"` (`sendSms` at [src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L82-L100))**: Immediately returns `{ success: true }` **without performing network delivery**.
>
> Because both stubs return `{ success: true }`, `BroadcastService.executeDispatch` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L602-L736)) and `BroadcastService.retryFailedRecipients` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L876-L950)) record `BroadcastRecipient` rows as **`SENT`** and mark the parent `BroadcastMessage` **`SENT`** even though zero external emails or text messages left the server. **Production operators must configure `resend` or `sendgrid` for live email delivery and `twilio` for live SMS delivery.**

---

## Architecture & API Endpoints

The broadcast domain (`src/features/broadcast/`, public barrel [src/features/broadcast/index.ts](../src/features/broadcast/index.ts#L1-L6)) exposes `BroadcastService` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L74-L951)), Zod request schemas ([src/features/broadcast/schemas.ts](../src/features/broadcast/schemas.ts#L3-L99)), audience filtering helpers ([src/features/broadcast/audience.ts](../src/features/broadcast/audience.ts#L8-L248)), and template rendering utilities ([src/features/broadcast/template.ts](../src/features/broadcast/template.ts#L14-L150)).

| Endpoint | Method | Access Tier | Responsibility |
| --- | --- | --- | --- |
| `/api/admin/broadcast/preview` | `POST` | `Admin-only` | Validates `PreviewBroadcastSchema` and calls `BroadcastService.renderPreview` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L412-L484)) to compute matching recipient counts and render a sample guest message without persisting or dispatching. |
| `/api/admin/broadcast/test-connection` | `POST` | `Admin-only` | Validates `TestConnectionSchema` and invokes `MultiChannelMessagingProvider.testConnection` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L250-L276)) against live or unsaved admin credential overrides. |
| `/api/admin/broadcast/test-send` | `POST` | `Admin-only` | Validates `SendTestBroadcastSchema` and executes `BroadcastService.sendTestBroadcast` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L490-L548)) to send a `[TEST]` email or SMS to an explicit `testEmail` or `testPhone` without creating `BroadcastMessage` rows. |
| `/api/admin/broadcast/send` | `POST` | `Admin-only` | Validates `SendBroadcastSchema` and invokes `BroadcastService.sendBroadcast` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L553-L597)) for immediate batched dispatch or future scheduling (`scheduledAt`). |
| `/api/admin/broadcast/history` | `GET` | `Admin-only` | Calls `BroadcastService.getBroadcastHistory` and `BroadcastService.countBroadcastHistory` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L825-L853)) to return bounded `BroadcastMessage` summary rows (`limit` default `50`, capped at `100`) with pagination headers and without `BroadcastRecipient` joins. |
| `/api/admin/broadcast/[id]` | `GET` | `Admin-only` | Calls `BroadcastService.getBroadcastById` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L858-L871)) to return the full `BroadcastMessage` body and ordered `BroadcastRecipient` delivery statuses for a single broadcast. |
| `/api/admin/broadcast/schedule/[id]` | `DELETE` | `Admin-only` | Calls `BroadcastService.cancelScheduledBroadcast` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L798-L820)) to transition a `SCHEDULED` message to `CANCELLED`. |
| `/api/admin/broadcast/retry` | `POST` | `Admin-only` | Validates `RetryBroadcastSchema` and invokes `BroadcastService.retryFailedRecipients` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L876-L950)) to re-dispatch `FAILED` `BroadcastRecipient` entries. |
| `/api/cron/broadcasts` | `GET`, `POST` | `Bearer (CRON_SECRET)` | Edge-authenticated scheduler hook ([src/app/api/cron/broadcasts/route.ts](../src/app/api/cron/broadcasts/route.ts#L1-L21)) invoking `BroadcastService.processScheduledBroadcasts` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L742-L793)). |

---

## Provider Adapters (`MultiChannelMessagingProvider`)

`MultiChannelMessagingProvider` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L51-L277)) resolves provider credentials from `AppConfig` (stored in PostgreSQL and masked in `/api/admin/settings` via `toAdminAppConfig` in [src/lib/config.ts](../src/lib/config.ts#L529-L587)):

| Channel | `AppConfig` Provider Value | Implementation | Network Behavior |
| --- | --- | --- | --- |
| **Email** | `resend` | `sendResendEmail` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L121-L157)) | **Live HTTPS (`POST https://api.resend.com/emails`)** using `resendApiKey` and `resendFrom` (or `smtpFrom` / `sendgridFrom` / `contactEmail` fallback). Sends sanitized `html` formatted via `formatEmailHtmlBody`. |
| **Email** | `sendgrid` | `sendSendGridEmail` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L159-L195)) | **Live HTTPS (`POST https://api.sendgrid.com/v3/mail/send`)** using `sendgridApiKey` and `sendgridFrom` (or `smtpFrom` / `resendFrom` / `contactEmail` fallback). Sends sanitized `text/html` content formatted via `formatEmailHtmlBody`. |
| **Email** | `smtp` *(default)* | `sendSmtpEmail` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L197-L205)) | **No-op stub**: returns `{ success: true }` immediately without opening a TCP/SMTP socket or performing network I/O, causing recipients to be marked `SENT`. |
| **SMS** | `twilio` | `sendTwilioSms` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L207-L238)) | **Live HTTPS (`POST https://api.twilio.com/2010-04-01/Accounts/<SID>/Messages.json`)** using HTTP Basic auth (`twilioAccountSid` + `twilioAuthToken`) and `twilioFromNumber`. |
| **SMS** | `none` *(default)* | `sendSms` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L82-L100)) | **No-op stub**: returns `{ success: true }` immediately without performing network I/O, causing recipients to be marked `SENT`. |

---

## Audience Resolution & `address-collection` Filtering

Target recipient resolution runs through `BroadcastService.resolveTargetGuests` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L300-L407)) and shares core predicate logic with the admin composer via `filterTargetGuestsInMemory` and `summarizeBroadcastAudience` in [src/features/broadcast/audience.ts](../src/features/broadcast/audience.ts#L8-L248):

1. **Sample Data Exclusion (`isSample: false`)**: Demo/sample `InvitationCode` rows generated during onboarding are unconditionally excluded from every broadcast query.
2. **Self-Submitted `address-collection` Exclusion by Default**: Guests who submit their mailing address through the unauthenticated public form (`POST /api/guest/address/public` in [src/app/api/guest/address/public/route.ts](../src/app/api/guest/address/public/route.ts#L91-L130)) are created with `tags: "address-collection"` (`ADDRESS_COLLECTION_TAG` in [src/features/broadcast/audience.ts](../src/features/broadcast/audience.ts#L8-L17)). Both `filterTargetGuestsInMemory` ([src/features/broadcast/audience.ts](../src/features/broadcast/audience.ts#L136-L152)) and `BroadcastService.resolveTargetGuests` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L300-L407)) **exclude** any guest carrying the `address-collection` tag unless `targetFilters.includeAddressCollection === true` (or `'address-collection'` is explicitly included in `targetFilters.tags`). This prevents unverified public form submissions from receiving private event announcements, invitation codes, or RSVP links by accident.
3. **Composable Audience Filters (`BroadcastTargetFiltersSchema`)**:
   - `subEventIds` & `rsvpStatuses` (`ATTENDING`, `DECLINED`, `MAYBE`, `NO_RESPONSE`): Filters guests granted access to specific sub-events (public `SubEvent` rows or explicit `SubEventAccess` grants) and matches their `SubEventRsvp` status (`NO_RESPONSE` matches invited guests with no submitted RSVP record).
   - `tags`, `tableIds`, `hasAddress`, `search`, `selectedGuestIds`, and `excludedGuestIds`: Supports comma-separated tag matching, seating table targeting (`'unassigned'` or specific `SeatingTable` IDs), mailing-address completeness checks, free-text search, and per-guest manual overrides.
4. **Channel Contact Eligibility**: `hasBroadcastChannelContact` ([src/features/broadcast/audience.ts](../src/features/broadcast/audience.ts#L53-L62)) requires a non-empty `email` for `EMAIL` broadcasts and resolves `phone` from `InvitationCode.extraFields` JSON (`phone` or `phoneNumber` via `getGuestPhone`) for `SMS` broadcasts.

---

## Dispatch, Batching, Scheduling, & Retry Lifecycle

1. **Immediate Dispatch (`BroadcastService.executeDispatch` at [src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L602-L736))**:
   - Creates a `BroadcastMessage` in `SENDING` status and pre-inserts `PENDING` `BroadcastRecipient` rows in chunks of `RECIPIENT_CHUNK_SIZE = 250` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L11)).
   - Iterates through recipients in configurable batches (`config.broadcastBatchSize`, default `50`, clamped `1..500`), sleeping `config.broadcastBatchDelayMs` (default `500 ms`, clamped `0..10000 ms`) between batches to respect upstream provider rate limits.
   - Updates each `BroadcastRecipient` to `SENT` or `FAILED` (recording provider `errorMessage`) and finalizes the parent `BroadcastMessage` as `SENT` (all succeeded), `PARTIAL` (mixed success and failure), or `FAILED` (zero succeeded).
2. **Scheduled Broadcasts & Atomic Cron Claim (`BroadcastService.processScheduledBroadcasts` at [src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L742-L793))**:
   - Passing a future `scheduledAt` timestamp persists the `BroadcastMessage` with `status: 'SCHEDULED'` without dispatching immediately.
   - When an external scheduler triggers `GET` or `POST /api/cron/broadcasts` with `Authorization: Bearer <CRON_SECRET>`, `processScheduledBroadcasts` queries due `SCHEDULED` jobs (`scheduledAt <= now`) and executes an atomic `prisma.broadcastMessage.updateMany({ where: { id: job.id, status: 'SCHEDULED' }, data: { status: 'SENDING' } })` claim (`claimed.count === 0` skips concurrent duplicate workers) before running `executeDispatch`.
3. **Failed Recipient Retry (`BroadcastService.retryFailedRecipients` at [src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L876-L950))**:
   - Accepts only `BroadcastMessage` records in `FAILED` or `PARTIAL` state, atomically claims the message into `SENDING`, re-renders personalized templates for `FAILED` `BroadcastRecipient` rows, and recomputes final `SENT` / `PARTIAL` / `FAILED` counts across the entire broadcast.

---

## Template Placeholders & HTML / Header Sanitization

Template interpolation and output encoding are enforced across [src/features/broadcast/template.ts](../src/features/broadcast/template.ts#L14-L98) and [src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L17-L30):

- **Supported Placeholders (`AVAILABLE_TEMPLATE_PLACEHOLDERS`)**: `{{guestName}}`, `{{partner1Name}}`, `{{partner2Name}}`, `{{weddingDate}}`, `{{venueName}}`, `{{venueAddress}}`, `{{invitationCode}}`, and `{{rsvpUrl}}` (constructed via `buildGuestRsvpUrl` at [src/features/broadcast/template.ts](../src/features/broadcast/template.ts#L28-L35) using `resolveBroadcastBaseUrl` from `AppConfig.baseUrl`, `NEXT_PUBLIC_SITE_URL`, or request origin).
- **Context-Aware Escaping (`renderBroadcastTemplate` at [src/features/broadcast/template.ts](../src/features/broadcast/template.ts#L51-L86))**:
  - **HTML Email Context (`escapeHtml: true`, default)**: Every substituted placeholder value passes through `escapeHtmlEntities` ([src/features/broadcast/template.ts](../src/features/broadcast/template.ts#L14-L16)), encoding `&`, `<`, `>`, `"`, and `'` so untrusted guest names or venue strings cannot inject HTML or `<script>` tags into emails.
  - **Plain-Text & SMS Context (`escapeHtml: false`)**: Used for SMS payloads and email subject rendering so apostrophes and ampersands are not double-encoded in text messages or subject headers.
- **Email Subject Header-Injection Defense (`sanitizeEmailSubject` at [src/features/broadcast/template.ts](../src/features/broadcast/template.ts#L21-L23))**: Replaces `\r` and `\n` sequences with spaces and trims whitespace before passing subjects to Resend or SendGrid.
- **HTML Body Formatting (`formatEmailHtmlBody` at [src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L17-L30))**: Escapes raw special characters outside existing HTML entities (`HTML_ENTITY_OR_SPECIAL_REGEX`), splits double newlines into `<p>` blocks, and converts single newlines into `<br />` tags so plain-text admin drafts render safely as structured HTML email bodies.
