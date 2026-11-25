'use client';
import React, { useState, useRef, useEffect, useContext, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  QueryClient,
  QueryClientContext,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';

import { FormGroup, Label, Input, FormMessage, Checkbox } from '@/components/ui/forms';
import { AccessibleStep } from '@/components/ui/AccessibleStep';
import { Container, Card, Heading, MainLandmark } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { ToastContext, ToastProvider } from '@/components/ui/ToastProvider';
import { useAdminWeddingParty } from '@/hooks/admin/useAdminWeddingParty';
import { useAdminAttractions } from '@/hooks/admin/useAdminAttractions';
import { useAdminInvitationCodes } from '@/hooks/admin/useAdminInvitationCodes';
import { hasAddressCollectionTag } from '@/features/registry';
import {
  SETUP_WIZARD_STORAGE_KEY,
  detectBrowserTimezone,
  useSetupWizardMachine,
  type SetupWizardPersistedState,
} from '@/hooks/useSetupWizardMachine';
import {
  ADMIN_SETTINGS_QUERY_KEY,
  invalidateOnboardingMilestones,
  invalidateSampleDataCaches,
} from '@/lib/adminCacheSync';
import {
  FEATURE_METADATA,
  resolveModuleConfig,
  type FeatureId,
} from '@/lib/modules';
import dynamic from 'next/dynamic';
import { WeddingPartyManagerModal } from './WeddingPartyManagerModal';
import { AttractionsManagerModal } from './AttractionsManagerModal';
import { ThemeConfigurationPanel } from '@/components/admin/ThemeConfigurationPanel';
import { AddressLookupInput } from '@/components/admin/AddressLookupInput';
import { SearchableTimezoneSelect } from '@/components/admin/SearchableTimezoneSelect';
import { OnboardingChecklist } from '@/components/admin/OnboardingChecklist';
import { isNonPlaceholderVenueText } from '@/utils/maps';
import { ThemeProvider, useTheme } from '@/components/ThemeProvider';
import { useOptionalDemo } from '@/components/demo/DemoContext';
import { ThemePreset, getPresetTokens, getServerExportTokens } from '@/lib/theme/presets';
import { ARCHETYPE_PRESETS, ArchetypeId } from '@/lib/sampleData/archetypes';
import { Icon } from '@/components/ui/Icon';
import Countdown from '@/components/Countdown';
import {
  ensureStaticDemoRuntime,
  getStaticDemoSavedSetupConfig,
  completeStaticDemoSetup,
} from '@/lib/staticDemo/runtime';
import { withBasePath } from '@/lib/basePath';
import {
  cleanOptionalSetupText,
  formatCleanVenueParts,
  isUpcomingWeddingDate,
  synthesizeSetupStarterCopy,
} from '@/lib/setupCopy';

/**
 * Render a multi-step admin setup wizard for configuring a wedding site.
 *
 * The component presents a login form, an essentials form to collect site and venue details,
 * and a final content step that links to admin pages; it handles authentication and saving
 * settings via the app's admin API endpoints and navigates to the site when setup completes.
 *
 * @returns The setup wizard UI as JSX when active, or `null` when nothing should be rendered.
 */
function isDefaultUrl(url: string): boolean {
  try {
    const urlObj = new URL(url.includes('://') ? url : `https://${url}`);
    const host = urlObj.hostname.toLowerCase();
    return (
      host === 'wedding.example' || host.endsWith('.wedding.example') ||
      host === 'example.com' || host.endsWith('.example.com')
    );
  } catch {
    return false;
  }
}

export type Step2ErrorField =
  | 'partner1'
  | 'partner2'
  | 'weddingDate'
  | 'timezone'
  | 'siteUrl'
  | 'contactEmail'
  | 'colorPrimary'
  | 'colorSecondary'
  | 'form';

const CsvImportWizardModal = dynamic(
  () =>
    import('@/components/admin/CsvImportWizardModal').then(
      (mod) => mod.CsvImportWizardModal
    ),
  {
    loading: () => null,
  }
);

function useSafeRouter() {
  try {
    return useRouter();
  } catch {
    return null;
  }
}

function getSetupErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const candidate = (err as { message?: unknown }).message;
    if (typeof candidate === 'string' && candidate) {
      return candidate;
    }
  }
  return fallback;
}

function syncAdminLoginState() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('isAdminLoggedIn', 'true');
    window.dispatchEvent(new Event('storage'));
  } catch {
    // Ignore storage errors in restricted browser environments
  }
}

function isValidOptionalContactEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed) return true;
  if (trimmed.toLowerCase() === 'hosts@wedding.example') return false;
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed);
}

export function resolveStep2BackendErrorField(message: string): Step2ErrorField {
  const lower = message.toLowerCase();
  if (
    lower.includes('weddingdate') ||
    lower.includes('wedding date') ||
    lower.includes('chronological date')
  ) {
    return 'weddingDate';
  }
  if (lower.includes('timezone') || lower.includes('iana')) {
    return 'timezone';
  }
  if (lower.includes('colorprimary') || lower.includes('primary color')) {
    return 'colorPrimary';
  }
  if (lower.includes('colorsecondary') || lower.includes('secondary color')) {
    return 'colorSecondary';
  }
  if (lower.includes('contactemail') || lower.includes('contact email')) {
    return 'contactEmail';
  }
  if (
    lower.includes('partner2name') ||
    lower.includes('groomname') ||
    lower.includes('partner 2')
  ) {
    return 'partner2';
  }
  if (
    lower.includes('partner1name') ||
    lower.includes('bridename') ||
    lower.includes('partner 1') ||
    lower.includes('partner name')
  ) {
    return 'partner1';
  }
  if (
    lower.includes('baseurl') ||
    lower.includes('base url') ||
    lower.includes('site url') ||
    lower.includes('valid url')
  ) {
    return 'siteUrl';
  }
  return 'form';
}

function parseHexLuminance(hexColor: string): number | null {
  const cleaned = hexColor.trim().replace(/^#/, '');
  const full =
    cleaned.length === 3
      ? cleaned
        .split('')
        .map((ch) => ch + ch)
        .join('')
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return null;
  }
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const toLinear = (c: number) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function getReadableTextOnHex(hexColor: string): string {
  const lum = parseHexLuminance(hexColor);
  if (lum === null) {
    return '#ffffff';
  }
  return lum > 0.179 ? '#111827' : '#ffffff';
}

function ensureContrastColor(
  candidateHex: string,
  backgroundHex: string,
  fallbackHex: string,
  minRatio = 4.5
): string {
  const fgLum = parseHexLuminance(candidateHex);
  const bgLum = parseHexLuminance(backgroundHex);
  if (fgLum === null || bgLum === null) {
    return fallbackHex;
  }
  const lighter = Math.max(fgLum, bgLum);
  const darker = Math.min(fgLum, bgLum);
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return ratio >= minRatio ? candidateHex : fallbackHex;
}

function resolvePreviewCssToken(
  rawValue: string | undefined,
  primaryHex: string,
  secondaryHex: string,
  fallbackHex: string
): string {
  if (typeof rawValue !== 'string' || !rawValue.trim()) {
    return fallbackHex;
  }
  const trimmed = rawValue.trim();
  if (trimmed.includes('--color-primary')) {
    return primaryHex;
  }
  if (trimmed.includes('--color-secondary')) {
    return secondaryHex;
  }
  if (trimmed.startsWith('var(') && trimmed.endsWith(')')) {
    const commaIdx = trimmed.indexOf(',');
    if (commaIdx !== -1) {
      const innerFallback = trimmed.slice(commaIdx + 1, trimmed.length - 1).trim();
      if (innerFallback && !innerFallback.startsWith('var(')) {
        return innerFallback;
      }
    }
    return fallbackHex;
  }
  return trimmed;
}

export interface SetupWizardSavedConfig extends Partial<SetupWizardPersistedState> {
  themePreset?: ThemePreset;
  colorPrimary?: string;
  colorSecondary?: string;
}

interface SetupWizardProps {
  initialSavedConfig?: SetupWizardSavedConfig;
  onDemoComplete?: () => void;
}

function SetupWizardContent({
  initialSavedConfig,
  onDemoComplete,
  hasAppShell = false,
}: SetupWizardProps & { hasAppShell?: boolean }) {
  const router = useSafeRouter();
  const queryClient = useQueryClient();
  const demo = useOptionalDemo();
  const isDemoMode = Boolean(demo?.isDemoMode);
  const [hasOpenedCsvModal, setHasOpenedCsvModal] = useState(false);
  const browserDetectedTimezone = useMemo(
    () => detectBrowserTimezone('America/Chicago'),
    []
  );
  const normalizedInitialSavedConfig: Partial<SetupWizardPersistedState> = {
    timezone: initialSavedConfig?.timezone || browserDetectedTimezone,
    ...(initialSavedConfig
      ? {
        ...initialSavedConfig,
        step:
          initialSavedConfig.step ??
          (initialSavedConfig.partner1Name &&
          initialSavedConfig.partner2Name &&
          initialSavedConfig.baseUrl
            ? 3
            : undefined),
      }
      : {}),
  };
  const {
    state,
    setStep,
    updateDraft,
    toggleModule,
    openModal,
    closeModal,
    setError,
    startSubmit,
    loginSuccess,
    clearPersistedState,
  } = useSetupWizardMachine(normalizedInitialSavedConfig);

  const {
    step,
    isAuthenticated,
    isLoading: loading,
    error,
    activeModal,
    partner1Name,
    partner2Name,
    weddingDate,
    baseUrl,
    contactEmail = '',
    venueName,
    venueAddress = '',
    venueCity,
    venueState,
    venueZip = '',
    latitude = 0,
    longitude = 0,
    timezone,
    themePreset,
    colorPrimary,
    colorSecondary,
    enabledFeatures,
    sampleArchetype,
    selectedModules,
    importedGuestCount = 0,
  } = state;

  const setPartner1Name = (val: string) => updateDraft({ partner1Name: val });
  const setPartner2Name = (val: string) => updateDraft({ partner2Name: val });
  const setWeddingDate = (val: string) => updateDraft({ weddingDate: val });
  const setBaseUrl = (val: string) => updateDraft({ baseUrl: val });
  const setContactEmail = (val: string) => updateDraft({ contactEmail: val });
  const setVenueName = (val: string) => updateDraft({ venueName: val });
  const setVenueAddress = (val: string) => updateDraft({ venueAddress: val });
  const setVenueCity = (val: string) => updateDraft({ venueCity: val });
  const setVenueState = (val: string) => updateDraft({ venueState: val });
  const setVenueZip = (val: string) => updateDraft({ venueZip: val });
  const setTimezone = (val: string) => updateDraft({ timezone: val });
  const setSampleArchetype = (archetype: ArchetypeId) => updateDraft({ sampleArchetype: archetype });
  const setSelectedModules = (modules: string[]) => updateDraft({ selectedModules: modules });

  // Login
  const [password, setPassword] = useState(() => (isDemoMode ? 'demo-admin-2026' : ''));
  const passwordInputRef = useRef<HTMLInputElement>(null);
  const seededDemoDefaultsRef = useRef(false);

  useEffect(() => {
    if (!isDemoMode || seededDemoDefaultsRef.current) return;
    seededDemoDefaultsRef.current = true;
    const patch: Record<string, unknown> = {};
    if (!partner1Name) patch.partner1Name = demo?.configOverrides.partner1Name || 'Alex';
    if (!partner2Name) patch.partner2Name = demo?.configOverrides.partner2Name || 'Taylor';
    if (!weddingDate) patch.weddingDate = demo?.configOverrides.weddingDate || '2026-09-19';
    if (!baseUrl) patch.baseUrl = 'https://ourwedding-showcase.org';
    if (!venueName) patch.venueName = demo?.configOverrides.venueName || 'The Glasshouse Estate';
    if (!venueCity) patch.venueCity = demo?.configOverrides.venueCity || 'Chicago';
    if (!venueState) patch.venueState = demo?.configOverrides.venueState || 'IL';
    if (Object.keys(patch).length > 0) {
      updateDraft(patch);
    }
  }, [
    isDemoMode,
    partner1Name,
    partner2Name,
    weddingDate,
    baseUrl,
    venueName,
    venueCity,
    venueState,
    demo?.configOverrides,
    updateDraft,
  ]);

  // Content Counts
  const { data: partyMembers = [] } = useAdminWeddingParty({ enabled: isAuthenticated });
  const { data: attractions = [] } = useAdminAttractions({ enabled: isAuthenticated });
  const { data: invitationCodes = [], fetchAll: refetchInvitationCodes } = useAdminInvitationCodes({ enabled: isAuthenticated });
  const nonSamplePartyMembers = partyMembers.filter((member) => !member.isSample);
  const nonSampleAttractions = attractions.filter((attraction) => !attraction.isSample);
  const nonSampleInvitationCodes = invitationCodes.filter(
    (code) => !code.isSample && !hasAddressCollectionTag(code.partyTags)
  );
  const activeNonSampleGuestCount =
    nonSampleInvitationCodes.length > 0 ? nonSampleInvitationCodes.length : importedGuestCount;

  const handleGuestImportComplete = async () => {
    const result = await refetchInvitationCodes();
    const rawItems =
      result && typeof result === 'object' && 'data' in result
        ? (result as { data?: typeof invitationCodes }).data
        : result;
    const codes = Array.isArray(rawItems) ? rawItems : invitationCodes;
    const nonSampleCount = codes.filter(
      (code) => !code.isSample && !hasAddressCollectionTag(code.partyTags)
    ).length;
    updateDraft({ importedGuestCount: nonSampleCount });
  };

  // Theme & Step 2 live preview state
  const { resolvedTheme, setThemeMode, setPreviewConfig } = useTheme();
  const previewMode: 'light' | 'dark' = resolvedTheme === 'dark' ? 'dark' : 'light';
  const [step2Viewport, setStep2Viewport] = useState<'desktop' | 'mobile'>('desktop');
  const step2DesktopBtnRef = useRef<HTMLButtonElement>(null);
  const step2MobileBtnRef = useRef<HTMLButtonElement>(null);
  const step2LightModeBtnRef = useRef<HTMLButtonElement>(null);
  const step2DarkModeBtnRef = useRef<HTMLButtonElement>(null);
  const [step2ErrorField, setStep2ErrorField] = useState<Step2ErrorField>('form');

  const handleStep2ViewportKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    current: 'desktop' | 'mobile',
  ) => {
    let next: 'desktop' | 'mobile' | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = current === 'desktop' ? 'mobile' : 'desktop';
    } else if (e.key === 'Home') {
      next = 'desktop';
    } else if (e.key === 'End') {
      next = 'mobile';
    }
    if (!next) return;
    e.preventDefault();
    setStep2Viewport(next);
    if (next === 'desktop') {
      step2DesktopBtnRef.current?.focus();
    } else {
      step2MobileBtnRef.current?.focus();
    }
  };

  const handleStep2ColorModeKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    current: 'light' | 'dark',
  ) => {
    let next: 'light' | 'dark' | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = current === 'light' ? 'dark' : 'light';
    } else if (e.key === 'Home') {
      next = 'light';
    } else if (e.key === 'End') {
      next = 'dark';
    }
    if (!next) return;
    e.preventDefault();
    setThemeMode(next);
    if (next === 'light') {
      step2LightModeBtnRef.current?.focus();
    } else {
      step2DarkModeBtnRef.current?.focus();
    }
  };

  const partner1InputRef = useRef<HTMLInputElement>(null);
  const partner2InputRef = useRef<HTMLInputElement>(null);
  const weddingDateInputRef = useRef<HTMLInputElement>(null);
  const timezoneInputRef = useRef<HTMLInputElement>(null);
  const siteUrlInputRef = useRef<HTMLInputElement>(null);
  const contactEmailInputRef = useRef<HTMLInputElement>(null);
  const step2FormAlertRef = useRef<HTMLDivElement>(null);

  const focusStep2Field = (field: Step2ErrorField) => {
    switch (field) {
      case 'partner1':
        partner1InputRef.current?.focus();
        break;
      case 'partner2':
        partner2InputRef.current?.focus();
        break;
      case 'weddingDate':
        weddingDateInputRef.current?.focus();
        break;
      case 'timezone':
        timezoneInputRef.current?.focus();
        break;
      case 'contactEmail':
        contactEmailInputRef.current?.focus();
        break;
      case 'colorPrimary':
        if (typeof document !== 'undefined') {
          (document.getElementById('colorPrimary') as HTMLInputElement | null)?.focus();
        }
        break;
      case 'colorSecondary':
        if (typeof document !== 'undefined') {
          (document.getElementById('colorSecondary') as HTMLInputElement | null)?.focus();
        }
        break;
      case 'siteUrl':
        siteUrlInputRef.current?.focus();
        break;
      case 'form':
      default:
        step2FormAlertRef.current?.focus();
        break;
    }
  };

  React.useLayoutEffect(() => {
    if (step === 2 && error && step2ErrorField === 'form') {
      step2FormAlertRef.current?.focus();
    }
  }, [step, error, step2ErrorField]);

  useEffect(() => {
    if (isAuthenticated && !isDemoMode) {
      syncAdminLoginState();
    }
  }, [isAuthenticated, isDemoMode]);

  useEffect(() => {
    if (step >= 2 && typeof setPreviewConfig === 'function') {
      setPreviewConfig({
        themePreset,
        colorPrimary,
        colorSecondary,
      });
    }
  }, [step, themePreset, colorPrimary, colorSecondary, setPreviewConfig]);

  const handleThemeChange = (
    fields: Partial<{
      themePreset: ThemePreset | string;
      colorPrimary: string;
      colorSecondary: string;
    }>
  ) => {
    const patch: Partial<SetupWizardPersistedState> = {};
    if (fields.themePreset !== undefined) {
      patch.themePreset = fields.themePreset as ThemePreset;
    }
    if (fields.colorPrimary !== undefined) {
      patch.colorPrimary = fields.colorPrimary;
    }
    if (fields.colorSecondary !== undefined) {
      patch.colorSecondary = fields.colorSecondary;
    }
    if (Object.keys(patch).length > 0) {
      updateDraft(patch);
    }
  };

  const handleLogin = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isDemoMode && demo) {
      demo.setSetupAuthenticated(true);
      updateDraft({
        partner1Name: partner1Name.trim() || demo.configOverrides.partner1Name || 'Alex',
        partner2Name: partner2Name.trim() || demo.configOverrides.partner2Name || 'Taylor',
        baseUrl:
          !baseUrl.trim() || isDefaultUrl(baseUrl)
            ? 'https://alexandtaylor2026.wedding'
            : baseUrl,
      });
      loginSuccess();
      return;
    }
    startSubmit();
    try {
      const res = await fetch(withBasePath('/api/admin/setup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        syncAdminLoginState();
        loginSuccess();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Invalid admin password.');
        passwordInputRef.current?.focus();
        passwordInputRef.current?.select();
      }
    } catch (err: unknown) {
      setError(getSetupErrorMessage(err, 'Failed to log in.'));
      passwordInputRef.current?.focus();
      passwordInputRef.current?.select();
    }
  };

  const handleSaveConfig = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedPartner1 = partner1Name.trim();
    const trimmedPartner2 = partner2Name.trim();
    const trimmedBaseUrl = baseUrl.trim();

    if (!trimmedPartner1 || !trimmedPartner2) {
      if (!trimmedPartner1) {
        setStep2ErrorField('partner1');
        setError('Please enter names for both partners.');
        partner1InputRef.current?.focus();
      } else {
        setStep2ErrorField('partner2');
        setError('Please enter names for both partners.');
        partner2InputRef.current?.focus();
      }
      return;
    }

    try {
      new URL(trimmedBaseUrl);
      if (isDefaultUrl(trimmedBaseUrl)) {
        setStep2ErrorField('siteUrl');
        setError('Please use your own URL, not a sample or default domain.');
        siteUrlInputRef.current?.focus();
        return;
      }
    } catch {
      // If it's not a valid URL, it will fail backend validation anyway.
      // But we can also set an error here.
      setStep2ErrorField('siteUrl');
      setError('Please enter a valid URL.');
      siteUrlInputRef.current?.focus();
      return;
    }

    const trimmedContactEmail = contactEmail.trim();
    if (!isValidOptionalContactEmail(trimmedContactEmail)) {
      setStep2ErrorField('contactEmail');
      setError('Please enter a valid contact email address or leave it blank.');
      contactEmailInputRef.current?.focus();
      return;
    }

    const cleanedVenueName = cleanOptionalSetupText(venueName);
    const cleanedVenueAddress = cleanOptionalSetupText(venueAddress);
    const cleanedVenueCity = cleanOptionalSetupText(venueCity);
    const cleanedVenueState = cleanOptionalSetupText(venueState);
    const cleanedVenueZip = cleanOptionalSetupText(venueZip);
    const rawTimezoneInput = timezoneInputRef.current?.value;
    const resolvedTimezone =
      (typeof rawTimezoneInput === 'string' ? rawTimezoneInput.trim() : timezone.trim()) ||
      'America/Chicago';
    const resolvedModules = resolveModuleConfig(enabledFeatures);
    const starterCopy = synthesizeSetupStarterCopy({
      partner1Name: trimmedPartner1,
      partner2Name: trimmedPartner2,
      weddingDate,
      timezone: resolvedTimezone,
      venueName: cleanedVenueName,
      venueCity: cleanedVenueCity,
      venueState: cleanedVenueState,
    });

    updateDraft({
      partner1Name: trimmedPartner1,
      partner2Name: trimmedPartner2,
      baseUrl: trimmedBaseUrl,
      contactEmail: trimmedContactEmail,
      venueName: cleanedVenueName,
      venueAddress: cleanedVenueAddress,
      venueCity: cleanedVenueCity,
      venueState: cleanedVenueState,
      venueZip: cleanedVenueZip,
      timezone: resolvedTimezone,
    });

    if (isDemoMode && demo) {
      demo.updateConfigOverrides({
        partner1Name: trimmedPartner1,
        partner2Name: trimmedPartner2,
        weddingDate: weddingDate ? new Date(`${weddingDate}T16:00:00Z`) : new Date('2026-10-18T16:00:00Z'),
        contactEmail: trimmedContactEmail,
        venueName: cleanedVenueName,
        venueAddress: cleanedVenueAddress,
        venueCity: cleanedVenueCity,
        venueState: cleanedVenueState,
        venueZip: cleanedVenueZip,
        latitude: typeof latitude === 'number' && Number.isFinite(latitude) ? latitude : 0,
        longitude: typeof longitude === 'number' && Number.isFinite(longitude) ? longitude : 0,
        heroTitle: starterCopy.heroTitle,
        heroSubtitle: starterCopy.heroSubtitle,
        storyText: starterCopy.storyText,
        venueDescription: '',
        travelAdvice: '',
        seoTitle: starterCopy.seoTitle,
        seoDescription: starterCopy.seoDescription,
        timezone: resolvedTimezone,
        themePreset,
        colorPrimary,
        colorSecondary,
        modules: resolvedModules,
        showCountdown: resolvedModules.countdown,
        showAddToCalendar: resolvedModules.addToCalendar,
      });
      demo.setSetupAuthenticated(true);
      setStep(3);
      return;
    }

    startSubmit();
    try {
      const res = await fetch(withBasePath('/api/admin/setup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner1Name: trimmedPartner1,
          partner2Name: trimmedPartner2,
          weddingDate,
          baseUrl: trimmedBaseUrl,
          contactEmail: trimmedContactEmail,
          venueName: cleanedVenueName,
          venueAddress: cleanedVenueAddress,
          venueCity: cleanedVenueCity,
          venueState: cleanedVenueState,
          venueZip: cleanedVenueZip,
          timezone: resolvedTimezone,
          latitude: typeof latitude === 'number' && Number.isFinite(latitude) ? latitude : 0,
          longitude: typeof longitude === 'number' && Number.isFinite(longitude) ? longitude : 0,
          storyText: starterCopy.storyText,
          venueDescription: '',
          travelAdvice: '',
          heroTitle: starterCopy.heroTitle,
          heroSubtitle: starterCopy.heroSubtitle,
          seoTitle: starterCopy.seoTitle,
          seoDescription: starterCopy.seoDescription,
          themePreset,
          colorPrimary,
          colorSecondary,
          modules: resolvedModules,
          showCountdown: resolvedModules.countdown,
          showAddToCalendar: resolvedModules.addToCalendar,
          setupCompleted: false,
        }),
      });
      if (res.ok) {
        syncAdminLoginState();
        setStep(3);
        if (typeof window !== 'undefined') {
          const setupPath = withBasePath('/admin/setup');
          if (window.location.pathname.replace(/\/+$/, '') !== setupPath) {
            try {
              window.history.replaceState(window.history.state, '', setupPath);
            } catch {
              // Ignore history replacement errors in restricted environments
            }
          }
        }
      } else {
        const data = await res.json().catch(() => ({}));
        const errMsg =
          typeof data.error === 'string' && data.error
            ? data.error
            : 'Failed to save configuration.';
        const targetField = resolveStep2BackendErrorField(errMsg);
        setStep2ErrorField(targetField);
        setError(errMsg);
        focusStep2Field(targetField);
      }
    } catch (err: unknown) {
      setStep2ErrorField('form');
      setError(getSetupErrorMessage(err, 'Failed to save config.'));
      focusStep2Field('form');
    }
  };

  const persistStep3FeatureToggles = async () => {
    const resolvedModules = resolveModuleConfig(enabledFeatures);
    if (isDemoMode && demo) {
      demo.updateConfigOverrides({
        modules: resolvedModules,
        showCountdown: resolvedModules.countdown,
        showAddToCalendar: resolvedModules.addToCalendar,
      });
      if (queryClient) {
        await queryClient.invalidateQueries({ queryKey: ADMIN_SETTINGS_QUERY_KEY });
      }
      invalidateOnboardingMilestones(queryClient);
      return;
    }

    const setupRes = await fetch(withBasePath('/api/admin/setup'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setupCompleted: false,
        modules: resolvedModules,
        showCountdown: resolvedModules.countdown,
        showAddToCalendar: resolvedModules.addToCalendar,
      }),
    });
    if (setupRes && !setupRes.ok) {
      const data = await setupRes.json().catch(() => ({}));
      throw new Error(
        typeof data.error === 'string' && data.error
          ? data.error
          : 'Failed to save feature module settings.'
      );
    }
    if (queryClient) {
      await queryClient.invalidateQueries({ queryKey: ADMIN_SETTINGS_QUERY_KEY });
    }
    invalidateOnboardingMilestones(queryClient);
  };

  const handleFeatureToggle = (featureId: FeatureId, checked: boolean) => {
    const nextFeatures = resolveModuleConfig({
      ...enabledFeatures,
      [featureId]: checked,
    });
    const nextSampleModules = nextFeatures.registry
      ? selectedModules
      : selectedModules.filter((m) => m !== 'registry');
    updateDraft({
      enabledFeatures: nextFeatures,
      selectedModules: nextSampleModules,
    });
  };

  const handleSampleDataSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const effectiveSampleModules = enabledFeatures.registry
      ? selectedModules
      : selectedModules.filter((m) => m !== 'registry');

    if (isDemoMode && demo) {
      await persistStep3FeatureToggles();
      demo.applySampleSelection(sampleArchetype, effectiveSampleModules);
      await invalidateSampleDataCaches(queryClient);
      setStep(4);
      return;
    }
    startSubmit();
    try {
      await persistStep3FeatureToggles();
      if (effectiveSampleModules.length > 0) {
        const res = await fetch(withBasePath('/api/admin/sample-data'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            archetype: sampleArchetype,
            modules: effectiveSampleModules,
          }),
        });
        if (res && !res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to generate sample data.');
        }
      } else {
        const delRes = await fetch(withBasePath('/api/admin/sample-data'), { method: 'DELETE' });
        if (delRes && !delRes.ok) {
          const data = await delRes.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to clear sample data.');
        }
      }
      await invalidateSampleDataCaches(queryClient);
      setStep(4);
    } catch (err: unknown) {
      setError(getSetupErrorMessage(err, 'Error configuring sample data.'));
    }
  };

  const handleSkipSampleData = async () => {
    setSelectedModules([]);
    if (isDemoMode && demo) {
      await persistStep3FeatureToggles();
      demo.applySampleSelection(sampleArchetype, []);
      await invalidateSampleDataCaches(queryClient);
      setStep(4);
      return;
    }
    startSubmit();
    try {
      await persistStep3FeatureToggles();
      const delRes = await fetch(withBasePath('/api/admin/sample-data'), {
        method: 'DELETE',
      });
      if (delRes && !delRes.ok) {
        const data = await delRes.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to clear sample data.');
      }
      await invalidateSampleDataCaches(queryClient);
      setStep(4);
    } catch (err: unknown) {
      setError(getSetupErrorMessage(err, 'Error skipping sample data.'));
    }
  };

  const previewVenue = formatCleanVenueParts({
    venueName,
    venueAddress,
    venueCity,
    venueState,
    venueZip,
  });
  const previewStarterCopy = synthesizeSetupStarterCopy({
    partner1Name: partner1Name.trim() || 'Partner One',
    partner2Name: partner2Name.trim() || 'Partner Two',
    weddingDate,
    timezone: timezone || 'America/Chicago',
    venueName: previewVenue.venueName,
    venueCity: previewVenue.venueCity,
    venueState: previewVenue.venueState,
  });
  const previewExportTokens = getServerExportTokens(themePreset, null, {
    colorPrimary,
    colorSecondary,
  });
  const previewCompTokens = getPresetTokens(themePreset, previewMode);
  const defaultPreviewModeTokens = getPresetTokens('classic', previewMode);
  const previewCanvasBg = resolvePreviewCssToken(
    previewCompTokens['--container-bg'],
    colorPrimary,
    colorSecondary,
    defaultPreviewModeTokens['--container-bg'] || previewExportTokens.canvasBg
  );
  const previewCardBg = resolvePreviewCssToken(
    previewCompTokens['--card-bg'],
    colorPrimary,
    colorSecondary,
    defaultPreviewModeTokens['--card-bg'] || previewExportTokens.cardBg
  );
  const previewCardBorder = resolvePreviewCssToken(
    previewCompTokens['--card-border'],
    colorPrimary,
    colorSecondary,
    defaultPreviewModeTokens['--card-border'] || '#e5e7eb'
  );
  const previewBodyTextColor = resolvePreviewCssToken(
    previewCompTokens['--form-label-text'],
    colorPrimary,
    colorSecondary,
    defaultPreviewModeTokens['--form-label-text']
  );
  const rawPreviewHeadingColor = resolvePreviewCssToken(
    previewCompTokens['--heading-color'],
    colorPrimary,
    colorSecondary,
    previewBodyTextColor
  );
  const previewHeadingOnCanvas = ensureContrastColor(
    rawPreviewHeadingColor,
    previewCanvasBg,
    previewBodyTextColor,
    4.5
  );
  const previewHeadingOnCard = ensureContrastColor(
    rawPreviewHeadingColor,
    previewCardBg,
    previewBodyTextColor,
    4.5
  );
  const rawPreviewMutedColor = resolvePreviewCssToken(
    previewCompTokens['--form-message-text'],
    colorPrimary,
    colorSecondary,
    previewMode === 'dark' ? '#d4d4d8' : '#4b5563'
  );
  const previewMutedOnCanvas = ensureContrastColor(
    rawPreviewMutedColor,
    previewCanvasBg,
    previewBodyTextColor,
    4.5
  );
  const previewMutedOnCard = ensureContrastColor(
    rawPreviewMutedColor,
    previewCardBg,
    previewBodyTextColor,
    4.5
  );
  const previewCardRadius = previewCompTokens['--schedule-card-radius'] || '1rem';
  const previewBtnRadius = previewCompTokens['--btn-radius'] || '9999px';
  const safePreviewPrimary = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(colorPrimary.trim())
    ? colorPrimary.trim()
    : '#4A5568';
  const safePreviewSecondary = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(colorSecondary.trim())
    ? colorSecondary.trim()
    : '#2D3748';
  const previewCtaTextColor = getReadableTextOnHex(safePreviewPrimary);
  const previewParsedDate = weddingDate
    ? /^\d{4}-\d{2}-\d{2}$/.test(weddingDate.trim())
      ? new Date(`${weddingDate.trim()}T16:00:00.000Z`)
      : new Date(weddingDate)
    : null;
  const hasValidPreviewDate = Boolean(
    previewParsedDate && !Number.isNaN(previewParsedDate.getTime())
  );
  const showPreviewCountdown =
    enabledFeatures.countdown &&
    hasValidPreviewDate &&
    isUpcomingWeddingDate(weddingDate);

  const handleCompleteAndExit = async (destinationPath = '/admin/dashboard') => {
    completeStaticDemoSetup();
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem(SETUP_WIZARD_STORAGE_KEY);
      } catch {
        // Ignore storage errors in restricted browser environments
      }
    }
    if (isDemoMode && demo) {
      clearPersistedState();
      demo.setSetupAuthenticated(false);
      demo.setPersona('admin');
      if (onDemoComplete && destinationPath === '/admin/dashboard') {
        onDemoComplete();
      } else if (hasAppShell && router?.push) {
        router.push(destinationPath);
        router.refresh?.();
      }
      return;
    }
    syncAdminLoginState();
    startSubmit();
    try {
      await fetch(withBasePath('/api/admin/setup'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupCompleted: true }),
      });
    } catch {
      // Allow navigation to proceed even if network completion call fails
    }
    clearPersistedState();
    if (hasAppShell && router?.push) {
      router.push(destinationPath);
      router.refresh?.();
    } else if (typeof window !== 'undefined') {
      window.location.assign(
        new URL(withBasePath(destinationPath), window.location.origin).href
      );
    }
  };

  return (
    <MainLandmark className="min-h-screen py-12 flex flex-col justify-center items-center">
      <h1 className="sr-only">Wedding Website Setup Wizard</h1>
      <AccessibleStep isActive={step === 1}>
        <Container>
          <Card className="max-w-md">
            <Heading as="h2" className="mb-4">Welcome to Your Wedding Site!</Heading>
            {isDemoMode ? (
              <p className="mb-4 text-gray-700 dark:text-gray-200">
                <strong>Interactive Showcase Mode:</strong> Step through all 5 onboarding stages locally without server calls. A sample password is pre-filled—click Continue to begin.
              </p>
            ) : (
              <p className="mb-4 text-gray-700 dark:text-gray-200">Please enter the admin password configured in your environment to begin setup.</p>
            )}
            <form onSubmit={handleLogin} className="space-y-4">
              <FormGroup state={error && step === 1 ? 'error' : 'default'}>
                <Label htmlFor="adminPassword" className="sr-only">Admin Password</Label>
                <Input
                  ref={passwordInputRef}
                  id="adminPassword"
                  type="password"
                  placeholder="Admin Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                {error && step === 1 && <FormMessage>{error}</FormMessage>}
              </FormGroup>
              <Button type="submit" disabled={loading} variant="primary" className="w-full py-3">
                {loading ? 'Authenticating...' : 'Continue'}
              </Button>
            </form>
          </Card>
        </Container>
      </AccessibleStep>

      {step >= 2 && (
        <nav
          aria-label="Setup wizard progress"
          className="w-full max-w-6xl mx-auto px-4 sm:px-6 mb-6"
        >
          <ol className="flex flex-wrap items-center justify-center sm:justify-between gap-2 rounded-xl border border-gray-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 px-4 py-2.5 text-xs font-semibold shadow-xs">
            {[
              { num: 1, label: 'Auth' },
              { num: 2, label: 'Essentials' },
              { num: 3, label: 'Features & Sample Data' },
              { num: 4, label: 'Guest List' },
              { num: 5, label: 'Complete' },
            ].map((item) => {
              const isCurrent = step === item.num;
              const isDone = step > item.num;
              return (
                <li
                  key={item.num}
                  aria-current={isCurrent ? 'step' : undefined}
                  className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-lg ${
                    isCurrent
                      ? 'bg-rose-50 dark:bg-zinc-800 text-gray-900 dark:text-white ring-1 ring-primary/40'
                      : isDone
                        ? 'text-emerald-800 dark:text-emerald-300'
                        : 'text-gray-600 dark:text-zinc-400'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${
                      isCurrent
                        ? 'bg-primary text-white'
                        : isDone
                          ? 'bg-emerald-700 text-white dark:bg-emerald-500 dark:text-gray-950'
                          : 'bg-gray-200 dark:bg-zinc-800 text-gray-700 dark:text-zinc-300'
                    }`}
                  >
                    {isDone ? '✓' : item.num}
                  </span>
                  <span>{item.label}</span>
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <AccessibleStep isActive={step === 2}>
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <Card className="w-full max-w-none lg:col-span-7">
            <Heading as="h2" className="mb-4">Step 2: The Essentials</Heading>
            <p className="mb-4 text-gray-700 dark:text-gray-200">Let&apos;s start with your names and when the big day is.</p>
            {error && step === 2 && step2ErrorField === 'form' && (
              <div
                ref={step2FormAlertRef}
                role="alert"
                tabIndex={-1}
                data-testid="step2-form-error-banner"
                className="mb-4 rounded-xl border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3.5 text-sm font-medium text-red-900 dark:text-red-200 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {error}
              </div>
            )}
            <form onSubmit={handleSaveConfig} noValidate className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormGroup state={!!error && step === 2 && step2ErrorField === 'partner1' ? 'error' : 'default'}>
                  <Label htmlFor="partner1">Partner 1</Label>
                  <Input
                    ref={partner1InputRef}
                    id="partner1"
                    type="text"
                    value={partner1Name}
                    onChange={(e) => setPartner1Name(e.target.value)}
                    required
                  />
                  {error && step === 2 && step2ErrorField === 'partner1' ? (
                    <FormMessage role="alert">{error}</FormMessage>
                  ) : null}
                </FormGroup>
                <FormGroup state={!!error && step === 2 && step2ErrorField === 'partner2' ? 'error' : 'default'}>
                  <Label htmlFor="partner2">Partner 2</Label>
                  <Input
                    ref={partner2InputRef}
                    id="partner2"
                    type="text"
                    value={partner2Name}
                    onChange={(e) => setPartner2Name(e.target.value)}
                    required
                  />
                  {error && step === 2 && step2ErrorField === 'partner2' ? (
                    <FormMessage role="alert">{error}</FormMessage>
                  ) : null}
                </FormGroup>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormGroup state={!!error && step === 2 && step2ErrorField === 'weddingDate' ? 'error' : 'default'}>
                  <Label htmlFor="weddingDate">Wedding Date</Label>
                  <Input
                    ref={weddingDateInputRef}
                    id="weddingDate"
                    type="date"
                    value={weddingDate}
                    onChange={(e) => setWeddingDate(e.target.value)}
                    required
                  />
                  {error && step === 2 && step2ErrorField === 'weddingDate' ? (
                    <FormMessage role="alert">{error}</FormMessage>
                  ) : null}
                </FormGroup>
                <FormGroup state={!!error && step === 2 && step2ErrorField === 'timezone' ? 'error' : 'default'}>
                  <Label htmlFor="timezone">Venue Timezone</Label>
                  <SearchableTimezoneSelect
                    ref={timezoneInputRef}
                    id="timezone"
                    name="timezone"
                    value={timezone}
                    onChange={(val) => setTimezone(val)}
                    placeholder="Search and select timezone (e.g. America/Chicago)..."
                    required
                    commitRawOnBlur
                  />
                  {error && step === 2 && step2ErrorField === 'timezone' ? (
                    <FormMessage role="alert">{error}</FormMessage>
                  ) : !initialSavedConfig?.timezone && timezone === browserDetectedTimezone ? (
                    <FormMessage id="timezone-detected-hint">
                      Detected from your browser ({browserDetectedTimezone})
                    </FormMessage>
                  ) : null}
                </FormGroup>
              </div>
              <FormGroup state={isDefaultUrl(baseUrl) || (!!error && step === 2 && step2ErrorField === 'siteUrl') ? 'error' : 'default'}>
                <Label htmlFor="siteUrl">Site URL (e.g. https://ourwedding.com)</Label>
                <Input 
                  ref={siteUrlInputRef}
                  id="siteUrl" 
                  type="url" 
                  value={baseUrl} 
                  onChange={(e) => setBaseUrl(e.target.value)} 
                  required 
                />
                {isDefaultUrl(baseUrl) ? (
                  <FormMessage role="alert">Please use your own URL.</FormMessage>
                ) : (error && step === 2 && step2ErrorField === 'siteUrl') ? (
                  <FormMessage role="alert">{error}</FormMessage>
                ) : null}
              </FormGroup>
              <FormGroup state={!!error && step === 2 && step2ErrorField === 'contactEmail' ? 'error' : 'default'}>
                <Label htmlFor="contactEmail">Host Contact Email (Optional)</Label>
                <Input
                  ref={contactEmailInputRef}
                  id="contactEmail"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="e.g. hosts@ourwedding.com"
                />
                {error && step === 2 && step2ErrorField === 'contactEmail' ? (
                  <FormMessage role="alert">{error}</FormMessage>
                ) : null}
              </FormGroup>
              <div className="space-y-4 pt-2 border-t border-gray-200 dark:border-zinc-700">
                <AddressLookupInput
                  id="setupVenueLookup"
                  label="Lookup Address"
                  placeholder="Search venue name or street address..."
                  helperText="Select a result to fill your venue address and coordinates automatically."
                  verifiedCoordinates={{ latitude, longitude }}
                  onSelect={(match) => {
                    updateDraft({
                      venueName:
                        !isNonPlaceholderVenueText(venueName) && match.name
                          ? match.name
                          : venueName || match.name,
                      venueAddress: match.streetAddress || match.displayName || venueAddress,
                      venueCity: match.city || venueCity,
                      venueState: match.state || venueState,
                      venueZip: match.zip || venueZip,
                      latitude: match.latitude,
                      longitude: match.longitude,
                    });
                  }}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormGroup>
                    <Label htmlFor="venueName">Venue Name</Label>
                    <Input id="venueName" type="text" value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder="Optional" />
                  </FormGroup>
                  <FormGroup>
                    <Label htmlFor="venueAddress">Street Address</Label>
                    <Input id="venueAddress" type="text" value={venueAddress} onChange={(e) => setVenueAddress(e.target.value)} placeholder="Optional" />
                  </FormGroup>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <FormGroup className="col-span-3 md:col-span-1">
                    <Label htmlFor="venueCity">City</Label>
                    <Input id="venueCity" type="text" value={venueCity} onChange={(e) => setVenueCity(e.target.value)} placeholder="Optional" />
                  </FormGroup>
                  <FormGroup className="col-span-3 md:col-span-1">
                    <Label htmlFor="venueState">State</Label>
                    <Input id="venueState" type="text" value={venueState} onChange={(e) => setVenueState(e.target.value)} placeholder="Optional" />
                  </FormGroup>
                  <FormGroup className="col-span-3 md:col-span-1">
                    <Label htmlFor="venueZip">Postal / Zip Code</Label>
                    <Input id="venueZip" type="text" value={venueZip} onChange={(e) => setVenueZip(e.target.value)} placeholder="Optional" />
                  </FormGroup>
                </div>
              </div>

              <div className="pt-4 border-t border-gray-200 dark:border-zinc-700">
                <ThemeConfigurationPanel
                  mode="essentials"
                  values={{
                    themePreset,
                    colorPrimary,
                    colorSecondary,
                  }}
                  errors={
                    error && step === 2 && step2ErrorField === 'colorPrimary'
                      ? { colorPrimary: error }
                      : error && step === 2 && step2ErrorField === 'colorSecondary'
                        ? { colorSecondary: error }
                        : undefined
                  }
                  onChange={handleThemeChange}
                />
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                {isDemoMode && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={loading}
                    onClick={() => {
                      demo?.setSetupAuthenticated(false);
                      setStep(1);
                    }}
                    className="py-3 px-6"
                  >
                    Back
                  </Button>
                )}
                <Button type="submit" disabled={loading} variant="primary" className="flex-1 py-3">
                  {loading ? 'Saving...' : 'Next Step'}
                </Button>
              </div>
            </form>
          </Card>

          <aside
            aria-label="Live guest homepage preview"
            data-testid="step2-live-preview"
            className="w-full lg:col-span-5 lg:sticky lg:top-8 rounded-2xl border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-200 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-900">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" aria-hidden="true" />
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-800 dark:text-zinc-200">
                  Live Guest Preview
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div
                  role="group"
                  aria-label="Preview color mode"
                  className="inline-flex items-center rounded-lg bg-gray-200/80 dark:bg-zinc-800 p-0.5 border border-gray-300 dark:border-zinc-700"
                >
                  <button
                    ref={step2LightModeBtnRef}
                    type="button"
                    aria-pressed={previewMode === 'light'}
                    onClick={() => setThemeMode('light')}
                    onKeyDown={(e) => handleStep2ColorModeKeyDown(e, 'light')}
                    className={`inline-flex min-h-[30px] items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      previewMode === 'light'
                        ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-xs'
                        : 'text-gray-700 dark:text-zinc-300 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon name="Sun" size={13} />
                    <span>Light</span>
                  </button>
                  <button
                    ref={step2DarkModeBtnRef}
                    type="button"
                    aria-pressed={previewMode === 'dark'}
                    onClick={() => setThemeMode('dark')}
                    onKeyDown={(e) => handleStep2ColorModeKeyDown(e, 'dark')}
                    className={`inline-flex min-h-[30px] items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      previewMode === 'dark'
                        ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-xs'
                        : 'text-gray-700 dark:text-zinc-300 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon name="Moon" size={13} />
                    <span>Dark</span>
                  </button>
                </div>

                <div
                  role="group"
                  aria-label="Step 2 preview viewport"
                  className="inline-flex items-center rounded-lg bg-gray-200/80 dark:bg-zinc-800 p-0.5 border border-gray-300 dark:border-zinc-700"
                >
                  <button
                    ref={step2DesktopBtnRef}
                    type="button"
                    aria-pressed={step2Viewport === 'desktop'}
                    onClick={() => setStep2Viewport('desktop')}
                    onKeyDown={(e) => handleStep2ViewportKeyDown(e, 'desktop')}
                    className={`inline-flex min-h-[30px] items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      step2Viewport === 'desktop'
                        ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-xs'
                        : 'text-gray-700 dark:text-zinc-300 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon name="Monitor" size={13} />
                    <span>Desktop</span>
                  </button>
                  <button
                    ref={step2MobileBtnRef}
                    type="button"
                    aria-pressed={step2Viewport === 'mobile'}
                    onClick={() => setStep2Viewport('mobile')}
                    onKeyDown={(e) => handleStep2ViewportKeyDown(e, 'mobile')}
                    className={`inline-flex min-h-[30px] items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                      step2Viewport === 'mobile'
                        ? 'bg-white dark:bg-zinc-700 text-gray-900 dark:text-white shadow-xs'
                        : 'text-gray-700 dark:text-zinc-300 hover:text-gray-900 dark:hover:text-white'
                    }`}
                  >
                    <Icon name="Smartphone" size={13} />
                    <span>Mobile (375px)</span>
                  </button>
                </div>
              </div>
            </div>

            <div className="p-4 bg-gray-100 dark:bg-zinc-950 flex justify-center">
              <div
                data-testid="step2-preview-frame"
                data-viewport={step2Viewport}
                data-theme-mode={previewMode}
                style={{
                  width: step2Viewport === 'mobile' ? '375px' : '100%',
                  maxWidth: '100%',
                  backgroundColor: previewCanvasBg,
                  fontFamily: previewExportTokens.fontBody,
                  color: previewBodyTextColor,
                  borderColor: previewCardBorder,
                }}
                className={`transition-all overflow-hidden border ${
                  step2Viewport === 'mobile'
                    ? 'rounded-[1.5rem] shadow-xl'
                    : 'w-full rounded-xl shadow-md'
                }`}
              >
                <div className="px-5 py-7 text-center space-y-4">
                  <div
                    className="inline-block h-1 w-12 rounded-full"
                    style={{ backgroundColor: safePreviewSecondary }}
                    aria-hidden="true"
                  />
                  <p
                    data-testid="step2-preview-headline"
                    className={`${step2Viewport === 'mobile' ? 'text-2xl' : 'text-3xl'} font-bold tracking-tight leading-tight`}
                    style={{
                      fontFamily: previewExportTokens.fontHeading,
                      color: previewHeadingOnCanvas,
                    }}
                  >
                    {previewStarterCopy.heroTitle}
                  </p>
                  <p
                    data-testid="step2-preview-subtitle"
                    className="text-sm leading-relaxed"
                    style={{ color: previewMutedOnCanvas }}
                  >
                    {previewStarterCopy.heroSubtitle}
                  </p>

                  {(previewStarterCopy.formattedDate || previewVenue.shortLocation) && (
                    <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-medium">
                      {previewStarterCopy.formattedDate && (
                        <span
                          className="px-3 py-1 border"
                          style={{
                            backgroundColor: previewCardBg,
                            color: previewBodyTextColor,
                            borderColor: previewCardBorder,
                            borderRadius: previewBtnRadius,
                          }}
                        >
                          {previewStarterCopy.formattedDate}
                        </span>
                      )}
                      {previewVenue.shortLocation && (
                        <span
                          data-testid="step2-preview-venue"
                          className="px-3 py-1 border"
                          style={{
                            backgroundColor: previewCardBg,
                            color: previewBodyTextColor,
                            borderColor: previewCardBorder,
                            borderRadius: previewBtnRadius,
                          }}
                        >
                          {previewVenue.venueName && previewVenue.cityState
                            ? `${previewVenue.venueName} · ${previewVenue.cityState}`
                            : previewVenue.shortLocation}
                        </span>
                      )}
                    </div>
                  )}

                  {showPreviewCountdown && previewParsedDate && (
                    <div
                      data-testid="step2-preview-countdown"
                      className="text-sm font-semibold py-1.5 px-3 inline-block border"
                      style={{
                        backgroundColor: previewCardBg,
                        color: previewBodyTextColor,
                        borderColor: previewCardBorder,
                        borderRadius: previewCardRadius,
                      }}
                    >
                      <Countdown targetDate={previewParsedDate.toISOString()} />
                    </div>
                  )}

                  <div className="pt-1">
                    <span
                      className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold shadow-sm"
                      style={{
                        backgroundColor: safePreviewPrimary,
                        color: previewCtaTextColor,
                        borderRadius: previewBtnRadius,
                      }}
                    >
                      Our Story
                    </span>
                  </div>

                  {previewStarterCopy.storyText && (
                    <div
                      data-testid="step2-preview-story-card"
                      className="mt-4 p-4 text-left border space-y-1.5"
                      style={{
                        backgroundColor: previewCardBg,
                        borderColor: previewCardBorder,
                        borderRadius: previewCardRadius,
                      }}
                    >
                      <p
                        className="text-sm font-bold"
                        style={{
                          fontFamily: previewExportTokens.fontHeading,
                          color: previewHeadingOnCard,
                        }}
                      >
                        Our Story
                      </p>
                      <p className="text-xs leading-relaxed" style={{ color: previewMutedOnCard }}>
                        {previewStarterCopy.storyText}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>
        </div>
      </AccessibleStep>

      <AccessibleStep isActive={step === 3}>
        <Container>
          <Card className="max-w-3xl">
            <Heading as="h2" className="mb-2">Step 3: Sample Data Selection</Heading>
            <p className="mb-6 text-gray-700 dark:text-gray-300">
              Choose which site modules to enable and optionally populate your wedding site with sample records so you can explore features right away. You can adjust modules or clear sample data anytime from the admin dashboard.
            </p>

            <form onSubmit={handleSampleDataSubmit} className="space-y-6">
              {error && step === 3 && (
                <FormGroup state="error">
                  <FormMessage role="alert">{error}</FormMessage>
                </FormGroup>
              )}

              <section aria-labelledby="setup-site-features-heading" className="space-y-3">
                <div>
                  <h3
                    id="setup-site-features-heading"
                    className="text-sm font-semibold text-gray-900 dark:text-gray-100"
                  >
                    Site Features &amp; Modules
                  </h3>
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-0.5">
                    Toggle guest-facing sections, countdown timer, and calendar links. Disabling Gift Registry automatically turns off Group Gifting.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
                  {Object.values(FEATURE_METADATA).map((feature) => {
                    const isDependencyDisabled = Boolean(
                      feature.dependencies?.some((dep) => !enabledFeatures[dep])
                    );
                    const isChecked = isDependencyDisabled
                      ? false
                      : Boolean(enabledFeatures[feature.id]);

                    return (
                      <FormGroup
                        key={feature.id}
                        className={`rounded-lg border p-3 transition-colors ${
                          isDependencyDisabled
                            ? 'bg-gray-100/80 dark:bg-gray-900/40 border-gray-200 dark:border-gray-800 opacity-75'
                            : 'bg-white dark:bg-gray-900/70 border-gray-200 dark:border-gray-700'
                        }`}
                      >
                        <label
                          className={`flex items-start gap-3 ${
                            isDependencyDisabled ? 'cursor-not-allowed' : 'cursor-pointer'
                          }`}
                        >
                          <Checkbox
                            id={`setup-feature-${feature.id}`}
                            data-testid={`setup-feature-toggle-${feature.id}`}
                            checked={isChecked}
                            disabled={isDependencyDisabled}
                            onChange={(e) => handleFeatureToggle(feature.id, e.target.checked)}
                            className="mt-0.5"
                          />
                          <span className="flex-1 text-left">
                            <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                              <span>{feature.title}</span>
                              {feature.dependencies && feature.dependencies.length > 0 && (
                                <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/60 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:text-amber-100">
                                  Requires Gift Registry
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block text-xs text-gray-600 dark:text-gray-300">
                              {feature.description}
                            </span>
                          </span>
                        </label>
                      </FormGroup>
                    );
                  })}
                </div>
              </section>

              <div>
                <span
                  id="starter-archetype-preset-label"
                  className="block text-sm font-semibold mb-2 text-[var(--form-label-text,var(--color-primary-text,#111827))]"
                >
                  Starter Archetype Preset
                </span>
                <ToggleButtonGroup
                  mode="radiogroup"
                  aria-labelledby="starter-archetype-preset-label"
                  value={sampleArchetype}
                  onChange={(key) => {
                    setSampleArchetype(key);
                    setSelectedModules(
                      enabledFeatures.registry
                        ? ['registry', 'guests', 'seating', 'weddingParty', 'attractions', 'faqs']
                        : ['guests', 'seating', 'weddingParty', 'attractions', 'faqs']
                    );
                  }}
                  className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-transparent dark:bg-transparent p-0 border-0 rounded-none"
                  options={(Object.keys(ARCHETYPE_PRESETS) as ArchetypeId[]).map((key) => {
                    const preset = ARCHETYPE_PRESETS[key];
                    return {
                      value: key,
                      label: preset.name,
                      description: <span className="line-clamp-2">{preset.description}</span>,
                    };
                  })}
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-3">
                  <FormGroup>
                    <Label className="font-semibold">Sample Data Modules</Label>
                  </FormGroup>
                  <div className="space-x-2 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedModules(
                          enabledFeatures.registry
                            ? ['registry', 'guests', 'seating', 'weddingParty', 'attractions', 'faqs']
                            : ['guests', 'seating', 'weddingParty', 'attractions', 'faqs']
                        )
                      }
                      className="text-primary underline hover:opacity-80"
                    >
                      Select All
                    </button>
                    <span>|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedModules([])}
                      className="text-gray-600 dark:text-gray-300 underline hover:text-gray-800 dark:hover:text-gray-100"
                    >
                      Deselect All (Start Blank)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-gray-50 dark:bg-gray-800/50 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
                  {enabledFeatures.registry && (
                    <FormGroup className="flex items-center space-x-3 cursor-pointer">
                      <label className="flex items-center space-x-3 cursor-pointer">
                        <Checkbox
                          checked={selectedModules.includes('registry')}
                          onChange={() => toggleModule('registry')}
                        />
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Registry Items &amp; Cash Funds</span>
                      </label>
                    </FormGroup>
                  )}

                  <FormGroup className="flex items-center space-x-3 cursor-pointer">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <Checkbox
                        checked={selectedModules.includes('guests')}
                        onChange={() => toggleModule('guests')}
                      />
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Guest List &amp; Invitation Codes</span>
                    </label>
                  </FormGroup>

                  <FormGroup className="flex items-center space-x-3 cursor-pointer">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <Checkbox
                        checked={selectedModules.includes('seating')}
                        onChange={() => toggleModule('seating')}
                      />
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Seating Layout &amp; Tables</span>
                    </label>
                  </FormGroup>

                  <FormGroup className="flex items-center space-x-3 cursor-pointer">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <Checkbox
                        checked={selectedModules.includes('weddingParty')}
                        onChange={() => toggleModule('weddingParty')}
                      />
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Wedding Party Members</span>
                    </label>
                  </FormGroup>

                  <FormGroup className="flex items-center space-x-3 cursor-pointer">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <Checkbox
                        checked={selectedModules.includes('attractions')}
                        onChange={() => toggleModule('attractions')}
                      />
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Local Attractions &amp; Hotel Blocks</span>
                    </label>
                  </FormGroup>

                  <FormGroup className="flex items-center space-x-3 cursor-pointer">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <Checkbox
                        checked={selectedModules.includes('faqs')}
                        onChange={() => toggleModule('faqs')}
                      />
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Wedding Q&amp;A &amp; Starter FAQs</span>
                    </label>
                  </FormGroup>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loading}
                  onClick={() => setStep(2)}
                  className="py-3 px-6"
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  disabled={loading}
                  variant="primary"
                  className="flex-1 py-3"
                >
                  {loading ? 'Populating Sample Data...' : 'Populate Sample Data & Continue'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={loading}
                  onClick={() => {
                    void handleSkipSampleData();
                  }}
                  className="py-3 px-6"
                >
                  Skip
                </Button>
              </div>
              <div className="pt-2 text-center">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => {
                    void handleCompleteAndExit();
                  }}
                  className="text-sm font-medium text-gray-600 dark:text-gray-300 underline hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-2 py-1"
                >
                  Skip to Admin Dashboard
                </button>
              </div>
            </form>
          </Card>
        </Container>
      </AccessibleStep>

      <AccessibleStep isActive={step === 4}>
        <Container>
          <Card className="max-w-2xl text-center">
            <Heading as="h2" className="mb-2">Step 4: Guest List Import</Heading>
            <p className="mb-6 text-gray-700 dark:text-gray-300">
              Import your guest list spreadsheet to issue invitation codes and manage RSVPs immediately, or skip to complete setup.
            </p>

            {activeNonSampleGuestCount > 0 ? (
              <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl text-emerald-800 dark:text-emerald-200 font-medium">
                ✓ {activeNonSampleGuestCount} guest record(s) imported.
              </div>
            ) : (
              <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl text-gray-600 dark:text-gray-300 text-sm">
                No guests imported yet. You can import a CSV file now or add guests later from the admin dashboard.
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                type="button"
                variant="secondary"
                disabled={loading}
                onClick={() => setStep(3)}
                className="py-3 px-6"
              >
                Back
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={loading}
                onClick={() => {
                  setHasOpenedCsvModal(true);
                  openModal('csv');
                }}
                className="flex-1 py-3"
              >
                Import Guest List CSV
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={loading}
                onClick={() => setStep(5)}
                className="py-3 px-6"
              >
                Skip for Now
              </Button>
            </div>
            <div className="mt-4 text-center">
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  void handleCompleteAndExit();
                }}
                className="text-sm font-medium text-gray-600 dark:text-gray-300 underline hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-2 py-1"
              >
                Skip to Admin Dashboard
              </button>
            </div>
          </Card>
        </Container>
      </AccessibleStep>

      <AccessibleStep isActive={step === 5}>
        <Container>
          <Card className="max-w-3xl text-center">
            <Heading as="h2" className="mb-4">Step 5: Complete Setup</Heading>
            <p className="mb-6 text-gray-700 dark:text-gray-200">Great! Your wedding website setup is complete. You can now manage custom details or view your guest site.</p>
            <div className="space-y-4">
              <Button onClick={() => openModal('weddingParty')} variant="secondary" className="w-full py-3">
                Manage Wedding Party ({nonSamplePartyMembers.length} {nonSamplePartyMembers.length === 1 ? 'member' : 'members'})
              </Button>
              <Button onClick={() => openModal('attractions')} variant="secondary" className="w-full py-3">
                Manage Attractions ({nonSampleAttractions.length} {nonSampleAttractions.length === 1 ? 'item' : 'items'})
              </Button>
            </div>
            {activeNonSampleGuestCount > 0 && (
              <p className="mt-4 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                Guest List: {activeNonSampleGuestCount} invitation code(s) active
              </p>
            )}
            <OnboardingChecklist
              refreshTrigger={step === 5 ? 1 : 0}
              headingLevel="h3"
              className="mt-6 mb-2 shadow-none"
              onNavigate={(href) => {
                void handleCompleteAndExit(href);
              }}
            />
            <p className="mt-6 mb-4 text-sm text-gray-600 dark:text-gray-300">You can also manage content and clear sample data anytime from the Admin Dashboard.</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                type="button"
                variant="secondary"
                disabled={loading}
                onClick={() => setStep(4)}
                className="py-3 px-6"
              >
                Back
              </Button>
              <Button
                disabled={loading}
                onClick={() => {
                  void handleCompleteAndExit();
                }}
                variant="primary"
                className="flex-1 py-3"
              >
                Go to Admin Dashboard
              </Button>
            </div>
            <div className="mt-4 text-center">
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  void handleCompleteAndExit();
                }}
                className="text-sm font-medium text-gray-600 dark:text-gray-300 underline hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-2 py-1"
              >
                Skip to Admin Dashboard
              </button>
            </div>
          </Card>
        </Container>
      </AccessibleStep>

      {isAuthenticated && (
        <>
          <WeddingPartyManagerModal
            isOpen={activeModal === 'weddingParty'}
            onClose={closeModal}
            partner1Name={partner1Name}
            partner2Name={partner2Name}
          />

          <AttractionsManagerModal
            isOpen={activeModal === 'attractions'}
            onClose={closeModal}
          />

          {(hasOpenedCsvModal || activeModal === 'csv') && (
            <CsvImportWizardModal
              isOpen={activeModal === 'csv'}
              onClose={closeModal}
              onImportComplete={handleGuestImportComplete}
              existingCodes={invitationCodes
                .map((c) => c.code)
                .filter((code): code is string => Boolean(code && code.trim()))}
            />
          )}
        </>
      )}
    </MainLandmark>
  );
}

export default function SetupWizard({
  initialSavedConfig,
  onDemoComplete,
}: SetupWizardProps = {}) {
  ensureStaticDemoRuntime();
  const resolvedSavedConfig =
    initialSavedConfig ?? getStaticDemoSavedSetupConfig();
  const outerQueryClient = useContext(QueryClientContext);
  const outerToast = useContext(ToastContext);
  const [fallbackQueryClient] = useState(() => new QueryClient());
  const activeQueryClient = outerQueryClient ?? fallbackQueryClient;
  const outerTheme = useTheme();

  const hasAppShell = Boolean(outerQueryClient && outerToast);
  const content = (
    <SetupWizardContent
      initialSavedConfig={resolvedSavedConfig}
      onDemoComplete={onDemoComplete}
      hasAppShell={hasAppShell}
    />
  );
  const withToast = outerToast ? content : <ToastProvider>{content}</ToastProvider>;
  const wizardTree = outerQueryClient ? (
    withToast
  ) : (
    <QueryClientProvider client={activeQueryClient}>{withToast}</QueryClientProvider>
  );

  if (outerTheme.hasThemeProvider) {
    return wizardTree;
  }

  return <ThemeProvider>{wizardTree}</ThemeProvider>;
}
