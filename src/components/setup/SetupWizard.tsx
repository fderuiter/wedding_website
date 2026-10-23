'use client';
import React, { useState, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { FormGroup, Label, Input, FormMessage, Checkbox } from '@/components/ui/forms';
import { AccessibleStep } from '@/components/ui/AccessibleStep';
import { Container, Card, Heading } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { useAdminWeddingParty } from '@/hooks/admin/useAdminWeddingParty';
import { useAdminAttractions } from '@/hooks/admin/useAdminAttractions';
import { useFormPersist } from '@/hooks/useFormPersist';
import { WeddingPartyManagerModal } from './WeddingPartyManagerModal';
import { AttractionsManagerModal } from './AttractionsManagerModal';
import { ThemeConfigurationPanel } from '@/components/admin/ThemeConfigurationPanel';
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

interface SetupWizardPersistedState {
  step: number;
  partner1Name: string;
  partner2Name: string;
  weddingDate: string;
  baseUrl: string;
  venueName: string;
  venueCity: string;
  venueState: string;
  timezone: string;
  sampleArchetype: ArchetypeId;
  selectedModules: string[];
}

const initialSetupWizardState: SetupWizardPersistedState = {
  step: 1,
  partner1Name: '',
  partner2Name: '',
  weddingDate: '',
  baseUrl: '',
  venueName: '',
  venueCity: '',
  venueState: '',
  timezone: 'America/Chicago',
  sampleArchetype: 'classic',
  selectedModules: ['registry', 'guests', 'seating', 'weddingParty', 'attractions'],
};

function SetupWizardContent() {
  const [wizardState, setWizardState, clearPersistedSetupState] = useFormPersist<SetupWizardPersistedState>(
    'setup_wizard_draft',
    initialSetupWizardState
  );

  const {
    step,
    partner1Name,
    partner2Name,
    weddingDate,
    baseUrl,
    venueName,
    venueCity,
    venueState,
    timezone,
    sampleArchetype,
    selectedModules,
  } = wizardState;

  const setStep = (newStep: number | ((prev: number) => number)) => {
    setWizardState((prev) => ({
      ...prev,
      step: typeof newStep === 'function' ? newStep(prev.step) : newStep,
    }));
  };

  const setPartner1Name = (val: string) => setWizardState((prev) => ({ ...prev, partner1Name: val }));
  const setPartner2Name = (val: string) => setWizardState((prev) => ({ ...prev, partner2Name: val }));
  const setWeddingDate = (val: string) => setWizardState((prev) => ({ ...prev, weddingDate: val }));
  const setBaseUrl = (val: string) => setWizardState((prev) => ({ ...prev, baseUrl: val }));
  const setVenueName = (val: string) => setWizardState((prev) => ({ ...prev, venueName: val }));
  const setVenueCity = (val: string) => setWizardState((prev) => ({ ...prev, venueCity: val }));
  const setVenueState = (val: string) => setWizardState((prev) => ({ ...prev, venueState: val }));
  const setTimezone = (val: string) => setWizardState((prev) => ({ ...prev, timezone: val }));
  const setSampleArchetype = (archetype: ArchetypeId) => setWizardState((prev) => ({ ...prev, sampleArchetype: archetype }));
  const setSelectedModules = (modules: string[]) => setWizardState((prev) => ({ ...prev, selectedModules: modules }));

  const toggleModule = (moduleKey: string) => {
    setWizardState((prev) => {
      const current = prev.selectedModules || [];
      const updated = current.includes(moduleKey)
        ? current.filter((m) => m !== moduleKey)
        : [...current, moduleKey];
      return { ...prev, selectedModules: updated };
    });
  };

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Login
  const [password, setPassword] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Content Management Modals
  const [isWeddingPartyModalOpen, setIsWeddingPartyModalOpen] = useState(false);
  const [isAttractionsModalOpen, setIsAttractionsModalOpen] = useState(false);

  // Content Counts
  const { data: partyMembers = [] } = useAdminWeddingParty({ enabled: isAuthenticated });
  const { data: attractions = [] } = useAdminAttractions({ enabled: isAuthenticated });
  // Theme state
  const [themePreset, setThemePreset] = useState<ThemePreset>('classic');
  const [colorPrimary, setColorPrimary] = useState('#4A5568');
  const [colorSecondary, setColorSecondary] = useState('#2D3748');
  const [layoutContainerMaxWidth, setLayoutContainerMaxWidth] = useState('64rem');
  const [layoutGridGap, setLayoutGridGap] = useState('1.5rem');
  const [layoutCardPadding, setLayoutCardPadding] = useState('2rem');
  const [layoutBorderRadius, setLayoutBorderRadius] = useState('1rem');
  const [themeTokens, setThemeTokens] = useState<Record<string, string>>({});
  const siteUrlInputRef = useRef<HTMLInputElement>(null);

  const handleThemeChange = (fields: Record<string, any>) => {
    if (fields.themePreset !== undefined) setThemePreset(fields.themePreset);
    if (fields.colorPrimary !== undefined) setColorPrimary(fields.colorPrimary);
    if (fields.colorSecondary !== undefined) setColorSecondary(fields.colorSecondary);
    if (fields.layoutContainerMaxWidth !== undefined) setLayoutContainerMaxWidth(fields.layoutContainerMaxWidth);
    if (fields.layoutGridGap !== undefined) setLayoutGridGap(fields.layoutGridGap);
    if (fields.layoutCardPadding !== undefined) setLayoutCardPadding(fields.layoutCardPadding);
    if (fields.layoutBorderRadius !== undefined) setLayoutBorderRadius(fields.layoutBorderRadius);
    if (fields.themeTokens !== undefined) {
      setThemeTokens((prev) => ({ ...prev, ...fields.themeTokens }));
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setIsAuthenticated(true);
        setStep(2);
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
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      new URL(baseUrl);
      if (isDefaultUrl(baseUrl)) {
        setError('Please use your own URL, not a sample or default domain.');
        siteUrlInputRef.current?.focus();
        return;
      }
    } catch (err) {
      // If it's not a valid URL, it will fail backend validation anyway.
      // But we can also set an error here.
      setError('Please enter a valid URL.');
      siteUrlInputRef.current?.focus();
      return;
    }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partner1Name,
          partner2Name,
          weddingDate,
          baseUrl,
          venueName: venueName || 'TBD',
          venueAddress: 'TBD',
          venueCity: venueCity || 'TBD',
          venueState: venueState || 'TBD',
          venueZip: 'TBD',
          timezone: timezone || 'America/Chicago',
          latitude: 0,
          longitude: 0,
          storyText: 'Our story...',
          venueDescription: 'Venue description...',
          travelAdvice: 'Travel advice...',
          heroTitle: 'We Tied the Knot!',
          heroSubtitle: 'Thank you for celebrating with us!',
          seoTitle: `${partner1Name} & ${partner2Name}'s Wedding`,
          seoDescription: `Join ${partner1Name} and ${partner2Name} for their wedding celebration.`,
          themePreset,
          colorPrimary,
          colorSecondary,
          layoutContainerMaxWidth,
          layoutGridGap,
          layoutCardPadding,
          layoutBorderRadius,
          themeTokens,
        }),
      });
      if (res.ok) {
        setStep(3);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to save configuration.');
        siteUrlInputRef.current?.focus();
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save config.');
      siteUrlInputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleSampleDataSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
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
      setStep(4);
    } catch (err: any) {
      setError(err.message || 'Error configuring sample data.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen py-12 flex flex-col justify-center items-center">
      <AccessibleStep isActive={!isAuthenticated || step === 1}>
        <Container>
          <Card className="max-w-md">
            <Heading className="mb-4">Welcome to Your Wedding Site!</Heading>
            <p className="mb-4 text-gray-700">Please enter the admin password configured in your environment to begin setup.</p>
            <form onSubmit={handleLogin} className="space-y-4">
              <FormGroup state={error && !isAuthenticated ? 'error' : 'default'}>
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
                {error && !isAuthenticated && <FormMessage>{error}</FormMessage>}
              </FormGroup>
              <Button type="submit" disabled={loading} variant="primary" className="w-full py-3">
                {loading ? 'Authenticating...' : 'Continue'}
              </Button>
            </form>
          </Card>
        </Container>
      </AccessibleStep>

      <AccessibleStep isActive={isAuthenticated && step === 2}>
        <Container>
          <Card className="max-w-xl">
            <Heading className="mb-4">Step 1: The Essentials</Heading>
            <p className="mb-4 text-gray-700">Let&apos;s start with your names and when the big day is.</p>
            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormGroup>
                  <Label htmlFor="partner1">Partner 1</Label>
                  <Input id="partner1" type="text" value={partner1Name} onChange={(e) => setPartner1Name(e.target.value)} required />
                </FormGroup>
                <FormGroup>
                  <Label htmlFor="partner2">Partner 2</Label>
                  <Input id="partner2" type="text" value={partner2Name} onChange={(e) => setPartner2Name(e.target.value)} required />
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
              <FormGroup state={isDefaultUrl(baseUrl) || (!!error && isAuthenticated && step === 2) ? 'error' : 'default'}>
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
                ) : (error && isAuthenticated && step === 2) ? (
                  <FormMessage>{error}</FormMessage>
                ) : null}
              </FormGroup>
              <div className="grid grid-cols-3 gap-4">
                <FormGroup className="col-span-3 md:col-span-1">
                  <Label htmlFor="venueName">Venue Name</Label>
                  <Input id="venueName" type="text" value={venueName} onChange={(e) => setVenueName(e.target.value)} required />
                </FormGroup>
                <FormGroup className="col-span-3 md:col-span-1">
                  <Label htmlFor="venueCity">City</Label>
                  <Input id="venueCity" type="text" value={venueCity} onChange={(e) => setVenueCity(e.target.value)} required />
                </FormGroup>
                <FormGroup className="col-span-3 md:col-span-1">
                  <Label htmlFor="venueState">State</Label>
                  <Input id="venueState" type="text" value={venueState} onChange={(e) => setVenueState(e.target.value)} required />
                </FormGroup>
              </div>

              <div className="pt-4 border-t border-gray-200 dark:border-zinc-700">
                <ThemeConfigurationPanel
                  values={{
                    themePreset,
                    colorPrimary,
                    colorSecondary,
                    layoutContainerMaxWidth,
                    layoutGridGap,
                    layoutCardPadding,
                    layoutBorderRadius,
                    themeTokens,
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

      <AccessibleStep isActive={isAuthenticated && step === 3}>
        <Container>
          <Card className="max-w-2xl">
            <Heading className="mb-2">Step 3: Sample Data Selection</Heading>
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
                <FormGroup>
                  <Label className="font-semibold block mb-2">Starter Archetype Preset</Label>
                </FormGroup>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(Object.keys(ARCHETYPE_PRESETS) as ArchetypeId[]).map((key) => {
                    const preset = ARCHETYPE_PRESETS[key];
                    const isSelected = sampleArchetype === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setSampleArchetype(key);
                          setSelectedModules(['registry', 'guests', 'seating', 'weddingParty', 'attractions']);
                        }}
                        className={`p-4 rounded-xl border text-left transition ${
                          isSelected
                            ? 'border-primary bg-primary/10 ring-2 ring-primary'
                            : 'border-gray-300 dark:border-gray-700 hover:border-gray-400'
                        }`}
                      >
                        <div className="font-bold text-sm text-primary">{preset.name}</div>
                        <div className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                          {preset.description}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-3">
                  <FormGroup>
                    <Label className="font-semibold">Sample Data Modules</Label>
                  </FormGroup>
                  <div className="space-x-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedModules(['registry', 'guests', 'seating', 'weddingParty', 'attractions'])}
                      className="text-primary underline hover:opacity-80"
                    >
                      Select All
                    </button>
                    <span>|</span>
                    <button
                      type="button"
                      onClick={() => setSelectedModules([])}
                      className="text-gray-500 underline hover:text-gray-700"
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
                      <span className="text-sm font-medium">Registry Items & Cash Funds</span>
                    </label>
                  </FormGroup>

                  <FormGroup className="flex items-center space-x-3 cursor-pointer">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <Checkbox
                        checked={selectedModules.includes('guests')}
                        onChange={() => toggleModule('guests')}
                      />
                      <span className="text-sm font-medium">Guest List & Invitation Codes</span>
                    </label>
                  </FormGroup>

                  <FormGroup className="flex items-center space-x-3 cursor-pointer">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <Checkbox
                        checked={selectedModules.includes('seating')}
                        onChange={() => toggleModule('seating')}
                      />
                      <span className="text-sm font-medium">Seating Layout & Tables</span>
                    </label>
                  </FormGroup>

                  <FormGroup className="flex items-center space-x-3 cursor-pointer">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <Checkbox
                        checked={selectedModules.includes('weddingParty')}
                        onChange={() => toggleModule('weddingParty')}
                      />
                      <span className="text-sm font-medium">Wedding Party Members</span>
                    </label>
                  </FormGroup>

                  <FormGroup className="flex items-center space-x-3 cursor-pointer md:col-span-2">
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <Checkbox
                        checked={selectedModules.includes('attractions')}
                        onChange={() => toggleModule('attractions')}
                      />
                      <span className="text-sm font-medium">Local Attractions & Hotel Blocks</span>
                    </label>
                  </FormGroup>
                </div>
              </div>

              <div className="flex gap-3">
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
                  onClick={async () => {
                    setSelectedModules([]);
                    setStep(4);
                  }}
                  className="py-3 px-6"
                >
                  Skip
                </Button>
              </div>
            </form>
          </Card>
        </Container>
      </AccessibleStep>

      <AccessibleStep isActive={isAuthenticated && step === 4}>
        <Container>
          <Card className="max-w-2xl text-center">
            <Heading className="mb-4">Step 4: Complete Setup</Heading>
            <p className="mb-6 text-gray-700">Great! Your wedding website setup is complete. You can now manage custom details or view your guest site.</p>
            <div className="space-y-4">
              <Button onClick={() => setIsWeddingPartyModalOpen(true)} variant="secondary" className="w-full py-3">
                Manage Wedding Party ({partyMembers.length} {partyMembers.length === 1 ? 'member' : 'members'})
              </Button>
              <Button onClick={() => setIsAttractionsModalOpen(true)} variant="secondary" className="w-full py-3">
                Manage Attractions ({attractions.length} {attractions.length === 1 ? 'item' : 'items'})
              </Button>
            </div>
            <p className="mt-6 mb-4 text-sm text-gray-600">You can also manage content and clear sample data anytime from the Admin Dashboard.</p>
            <Button onClick={() => {
              clearPersistedSetupState();
              window.location.href = '/admin/dashboard';
            }} variant="primary" className="w-full py-3">
              Go to Admin Dashboard
            </Button>
          </Card>
        </Container>
      </AccessibleStep>

      <WeddingPartyManagerModal
        isOpen={isWeddingPartyModalOpen}
        onClose={() => setIsWeddingPartyModalOpen(false)}
      />

      <AttractionsManagerModal
        isOpen={isAttractionsModalOpen}
        onClose={() => setIsAttractionsModalOpen(false)}
      />
    </main>
  );
}

export default function SetupWizard() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <SetupWizardContent />
    </QueryClientProvider>
  );
}

