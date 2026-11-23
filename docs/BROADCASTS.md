# Guest Broadcasts & Messaging

This specification documents the architecture, provider adapters, audience resolution rules, scheduling lifecycle, and template sanitization controls for outbound guest email and SMS broadcasts in `src/features/broadcast/`.

> **Operational Note — Default `smtp` Host Requirement vs. `none` Simulation Mode**
>
> Out of the box, `AppConfig` defaults to `emailProvider = "smtp"` and `smsProvider = "none"`. In `MultiChannelMessagingProvider` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L749-L1054)):
> - **`emailProvider = "smtp"` (`sendSmtpEmail` at [src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L901-L952))**: Connects over `node:net` / `node:tls` (supporting implicit TLS on port `465` / `smtpSecure: true`, `STARTTLS` upgrade on port `587`, `AUTH PLAIN`, and `AUTH LOGIN` with a 10-second socket timeout) and returns `{ success: false }` when `smtpHost` is blank. `testConnection` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L997-L1054)) executes a live `220` greeting, `EHLO`/`HELO`, `STARTTLS`, `AUTH`, and `QUIT` handshake.
> - **`emailProvider = "none"` (`sendEmail` at [src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L756-L784)) and `smsProvider = "none"` (`sendSms` at [src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L786-L804))**: Explicitly simulate delivery and return `{ success: true }` **without performing network delivery**.
>
> When simulation mode (`none`) is enabled, `BroadcastService.executeDispatch` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L653-L787)) and `BroadcastService.retryFailedRecipients` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L962-L1037)) record `BroadcastRecipient` rows as **`SENT`** and mark the parent `BroadcastMessage` **`SENT`** without external network traffic. **Production operators must configure a valid `smtpHost` (for `smtp`), `resend`, or `sendgrid` for live email delivery and `twilio` for live SMS delivery.**

---

## Architecture & API Endpoints

The broadcast domain (`src/features/broadcast/`, public barrel [src/features/broadcast/index.ts](../src/features/broadcast/index.ts#L1-L6)) exposes `BroadcastService` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L80-L1037)), Zod request schemas ([src/features/broadcast/schemas.ts](../src/features/broadcast/schemas.ts#L3-L99)), audience filtering helpers ([src/features/broadcast/audience.ts](../src/features/broadcast/audience.ts#L8-L248)), and template & stationery card rendering utilities ([src/features/broadcast/template.ts](../src/features/broadcast/template.ts#L47-L485)).

| Endpoint | Method | Access Tier | Responsibility |
| --- | --- | --- | --- |
| `/api/admin/broadcast/preview` | `POST` | `Admin-only` | Validates `PreviewBroadcastSchema` and calls `BroadcastService.renderPreview` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L451-L535)) to compute matching recipient counts and render a sample guest message (including `htmlBody` stationery cards) without persisting or dispatching. |
| `/api/admin/broadcast/test-connection` | `POST` | `Admin-only` | Validates `TestConnectionSchema` and invokes `MultiChannelMessagingProvider.testConnection` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L997-L1054)) against live or unsaved admin credential overrides. |
| `/api/admin/broadcast/test-send` | `POST` | `Admin-only` | Validates `SendTestBroadcastSchema` and executes `BroadcastService.sendTestBroadcast` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L541-L599)) to send a `[TEST]` email or SMS to an explicit `testEmail` or `testPhone` without creating `BroadcastMessage` rows. |
| `/api/admin/broadcast/send` | `POST` | `Admin-only` | Validates `SendBroadcastSchema` and invokes `BroadcastService.sendBroadcast` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L604-L648)) for immediate batched dispatch or future scheduling (`scheduledAt`). |
| `/api/admin/broadcast/history` | `GET` | `Admin-only` | Calls `BroadcastService.getBroadcastHistory` and `BroadcastService.countBroadcastHistory` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L876-L939)) to return bounded `BroadcastMessage` summary rows (`limit` default `50`, capped at `100`, including aggregated `viewedCount`) with pagination headers and without `BroadcastRecipient` joins. |
| `/api/admin/broadcast/[id]` | `GET` | `Admin-only` | Calls `BroadcastService.getBroadcastById` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L944-L957)) to return the full `BroadcastMessage` body and ordered `BroadcastRecipient` delivery statuses for a single broadcast. |
| `/api/admin/broadcast/schedule/[id]` | `DELETE` | `Admin-only` | Calls `BroadcastService.cancelScheduledBroadcast` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L849-L871)) to transition a `SCHEDULED` message to `CANCELLED`. |
| `/api/admin/broadcast/retry` | `POST` | `Admin-only` | Validates `RetryBroadcastSchema` and invokes `BroadcastService.retryFailedRecipients` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L962-L1037)) to retry `FAILED` entries or resend explicit `recipientIds`. |
| `/api/cron/broadcasts` | `GET`, `POST` | `Bearer (CRON_SECRET)` | Edge-authenticated scheduler hook ([src/app/api/cron/broadcasts/route.ts](../src/app/api/cron/broadcasts/route.ts#L1-L21)) invoking `BroadcastService.processScheduledBroadcasts` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L793-L844)). |

---

## Provider Adapters (`MultiChannelMessagingProvider`)

`MultiChannelMessagingProvider` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L749-L1054)) resolves provider credentials from `AppConfig` (stored in PostgreSQL and masked in `/api/admin/settings` via `toAdminAppConfig` in [src/lib/config.ts](../src/lib/config.ts#L529-L587)):

| Channel | `AppConfig` Provider Value | Implementation | Network Behavior |
| --- | --- | --- | --- |
| **Email** | `resend` | `sendResendEmail` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L825-L861)) | **Live HTTPS (`POST https://api.resend.com/emails`)** using `resendApiKey` and `resendFrom` (or `smtpFrom` / `sendgridFrom` / `contactEmail` fallback). Sends sanitized `html` formatted via `formatEmailHtmlBody`. |
| **Email** | `sendgrid` | `sendSendGridEmail` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L863-L899)) | **Live HTTPS (`POST https://api.sendgrid.com/v3/mail/send`)** using `sendgridApiKey` and `sendgridFrom` (or `smtpFrom` / `resendFrom` / `contactEmail` fallback). Sends sanitized `text/html` content formatted via `formatEmailHtmlBody`. |
| **Email** | `smtp` *(default)* | `sendSmtpEmail` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L901-L952)) | **Live Native SMTP (`node:net` / `node:tls`)** supporting implicit TLS (`465` / `smtpSecure: true`), `STARTTLS` (`587`), `AUTH PLAIN` / `AUTH LOGIN`, CRLF header sanitization, RFC 5321 dot-stuffing, and `multipart/alternative` (`text/plain` + `text/html`). Returns `{ success: false }` if `smtpHost` is empty. |
| **Email** | `none` | `sendEmail` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L756-L784)) | **Simulation mode**: returns `{ success: true }` immediately without performing network I/O. |
| **SMS** | `twilio` | `sendTwilioSms` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L954-L995)) | **Live HTTPS (`POST https://api.twilio.com/2010-04-01/Accounts/<SID>/Messages.json`)** using HTTP Basic auth (`twilioAccountSid` + `twilioAuthToken`) and `twilioFromNumber`. |
| **SMS** | `none` *(default)* | `sendSms` ([src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L786-L804)) | **Simulation mode**: returns `{ success: true }` immediately without performing network I/O. |

---

## Audience Resolution & `address-collection` Filtering

Target recipient resolution runs through `BroadcastService.resolveTargetGuests` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L339-L446)) and shares core predicate logic with the admin composer via `filterTargetGuestsInMemory` and `summarizeBroadcastAudience` in [src/features/broadcast/audience.ts](../src/features/broadcast/audience.ts#L8-L248):

1. **Sample Data Exclusion (`isSample: false`)**: Demo/sample `InvitationCode` rows generated during onboarding are unconditionally excluded from every broadcast query.
2. **Self-Submitted `address-collection` Exclusion by Default**: Unmatched or conflicting-address submissions on the unauthenticated public form (`POST /api/guest/address/public` in [src/app/api/guest/address/public/route.ts](../src/app/api/guest/address/public/route.ts#L24-L269)) are created with `partyTags: ['address-collection']` (`ADDRESS_COLLECTION_TAG` in [src/features/broadcast/audience.ts](../src/features/broadcast/audience.ts#L8-L17)), whereas matched invited guests without address conflicts sync blank contact fields directly onto their existing `InvitationCode` row. Both `filterTargetGuestsInMemory` ([src/features/broadcast/audience.ts](../src/features/broadcast/audience.ts#L136-L152)) and `BroadcastService.resolveTargetGuests` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L339-L446)) **exclude** any guest carrying the `address-collection` tag unless `targetFilters.includeAddressCollection === true` (or `'address-collection'` is explicitly included in `targetFilters.tags`). This prevents unverified public form submissions from receiving private event announcements, invitation codes, or RSVP links by accident.
3. **Composable Audience Filters (`BroadcastTargetFiltersSchema`)**:
   - `subEventIds` & `rsvpStatuses` (`ATTENDING`, `DECLINED`, `MAYBE`, `NO_RESPONSE`): Filters guests granted access to specific sub-events (public `SubEvent` rows or explicit `SubEventAccess` grants) and matches their `SubEventRsvp` status (`NO_RESPONSE` matches invited guests with no submitted RSVP record).
   - `tags`, `tableIds`, `hasAddress`, `search`, `selectedGuestIds`, and `excludedGuestIds`: Supports comma-separated tag matching, seating table targeting (`'unassigned'` or specific `SeatingTable` IDs), mailing-address completeness checks, free-text search, and per-guest manual overrides.
4. **Channel Contact Eligibility**: `hasBroadcastChannelContact` ([src/features/broadcast/audience.ts](../src/features/broadcast/audience.ts#L53-L62)) requires a non-empty `email` for `EMAIL` broadcasts and resolves `phone` from `InvitationCode.extraFields` JSON (`phone` or `phoneNumber` via `getGuestPhone`) for `SMS` broadcasts.

---

## Dispatch, Batching, Scheduling, & Retry Lifecycle

1. **Immediate Dispatch (`BroadcastService.executeDispatch` at [src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L653-L787))**:
   - Creates a `BroadcastMessage` in `SENDING` status and pre-inserts `PENDING` `BroadcastRecipient` rows in chunks of `RECIPIENT_CHUNK_SIZE = 250` ([src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L17)).
   - Iterates through recipients in configurable batches (`config.broadcastBatchSize`, default `50`, clamped `1..500`), sleeping `config.broadcastBatchDelayMs` (default `500 ms`, clamped `0..10000 ms`) between batches to respect upstream provider rate limits.
   - Updates each `BroadcastRecipient` to `SENT` or `FAILED` (recording provider `errorMessage`) and finalizes the parent `BroadcastMessage` as `SENT` (all succeeded), `PARTIAL` (mixed success and failure), or `FAILED` (zero succeeded). When invited non-sample guests sign in or validate their code, `SENT` recipient rows transition to `VIEWED` for open tracking.
2. **Scheduled Broadcasts & Atomic Cron Claim (`BroadcastService.processScheduledBroadcasts` at [src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L793-L844))**:
   - Passing a future `scheduledAt` timestamp persists the `BroadcastMessage` with `status: 'SCHEDULED'` without dispatching immediately.
   - When an external scheduler triggers `GET` or `POST /api/cron/broadcasts` with `Authorization: Bearer <CRON_SECRET>`, `processScheduledBroadcasts` queries due `SCHEDULED` jobs (`scheduledAt <= now`) and executes an atomic `prisma.broadcastMessage.updateMany({ where: { id: job.id, status: 'SCHEDULED' }, data: { status: 'SENDING' } })` claim (`claimed.count === 0` skips concurrent duplicate workers) before running `executeDispatch`.
3. **Failed Recipient Retry & Per-Recipient Resend (`BroadcastService.retryFailedRecipients` at [src/features/broadcast/service.ts](../src/features/broadcast/service.ts#L962-L1037))**:
   - Atomically claims eligible `BroadcastMessage` records into `SENDING` (`FAILED`/`PARTIAL` for bulk retry, or `SENT`/`PARTIAL`/`FAILED` when explicit `recipientIds` are provided), re-renders personalized templates, and recomputes final `SENT` / `PARTIAL` / `FAILED` counts while preserving `VIEWED` recipients in `sentCount`.

---

## Template Placeholders & HTML / Header Sanitization

Template interpolation and output encoding are enforced across [src/features/broadcast/template.ts](../src/features/broadcast/template.ts#L47-L485) and [src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L28-L53):

- **Supported Placeholders (`AVAILABLE_TEMPLATE_PLACEHOLDERS`)**: `{{guestName}}`, `{{partner1Name}}`, `{{partner2Name}}`, `{{weddingDate}}`, `{{venueName}}`, `{{venueAddress}}`, `{{invitationCode}}`, and `{{rsvpUrl}}` (constructed via `buildGuestRsvpUrl` at [src/features/broadcast/template.ts](../src/features/broadcast/template.ts#L76-L83) using `resolveBroadcastBaseUrl` from `AppConfig.baseUrl`, `NEXT_PUBLIC_SITE_URL`, or request origin).
- **Context-Aware Escaping (`renderBroadcastTemplate` at [src/features/broadcast/template.ts](../src/features/broadcast/template.ts#L360-L395))**:
  - **HTML Email Context (`escapeHtml: true`, default)**: Every substituted placeholder value passes through `escapeHtmlEntities` ([src/features/broadcast/template.ts](../src/features/broadcast/template.ts#L47-L49)), encoding `&`, `<`, `>`, `"`, and `'` so untrusted guest names or venue strings cannot inject HTML or `<script>` tags into emails.
  - **Plain-Text & SMS Context (`escapeHtml: false`)**: Used for SMS payloads and email subject rendering so apostrophes and ampersands are not double-encoded in text messages or subject headers.
- **Email Subject Header-Injection Defense (`sanitizeEmailSubject` at [src/features/broadcast/template.ts](../src/features/broadcast/template.ts#L69-L71))**: Replaces `\r` and `\n` sequences with spaces and trims whitespace before passing subjects to SMTP, Resend, or SendGrid.
- **HTML Body & Stationery Card Formatting (`formatEmailHtmlBody` at [src/features/broadcast/providers/index.ts](../src/features/broadcast/providers/index.ts#L28-L53) and `renderStationeryCardHtml` at [src/features/broadcast/template.ts](../src/features/broadcast/template.ts#L234-L344))**: Renders `[CARD:save-the-date]` and `[CARD:formal-invitation]` templates into themed HTML stationery cards with couple branding, `AppConfig` colors, event details, calendar links, and `{{rsvpUrl}}` CTA buttons, while escaping plain-text drafts into `<p>` / `<br />` HTML blocks.
