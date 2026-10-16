'use client';
import React, { useState, useRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { FormGroup, Label, Input, FormMessage } from '@/components/ui/forms';
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
  const siteUrlInputRef = useRef<HTMLInputElement>(null);

  const handleThemeChange = (fields: Record<string, any>) => {
    if (fields.themePreset !== undefined) setThemePreset(fields.themePreset);
    if (fields.colorPrimary !== undefined) setColorPrimary(fields.colorPrimary);
    if (fields.colorSecondary !== undefined) setColorSecondary(fields.colorSecondary);
    if (fields.layoutContainerMaxWidth !== undefined) setLayoutContainerMaxWidth(fields.layoutContainerMaxWidth);
    if (fields.layoutGridGap !== undefined) setLayoutGridGap(fields.layoutGridGap);
    if (fields.layoutCardPadding !== undefined) setLayoutCardPadding(fields.layoutCardPadding);
    if (fields.layoutBorderRadius !== undefined) setLayoutBorderRadius(fields.layoutBorderRadius);
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
                {error && !isAuthenticated && <FormMessage role="alert">{error}</FormMessage>}
              </FormGroup>
              <Button disabled={loading} type="submit" variant="primary" className="w-full py-3">
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
                  <FormMessage role="alert">Please use your own URL.</FormMessage>
                ) : (error && isAuthenticated && step === 2) ? (
                  <FormMessage role="alert">{error}</FormMessage>
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
                  }}
                  onChange={handleThemeChange}
                />
              </div>

              <Button disabled={loading} type="submit" variant="primary" className="w-full py-3">
                {loading ? 'Saving...' : 'Next Step'}
              </Button>
            </form>
          </Card>
        </Container>
      </AccessibleStep>

      <AccessibleStep isActive={isAuthenticated && step === 3}>
        <Container>
          <Card className="max-w-2xl text-center">
            <Heading className="mb-4">Step 2: Add Content</Heading>
            <p className="mb-6 text-gray-700">Great! Your core details are set. Now let&apos;s add some content like your wedding party and things to do in the area.</p>
            <div className="space-y-4">
              <Button onClick={() => setIsWeddingPartyModalOpen(true)} variant="secondary" className="w-full py-3">
                Manage Wedding Party ({partyMembers.length} {partyMembers.length === 1 ? 'member' : 'members'})
              </Button>
              <Button onClick={() => setIsAttractionsModalOpen(true)} variant="secondary" className="w-full py-3">
                Manage Attractions ({attractions.length} {attractions.length === 1 ? 'item' : 'items'})
              </Button>
            </div>
            <p className="mt-6 mb-4 text-sm text-gray-600">You can also do this later from the Admin Dashboard.</p>
            <Button onClick={() => {
              clearPersistedSetupState();
              window.location.href = '/';
            }} variant="primary" className="w-full py-3">
              Finish Setup & View Site
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

