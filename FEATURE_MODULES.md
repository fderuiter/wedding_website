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

## Enumerated Feature Modules

The following 10 optional features are enumerated and supported:

| Feature Identifier | Title | Category | Description | Affected UI Routes | Affected API Routes | Dependencies |
| --- | --- | --- | --- | --- | --- | --- |
| `registry` | Gift Registry | Core | Custom gift registry system for guests to browse and claim items. | `/registry`, `/registry/add-item`, `/registry/edit-item` | `/api/registry/*` | None |
| `groupGifting` | Group Gifting | Core | Partial monetary contribution support on high-value registry items. | `/registry` (group gift UI) | `/api/registry/contribute` | Requires `registry` |
| `guestPasscode` | Guest Passcode Access | Core | Gatekeeper forcing guest passcode login before viewing site content. | `/guest/login` | `/api/guest/login` | None |
| `weather` | Weather Forecast | Information | Live weather forecast widget for the wedding date and venue location. | `/weather` | `/api/weather` | None |
| `weddingParty` | Wedding Party Roster | Information | Biographies and photos for members of the wedding party. | `/wedding-party` | `/api/admin/wedding-party` | None |
| `attractions` | Local Attractions | Information | Guide for guests with local recommendations, maps, and categories. | `/things-to-do` | `/api/admin/attractions` | None |
| `gallery` | Photo Gallery & Media | Engagement | Photo gallery page and administrative media management. | `/photos` | `/api/media/*` | None |
| `countdown` | Homepage Countdown Timer | Engagement | Live countdown timer widget on the homepage layout. | Homepage (`/`) | N/A | None |
| `addToCalendar` | Add to Calendar Widget | Engagement | Calendar invitation button generating ICS / Google Calendar files. | Homepage (`/`) | N/A | None |
| `interactive3D` | Interactive 3D Experiences | Experience | Interactive 3D canvas and Heart page rendered with React Three Fiber. | `/heart` | N/A | None |

---

## Schema Validation & Data Model

Module configuration is schema-validated using Zod via `ModuleConfigSchema` (`src/lib/modules.ts`):

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
