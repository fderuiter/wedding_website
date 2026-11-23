import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import SetupWizard, { type SetupWizardSavedConfig } from '@/components/setup/SetupWizard';
import { getAppConfig, isSiteInitialized, isSetupCompleted } from '@/lib/config';

/**
 * Admin-protected setup route (/admin/setup) that keeps SetupWizard reachable
 * across browser reloads and reopened tabs until Step 5 marks setupCompleted true.
 */
export default async function AdminSetupPage() {
  const isStaticExport =
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export';

  if (isStaticExport) {
    return <SetupWizard />;
  }

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
      val && val.trim().toUpperCase() !== 'TBD' ? val.trim() : '';

    initialSavedConfig = {
      step: 3,
      partner1Name: config.partner1Name || config.brideName || '',
      partner2Name: config.partner2Name || config.groomName || '',
      weddingDate: weddingDateIso,
      baseUrl: config.baseUrl || '',
      contactEmail: config.contactEmail || '',
      venueName: cleanVenue(config.venueName),
      venueCity: cleanVenue(config.venueCity),
      venueState: cleanVenue(config.venueState),
      timezone: config.timezone || 'America/Chicago',
      themePreset: config.themePreset,
      colorPrimary: config.colorPrimary,
      colorSecondary: config.colorSecondary,
    };
  }

  return <SetupWizard initialSavedConfig={initialSavedConfig} />;
}
