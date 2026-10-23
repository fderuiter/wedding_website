'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';

// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';
import { useAdminSettings } from '@/hooks/admin/useAdminSettings';
import { Dialog } from '@/components/ui/Dialog';

import AdminPreviewLayout from '@/components/admin/AdminPreviewLayout';
import { FormGroup, Label, Input, Textarea, Select, FormMessage } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';
import { useAdminBroadcast } from '@/hooks/admin/useAdminBroadcast';
import { MAX_UPLOAD_SIZE, ACCEPTED_IMAGE_TYPES } from '@/utils/validation';
import { FEATURE_METADATA, FeatureId, resolveModuleConfig } from '@/lib/modules';
import { ThemeConfigurationPanel } from '@/components/admin/ThemeConfigurationPanel';

interface SearchableTimezoneSelectProps {
  value: string;
  onChange: (val: string) => void;
}

function SearchableTimezoneSelect({ value, onChange }: SearchableTimezoneSelectProps) {
  const ianaTimezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch (e) {
      return ['America/Chicago', 'UTC'];
    }
  }, []);

  const [search, setSearch] = useState(value || 'America/Chicago');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (value) {
      setSearch(value);
    }
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setHighlightedIndex(-1);
        if (ianaTimezones.includes(search)) {
          onChange(search);
        } else {
          setSearch(value || 'America/Chicago');
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [search, value, ianaTimezones, onChange]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ianaTimezones;
    return ianaTimezones.filter((tz) => tz.toLowerCase().includes(q));
  }, [search, ianaTimezones]);

  const handleSelect = (tz: string) => {
    onChange(tz);
    setSearch(tz);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setIsOpen(true);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      }
      if (filtered.length > 0) {
        setHighlightedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      }
      if (filtered.length > 0) {
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
      }
    } else if (e.key === 'Enter') {
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < filtered.length) {
        e.preventDefault();
        handleSelect(filtered[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        setIsOpen(false);
        setHighlightedIndex(-1);
        setSearch(value || 'America/Chicago');
      }
    } else if (e.key === 'Home') {
      if (isOpen && filtered.length > 0) {
        e.preventDefault();
        setHighlightedIndex(0);
      }
    } else if (e.key === 'End') {
      if (isOpen && filtered.length > 0) {
        e.preventDefault();
        setHighlightedIndex(filtered.length - 1);
      }
    }
  };

  useEffect(() => {
    if (highlightedIndex >= 0 && optionRefs.current[highlightedIndex]) {
      optionRefs.current[highlightedIndex]?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  return (
    <div ref={containerRef} className="relative w-full">
      <Input
        type="text"
        placeholder="Search and select timezone (e.g. Europe/Paris)..."
        value={search}
        onChange={handleInputChange}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls="timezone-listbox"
        aria-autocomplete="list"
        aria-activedescendant={
          isOpen && highlightedIndex >= 0 && filtered[highlightedIndex]
            ? `timezone-option-${highlightedIndex}`
            : undefined
        }
        className="w-full"
      />
      {isOpen && (
        <div
          id="timezone-listbox"
          role="listbox"
          aria-label="Timezone options"
          className="absolute left-0 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg z-50"
        >
          {filtered.length > 0 ? (
            filtered.map((tz, index) => {
              const isHighlighted = index === highlightedIndex;
              return (
                <div
                  key={tz}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  id={`timezone-option-${index}`}
                  role="option"
                  aria-selected={isHighlighted}
                  onClick={() => handleSelect(tz)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-zinc-200 cursor-pointer ${
                    isHighlighted
                      ? 'bg-gray-100 dark:bg-zinc-700'
                      : 'hover:bg-gray-100 dark:hover:bg-zinc-700'
                  }`}
                >
                  {tz}
                </div>
              );
            })
          ) : (
            <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
              No matching standard IANA timezones found
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const [selectedProfileId, setSelectedProfileId] = useState<string>('global');

  const {
    config: initialConfig,
    loading,
    saving,
    saveSettings,
    profiles,
    loadingList,
    createProfile,
    creating,
    fetchAll,
  } = useAdminSettings(selectedProfileId);

  const { testConnection, testingConnection } = useAdminBroadcast();

  const handleTestConnection = async (type: 'email' | 'sms') => {
    try {
      const res: any = await testConnection({
        type,
        provider: type === 'email' ? localConfig?.emailProvider : localConfig?.smsProvider,
        smtpHost: localConfig?.smtpHost,
        smtpPort: localConfig?.smtpPort ? Number(localConfig.smtpPort) : 587,
        smtpUser: localConfig?.smtpUser,
        smtpPass: localConfig?.smtpPass,
        smtpFrom: localConfig?.smtpFrom,
        smtpSecure: Boolean(localConfig?.smtpSecure),
        resendApiKey: localConfig?.resendApiKey,
        resendFrom: localConfig?.resendFrom,
        sendgridApiKey: localConfig?.sendgridApiKey,
        sendgridFrom: localConfig?.sendgridFrom,
        twilioAccountSid: localConfig?.twilioAccountSid,
        twilioAuthToken: localConfig?.twilioAuthToken,
        twilioFromNumber: localConfig?.twilioFromNumber,
      });

      if (res.success) {
        addToast(`Successfully verified ${type.toUpperCase()} provider configuration!`, 'success');
      } else {
        addToast(`Connection test failed: ${res.error || 'Unknown error'}`, 'error');
      }
    } catch (err: any) {
      addToast(`Connection test failed: ${err.message}`, 'error');
    }
  };

  const [localConfig, setLocalConfig] = useState<any>(null);
  const [themeTokensText, setThemeTokensText] = useState('{}');
  const [themeTokensError, setThemeTokensError] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newProfileData, setNewProfileData] = useState({ partner1Name: '', partner2Name: '', subdomain: '' });
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    if (initialConfig) {
      setLocalConfig(initialConfig);
      if (initialConfig.themeTokens) {
        try {
          const tokensObj = typeof initialConfig.themeTokens === 'string'
            ? JSON.parse(initialConfig.themeTokens)
            : initialConfig.themeTokens;
          setThemeTokensText(JSON.stringify(tokensObj, null, 2));
        } catch {
          setThemeTokensText('{}');
        }
      } else {
        setThemeTokensText('{}');
      }
    }
  }, [initialConfig]);

  const handleTokensChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setThemeTokensText(text);
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        setThemeTokensError('');
        setLocalConfig((prev: any) => ({ ...prev, themeTokens: parsed }));
      } else {
        setThemeTokensError('Theme tokens must be a JSON object mapping CSS variables to values.');
      }
    } catch {
      setThemeTokensError('Invalid JSON format.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localConfig) return;
    try {
      await saveSettings(localConfig);
      addToast('Branding profile saved successfully.', 'success');
    } catch (err: any) {
      addToast(err.message || 'Failed to save profile', 'error');
    }
  };

  const handleCreateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    try {
      const created = await createProfile(newProfileData);
      addToast('Staging profile created successfully!', 'success');
      setIsCreateOpen(false);
      setNewProfileData({ partner1Name: '', partner2Name: '', subdomain: '' });
      if (created && created.id) {
        setSelectedProfileId(created.id);
        setLocalConfig(null);
      }
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create profile. Ensure subdomain is unique.');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, fieldName: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > MAX_UPLOAD_SIZE) {
      addToast('File size exceeds 5MB limit', 'error');
      return;
    }

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      addToast('Invalid file format. Only JPG, PNG, and ICO are supported', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const { url } = await apiClient.post<{ url: string }>('/api/admin/upload', formData);
      setLocalConfig((prev: any) => ({ ...prev, [fieldName]: url }));
      addToast(`${fieldName} uploaded successfully.`, 'success');
    } catch (err: any) {
      addToast(`Upload failed: ${err.message || err}`, 'error');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setLocalConfig((prev: any) => ({ ...prev, [name]: value }));
  };

  if (loading || loadingList) return <div className="p-8 text-center">Loading settings...</div>;

  if (!localConfig) return <div className="p-8 text-center text-red-500">Failed to load settings.</div>;

  const isMultisite = Boolean(localConfig.multisiteEnabled);

  return (
    <AdminPreviewLayout
      previewUrl="/"
      draftType="config"
      draftData={{
        ...localConfig,
        weddingDate: localConfig.weddingDate ? new Date(localConfig.weddingDate).toISOString() : new Date().toISOString()
      }}
      entityId={selectedProfileId}
      onRestore={() => {
        setLocalConfig(initialConfig);
        fetchAll();
      }}
    >
      <div className="mx-auto max-w-4xl p-6">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Site Settings</h1>
          <Button variant="ghost" onClick={() => router.push('/admin/dashboard')}>Back to Dashboard</Button>
        </div>

        {/* Profile Switcher & Creator Section (Visible when MULTISITE_ENABLED=true) */}
        {isMultisite && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 border border-gray-100 dark:border-zinc-700">
            <div className="space-y-1">
              <h3 className="text-lg font-medium text-gray-900 dark:text-zinc-100">Branding & Staging Profiles</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Manage parallel configuration profiles or test changes on staging subdomains.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <select
                value={selectedProfileId}
                onChange={(e) => {
                  setSelectedProfileId(e.target.value);
                  setLocalConfig(null);
                }}
                className="rounded-md border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-4 py-2 text-sm text-gray-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
              >
                {Array.isArray(profiles) ? (
                  profiles.map((p: any) => (
                    <option key={p.id} value={p.id}>
                      {p.id === 'global' ? 'Production (Default)' : `${p.brideName} & ${p.groomName} (subdomain: ${p.subdomain})`}
                    </option>
                  ))
                ) : (
                  <option value="global">Production (Default)</option>
                )}
              </select>
              <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
                New Profile
              </Button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8 pb-10">
          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-4">Core Identity</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup>
                <Label>Partner 1 Name</Label>
                <Input required type="text" name="partner1Name" value={localConfig.partner1Name || localConfig.brideName || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Partner 2 Name</Label>
                <Input required type="text" name="partner2Name" value={localConfig.partner2Name || localConfig.groomName || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Wedding Date</Label>
                <Input required type="date" name="weddingDate" value={localConfig.weddingDate || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Base URL</Label>
                <Input required type="url" name="baseUrl" value={localConfig.baseUrl || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Host Contact Email</Label>
                <Input type="email" name="contactEmail" value={localConfig.contactEmail || ''} onChange={handleChange} placeholder="e.g. hosts@wedding.example" />
                <FormMessage>Host contact email address used across guest support touchpoints.</FormMessage>
              </FormGroup>
              {isMultisite && selectedProfileId !== 'global' && (
                <FormGroup>
                  <Label>Subdomain Identifier</Label>
                  <Input
                    required
                    type="text"
                    name="subdomain"
                    value={localConfig.subdomain || ''}
                    onChange={(e) => {
                      const sanitized = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                      setLocalConfig((prev: any) => ({ ...prev, subdomain: sanitized }));
                    }}
                    placeholder="e.g. promptops"
                  />
                  <FormMessage>Only lowercase alphanumeric characters and hyphens. Maps to the staging environment.</FormMessage>
                </FormGroup>
              )}
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-4">Venue & Location</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup>
                <Label>Venue Name</Label>
                <Input required type="text" name="venueName" value={localConfig.venueName || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Address</Label>
                <Input required type="text" name="venueAddress" value={localConfig.venueAddress || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>City</Label>
                <Input required type="text" name="venueCity" value={localConfig.venueCity || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>State</Label>
                <Input required type="text" name="venueState" value={localConfig.venueState || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Zip Code</Label>
                <Input required type="text" name="venueZip" value={localConfig.venueZip || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Venue Timezone</Label>
                <SearchableTimezoneSelect
                  value={localConfig.timezone}
                  onChange={(val) => setLocalConfig((prev: any) => ({ ...prev, timezone: val }))}
                />
              </FormGroup>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <FormGroup>
                <Label>Latitude</Label>
                <Input required type="number" step="any" name="latitude" value={localConfig.latitude || 0} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Longitude</Label>
                <Input required type="number" step="any" name="longitude" value={localConfig.longitude || 0} onChange={handleChange} />
              </FormGroup>
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-4">Narrative Content</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup>
                <Label>Hero Title</Label>
                <Input required type="text" name="heroTitle" value={localConfig.heroTitle || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Hero Subtitle</Label>
                <Input required type="text" name="heroSubtitle" value={localConfig.heroSubtitle || ''} onChange={handleChange} />
              </FormGroup>
            </div>
            <FormGroup>
              <Label>Our Story</Label>
              <Textarea required name="storyText" value={localConfig.storyText || ''} onChange={handleChange} rows={6} />
            </FormGroup>
            <FormGroup>
              <Label>Venue Description</Label>
              <Textarea required name="venueDescription" value={localConfig.venueDescription || ''} onChange={handleChange} rows={4} />
            </FormGroup>
            <FormGroup>
              <Label>Travel Advice</Label>
              <Textarea required name="travelAdvice" value={localConfig.travelAdvice || ''} onChange={handleChange} rows={4} />
            </FormGroup>
          </section>

          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-4">Theme Customization</h2>
            <ThemeConfigurationPanel
              values={{
                colorPrimary: localConfig.colorPrimary,
                colorSecondary: localConfig.colorSecondary,
                themePreset: localConfig.themePreset,
                layoutContainerMaxWidth: localConfig.layoutContainerMaxWidth,
                layoutGridGap: localConfig.layoutGridGap,
                layoutCardPadding: localConfig.layoutCardPadding,
                layoutBorderRadius: localConfig.layoutBorderRadius,
                fontSizeBase: localConfig.fontSizeBase,
                fontSizeLg: localConfig.fontSizeLg,
                fontWeightNormal: localConfig.fontWeightNormal,
                spacingMd: localConfig.spacingMd,
                borderRadiusSm: localConfig.borderRadiusSm,
                borderWidthThin: localConfig.borderWidthThin,
                borderStyleDefault: localConfig.borderStyleDefault,
                brandLogoWidth: localConfig.brandLogoWidth,
                brandLogoHeight: localConfig.brandLogoHeight,
                brandHeroHeight: localConfig.brandHeroHeight,
                brandWatermarkWidth: localConfig.brandWatermarkWidth,
                brandWatermarkOpacity: localConfig.brandWatermarkOpacity,
                brandBadgeSize: localConfig.brandBadgeSize,
                typographyScale: localConfig.typographyScale,
                spacingScale: localConfig.spacingScale,
                borderTreatment: localConfig.borderTreatment,
                brandDimensions: localConfig.brandDimensions,
              }}
              onChange={(updated) => {
                setLocalConfig((prev: any) => ({
                  ...prev,
                  ...updated,
                }));
              }}
            />
            <FormGroup>
              <Label>Custom CSS Theme Tokens (JSON)</Label>
              <Textarea
                value={themeTokensText}
                onChange={handleTokensChange}
                rows={5}
                placeholder='{\n  "--btn-radius": "0.5rem",\n  "--card-bg": "#ffffff"\n}'
                className="font-mono text-xs"
              />
              {themeTokensError ? (
                <FormMessage role="alert">{themeTokensError}</FormMessage>
              ) : (
                <FormMessage>Provide custom CSS token overrides in JSON format. Keys must start with --.</FormMessage>
              )}
            </FormGroup>
          </section>

          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-2">Feature & Module Management</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              Enable or disable optional site capabilities. Disabling a feature removes its navigation links, protects page routes, disables backend API endpoints, and handles dependencies automatically.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(FEATURE_METADATA).map(([id, meta]) => {
                const featureId = id as FeatureId;
                const currentModules = resolveModuleConfig(localConfig.modules);
                const isChecked = currentModules[featureId];
                const isRegistryDisabled = !currentModules.registry;
                const isDependencyBlocked = meta.dependencies?.includes('registry') && isRegistryDisabled;

                return (
                  <div
                    key={featureId}
                    className={`p-4 rounded-lg border transition-colors ${
                      isChecked
                        ? 'border-rose-200 dark:border-rose-900/60 bg-rose-50/30 dark:bg-rose-950/20'
                        : 'border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 opacity-80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <label htmlFor={`feature-${featureId}`} className="font-semibold text-gray-900 dark:text-gray-100 cursor-pointer flex items-center gap-2">
                          {meta.title}
                          {isDependencyBlocked && (
                            <span className="text-xs bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded font-normal">
                              Requires Registry
                            </span>
                          )}
                        </label>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {meta.description}
                        </p>
                      </div>
                      <input
                        id={`feature-${featureId}`}
                        type="checkbox"
                        checked={isChecked}
                        disabled={isDependencyBlocked}
                        onChange={(e) => {
                          const newChecked = e.target.checked;
                          const updatedModules = { ...currentModules, [featureId]: newChecked };
                          if (featureId === 'registry' && !newChecked) {
                            updatedModules.groupGifting = false;
                          }
                          if (featureId === 'countdown') {
                            setLocalConfig((prev: any) => ({
                              ...prev,
                              showCountdown: newChecked,
                              modules: updatedModules,
                            }));
                          } else if (featureId === 'addToCalendar') {
                            setLocalConfig((prev: any) => ({
                              ...prev,
                              showAddToCalendar: newChecked,
                              modules: updatedModules,
                            }));
                          } else {
                            setLocalConfig((prev: any) => ({
                              ...prev,
                              modules: updatedModules,
                            }));
                          }
                        }}
                        className="h-5 w-5 rounded border-gray-300 text-rose-600 focus:ring-rose-500 cursor-pointer mt-1"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <div className="flex justify-between items-center mb-2">
              <div>
                <h2 className="text-xl font-semibold">Messaging & Broadcast Settings</h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Configure delivery providers (SMTP, Resend, SendGrid, Twilio) and rate limits for guest broadcast communications.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={testingConnection}
                  onClick={() => handleTestConnection('email')}
                >
                  {testingConnection ? 'Testing...' : 'Test Email Connection'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={testingConnection}
                  onClick={() => handleTestConnection('sms')}
                >
                  {testingConnection ? 'Testing...' : 'Test SMS Connection'}
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t pt-4 border-gray-100 dark:border-gray-700">
              <FormGroup>
                <Label htmlFor="emailProvider">Email Delivery Provider</Label>
                <Select
                  id="emailProvider"
                  name="emailProvider"
                  value={localConfig.emailProvider || 'smtp'}
                  onChange={handleChange}
                >
                  <option value="smtp">Standard SMTP Server</option>
                  <option value="resend">Resend Email API</option>
                  <option value="sendgrid">SendGrid Email API</option>
                  <option value="none">Disabled / Simulation</option>
                </Select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="smsProvider">SMS Gateway Provider</Label>
                <Select
                  id="smsProvider"
                  name="smsProvider"
                  value={localConfig.smsProvider || 'none'}
                  onChange={handleChange}
                >
                  <option value="none">Disabled / Simulation</option>
                  <option value="twilio">Twilio Programmable Messaging</option>
                </Select>
              </FormGroup>
            </div>

            {/* SMTP Settings */}
            {(localConfig.emailProvider === 'smtp' || !localConfig.emailProvider) && (
              <div className="p-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg space-y-3 border border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">SMTP Credentials</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <FormGroup>
                    <Label>SMTP Host</Label>
                    <Input type="text" name="smtpHost" value={localConfig.smtpHost || ''} onChange={handleChange} placeholder="smtp.mailgun.org" />
                  </FormGroup>
                  <FormGroup>
                    <Label>SMTP Port</Label>
                    <Input type="number" name="smtpPort" value={localConfig.smtpPort || 587} onChange={handleChange} placeholder="587" />
                  </FormGroup>
                  <FormGroup>
                    <Label>From Email Address</Label>
                    <Input type="email" name="smtpFrom" value={localConfig.smtpFrom || ''} onChange={handleChange} placeholder="wedding@example.com" />
                  </FormGroup>
                  <FormGroup>
                    <Label>SMTP Username</Label>
                    <Input type="text" name="smtpUser" value={localConfig.smtpUser || ''} onChange={handleChange} />
                  </FormGroup>
                  <FormGroup>
                    <Label>SMTP Password</Label>
                    <Input type="password" name="smtpPass" value={localConfig.smtpPass || ''} onChange={handleChange} />
                  </FormGroup>
                </div>
              </div>
            )}

            {/* Resend Settings */}
            {localConfig.emailProvider === 'resend' && (
              <div className="p-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg space-y-3 border border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Resend API Credentials</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FormGroup>
                    <Label>Resend API Key</Label>
                    <Input type="password" name="resendApiKey" value={localConfig.resendApiKey || ''} onChange={handleChange} placeholder="re_123456789..." />
                  </FormGroup>
                  <FormGroup>
                    <Label>Sender Email Address</Label>
                    <Input type="email" name="resendFrom" value={localConfig.resendFrom || ''} onChange={handleChange} placeholder="wedding@yourdomain.com" />
                  </FormGroup>
                </div>
              </div>
            )}

            {/* SendGrid Settings */}
            {localConfig.emailProvider === 'sendgrid' && (
              <div className="p-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg space-y-3 border border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">SendGrid API Credentials</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <FormGroup>
                    <Label>SendGrid API Key</Label>
                    <Input type="password" name="sendgridApiKey" value={localConfig.sendgridApiKey || ''} onChange={handleChange} placeholder="SG.123456789..." />
                  </FormGroup>
                  <FormGroup>
                    <Label>Sender Email Address</Label>
                    <Input type="email" name="sendgridFrom" value={localConfig.sendgridFrom || ''} onChange={handleChange} placeholder="wedding@yourdomain.com" />
                  </FormGroup>
                </div>
              </div>
            )}

            {/* Twilio Settings */}
            {localConfig.smsProvider === 'twilio' && (
              <div className="p-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg space-y-3 border border-gray-200 dark:border-gray-700">
                <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Twilio SMS Credentials</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <FormGroup>
                    <Label>Account SID</Label>
                    <Input type="text" name="twilioAccountSid" value={localConfig.twilioAccountSid || ''} onChange={handleChange} placeholder="AC123456789..." />
                  </FormGroup>
                  <FormGroup>
                    <Label>Auth Token</Label>
                    <Input type="password" name="twilioAuthToken" value={localConfig.twilioAuthToken || ''} onChange={handleChange} />
                  </FormGroup>
                  <FormGroup>
                    <Label>From Phone Number</Label>
                    <Input type="text" name="twilioFromNumber" value={localConfig.twilioFromNumber || ''} onChange={handleChange} placeholder="+15551234567" />
                  </FormGroup>
                </div>
              </div>
            )}

            {/* Dispatch Safety & Batching */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <FormGroup>
                <Label>Batch Size (Recipients per Chunk)</Label>
                <Input type="number" name="broadcastBatchSize" value={localConfig.broadcastBatchSize || 50} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Batch Delay (ms between Chunks)</Label>
                <Input type="number" name="broadcastBatchDelayMs" value={localConfig.broadcastBatchDelayMs || 500} onChange={handleChange} />
              </FormGroup>
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-4">Branding & Assets</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup>
                <Label>Brand Monogram</Label>
                <Input
                  type="text"
                  name="brandMonogram"
                  value={localConfig.brandMonogram || ''}
                  onChange={handleChange}
                  placeholder="e.g. A & F (leave blank for automatic derivation)"
                />
                <FormMessage>Custom monogram text displayed in navigation when no custom logo image is provided.</FormMessage>
              </FormGroup>
              <FormGroup>
                <Label>Brand Logo Alt Text</Label>
                <Input
                  type="text"
                  name="brandLogoAlt"
                  value={localConfig.brandLogoAlt || ''}
                  onChange={handleChange}
                  placeholder="e.g. Wedding Logo"
                />
                <FormMessage>Accessibility text for screen readers when displaying custom brand logo image.</FormMessage>
              </FormGroup>
            </div>
            <FormGroup>
              <Label>Brand Logo Image (Header Navigation)</Label>
              <div className="flex flex-col space-y-2">
                <Input
                  type="text"
                  name="brandLogoUrl"
                  value={localConfig.brandLogoUrl || ''}
                  onChange={handleChange}
                  placeholder="https://... or /images/logo.png"
                />
                <div className="flex items-center gap-4">
                  <Input
                    type="file"
                    accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
                    onChange={(e) => handleUpload(e, 'brandLogoUrl')}
                    className="file:pt-1"
                  />
                  {localConfig.brandLogoUrl && (
                    <div className="flex items-center gap-2">
                      <img
                        src={localConfig.brandLogoUrl}
                        alt={localConfig.brandLogoAlt || 'Brand logo preview'}
                        className="h-10 max-h-12 w-auto object-contain bg-gray-100 dark:bg-gray-700 rounded p-1"
                      />
                      <span className="text-xs text-gray-500 dark:text-gray-400 break-all">{localConfig.brandLogoUrl}</span>
                    </div>
                  )}
                </div>
              </div>
            </FormGroup>

            {/* Hero Visual */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormGroup>
                  <Label>Hero Visual Alt Text</Label>
                  <Input
                    type="text"
                    name="heroImageAlt"
                    value={localConfig.heroImageAlt || ''}
                    onChange={handleChange}
                    placeholder="e.g. Hero background image"
                  />
                  <FormMessage>Accessibility description for hero visual background media.</FormMessage>
                </FormGroup>
              </div>
              <FormGroup>
                <Label>Hero Visual Background Image</Label>
                <div className="flex flex-col space-y-2">
                  <Input
                    type="text"
                    name="heroImageUrl"
                    value={localConfig.heroImageUrl || ''}
                    onChange={handleChange}
                    placeholder="https://... or /images/hero.jpg"
                  />
                  <div className="flex items-center gap-4">
                    <Input
                      type="file"
                      accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
                      onChange={(e) => handleUpload(e, 'heroImageUrl')}
                      className="file:pt-1"
                    />
                    {localConfig.heroImageUrl && (
                      <div className="flex items-center gap-2">
                        <img
                          src={localConfig.heroImageUrl}
                          alt={localConfig.heroImageAlt || 'Hero visual preview'}
                          className="h-12 w-20 object-cover bg-gray-100 dark:bg-gray-700 rounded p-1"
                        />
                        <span className="text-xs text-gray-500 dark:text-gray-400 break-all">{localConfig.heroImageUrl}</span>
                      </div>
                    )}
                  </div>
                </div>
              </FormGroup>
            </div>

            {/* Brand Watermark */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormGroup>
                  <Label>Brand Watermark Alt Text</Label>
                  <Input
                    type="text"
                    name="brandWatermarkAlt"
                    value={localConfig.brandWatermarkAlt || ''}
                    onChange={handleChange}
                    placeholder="e.g. Brand watermark logo"
                  />
                  <FormMessage>Accessibility description for brand watermark visual.</FormMessage>
                </FormGroup>
              </div>
              <FormGroup>
                <Label>Brand Watermark Graphic</Label>
                <div className="flex flex-col space-y-2">
                  <Input
                    type="text"
                    name="brandWatermarkUrl"
                    value={localConfig.brandWatermarkUrl || ''}
                    onChange={handleChange}
                    placeholder="https://... or /images/watermark.png"
                  />
                  <div className="flex items-center gap-4">
                    <Input
                      type="file"
                      accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
                      onChange={(e) => handleUpload(e, 'brandWatermarkUrl')}
                      className="file:pt-1"
                    />
                    {localConfig.brandWatermarkUrl && (
                      <div className="flex items-center gap-2">
                        <img
                          src={localConfig.brandWatermarkUrl}
                          alt={localConfig.brandWatermarkAlt || 'Brand watermark preview'}
                          className="h-10 max-h-12 w-auto object-contain bg-gray-100 dark:bg-gray-700 rounded p-1"
                        />
                        <span className="text-xs text-gray-500 dark:text-gray-400 break-all">{localConfig.brandWatermarkUrl}</span>
                      </div>
                    )}
                  </div>
                </div>
              </FormGroup>
            </div>

            {/* Badge Graphic */}
            <div className="pt-4 border-t border-gray-200 dark:border-gray-700 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormGroup>
                  <Label>Badge Graphic Alt Text</Label>
                  <Input
                    type="text"
                    name="badgeGraphicAlt"
                    value={localConfig.badgeGraphicAlt || ''}
                    onChange={handleChange}
                    placeholder="e.g. Special badge graphic"
                  />
                  <FormMessage>Accessibility description for badge graphic visual.</FormMessage>
                </FormGroup>
              </div>
              <FormGroup>
                <Label>Badge Graphic Image</Label>
                <div className="flex flex-col space-y-2">
                  <Input
                    type="text"
                    name="badgeGraphicUrl"
                    value={localConfig.badgeGraphicUrl || ''}
                    onChange={handleChange}
                    placeholder="https://... or /images/badge.png"
                  />
                  <div className="flex items-center gap-4">
                    <Input
                      type="file"
                      accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
                      onChange={(e) => handleUpload(e, 'badgeGraphicUrl')}
                      className="file:pt-1"
                    />
                    {localConfig.badgeGraphicUrl && (
                      <div className="flex items-center gap-2">
                        <img
                          src={localConfig.badgeGraphicUrl}
                          alt={localConfig.badgeGraphicAlt || 'Badge graphic preview'}
                          className="h-10 max-h-12 w-auto object-contain bg-gray-100 dark:bg-gray-700 rounded p-1"
                        />
                        <span className="text-xs text-gray-500 dark:text-gray-400 break-all">{localConfig.badgeGraphicUrl}</span>
                      </div>
                    )}
                  </div>
                </div>
              </FormGroup>
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-4">SEO & Metadata</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup>
                <Label>SEO Title</Label>
                <Input required type="text" name="seoTitle" value={localConfig.seoTitle || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>SEO Description</Label>
                <Input required type="text" name="seoDescription" value={localConfig.seoDescription || ''} onChange={handleChange} />
              </FormGroup>
            </div>
            <FormGroup>
              <Label>SEO Keywords</Label>
              <Textarea name="seoKeywords" value={localConfig.seoKeywords || ''} onChange={handleChange} rows={3} placeholder="{{partner1Name}} and {{partner2Name}}'s wedding..." />
              <FormMessage>Comma-separated list. Use templates like {'{{partner1Name}}'}. Variables: partner1Name, partner2Name, brideName, groomName, venueName, venueCity, venueState.</FormMessage>
            </FormGroup>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <FormGroup>
                <Label>Favicon (.ico, .png)</Label>
                <div className="flex flex-col space-y-2">
                  <Input type="file" accept=".ico,.png,image/png,image/x-icon" onChange={(e) => handleUpload(e, 'faviconUrl')} className="file:pt-1" />
                  {localConfig.faviconUrl && (
                    <div className="flex items-center gap-2">
                      <img src={localConfig.faviconUrl} alt="Favicon preview" className="w-8 h-8 object-contain bg-gray-100 dark:bg-gray-700 rounded" />
                      <span className="text-xs text-gray-500 dark:text-gray-400 break-all">{localConfig.faviconUrl}</span>
                    </div>
                  )}
                </div>
              </FormGroup>
              <FormGroup>
                <Label>Social Sharing Image (OG Image)</Label>
                <div className="flex flex-col space-y-2">
                  <Input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={(e) => handleUpload(e, 'ogImageUrl')} className="file:pt-1" />
                  {localConfig.ogImageUrl && (
                    <div className="flex items-center gap-2">
                      <img src={localConfig.ogImageUrl} alt="OG Image preview" className="w-32 h-auto object-contain bg-gray-100 dark:bg-gray-700 rounded" />
                      <span className="text-xs text-gray-500 dark:text-gray-400 break-all">{localConfig.ogImageUrl}</span>
                    </div>
                  )}
                </div>
              </FormGroup>
            </div>
          </section>

          <div className="flex justify-end sticky bottom-0 bg-gray-100 dark:bg-gray-900 py-4 shadow-t">
            <Button
              type="submit"
              disabled={saving}
              variant="primary"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </form>
      </div>

      <Dialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        title="Create Staging Profile"
        description="Create a new staging profile assigned to a unique testing subdomain."
      >
        <form onSubmit={handleCreateProfile} className="space-y-4">
          {createError && (
            <div className="p-3 text-sm bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-200 rounded">
              {createError}
            </div>
          )}
          <FormGroup>
            <Label>Partner 1 Name</Label>
            <Input
              required
              type="text"
              value={newProfileData.partner1Name}
              onChange={(e) => setNewProfileData(prev => ({ ...prev, partner1Name: e.target.value }))}
              placeholder="e.g. Abby"
            />
          </FormGroup>
          <FormGroup>
            <Label>Partner 2 Name</Label>
            <Input
              required
              type="text"
              value={newProfileData.partner2Name}
              onChange={(e) => setNewProfileData(prev => ({ ...prev, partner2Name: e.target.value }))}
              placeholder="e.g. Liam"
            />
          </FormGroup>
          <FormGroup>
            <Label>Testing Subdomain</Label>
            <Input
              required
              type="text"
              value={newProfileData.subdomain}
              onChange={(e) => setNewProfileData(prev => ({ ...prev, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
              placeholder="e.g. staging-ops"
            />
            <FormMessage>Only lowercase alphanumeric characters and hyphens. Aligned to subdomain routing.</FormMessage>
          </FormGroup>
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="ghost" onClick={() => setIsCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={creating}>
              {creating ? 'Creating...' : 'Create Profile'}
            </Button>
          </div>
        </form>
      </Dialog>
    </AdminPreviewLayout>
  );
}
