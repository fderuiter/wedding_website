import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createPageMetadata } from '@/app/metadata';
import SetupWizard, { type SetupWizardSavedConfig } from '@/components/setup/SetupWizard';
import { enforceAdminPageSession, isStaticExportBuild } from '@/core/auth/adminPageGuard';
import { getAppConfig, isSiteInitialized, isSetupCompleted } from '@/lib/config';
import { isNonPlaceholderVenueText } from '@/utils/maps';

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
    const weddingDateIso =
      config.weddingDate instanceof Date && !Number.isNaN(config.weddingDate.getTime())
        ? config.weddingDate.toISOString().slice(0, 10)
        : '';
    const cleanVenue = (val: string | null | undefined) =>
      isNonPlaceholderVenueText(val) ? val.trim() : '';

    initialSavedConfig = {
      step: 3,
      partner1Name: config.partner1Name || config.brideName || '',
      partner2Name: config.partner2Name || config.groomName || '',
      weddingDate: weddingDateIso,
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
      timezone: config.timezone || 'America/Chicago',
      themePreset: config.themePreset,
      colorPrimary: config.colorPrimary,
      colorSecondary: config.colorSecondary,
    };
  }

  return <SetupWizard initialSavedConfig={initialSavedConfig} />;
}
