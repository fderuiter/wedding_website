import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createPageMetadata } from '@/app/metadata';
import SetupWizard, { type SetupWizardSavedConfig } from '@/components/setup/SetupWizard';
import { enforceAdminPageSession, isStaticExportBuild } from '@/core/auth/adminPageGuard';
import { getAppConfig, isSiteInitialized, isSetupCompleted } from '@/lib/config';
import { resolveModuleConfig } from '@/lib/modules';
import { isNonPlaceholderVenueText } from '@/utils/maps';
import { extractVenueDateAndTime } from '@/utils/venueDateTime';

export const metadata: Metadata = createPageMetadata({
  title: 'Initial Site Setup',
  description: 'Configure initial couple details, wedding date, venue, and theme settings.',
  noIndex: true,
});

/**
 * Admin-protected setup route (/admin/setup) that keeps SetupWizard reachable
 * across browser reloads and reopened tabs until Step 5 marks setupCompleted true.
 */
export default async function AdminSetupPage() {
  if (isStaticExportBuild()) {
    return <SetupWizard />;
  }

  await enforceAdminPageSession();
  await headers();

  const config = await getAppConfig();
  const initialized = isSiteInitialized(config);

  if (initialized && isSetupCompleted(config)) {
    redirect('/admin/dashboard');
  }

  let initialSavedConfig: SetupWizardSavedConfig | undefined;
  if (initialized) {
    const resolvedTimezone = config.timezone || 'America/Chicago';
    const hydratedVenueDateTime =
      config.weddingDate instanceof Date && !Number.isNaN(config.weddingDate.getTime())
        ? extractVenueDateAndTime(config.weddingDate, resolvedTimezone)
        : { date: '', time: '16:00' };
    const cleanVenue = (val: string | null | undefined) =>
      isNonPlaceholderVenueText(val) ? val.trim() : '';
    const hasSavedModuleFields =
      config.modules !== undefined ||
      typeof config.showCountdown === 'boolean' ||
      typeof config.showAddToCalendar === 'boolean';
    const hydratedEnabledFeatures = hasSavedModuleFields
      ? resolveModuleConfig({
        ...resolveModuleConfig(config.modules),
        ...(typeof config.showCountdown === 'boolean' ? { countdown: config.showCountdown } : {}),
        ...(typeof config.showAddToCalendar === 'boolean'
          ? { addToCalendar: config.showAddToCalendar }
          : {}),
      })
      : undefined;

    initialSavedConfig = {
      step: 3,
      partner1Name: config.partner1Name || config.brideName || '',
      partner2Name: config.partner2Name || config.groomName || '',
      weddingDate: hydratedVenueDateTime.date,
      ceremonyTime: hydratedVenueDateTime.time,
      baseUrl: config.baseUrl || '',
      contactEmail: config.contactEmail || '',
      venueName: cleanVenue(config.venueName),
      venueAddress: cleanVenue(config.venueAddress),
      venueCity: cleanVenue(config.venueCity),
      venueState: cleanVenue(config.venueState),
      venueZip: cleanVenue(config.venueZip),
      latitude:
        typeof config.latitude === 'number' && Number.isFinite(config.latitude)
          ? config.latitude
          : 0,
      longitude:
        typeof config.longitude === 'number' && Number.isFinite(config.longitude)
          ? config.longitude
          : 0,
      timezone: resolvedTimezone,
      themePreset: config.themePreset,
      colorPrimary: config.colorPrimary,
      colorSecondary: config.colorSecondary,
      ...(hydratedEnabledFeatures ? { enabledFeatures: hydratedEnabledFeatures } : {}),
    };
  }

  return <SetupWizard initialSavedConfig={initialSavedConfig} />;
}
