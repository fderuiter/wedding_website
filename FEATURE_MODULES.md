# Feature & Module Configuration Architecture

## Overview
This application features an explicit feature/module configuration model designed to allow adopters to enable or disable optional capabilities without modifying application source code or scattering conditional checks.

Disabling a feature module handles:
1. **Navigation Visibility**: Removes corresponding links from both the public Navbar and Admin Dashboard navigation bar.
2. **Route Protection**: Accessing UI routes or API endpoints belonging to a disabled feature returns HTTP 404 (Not Found).
3. **Admin Controls**: Hides or disables relevant administrative controls in the dashboard.
4. **Backend/Scheduled Tasks**: Prevents background polling, client-side intervals, or external service calls.
5. **Feature Dependencies**: Enforces dependency rules between features (e.g. `groupGifting` depends on `registry`).
6. **Core Infrastructure Independence**: Core setup, authentication, database ORM, logging, audit trails, and general settings remain operational independently of presentation features.

---

## Enumerated Presentation Feature Toggles

The following 10 optional presentation feature toggles are enumerated and supported in [src/lib/modules.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/lib/modules.ts#L94-L105):

| Feature Identifier | Title | Category | Description | Affected UI Routes | Affected API Routes | Dependencies |
| --- | --- | --- | --- | --- | --- | --- |
| `registry` | Gift Registry | Core | Custom gift registry system for guests to browse and claim items. | `/registry`, `/registry/add-item`, `/registry/edit-item` | `/api/registry/*`, `/api/admin/[entity]` (entity: `registry-item`) | None |
| `groupGifting` | Group Gifting | Core | Partial monetary contribution support on high-value registry items. | `/registry` (group gift UI) | `/api/registry/contribute` | Requires `registry` |
| `guestPasscode` | Guest Passcode Access | Core | Gatekeeper forcing guest passcode login before viewing site content. | `/guest/login` | `/api/guest/login` | None |
| `weather` | Weather Forecast | Information | Live weather forecast widget for the wedding date and venue location. | `/weather` | `/api/weather` | None |
| `weddingParty` | Wedding Party Roster | Information | Biographies and photos for members of the wedding party. | `/wedding-party` | `/api/admin/[entity]` (entity: `wedding-party`) | None |
| `attractions` | Local Attractions | Information | Guide for guests with local recommendations, maps, and categories. | `/things-to-do` | `/api/admin/[entity]` (entity: `attractions`) | None |
| `gallery` | Photo Gallery & Media | Engagement | Photo gallery page and administrative media management. | `/photos` | `/api/media/*`, `/api/photos/*` | None |
| `countdown` | Homepage Countdown Timer | Engagement | Live countdown timer widget on the homepage layout. | Homepage (`/`) | N/A | None |
| `addToCalendar` | Add to Calendar Widget | Engagement | Calendar invitation button generating ICS / Google Calendar files. | Homepage (`/`) | N/A | None |
| `interactive3D` | Interactive 3D Experiences | Experience | Interactive 3D canvas and Heart page rendered with React Three Fiber. | `/heart` | N/A | None |

### Dynamic Administrative Entity Controller Routes
Administrative CRUD operations for entities such as wedding party members (`wedding-party`), local attractions (`attractions`), registry items (`registry-item`), seating tables (`seating-table`), sub-events (`sub-event`), invitation codes (`invitation-code`), and content nodes (`content`) do not use static route endpoints.

Instead, administrative CRUD operations route dynamically through [/api/admin/[entity]](https://github.com/fderuiter/wedding_website/blob/HEAD/src/app/api/admin/%5Bentity%5D/route.ts#L7-L56) ([src/app/api/admin/[entity]/route.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/app/api/admin/%5Bentity%5D/route.ts#L7-L56)).
The entity controller maps entity parameters to service handlers using the feature registry defined in [src/features/admin/registry.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/features/admin/registry.ts#L9-L17).

---

## Architectural Division: Presentation Toggles vs. Domain Modules

The application architecture establishes a strict separation between presentation toggles and core domain feature modules:

1. **Presentation Feature Toggles ([src/lib/modules.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/lib/modules.ts#L94-L105))**:
   - Represent user-configurable feature flags defined in `ModuleConfigSchema`.
   - Stored in the database inside the `AppConfig` profile and configured via the Admin Dashboard.
   - Control navigation visibility, client-side rendering, and HTTP 404 route protections for optional frontend experiences.

2. **Core Domain Feature Modules ([src/features/](https://github.com/fderuiter/wedding_website/tree/HEAD/src/features/))**:
   - Represent underlying domain services, data repositories, business logic, and backend orchestration logic.
   - Core domain modules execute system capabilities independently of presentation toggle state.
   - Some domain modules power optional presentation toggles, while administrative and infrastructural domain modules (such as `admin`, `broadcast`, `content`, `logistics`, `seating`, `sub-events`, and `media`) remain active to maintain system administration and core workflows.

---

## Core Domain Feature Modules Architecture (`src/features/`)

The application codebase organizes domain capabilities into 11 core feature modules under [src/features/](https://github.com/fderuiter/wedding_website/tree/HEAD/src/features/):

| Domain Module | Directory Path | Purpose & Responsibilities | Key Components & Services |
| --- | --- | --- | --- |
| `admin` | `src/features/admin` | Central administrative service registry and API client orchestration for dynamic entity routing. | [src/features/admin/registry.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/features/admin/registry.ts#L9-L17), `apiClient.ts` |
| `attractions` | `src/features/attractions` | Manages local recommendations, hotel blocks, categories, and map directions. | `AttractionAdminService`, `attractionsService` |
| `broadcast` | `src/features/broadcast` | Multi-channel broadcast messaging studio for segment-filtered email and SMS announcements. | `sendBroadcast`, `BroadcastModal` |
| `content` | `src/features/content` | Content node persistence, site settings, theme configuration, and pending photo reviews. | `ContentNodeAdminService`, `contentService`, `ContentRepository` |
| `logistics` | `src/features/logistics` | Schedule logistics and venue event information management. | `logisticsService`, `LogisticsRepository` |
| `media` | `src/features/media` | Photo gallery storage, image moderation, EXIF sanitization, asset uploads, and bulk ZIP exports. | `MediaRepository`, `mediaService` |
| `registry` | `src/features/registry` | Gift registry items, group gifting, contribution tracking, invitation code import, and thank-you notes. | `RegistryItemAdminService`, `InvitationCodeAdminService`, `thankYouService` |
| `seating` | `src/features/seating` | Seating table management, floorplan canvas layout, seat assignments, and vector PDF exports. | `SeatingTableAdminService`, `seatingService`, `pdf.service.ts` |
| `sub-events` | `src/features/sub-events` | Sub-events management, guest access permissions, and per-event RSVP matrix tracking. | `SubEventAdminService`, `subEventService`, `SubEventRepository` |
| `weather` | `src/features/weather` | Live weather forecasts (Open-Meteo) and seasonal climate matrix fallbacks. | `weatherProxy`, `Forecast` |
| `wedding-party` | `src/features/wedding-party` | Wedding party roster members, biographies, side assignments, and display ordering. | `WeddingPartyAdminService`, `weddingPartyService` |

---

## Schema Validation & Data Model

Module configuration is schema-validated using Zod via `ModuleConfigSchema` ([src/lib/modules.ts](https://github.com/fderuiter/wedding_website/blob/HEAD/src/lib/modules.ts#L94-L105)):

```ts
import { z } from 'zod';

export const ModuleConfigSchema = z.object({
  registry: z.boolean().default(true),
  groupGifting: z.boolean().default(true),
  guestPasscode: z.boolean().default(true),
  weather: z.boolean().default(true),
  weddingParty: z.boolean().default(true),
  attractions: z.boolean().default(true),
  gallery: z.boolean().default(true),
  countdown: z.boolean().default(true),
  addToCalendar: z.boolean().default(true),
  interactive3D: z.boolean().default(true),
});
```

### Dependency Resolution Rule
`groupGifting` explicitly depends on `registry`.
- If `registry` is set to `false`, `groupGifting` is automatically resolved to `false`.
- Attempting to submit `groupGifting: true` while `registry: false` is blocked by validation and automatically normalized during `resolveModuleConfig()`.

---

## Admin Configuration Management

Administrators can toggle feature modules dynamically in **Site Settings** (`/admin/dashboard/settings`).
When features are toggled and saved:
- Settings are stored in the active `AppConfig` profile in the PostgreSQL database.
- Navigation links and route protections update immediately across the site.
