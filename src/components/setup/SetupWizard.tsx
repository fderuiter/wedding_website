'use client';
import React, { useState, useRef, useEffect, useContext } from 'react';
import {
  QueryClient,
  QueryClientContext,
  QueryClientProvider,
  useQueryClient,
} from '@tanstack/react-query';

import { FormGroup, Label, Input, FormMessage, Checkbox } from '@/components/ui/forms';
import { AccessibleStep } from '@/components/ui/AccessibleStep';
import { Container, Card, Heading } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { ToastContext, ToastProvider } from '@/components/ui/ToastProvider';
import { useAdminWeddingParty } from '@/hooks/admin/useAdminWeddingParty';
import { useAdminAttractions } from '@/hooks/admin/useAdminAttractions';
import { useAdminInvitationCodes } from '@/hooks/admin/useAdminInvitationCodes';
import {
  SETUP_WIZARD_STORAGE_KEY,
  useSetupWizardMachine,
  type SetupWizardPersistedState,
} from '@/hooks/useSetupWizardMachine';
import { invalidateSampleDataCaches } from '@/lib/adminCacheSync';
import { WeddingPartyManagerModal } from './WeddingPartyManagerModal';
import { AttractionsManagerModal } from './AttractionsManagerModal';
import { CsvImportWizardModal } from '@/components/admin/CsvImportWizardModal';
import { ThemeConfigurationPanel } from '@/components/admin/ThemeConfigurationPanel';
import { ThemeProvider, useTheme } from '@/components/ThemeProvider';
import { ThemePreset } from '@/lib/theme/presets';
import { ARCHETYPE_PRESETS, ArchetypeId } from '@/lib/sampleData/archetypes';

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

type Step2ErrorField = 'partner1' | 'partner2' | 'siteUrl' | 'contactEmail';

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

function resolveStep2BackendErrorField(message: string): Step2ErrorField {
  const lower = message.toLowerCase();
  if (lower.includes('contactemail') || lower.includes('contact email')) {
    return 'contactEmail';
  }
  if (lower.includes('partner2name')) {
    return 'partner2';
  }
  if (lower.includes('partner1name') || lower.includes('partner name')) {
    return 'partner1';
  }
  return 'siteUrl';
}

export interface SetupWizardSavedConfig extends Partial<SetupWizardPersistedState> {
  themePreset?: ThemePreset;
  colorPrimary?: string;
  colorSecondary?: string;
}

interface SetupWizardProps {
  initialSavedConfig?: SetupWizardSavedConfig;
}

function SetupWizardContent({ initialSavedConfig }: SetupWizardProps) {
  const queryClient = useQueryClient();
  const normalizedInitialSavedConfig = initialSavedConfig
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
    : undefined;
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
    venueCity,
    venueState,
    timezone,
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
  const setVenueCity = (val: string) => updateDraft({ venueCity: val });
  const setVenueState = (val: string) => updateDraft({ venueState: val });
  const setTimezone = (val: string) => updateDraft({ timezone: val });
  const setSampleArchetype = (archetype: ArchetypeId) => updateDraft({ sampleArchetype: archetype });
  const setSelectedModules = (modules: string[]) => updateDraft({ selectedModules: modules });

  // Login
  const [password, setPassword] = useState('');
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Content Counts
  const { data: partyMembers = [] } = useAdminWeddingParty({ enabled: isAuthenticated });
  const { data: attractions = [] } = useAdminAttractions({ enabled: isAuthenticated });
  const { data: invitationCodes = [], fetchAll: refetchInvitationCodes } = useAdminInvitationCodes({ enabled: isAuthenticated });
  const nonSampleInvitationCodes = invitationCodes.filter((code) => !code.isSample);
  const activeNonSampleGuestCount =
    nonSampleInvitationCodes.length > 0 ? nonSampleInvitationCodes.length : importedGuestCount;

  const handleGuestImportComplete = async () => {
    const result = await refetchInvitationCodes();
    const rawItems =
      result && typeof result === 'object' && 'data' in result
        ? (result as { data?: typeof invitationCodes }).data
        : result;
    const codes = Array.isArray(rawItems) ? rawItems : invitationCodes;
    const nonSampleCount = codes.filter((code) => !code.isSample).length;
    updateDraft({ importedGuestCount: nonSampleCount });
  };

  // Theme state
  const { setPreviewConfig } = useTheme();
  const [themePreset, setThemePreset] = useState<ThemePreset>(
    initialSavedConfig?.themePreset ?? 'classic'
  );
  const [colorPrimary, setColorPrimary] = useState(
    initialSavedConfig?.colorPrimary ?? '#4A5568'
  );
  const [colorSecondary, setColorSecondary] = useState(
    initialSavedConfig?.colorSecondary ?? '#2D3748'
  );
  const [step2ErrorField, setStep2ErrorField] = useState<Step2ErrorField>('siteUrl');
  const partner1InputRef = useRef<HTMLInputElement>(null);
  const partner2InputRef = useRef<HTMLInputElement>(null);
  const siteUrlInputRef = useRef<HTMLInputElement>(null);
  const contactEmailInputRef = useRef<HTMLInputElement>(null);

  const focusStep2Field = (field: Step2ErrorField) => {
    switch (field) {
      case 'partner1':
        partner1InputRef.current?.focus();
        break;
      case 'partner2':
        partner2InputRef.current?.focus();
        break;
      case 'contactEmail':
        contactEmailInputRef.current?.focus();
        break;
      case 'siteUrl':
      default:
        siteUrlInputRef.current?.focus();
        break;
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      syncAdminLoginState();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (step >= 2 && typeof setPreviewConfig === 'function') {
      setPreviewConfig({
        themePreset,
        colorPrimary,
        colorSecondary,
      });
    }
  }, [step, themePreset, colorPrimary, colorSecondary, setPreviewConfig]);

  const handleThemeChange = (fields: Record<string, any>) => {
    if (fields.themePreset !== undefined) setThemePreset(fields.themePreset);
    if (fields.colorPrimary !== undefined) setColorPrimary(fields.colorPrimary);
    if (fields.colorSecondary !== undefined) setColorSecondary(fields.colorSecondary);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    startSubmit();
    try {
      const res = await fetch('/api/admin/setup', {
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
    } catch (err: any) {
      setError(err.message || 'Failed to log in.');
      passwordInputRef.current?.focus();
      passwordInputRef.current?.select();
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
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

    updateDraft({
      partner1Name: trimmedPartner1,
      partner2Name: trimmedPartner2,
      baseUrl: trimmedBaseUrl,
      contactEmail: trimmedContactEmail,
    });

    startSubmit();
    try {
      const res = await fetch('/api/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner1Name: trimmedPartner1,
          partner2Name: trimmedPartner2,
          weddingDate,
          baseUrl: trimmedBaseUrl,
          contactEmail: trimmedContactEmail,
          venueName: venueName?.trim() || '',
          venueAddress: '',
          venueCity: venueCity?.trim() || '',
          venueState: venueState?.trim() || '',
          venueZip: '',
          timezone: timezone || 'America/Chicago',
          latitude: 0,
          longitude: 0,
          storyText: '',
          venueDescription: '',
          travelAdvice: '',
          heroTitle: `${trimmedPartner1} & ${trimmedPartner2}`,
          heroSubtitle: '',
          seoTitle: `${trimmedPartner1} & ${trimmedPartner2}'s Wedding`,
          seoDescription: `Join ${trimmedPartner1} and ${trimmedPartner2} for their wedding celebration.`,
          themePreset,
          colorPrimary,
          colorSecondary,
          setupCompleted: false,
        }),
      });
      if (res.ok) {
        syncAdminLoginState();
        setStep(3);
        if (typeof window !== 'undefined' && window.location.pathname !== '/admin/setup') {
          try {
            window.history.replaceState(window.history.state, '', '/admin/setup');
          } catch {
            // Ignore history replacement errors in restricted environments
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
    } catch (err: any) {
      setStep2ErrorField('siteUrl');
      setError(err.message || 'Failed to save config.');
      siteUrlInputRef.current?.focus();
    }
  };

  const handleSampleDataSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    startSubmit();
    try {
      if (selectedModules.length > 0) {
        const res = await fetch('/api/admin/sample-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            archetype: sampleArchetype,
            modules: selectedModules,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to generate sample data.');
        }
      } else {
        await fetch('/api/admin/sample-data', { method: 'DELETE' });
      }
      await invalidateSampleDataCaches(queryClient);
      setStep(4);
    } catch (err: any) {
      setError(err.message || 'Error configuring sample data.');
    }
  };

  const handleCompleteAndExit = async () => {
    syncAdminLoginState();
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem(SETUP_WIZARD_STORAGE_KEY);
      } catch {
        // Ignore storage errors in restricted browser environments
      }
    }
    startSubmit();
    try {
      await fetch('/api/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupCompleted: true }),
      });
    } catch {
      // Allow navigation to proceed even if network completion call fails
    }
    clearPersistedState();
    window.location.href = '/admin/dashboard';
  };

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen py-12 flex flex-col justify-center items-center">
      <h1 className="sr-only">Wedding Website Setup Wizard</h1>
      <AccessibleStep isActive={step === 1}>
        <Container>
          <Card className="max-w-md">
            <Heading as="h2" className="mb-4">Welcome to Your Wedding Site!</Heading>
            <p className="mb-4 text-gray-700 dark:text-gray-200">Please enter the admin password configured in your environment to begin setup.</p>
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

      <AccessibleStep isActive={step === 2}>
        <Container>
          <Card className="max-w-xl">
            <Heading as="h2" className="mb-4">Step 2: The Essentials</Heading>
            <p className="mb-4 text-gray-700 dark:text-gray-200">Let&apos;s start with your names and when the big day is.</p>
            <form onSubmit={handleSaveConfig} className="space-y-4">
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
                    <FormMessage>{error}</FormMessage>
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
                    <FormMessage>{error}</FormMessage>
                  ) : null}
                </FormGroup>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormGroup>
                  <Label htmlFor="weddingDate">Wedding Date</Label>
                  <Input id="weddingDate" type="date" value={weddingDate} onChange={(e) => setWeddingDate(e.target.value)} required />
                </FormGroup>
                <FormGroup>
                  <Label htmlFor="timezone">Timezone</Label>
                  <Input id="timezone" type="text" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="e.g. America/Chicago" required />
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
                  <FormMessage>Please use your own URL.</FormMessage>
                ) : (error && step === 2 && step2ErrorField === 'siteUrl') ? (
                  <FormMessage>{error}</FormMessage>
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
                  <FormMessage>{error}</FormMessage>
                ) : null}
              </FormGroup>
              <div className="grid grid-cols-3 gap-4">
                <FormGroup className="col-span-3 md:col-span-1">
                  <Label htmlFor="venueName">Venue Name</Label>
                  <Input id="venueName" type="text" value={venueName} onChange={(e) => setVenueName(e.target.value)} placeholder="Optional" />
                </FormGroup>
                <FormGroup className="col-span-3 md:col-span-1">
                  <Label htmlFor="venueCity">City</Label>
                  <Input id="venueCity" type="text" value={venueCity} onChange={(e) => setVenueCity(e.target.value)} placeholder="Optional" />
                </FormGroup>
                <FormGroup className="col-span-3 md:col-span-1">
                  <Label htmlFor="venueState">State</Label>
                  <Input id="venueState" type="text" value={venueState} onChange={(e) => setVenueState(e.target.value)} placeholder="Optional" />
                </FormGroup>
              </div>

              <div className="pt-4 border-t border-gray-200 dark:border-zinc-700">
                <ThemeConfigurationPanel
                  mode="essentials"
                  values={{
                    themePreset,
                    colorPrimary,
                    colorSecondary,
                  }}
                  onChange={handleThemeChange}
                />
              </div>

              <Button type="submit" disabled={loading} variant="primary" className="w-full py-3">
                {loading ? 'Saving...' : 'Next Step'}
              </Button>
            </form>
          </Card>
        </Container>
      </AccessibleStep>

      <AccessibleStep isActive={step === 3}>
        <Container>
          <Card className="max-w-2xl">
            <Heading as="h2" className="mb-2">Step 3: Sample Data Selection</Heading>
            <p className="mb-6 text-gray-700 dark:text-gray-300">
              Populate your wedding site with sample records so you can explore features right away. You can clear or keep sample data anytime from the admin dashboard.
            </p>

            <form onSubmit={handleSampleDataSubmit} className="space-y-6">
              {error && step === 3 && (
                <FormGroup state="error">
                  <FormMessage>{error}</FormMessage>
                </FormGroup>
              )}

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
                    setSelectedModules(['registry', 'guests', 'seating', 'weddingParty', 'attractions', 'faqs']);
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
                      onClick={() => setSelectedModules(['registry', 'guests', 'seating', 'weddingParty', 'attractions', 'faqs'])}
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
                  <FormGroup className="flex items-center space-x-3 cursor-pointer">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <Checkbox
                        checked={selectedModules.includes('registry')}
                        onChange={() => toggleModule('registry')}
                      />
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Registry Items & Cash Funds</span>
                    </label>
                  </FormGroup>

                  <FormGroup className="flex items-center space-x-3 cursor-pointer">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <Checkbox
                        checked={selectedModules.includes('guests')}
                        onChange={() => toggleModule('guests')}
                      />
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Guest List & Invitation Codes</span>
                    </label>
                  </FormGroup>

                  <FormGroup className="flex items-center space-x-3 cursor-pointer">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <Checkbox
                        checked={selectedModules.includes('seating')}
                        onChange={() => toggleModule('seating')}
                      />
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Seating Layout & Tables</span>
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
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">Local Attractions & Hotel Blocks</span>
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
                    setSelectedModules([]);
                    setStep(4);
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
                onClick={() => openModal('csv')}
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
          <Card className="max-w-2xl text-center">
            <Heading as="h2" className="mb-4">Step 5: Complete Setup</Heading>
            <p className="mb-6 text-gray-700 dark:text-gray-200">Great! Your wedding website setup is complete. You can now manage custom details or view your guest site.</p>
            <div className="space-y-4">
              <Button onClick={() => openModal('weddingParty')} variant="secondary" className="w-full py-3">
                Manage Wedding Party ({partyMembers.length} {partyMembers.length === 1 ? 'member' : 'members'})
              </Button>
              <Button onClick={() => openModal('attractions')} variant="secondary" className="w-full py-3">
                Manage Attractions ({attractions.length} {attractions.length === 1 ? 'item' : 'items'})
              </Button>
            </div>
            {activeNonSampleGuestCount > 0 && (
              <p className="mt-4 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                Guest List: {activeNonSampleGuestCount} invitation code(s) active
              </p>
            )}
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
          />

          <AttractionsManagerModal
            isOpen={activeModal === 'attractions'}
            onClose={closeModal}
          />

          <CsvImportWizardModal
            isOpen={activeModal === 'csv'}
            onClose={closeModal}
            onImportComplete={handleGuestImportComplete}
            existingCodes={invitationCodes.map((c) => c.code)}
          />
        </>
      )}
    </main>
  );
}

export default function SetupWizard({ initialSavedConfig }: SetupWizardProps = {}) {
  const outerQueryClient = useContext(QueryClientContext);
  const outerToast = useContext(ToastContext);
  const [fallbackQueryClient] = useState(() => new QueryClient());
  const activeQueryClient = outerQueryClient ?? fallbackQueryClient;
  const outerTheme = useTheme();

  const content = <SetupWizardContent initialSavedConfig={initialSavedConfig} />;
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
