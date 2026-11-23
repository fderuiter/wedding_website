'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';
import { useAdminSettings } from '@/hooks/admin/useAdminSettings';
import { Dialog, useDirtyConfirmClose } from '@/components/ui/Dialog';
import { AdminViewState } from '@/components/admin/AdminViewState';

import AdminPreviewLayout from '@/components/admin/AdminPreviewLayout';
import { FormGroup, Label, Input, Textarea, Select, FormMessage } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';
import { useAdminBroadcast } from '@/hooks/admin/useAdminBroadcast';
import { MAX_UPLOAD_SIZE, ACCEPTED_IMAGE_TYPES } from '@/utils/validation';
import { FEATURE_METADATA, FeatureId, resolveModuleConfig } from '@/lib/modules';
import { ThemeConfigurationPanel } from '@/components/admin/ThemeConfigurationPanel';
import { AddressLookupInput } from '@/components/admin/AddressLookupInput';
import { isNonPlaceholderVenueText } from '@/utils/maps';
import { MediaImage } from '@/components/MediaImage';
import { stripPresetDefaultTokens, type ThemePreset } from '@/lib/theme/presets';
import { cssTokenKeyRegex, isValidCssTokenValue } from '@/features/content';
import {
  DEFAULT_RSVP_CLOSED_MESSAGE,
  RSVP_GRACE_PERIOD_HOURS_OPTIONS,
} from '@/utils/rsvpDeadline';

interface SearchableTimezoneSelectProps {
  value: string;
  onChange: (val: string) => void;
}

function SearchableTimezoneSelect({ value, onChange }: SearchableTimezoneSelectProps) {
  const ianaTimezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf('timeZone');
    } catch {
      return ['America/Chicago', 'UTC'];
    }
  }, []);

  const [draftSearch, setDraftSearch] = useState<string | null>(null);
  const search = draftSearch ?? (value || 'America/Chicago');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setHighlightedIndex(-1);
        if (ianaTimezones.includes(search)) {
          onChange(search);
        }
        setDraftSearch(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [search, ianaTimezones, onChange]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ianaTimezones;
    return ianaTimezones.filter((tz) => tz.toLowerCase().includes(q));
  }, [search, ianaTimezones]);

  const handleSelect = (tz: string) => {
    onChange(tz);
    setDraftSearch(null);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDraftSearch(e.target.value);
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
        setDraftSearch(null);
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

interface ThemeOverrideRow {
  id: string;
  key: string;
  value: string;
}

interface SettingsBrandingProfile {
  id: string;
  subdomain?: string | null;
  partner1Name?: string | null;
  partner2Name?: string | null;
  brideName?: string | null;
  groomName?: string | null;
}

interface SettingsDraftConfig {
  id?: string;
  multisiteEnabled?: boolean;
  subdomain?: string | null;
  partner1Name?: string;
  partner2Name?: string;
  brideName?: string;
  groomName?: string;
  weddingDate?: string;
  baseUrl?: string;
  contactEmail?: string;
  photoAlbumUrl?: string;
  venueName?: string;
  venueAddress?: string;
  venueCity?: string;
  venueState?: string;
  venueZip?: string;
  timezone?: string;
  latitude?: number | string;
  longitude?: number | string;
  shippingRecipientName?: string;
  shippingPhone?: string;
  shippingAddressLine1?: string;
  shippingAddressLine2?: string;
  shippingCity?: string;
  shippingState?: string;
  shippingZip?: string;
  shippingCountry?: string;
  shippingDeliveryNotes?: string;
  defaultPaymentHandleType?: string;
  defaultPaymentHandle?: string;
  rsvpOpen?: boolean;
  rsvpDeadlineDate?: string;
  rsvpGracePeriodHours?: number;
  rsvpClosedMessage?: string;
  heroTitle?: string;
  heroSubtitle?: string;
  storyText?: string;
  venueDescription?: string;
  travelAdvice?: string;
  colorPrimary?: string;
  colorSecondary?: string;
  themePreset?: ThemePreset | string;
  layoutContainerMaxWidth?: string;
  layoutGridGap?: string;
  layoutCardPadding?: string;
  layoutBorderRadius?: string;
  themeTokens?: Record<string, string>;
  printBg?: string;
  printText?: string;
  printBorder?: string;
  printHeaderBorder?: string;
  printBadgeBg?: string;
  modules?: Parameters<typeof resolveModuleConfig>[0];
  showCountdown?: boolean;
  showAddToCalendar?: boolean;
  emailProvider?: string;
  smsProvider?: string;
  smtpHost?: string;
  smtpPort?: number | string;
  smtpFrom?: string;
  smtpUser?: string;
  smtpPass?: string;
  smtpSecure?: boolean;
  hasSmtpPass?: boolean;
  resendApiKey?: string;
  resendFrom?: string;
  hasResendApiKey?: boolean;
  sendgridApiKey?: string;
  sendgridFrom?: string;
  hasSendgridApiKey?: boolean;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  hasTwilioAuthToken?: boolean;
  broadcastBatchSize?: number | string;
  broadcastBatchDelayMs?: number | string;
  brandMonogram?: string;
  brandLogoAlt?: string;
  brandLogoUrl?: string;
  heroImageAlt?: string;
  heroImageUrl?: string;
  brandWatermarkAlt?: string;
  brandWatermarkUrl?: string;
  badgeGraphicAlt?: string;
  badgeGraphicUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
  seoKeywords?: string;
  faviconUrl?: string;
  ogImageUrl?: string;
  [key: string]: unknown;
}

function getSettingsErrorMessage(err: unknown, fallback = ''): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const candidate = (err as { message?: unknown }).message;
    if (typeof candidate === 'string' && candidate) {
      return candidate;
    }
  }
  if (typeof err === 'string' && err) {
    return err;
  }
  return fallback;
}

function isPrintTokenKey(key: string): boolean {
  return key.startsWith('--print-');
}

function extractThemeOverrideRows(
  cfg: SettingsDraftConfig | null | undefined
): ThemeOverrideRow[] {
  const rawTokens: unknown = cfg?.themeTokens;
  if (!rawTokens) return [];
  try {
    const tokensObj =
      typeof rawTokens === 'string' ? JSON.parse(rawTokens) : rawTokens;
    if (!tokensObj || typeof tokensObj !== 'object' || Array.isArray(tokensObj)) {
      return [];
    }
    const sparseTokens = stripPresetDefaultTokens(
      tokensObj as Record<string, string>,
      cfg?.themePreset
    );
    return Object.entries(sparseTokens)
      .filter(([key]) => !isPrintTokenKey(key))
      .map(([key, val], idx) => ({
        id: `override-${idx}-${key}`,
        key,
        value: String(val ?? ''),
      }));
  } catch {
    return [];
  }
}

function validateThemeOverrideRow(row: ThemeOverrideRow): string {
  const trimmedKey = row.key.trim();
  const trimmedValue = row.value.trim();
  if (!trimmedKey && !trimmedValue) return '';
  if (!trimmedKey) {
    return 'Enter an override name starting with -- (for example, --btn-radius).';
  }
  if (!cssTokenKeyRegex.test(trimmedKey)) {
    return 'Override names must start with -- and use only letters, numbers, hyphens, or underscores (for example, --btn-radius).';
  }
  if (!isValidCssTokenValue(row.value)) {
    return 'Enter a clean style value without semicolons or brackets (for example, 0.5rem or #ffffff).';
  }
  return '';
}

function normalizeComparableConfigValue(config: SettingsDraftConfig, key: string): unknown {
  if (key === 'partner1Name' || key === 'brideName') {
    return config.partner1Name ?? config.brideName ?? '';
  }
  if (key === 'partner2Name' || key === 'groomName') {
    return config.partner2Name ?? config.groomName ?? '';
  }
  const val = config[key];
  return val === undefined || val === null ? '' : val;
}

function hasSettingsDraftChanges(
  currentConfig: SettingsDraftConfig | null,
  baseConfig: SettingsDraftConfig | null,
  currentRows: ThemeOverrideRow[],
  baseRows: ThemeOverrideRow[]
): boolean {
  if (!currentConfig || !baseConfig) return false;
  if (currentRows.length !== baseRows.length) return true;
  for (let i = 0; i < currentRows.length; i += 1) {
    if (
      currentRows[i].key !== baseRows[i].key ||
      currentRows[i].value !== baseRows[i].value
    ) {
      return true;
    }
  }
  if (currentConfig === baseConfig) return false;
  const keys = new Set([...Object.keys(baseConfig), ...Object.keys(currentConfig)]);
  for (const key of keys) {
    const currVal = normalizeComparableConfigValue(currentConfig, key);
    const baseVal = normalizeComparableConfigValue(baseConfig, key);
    if (JSON.stringify(currVal) !== JSON.stringify(baseVal)) {
      return true;
    }
  }
  return false;
}

export default function AdminSettingsPage() {
  const router = useRouter();
  const { addToast, confirm } = useToast();
  const [selectedProfileId, setSelectedProfileId] = useState<string>('global');

  const {
    config: initialConfig,
    loading,
    saving,
    error,
    saveSettings,
    profiles,
    loadingList,
    createProfile,
    creating,
    fetchAll,
  } = useAdminSettings(selectedProfileId);

  const { testConnection, testingConnection } = useAdminBroadcast();

  const [configOverride, setConfigOverride] = useState<{
    base: SettingsDraftConfig | null | undefined;
    value: SettingsDraftConfig | null;
  } | null>(null);
  const [overrideRowsState, setOverrideRowsState] = useState<{
    base: SettingsDraftConfig | null | undefined;
    rows: ThemeOverrideRow[];
  } | null>(null);
  const [savedBaselineState, setSavedBaselineState] = useState<{
    base: SettingsDraftConfig | null | undefined;
    config: SettingsDraftConfig | null;
    rows: ThemeOverrideRow[];
  } | null>(null);
  const [themeTokensError, setThemeTokensError] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newProfileData, setNewProfileData] = useState({ partner1Name: '', partner2Name: '', subdomain: '' });
  const [createError, setCreateError] = useState('');

  const localConfig: SettingsDraftConfig | null =
    configOverride && configOverride.base === initialConfig
      ? configOverride.value
      : ((initialConfig as SettingsDraftConfig | null | undefined) ?? null);
  const themeOverrideRows = useMemo(
    () =>
      overrideRowsState && overrideRowsState.base === initialConfig
        ? overrideRowsState.rows
        : extractThemeOverrideRows(initialConfig as SettingsDraftConfig | null | undefined),
    [overrideRowsState, initialConfig]
  );
  const baselineConfig: SettingsDraftConfig | null =
    savedBaselineState && savedBaselineState.base === initialConfig
      ? savedBaselineState.config
      : ((initialConfig as SettingsDraftConfig | null | undefined) ?? null);
  const baselineRows = useMemo(
    () =>
      savedBaselineState && savedBaselineState.base === initialConfig
        ? savedBaselineState.rows
        : extractThemeOverrideRows(initialConfig as SettingsDraftConfig | null | undefined),
    [savedBaselineState, initialConfig]
  );

  const isDirty = useMemo(
    () => hasSettingsDraftChanges(localConfig, baselineConfig, themeOverrideRows, baselineRows),
    [localConfig, baselineConfig, themeOverrideRows, baselineRows]
  );

  const isCreateProfileDirty = Boolean(
    newProfileData.partner1Name.trim() ||
      newProfileData.partner2Name.trim() ||
      newProfileData.subdomain.trim()
  );

  const closeCreateProfileDialog = useCallback(() => {
    setIsCreateOpen(false);
    setCreateError('');
    setNewProfileData({ partner1Name: '', partner2Name: '', subdomain: '' });
  }, []);

  const handleRequestCloseCreateProfile = useDirtyConfirmClose(
    isCreateProfileDirty,
    closeCreateProfileDialog
  );

  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const confirmDiscardChanges = useCallback(async () => {
    if (!isDirty) return true;
    if (typeof confirm === 'function') {
      return confirm('You have unsaved changes. Are you sure you want to discard them?');
    }
    return true;
  }, [isDirty, confirm]);

  const setLocalConfig = useCallback(
    (
      updater:
        | SettingsDraftConfig
        | null
        | ((prev: SettingsDraftConfig | null) => SettingsDraftConfig | null)
    ) => {
      setConfigOverride((prev) => {
        const current =
          prev && prev.base === initialConfig
            ? prev.value
            : ((initialConfig as SettingsDraftConfig | null | undefined) ?? null);
        const next = typeof updater === 'function' ? updater(current) : updater;
        return { base: initialConfig as SettingsDraftConfig | null | undefined, value: next };
      });
    },
    [initialConfig]
  );

  const syncThemeOverrideRows = useCallback((nextRows: ThemeOverrideRow[]) => {
    setOverrideRowsState({ base: initialConfig, rows: nextRows });

    const firstRowError = nextRows.map(validateThemeOverrideRow).find(Boolean) || '';
    const seenKeys = new Set<string>();
    let duplicateError = '';
    for (const row of nextRows) {
      const k = row.key.trim();
      if (!k) continue;
      if (seenKeys.has(k)) {
        duplicateError = `Duplicate override name "${k}". Each override name should appear once.`;
        break;
      }
      seenKeys.add(k);
    }

    const combinedError = firstRowError || duplicateError;
    setThemeTokensError(combinedError);

    if (!combinedError) {
      setLocalConfig((prev) => {
        const existingTokens = prev?.themeTokens && typeof prev.themeTokens === 'object' ? prev.themeTokens : {};
        const preservedPrintTokens: Record<string, string> = {};
        for (const [k, v] of Object.entries(existingTokens)) {
          if (isPrintTokenKey(k) && typeof v === 'string') {
            preservedPrintTokens[k] = v;
          }
        }
        const customTokens: Record<string, string> = { ...preservedPrintTokens };
        for (const row of nextRows) {
          const trimmedKey = row.key.trim();
          if (trimmedKey) {
            customTokens[trimmedKey] = row.value;
          }
        }
        return { ...(prev ?? {}), themeTokens: customTokens };
      });
    }
  }, [initialConfig, setLocalConfig]);

  const handleTestConnection = async (type: 'email' | 'sms') => {
    try {
      const res = (await testConnection({
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
      })) as { success?: boolean; error?: string };

      if (res.success) {
        addToast(`Successfully verified ${type.toUpperCase()} provider configuration!`, 'success');
      } else {
        addToast(`Connection test failed: ${res.error || 'Unknown error'}`, 'error');
      }
    } catch (err: unknown) {
      addToast(`Connection test failed: ${getSettingsErrorMessage(err, 'Unknown error')}`, 'error');
    }
  };

  const handleAddThemeOverride = () => {
    const newRow: ThemeOverrideRow = {
      id: `override-${Date.now()}-${themeOverrideRows.length}`,
      key: '',
      value: '',
    };
    syncThemeOverrideRows([...themeOverrideRows, newRow]);
  };

  const handleUpdateThemeOverride = (rowId: string, field: 'key' | 'value', val: string) => {
    const nextRows = themeOverrideRows.map((row) =>
      row.id === rowId ? { ...row, [field]: val } : row
    );
    syncThemeOverrideRows(nextRows);
  };

  const handleRemoveThemeOverride = (rowId: string) => {
    const nextRows = themeOverrideRows.filter((row) => row.id !== rowId);
    syncThemeOverrideRows(nextRows);
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!localConfig) return;
    if (themeTokensError) {
      addToast(themeTokensError, 'error');
      return;
    }
    try {
      const rawTokens =
        localConfig.themeTokens && typeof localConfig.themeTokens === 'object'
          ? localConfig.themeTokens
          : {};
      const payloadThemeTokens =
        Object.keys(rawTokens).length >= 25
          ? stripPresetDefaultTokens(rawTokens, localConfig.themePreset)
          : rawTokens;
      const payloadToSave = {
        ...localConfig,
        themeTokens: payloadThemeTokens,
      };
      const saved = (await saveSettings(payloadToSave)) as Partial<SettingsDraftConfig> | null;
      const nextSavedConfig: SettingsDraftConfig = {
        ...localConfig,
        ...(saved && typeof saved === 'object' ? saved : {}),
        weddingDate:
          saved && typeof saved === 'object' && saved.weddingDate
            ? String(saved.weddingDate).split('T')[0]
            : localConfig?.weddingDate,
        smtpPass: '',
        resendApiKey: '',
        sendgridApiKey: '',
        twilioAuthToken: '',
      };
      setLocalConfig(nextSavedConfig);
      setSavedBaselineState({
        base: initialConfig as SettingsDraftConfig | null | undefined,
        config: nextSavedConfig,
        rows: themeOverrideRows,
      });
      addToast('Branding profile saved successfully.', 'success');
    } catch (err: unknown) {
      addToast(getSettingsErrorMessage(err, 'Failed to save profile'), 'error');
    }
  };

  const handleCreateProfile = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCreateError('');
    try {
      const created = (await createProfile(newProfileData)) as { id?: string } | null;
      addToast('Staging profile created successfully!', 'success');
      setIsCreateOpen(false);
      setNewProfileData({ partner1Name: '', partner2Name: '', subdomain: '' });
      if (created && created.id) {
        setConfigOverride(null);
        setOverrideRowsState(null);
        setSavedBaselineState(null);
        setSelectedProfileId(created.id);
        setLocalConfig(null);
      }
    } catch (err: unknown) {
      setCreateError(
        getSettingsErrorMessage(err, 'Failed to create profile. Ensure subdomain is unique.')
      );
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
      setLocalConfig((prev) => ({ ...(prev ?? {}), [fieldName]: url }));
      addToast(`${fieldName} uploaded successfully.`, 'success');
    } catch (err: unknown) {
      addToast(`Upload failed: ${getSettingsErrorMessage(err, 'Unknown error')}`, 'error');
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setLocalConfig((prev) => {
      const next: SettingsDraftConfig = { ...(prev ?? {}), [name]: value };
      if (name === 'partner1Name') {
        next.brideName = value;
      } else if (name === 'partner2Name') {
        next.groomName = value;
      }
      return next;
    });
  };

  const handleBackToDashboard = async () => {
    if (!(await confirmDiscardChanges())) return;
    router.push('/admin/dashboard');
  };

  const handleProfileSwitch = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextProfileId = e.target.value;
    if (nextProfileId === selectedProfileId) return;
    if (!(await confirmDiscardChanges())) return;
    setConfigOverride(null);
    setOverrideRowsState(null);
    setSavedBaselineState(null);
    setSelectedProfileId(nextProfileId);
    setLocalConfig(null);
  };

  const isMultisite = Boolean(localConfig?.multisiteEnabled);

  return (
    <AdminViewState
      isLoading={loading || loadingList}
      error={error || (!(loading || loadingList) && !localConfig ? 'Failed to load settings.' : null)}
      onRetry={fetchAll}
      loadingMessage="Loading settings..."
    >
      {localConfig && (
        <AdminPreviewLayout
          previewUrl="/"
          draftType="config"
          draftData={{
            ...localConfig,
            smtpPass: undefined,
            resendApiKey: undefined,
            sendgridApiKey: undefined,
            twilioAuthToken: undefined,
            shippingRecipientName: undefined,
            shippingAddressLine1: undefined,
            shippingAddressLine2: undefined,
            shippingCity: undefined,
            shippingState: undefined,
            shippingZip: undefined,
            shippingCountry: undefined,
            shippingPhone: undefined,
            shippingDeliveryNotes: undefined,
            weddingDate: localConfig.weddingDate ? new Date(localConfig.weddingDate).toISOString() : new Date().toISOString()
          }}
          entityId={selectedProfileId}
          onRestore={() => {
            setConfigOverride(null);
            setOverrideRowsState(null);
            setSavedBaselineState(null);
            fetchAll();
          }}
        >
          <div className="mx-auto max-w-4xl p-6">
            <div className="flex justify-between items-center mb-8">
              <h1 className="text-3xl font-bold">Site Settings</h1>
              <Button variant="ghost" onClick={() => void handleBackToDashboard()}>Back to Dashboard</Button>
            </div>

            {/* Profile Switcher & Creator Section (Visible when MULTISITE_ENABLED=true) */}
            {isMultisite && (
              <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 border border-gray-100 dark:border-zinc-700">
                <div className="space-y-1">
                  <h2 className="text-lg font-medium text-gray-900 dark:text-zinc-100">Branding & Staging Profiles</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Manage parallel configuration profiles or test changes on staging subdomains.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <FormGroup className="space-y-0">
                    <Label htmlFor="brandingProfileSelect" className="sr-only">
                      Active Branding Profile
                    </Label>
                    <Select
                      id="brandingProfileSelect"
                      value={selectedProfileId}
                      onChange={(e) => void handleProfileSwitch(e)}
                      className="w-auto"
                    >
                      {Array.isArray(profiles) ? (
                        (profiles as SettingsBrandingProfile[]).map((p) => {
                          const isCurrent = p.id === selectedProfileId;
                          const p1 = (isCurrent ? (localConfig?.partner1Name || localConfig?.brideName) : (p.partner1Name || p.brideName)) || p.partner1Name || p.brideName || 'Partner 1';
                          const p2 = (isCurrent ? (localConfig?.partner2Name || localConfig?.groomName) : (p.partner2Name || p.groomName)) || p.partner2Name || p.groomName || 'Partner 2';
                          return (
                            <option key={p.id} value={p.id}>
                              {p.id === 'global' ? 'Production (Default)' : `${p1} & ${p2} (subdomain: ${p.subdomain})`}
                            </option>
                          );
                        })
                      ) : (
                        <option value="global">Production (Default)</option>
                      )}
                    </Select>
                  </FormGroup>
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
                    <Input required type="text" name="partner1Name" value={localConfig.partner1Name ?? localConfig.brideName ?? ''} onChange={handleChange} />
                  </FormGroup>
                  <FormGroup>
                    <Label>Partner 2 Name</Label>
                    <Input required type="text" name="partner2Name" value={localConfig.partner2Name ?? localConfig.groomName ?? ''} onChange={handleChange} />
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
                  <FormGroup>
                    <Label>External Photo Album URL</Label>
                    <Input type="url" name="photoAlbumUrl" value={localConfig.photoAlbumUrl || ''} onChange={handleChange} placeholder="https://photos.example.com/shared-album (optional)" />
                    <FormMessage>Optional external shared photo album link displayed on the public gallery page. Leave blank to hide.</FormMessage>
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
                          setLocalConfig((prev) => ({ ...(prev ?? {}), subdomain: sanitized }));
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
                <AddressLookupInput
                  id="settings-venue-lookup"
                  label="Search Address"
                  placeholder="Search venue name or street address..."
                  helperText="Select a verified location to fill street address, postal code, and map coordinates automatically."
                  verifiedCoordinates={{
                    latitude:
                      typeof localConfig.latitude === 'number'
                        ? localConfig.latitude
                        : localConfig.latitude !== undefined && localConfig.latitude !== ''
                          ? Number(localConfig.latitude)
                          : undefined,
                    longitude:
                      typeof localConfig.longitude === 'number'
                        ? localConfig.longitude
                        : localConfig.longitude !== undefined && localConfig.longitude !== ''
                          ? Number(localConfig.longitude)
                          : undefined,
                  }}
                  onSelect={(match) => {
                    setLocalConfig((prev) => ({
                      ...(prev ?? {}),
                      venueName:
                        !isNonPlaceholderVenueText(prev?.venueName) && match.name
                          ? match.name
                          : prev?.venueName || match.name,
                      venueAddress:
                        match.streetAddress || match.displayName || prev?.venueAddress || '',
                      venueCity: match.city || prev?.venueCity || '',
                      venueState: match.state || prev?.venueState || '',
                      venueZip: match.zip || prev?.venueZip || '',
                      latitude: match.latitude,
                      longitude: match.longitude,
                    }));
                  }}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormGroup>
                    <Label>Venue Name</Label>
                    <Input type="text" name="venueName" value={localConfig.venueName || ''} onChange={handleChange} />
                  </FormGroup>
                  <FormGroup>
                    <Label>Address</Label>
                    <Input type="text" name="venueAddress" value={localConfig.venueAddress || ''} onChange={handleChange} />
                  </FormGroup>
                  <FormGroup>
                    <Label>City</Label>
                    <Input type="text" name="venueCity" value={localConfig.venueCity || ''} onChange={handleChange} />
                  </FormGroup>
                  <FormGroup>
                    <Label>State</Label>
                    <Input type="text" name="venueState" value={localConfig.venueState || ''} onChange={handleChange} />
                  </FormGroup>
                  <FormGroup>
                    <Label>Zip Code</Label>
                    <Input type="text" name="venueZip" value={localConfig.venueZip || ''} onChange={handleChange} />
                  </FormGroup>
                  <FormGroup>
                    <Label>Venue Timezone</Label>
                    <SearchableTimezoneSelect
                      value={localConfig.timezone || ''}
                      onChange={(val) => setLocalConfig((prev) => ({ ...(prev ?? {}), timezone: val }))}
                    />
                  </FormGroup>
                </div>
                <details className="mt-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/40 p-3">
                  <summary className="cursor-pointer select-none font-medium text-sm text-gray-700 dark:text-gray-200 min-h-11 flex items-center justify-between gap-2">
                    <span>Manual Coordinates (Optional)</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Override decimal latitude &amp; longitude
                    </span>
                  </summary>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3">
                    <FormGroup>
                      <Label>Latitude</Label>
                      <Input type="number" step="any" name="latitude" value={localConfig.latitude ?? 0} onChange={handleChange} />
                    </FormGroup>
                    <FormGroup>
                      <Label>Longitude</Label>
                      <Input type="number" step="any" name="longitude" value={localConfig.longitude ?? 0} onChange={handleChange} />
                    </FormGroup>
                  </div>
                </details>
              </section>

              <section
                aria-labelledby="registry-shipping-settings-heading"
                className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4"
              >
                <div>
                  <h2 id="registry-shipping-settings-heading" className="text-xl font-semibold">
                    Registry Shipping &amp; Payment Defaults
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Share a private delivery address with authenticated guests on external store gifts and set a site-wide fallback peer-to-peer payment handle for cash funds and group gifts.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormGroup>
                    <Label htmlFor="shipping-recipient-name">Shipping Recipient Name</Label>
                    <Input
                      id="shipping-recipient-name"
                      type="text"
                      name="shippingRecipientName"
                      maxLength={255}
                      value={localConfig.shippingRecipientName || ''}
                      onChange={handleChange}
                      placeholder="e.g. Alex & Jordan Rivera"
                    />
                  </FormGroup>

                  <FormGroup>
                    <Label htmlFor="shipping-phone">Delivery Phone Number</Label>
                    <Input
                      id="shipping-phone"
                      type="tel"
                      name="shippingPhone"
                      maxLength={50}
                      value={localConfig.shippingPhone || ''}
                      onChange={handleChange}
                      placeholder="e.g. (555) 234-5678"
                    />
                    <FormMessage>
                      Optional carrier contact phone shown only to authenticated guests and admins.
                    </FormMessage>
                  </FormGroup>

                  <FormGroup>
                    <Label htmlFor="shipping-address-line1">Shipping Street Address</Label>
                    <Input
                      id="shipping-address-line1"
                      type="text"
                      name="shippingAddressLine1"
                      maxLength={255}
                      value={localConfig.shippingAddressLine1 || ''}
                      onChange={handleChange}
                      placeholder="e.g. 742 Evergreen Terrace"
                    />
                  </FormGroup>

                  <FormGroup>
                    <Label htmlFor="shipping-address-line2">Apartment, Suite, or Unit</Label>
                    <Input
                      id="shipping-address-line2"
                      type="text"
                      name="shippingAddressLine2"
                      maxLength={255}
                      value={localConfig.shippingAddressLine2 || ''}
                      onChange={handleChange}
                      placeholder="e.g. Apt 4B (optional)"
                    />
                  </FormGroup>

                  <FormGroup>
                    <Label htmlFor="shipping-city">Shipping City</Label>
                    <Input
                      id="shipping-city"
                      type="text"
                      name="shippingCity"
                      maxLength={120}
                      value={localConfig.shippingCity || ''}
                      onChange={handleChange}
                      placeholder="e.g. Portland"
                    />
                  </FormGroup>

                  <FormGroup>
                    <Label htmlFor="shipping-state">Shipping State / Province</Label>
                    <Input
                      id="shipping-state"
                      type="text"
                      name="shippingState"
                      maxLength={120}
                      value={localConfig.shippingState || ''}
                      onChange={handleChange}
                      placeholder="e.g. OR"
                    />
                  </FormGroup>

                  <FormGroup>
                    <Label htmlFor="shipping-zip">Shipping Postal / Zip Code</Label>
                    <Input
                      id="shipping-zip"
                      type="text"
                      name="shippingZip"
                      maxLength={40}
                      value={localConfig.shippingZip || ''}
                      onChange={handleChange}
                      placeholder="e.g. 97205"
                    />
                  </FormGroup>

                  <FormGroup>
                    <Label htmlFor="shipping-country">Shipping Country</Label>
                    <Input
                      id="shipping-country"
                      type="text"
                      name="shippingCountry"
                      maxLength={120}
                      value={localConfig.shippingCountry || ''}
                      onChange={handleChange}
                      placeholder="e.g. United States"
                    />
                  </FormGroup>
                </div>

                <FormGroup>
                  <Label htmlFor="shipping-delivery-notes">Delivery Notes &amp; Gate Instructions</Label>
                  <Textarea
                    id="shipping-delivery-notes"
                    name="shippingDeliveryNotes"
                    rows={2}
                    maxLength={500}
                    value={localConfig.shippingDeliveryNotes || ''}
                    onChange={handleChange}
                    placeholder="e.g. Leave packages on covered front porch; gate code #1234"
                  />
                  <FormMessage>
                    Included when authenticated guests view or copy your shipping address on external registry items.
                  </FormMessage>
                </FormGroup>

                <div className="pt-4 border-t border-gray-200 dark:border-gray-700 space-y-3">
                  <div>
                    <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      Default Peer-to-Peer Payment Handle
                    </h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Used automatically for cash funds and physical group gifts that do not define a custom item-level handle.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <FormGroup>
                      <Label htmlFor="default-payment-handle-type">Default Payment Service</Label>
                      <Select
                        id="default-payment-handle-type"
                        name="defaultPaymentHandleType"
                        value={localConfig.defaultPaymentHandleType || ''}
                        onChange={handleChange}
                      >
                        <option value="">None</option>
                        <option value="Venmo">Venmo</option>
                        <option value="PayPal">PayPal</option>
                        <option value="Cash App">Cash App</option>
                        <option value="Zelle">Zelle</option>
                        <option value="Custom">Custom Link</option>
                      </Select>
                    </FormGroup>

                    <FormGroup>
                      <Label htmlFor="default-payment-handle">Default Payment Handle / Link</Label>
                      <Input
                        id="default-payment-handle"
                        type="text"
                        name="defaultPaymentHandle"
                        maxLength={255}
                        value={localConfig.defaultPaymentHandle || ''}
                        onChange={handleChange}
                        placeholder="e.g. @couple-venmo or https://paypal.me/couple"
                      />
                    </FormGroup>
                  </div>
                </div>
              </section>

              <section
                aria-labelledby="rsvp-access-control-heading"
                className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4"
              >
                <div>
                  <h2 id="rsvp-access-control-heading" className="text-xl font-semibold">
                    RSVP Deadline &amp; Access Control
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Configure a global midnight RSVP cutoff in your venue timezone, an optional silent grace window, or manually lock online RSVP edits while keeping all saved guest responses.
                  </p>
                </div>

                <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/40 flex items-start justify-between gap-4">
                  <div>
                    <label
                      htmlFor="rsvp-open-toggle"
                      className="font-semibold text-gray-900 dark:text-gray-100 cursor-pointer"
                    >
                      Accept Online RSVPs
                    </label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Turn off to freeze online RSVP submissions and edits immediately while keeping all stored guest responses intact.
                    </p>
                  </div>
                  <input
                    id="rsvp-open-toggle"
                    name="rsvpOpen"
                    type="checkbox"
                    checked={localConfig.rsvpOpen !== false}
                    onChange={(e) =>
                      setLocalConfig((prev) => ({
                        ...(prev ?? {}),
                        rsvpOpen: e.target.checked,
                      }))
                    }
                    className="h-5 w-5 rounded border-gray-300 text-rose-600 focus:ring-rose-500 cursor-pointer mt-1"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormGroup>
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="rsvp-deadline-date" className="mb-0">
                        Global RSVP Cutoff Date
                      </Label>
                      {localConfig.rsvpDeadlineDate && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            setLocalConfig((prev) => ({
                              ...(prev ?? {}),
                              rsvpDeadlineDate: '',
                            }))
                          }
                        >
                          Clear Cutoff Date
                        </Button>
                      )}
                    </div>
                    <Input
                      id="rsvp-deadline-date"
                      type="date"
                      name="rsvpDeadlineDate"
                      value={localConfig.rsvpDeadlineDate || ''}
                      onChange={handleChange}
                    />
                    <FormMessage>
                      Closes online RSVPs at midnight at the end of this date in {localConfig.timezone || 'UTC'}. Leave blank for no automatic deadline.
                    </FormMessage>
                  </FormGroup>

                  <FormGroup>
                    <Label htmlFor="rsvp-grace-period-hours">Silent Grace Period</Label>
                    <Select
                      id="rsvp-grace-period-hours"
                      name="rsvpGracePeriodHours"
                      value={String(localConfig.rsvpGracePeriodHours ?? 0)}
                      onChange={(e) =>
                        setLocalConfig((prev) => ({
                          ...(prev ?? {}),
                          rsvpGracePeriodHours: Number(e.target.value),
                        }))
                      }
                    >
                      {RSVP_GRACE_PERIOD_HOURS_OPTIONS.map((hours) => {
                        const label =
                          hours === 0
                            ? '0 hours (close immediately at midnight)'
                            : hours === 24
                              ? '24 hours (1 day)'
                              : hours === 48
                                ? '48 hours (2 days)'
                                : hours === 72
                                  ? '72 hours (3 days)'
                                  : hours === 168
                                    ? '168 hours (7 days)'
                                    : `${hours} hours`;
                        return (
                          <option key={hours} value={String(hours)}>
                            {label}
                          </option>
                        );
                      })}
                    </Select>
                    <FormMessage>
                      Silently accepts late responses after the published cutoff date without revealing the grace window to guests.
                    </FormMessage>
                  </FormGroup>
                </div>

                <FormGroup>
                  <Label htmlFor="rsvp-closed-message">RSVP Closed Message</Label>
                  <Textarea
                    id="rsvp-closed-message"
                    name="rsvpClosedMessage"
                    rows={3}
                    maxLength={500}
                    value={localConfig.rsvpClosedMessage || ''}
                    onChange={handleChange}
                    placeholder={DEFAULT_RSVP_CLOSED_MESSAGE}
                  />
                  <FormMessage>
                    Shown to guests once RSVPs close so late guests know how to reach the hosts for urgent changes.
                  </FormMessage>
                </FormGroup>
              </section>

              <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
                <h2 className="text-xl font-semibold mb-4">Narrative Content</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormGroup>
                    <Label>Hero Title</Label>
                    <Input type="text" name="heroTitle" value={localConfig.heroTitle || ''} onChange={handleChange} />
                  </FormGroup>
                  <FormGroup>
                    <Label>Hero Subtitle</Label>
                    <Input type="text" name="heroSubtitle" value={localConfig.heroSubtitle || ''} onChange={handleChange} />
                  </FormGroup>
                </div>
                <FormGroup>
                  <Label>Our Story</Label>
                  <Textarea name="storyText" value={localConfig.storyText || ''} onChange={handleChange} rows={6} />
                </FormGroup>
                <FormGroup>
                  <Label>Venue Description</Label>
                  <Textarea name="venueDescription" value={localConfig.venueDescription || ''} onChange={handleChange} rows={4} />
                </FormGroup>
                <FormGroup>
                  <Label>Travel Advice</Label>
                  <Textarea name="travelAdvice" value={localConfig.travelAdvice || ''} onChange={handleChange} rows={4} />
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
                    themeTokens: localConfig.themeTokens,
                    printBg: localConfig.printBg || localConfig.themeTokens?.['--print-bg'],
                    printText: localConfig.printText || localConfig.themeTokens?.['--print-text'],
                    printBorder: localConfig.printBorder || localConfig.themeTokens?.['--print-border'],
                    printHeaderBorder: localConfig.printHeaderBorder || localConfig.themeTokens?.['--print-header-border'],
                    printBadgeBg: localConfig.printBadgeBg || localConfig.themeTokens?.['--print-badge-bg'],
                  }}
                  onChange={(updated) => {
                    const prevPreset = localConfig?.themePreset || 'classic';
                    const nextPreset = (updated.themePreset as string | undefined) || prevPreset;
                    const isPresetSwitch = Boolean(
                      updated.themePreset && updated.themePreset !== prevPreset
                    );

                    if (isPresetSwitch) {
                      const filteredRows = themeOverrideRows.filter((row) => {
                        const k = row.key.trim();
                        if (!k) return true;
                        const cleaned = stripPresetDefaultTokens(
                          { [k]: row.value },
                          nextPreset,
                          prevPreset
                        );
                        return Object.prototype.hasOwnProperty.call(cleaned, k);
                      });
                      setOverrideRowsState({
                        base: initialConfig as SettingsDraftConfig | null | undefined,
                        rows: filteredRows,
                      });
                    }

                    setLocalConfig((prev) => {
                      const activePrevPreset = prev?.themePreset || 'classic';
                      const activeNextPreset =
                        (updated.themePreset as string | undefined) || activePrevPreset;
                      let nextThemeTokens: Record<string, string>;

                      if (updated.themePreset && updated.themePreset !== activePrevPreset) {
                        nextThemeTokens = stripPresetDefaultTokens(
                          updated.themeTokens ?? prev?.themeTokens,
                          activeNextPreset,
                          activePrevPreset
                        );
                      } else if (updated.themeTokens !== undefined) {
                        const customNonPrint: Record<string, string> = {};
                        for (const [k, v] of Object.entries(prev?.themeTokens || {})) {
                          if (!isPrintTokenKey(k) && typeof v === 'string') {
                            customNonPrint[k] = v;
                          }
                        }
                        nextThemeTokens = {
                          ...customNonPrint,
                          ...updated.themeTokens,
                        };
                      } else {
                        nextThemeTokens = prev?.themeTokens || {};
                      }

                      return {
                        ...(prev ?? {}),
                        ...updated,
                        themeTokens: nextThemeTokens,
                      };
                    });
                  }}
                />
                <div className="space-y-3 pt-4 border-t border-gray-200 dark:border-zinc-700" role="group" aria-labelledby="custom-theme-overrides-heading">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 id="custom-theme-overrides-heading" className="text-md font-semibold text-gray-900 dark:text-zinc-100">
                        Custom Theme Overrides
                      </h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Fine-tune individual theme style values by adding named overrides (for example, --btn-radius set to 0.5rem).
                      </p>
                    </div>
                    <Button type="button" variant="secondary" size="sm" onClick={handleAddThemeOverride}>
                      + Add Theme Override
                    </Button>
                  </div>

                  {themeOverrideRows.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                      No custom theme overrides added. Using your selected preset and controls above.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {themeOverrideRows.map((row, idx) => {
                        const rowError = validateThemeOverrideRow(row);
                        const keyInputId = `theme-override-key-${idx}`;
                        const valueInputId = `theme-override-value-${idx}`;
                        const rowErrorId = `theme-override-error-${idx}`;
                        return (
                          <div key={row.id} className="rounded-md border border-gray-200 dark:border-zinc-700 p-3 space-y-2 bg-gray-50/50 dark:bg-zinc-900/40">
                            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                              <FormGroup state={rowError ? 'error' : 'default'}>
                                <Label htmlFor={keyInputId}>Override Name</Label>
                                <Input
                                  id={keyInputId}
                                  type="text"
                                  value={row.key}
                                  onChange={(e) => handleUpdateThemeOverride(row.id, 'key', e.target.value)}
                                  placeholder="e.g. --btn-radius"
                                  aria-invalid={Boolean(rowError)}
                                  aria-describedby={rowError ? rowErrorId : undefined}
                                />
                              </FormGroup>
                              <FormGroup state={rowError ? 'error' : 'default'}>
                                <Label htmlFor={valueInputId}>Override Value</Label>
                                <Input
                                  id={valueInputId}
                                  type="text"
                                  value={row.value}
                                  onChange={(e) => handleUpdateThemeOverride(row.id, 'value', e.target.value)}
                                  placeholder="e.g. 0.5rem or #ffffff"
                                  aria-invalid={Boolean(rowError)}
                                  aria-describedby={rowError ? rowErrorId : undefined}
                                />
                              </FormGroup>
                              <Button
                                type="button"
                                variant="danger"
                                size="sm"
                                onClick={() => handleRemoveThemeOverride(row.id)}
                                aria-label={`Remove theme override ${row.key || idx + 1}`}
                              >
                                Remove
                              </Button>
                            </div>
                            {rowError && (
                              <p id={rowErrorId} className="text-xs text-red-600 dark:text-red-400">
                                {rowError}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {themeTokensError && (
                    <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                      {themeTokensError}
                    </p>
                  )}
                </div>
              </section>

              <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
                <h2 className="text-xl font-semibold mb-2">Feature & Module Management</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Enable or disable optional site capabilities. Disabling a feature removes its navigation links, protects page routes, disables backend API endpoints, and handles dependencies automatically.
                </p>

                <div
                  role="note"
                  aria-label="Guest login passcode configuration"
                  className="p-4 rounded-lg border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/30 text-sm text-blue-900 dark:text-blue-200"
                >
                  <p className="font-semibold">Guest Login Passcode</p>
                  <p className="text-xs text-blue-800 dark:text-blue-300 mt-1">
                    Site-wide guest login gatekeeping is controlled via environment configuration (<code className="font-mono">GUEST_PASSCODE</code> and <code className="font-mono">GUEST_SESSION_SECRET</code>) enforced in Edge middleware rather than a database toggle. Update your deployment environment variables to enable, rotate, or disable the guest passcode gate.
                  </p>
                </div>

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
                                setLocalConfig((prev) => ({
                                  ...(prev ?? {}),
                                  showCountdown: newChecked,
                                  modules: updatedModules,
                                }));
                              } else if (featureId === 'addToCalendar') {
                                setLocalConfig((prev) => ({
                                  ...(prev ?? {}),
                                  showAddToCalendar: newChecked,
                                  modules: updatedModules,
                                }));
                              } else {
                                setLocalConfig((prev) => ({
                                  ...(prev ?? {}),
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
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href="/admin/dashboard/history?tab=broadcasts"
                      prefetch={false}
                      onClick={(e) => {
                        if (!isDirty) return;
                        e.preventDefault();
                        void confirmDiscardChanges().then((ok) => {
                          if (ok) {
                            router.push('/admin/dashboard/history?tab=broadcasts');
                          }
                        });
                      }}
                      className="inline-flex items-center justify-center h-8 px-3 text-xs font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 bg-[var(--btn-secondary-bg,var(--color-secondary,#B45309))] text-[var(--btn-secondary-text,#ffffff)] hover:bg-[var(--btn-secondary-hover-bg,var(--color-secondary,#B45309))] border border-[var(--btn-secondary-border,transparent)]"
                    >
                      Broadcast Delivery Logs
                    </Link>
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
                        <Label htmlFor="smtpPass">
                          SMTP Password
                          {localConfig.hasSmtpPass && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                              Configured
                            </span>
                          )}
                        </Label>
                        <Input
                          id="smtpPass"
                          type="password"
                          name="smtpPass"
                          autoComplete="new-password"
                          value={localConfig.smtpPass || ''}
                          onChange={handleChange}
                          placeholder={localConfig.hasSmtpPass ? 'Leave blank to keep saved password' : 'Enter SMTP password'}
                        />
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
                        <Label htmlFor="resendApiKey">
                          Resend API Key
                          {localConfig.hasResendApiKey && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                              Configured
                            </span>
                          )}
                        </Label>
                        <Input
                          id="resendApiKey"
                          type="password"
                          name="resendApiKey"
                          autoComplete="new-password"
                          value={localConfig.resendApiKey || ''}
                          onChange={handleChange}
                          placeholder={localConfig.hasResendApiKey ? 'Leave blank to keep saved API key' : 're_123456789...'}
                        />
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
                        <Label htmlFor="sendgridApiKey">
                          SendGrid API Key
                          {localConfig.hasSendgridApiKey && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                              Configured
                            </span>
                          )}
                        </Label>
                        <Input
                          id="sendgridApiKey"
                          type="password"
                          name="sendgridApiKey"
                          autoComplete="new-password"
                          value={localConfig.sendgridApiKey || ''}
                          onChange={handleChange}
                          placeholder={localConfig.hasSendgridApiKey ? 'Leave blank to keep saved API key' : 'SG.123456789...'}
                        />
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
                        <Label htmlFor="twilioAuthToken">
                          Auth Token
                          {localConfig.hasTwilioAuthToken && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 dark:bg-emerald-900/50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                              Configured
                            </span>
                          )}
                        </Label>
                        <Input
                          id="twilioAuthToken"
                          type="password"
                          name="twilioAuthToken"
                          autoComplete="new-password"
                          value={localConfig.twilioAuthToken || ''}
                          onChange={handleChange}
                          placeholder={localConfig.hasTwilioAuthToken ? 'Leave blank to keep saved auth token' : 'Enter auth token'}
                        />
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
                <div className="space-y-2">
                  <FormGroup>
                    <Label>Brand Logo Image (Header Navigation)</Label>
                    <Input
                      type="text"
                      name="brandLogoUrl"
                      value={localConfig.brandLogoUrl || ''}
                      onChange={handleChange}
                      placeholder="https://... or /images/logo.png"
                    />
                  </FormGroup>
                  <FormGroup>
                    <Label>Upload Brand Logo File</Label>
                    <div className="flex items-center gap-4">
                      <Input
                        type="file"
                        accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
                        onChange={(e) => handleUpload(e, 'brandLogoUrl')}
                        className="file:pt-1"
                      />
                      {localConfig.brandLogoUrl && (
                        <div className="flex items-center gap-2">
                          <MediaImage
                            src={localConfig.brandLogoUrl}
                            alt={localConfig.brandLogoAlt || 'Brand logo preview'}
                            className="h-10 max-h-12 w-auto object-contain bg-gray-100 dark:bg-gray-700 rounded p-1"
                          />
                          <span className="text-xs text-gray-500 dark:text-gray-400 break-all">{localConfig.brandLogoUrl}</span>
                        </div>
                      )}
                    </div>
                  </FormGroup>
                </div>

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
                  <div className="space-y-2">
                    <FormGroup>
                      <Label>Hero Visual Background Image</Label>
                      <Input
                        type="text"
                        name="heroImageUrl"
                        value={localConfig.heroImageUrl || ''}
                        onChange={handleChange}
                        placeholder="https://... or /images/hero.jpg"
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label>Upload Hero Background File</Label>
                      <div className="flex items-center gap-4">
                        <Input
                          type="file"
                          accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
                          onChange={(e) => handleUpload(e, 'heroImageUrl')}
                          className="file:pt-1"
                        />
                        {localConfig.heroImageUrl && (
                          <div className="flex items-center gap-2">
                            <MediaImage
                              src={localConfig.heroImageUrl}
                              alt={localConfig.heroImageAlt || 'Hero visual preview'}
                              className="h-12 w-20 object-cover bg-gray-100 dark:bg-gray-700 rounded p-1"
                            />
                            <span className="text-xs text-gray-500 dark:text-gray-400 break-all">{localConfig.heroImageUrl}</span>
                          </div>
                        )}
                      </div>
                    </FormGroup>
                  </div>
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
                  <div className="space-y-2">
                    <FormGroup>
                      <Label>Brand Watermark Graphic</Label>
                      <Input
                        type="text"
                        name="brandWatermarkUrl"
                        value={localConfig.brandWatermarkUrl || ''}
                        onChange={handleChange}
                        placeholder="https://... or /images/watermark.png"
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label>Upload Brand Watermark File</Label>
                      <div className="flex items-center gap-4">
                        <Input
                          type="file"
                          accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
                          onChange={(e) => handleUpload(e, 'brandWatermarkUrl')}
                          className="file:pt-1"
                        />
                        {localConfig.brandWatermarkUrl && (
                          <div className="flex items-center gap-2">
                            <MediaImage
                              src={localConfig.brandWatermarkUrl}
                              alt={localConfig.brandWatermarkAlt || 'Brand watermark preview'}
                              className="h-10 max-h-12 w-auto object-contain bg-gray-100 dark:bg-gray-700 rounded p-1"
                            />
                            <span className="text-xs text-gray-500 dark:text-gray-400 break-all">{localConfig.brandWatermarkUrl}</span>
                          </div>
                        )}
                      </div>
                    </FormGroup>
                  </div>
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
                  <div className="space-y-2">
                    <FormGroup>
                      <Label>Badge Graphic Image</Label>
                      <Input
                        type="text"
                        name="badgeGraphicUrl"
                        value={localConfig.badgeGraphicUrl || ''}
                        onChange={handleChange}
                        placeholder="https://... or /images/badge.png"
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label>Upload Badge Graphic File</Label>
                      <div className="flex items-center gap-4">
                        <Input
                          type="file"
                          accept=".svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp"
                          onChange={(e) => handleUpload(e, 'badgeGraphicUrl')}
                          className="file:pt-1"
                        />
                        {localConfig.badgeGraphicUrl && (
                          <div className="flex items-center gap-2">
                            <MediaImage
                              src={localConfig.badgeGraphicUrl}
                              alt={localConfig.badgeGraphicAlt || 'Badge graphic preview'}
                              className="h-10 max-h-12 w-auto object-contain bg-gray-100 dark:bg-gray-700 rounded p-1"
                            />
                            <span className="text-xs text-gray-500 dark:text-gray-400 break-all">{localConfig.badgeGraphicUrl}</span>
                          </div>
                        )}
                      </div>
                    </FormGroup>
                  </div>
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
                  <FormMessage>Comma-separated keywords. Insert placeholders like {'{{partner1Name}}'}, {'{{partner2Name}}'}, {'{{venueName}}'}, {'{{venueCity}}'}, or {'{{venueState}}'}.</FormMessage>
                </FormGroup>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                  <FormGroup>
                    <Label>Favicon (.ico, .png)</Label>
                    <div className="flex flex-col space-y-2">
                      <Input type="file" accept=".ico,.png,image/png,image/x-icon" onChange={(e) => handleUpload(e, 'faviconUrl')} className="file:pt-1" />
                      {localConfig.faviconUrl && (
                        <div className="flex items-center gap-2">
                          <MediaImage src={localConfig.faviconUrl} alt="Favicon preview" className="w-8 h-8 object-contain bg-gray-100 dark:bg-gray-700 rounded" />
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
                          <MediaImage src={localConfig.ogImageUrl} alt="OG Image preview" className="w-32 h-auto object-contain bg-gray-100 dark:bg-gray-700 rounded" />
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
            onClose={closeCreateProfileDialog}
            isDirty={isCreateProfileDirty}
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
                <Button type="button" variant="ghost" onClick={handleRequestCloseCreateProfile}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={creating}>
                  {creating ? 'Creating...' : 'Create Profile'}
                </Button>
              </div>
            </form>
          </Dialog>
        </AdminPreviewLayout>
      )}
    </AdminViewState>
  );
}
