'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';

import { apiClient } from '@/features/admin';
import { useAdminSettings } from '@/hooks/admin/useAdminSettings';
import { Dialog } from '@/components/ui/Dialog';

import AdminPreviewLayout from '@/components/admin/AdminPreviewLayout';
import { FormGroup, Label, Input, Textarea, FormMessage } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';
import { MAX_UPLOAD_SIZE, ACCEPTED_IMAGE_TYPES } from '@/utils/validation';

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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      setSearch(value);
    }
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
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
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <Input
        type="text"
        placeholder="Search and select timezone (e.g. Europe/Paris)..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        className="w-full"
      />
      {isOpen && (
        <div className="absolute left-0 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg z-50">
          {filtered.length > 0 ? (
            filtered.map((tz) => (
              <button
                key={tz}
                type="button"
                onClick={() => handleSelect(tz)}
                className="block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-zinc-200 hover:bg-gray-100 dark:hover:bg-zinc-700 focus:outline-none focus:bg-gray-100 dark:focus:bg-zinc-700"
              >
                {tz}
              </button>
            ))
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

  const [localConfig, setLocalConfig] = useState<any>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newProfileData, setNewProfileData] = useState({ brideName: '', groomName: '', subdomain: '' });
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    if (initialConfig) {
      setLocalConfig(initialConfig);
    }
  }, [initialConfig]);

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
      setNewProfileData({ brideName: '', groomName: '', subdomain: '' });
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setLocalConfig((prev: any) => ({ ...prev, [name]: value }));
  };

  if (loading || loadingList) return <div className="p-8 text-center">Loading settings...</div>;

  if (!localConfig) return <div className="p-8 text-center text-red-500">Failed to load settings.</div>;

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

        {/* Profile Switcher & Creator Section */}
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

        <form onSubmit={handleSubmit} className="space-y-8 pb-10">
          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-4">Core Identity</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup>
                <Label>Bride Name</Label>
                <Input required type="text" name="brideName" value={localConfig.brideName || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Groom Name</Label>
                <Input required type="text" name="groomName" value={localConfig.groomName || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Wedding Date</Label>
                <Input required type="date" name="weddingDate" value={localConfig.weddingDate || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Base URL</Label>
                <Input required type="url" name="baseUrl" value={localConfig.baseUrl || ''} onChange={handleChange} />
              </FormGroup>
              {selectedProfileId !== 'global' && (
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup>
                <Label>Primary Color (Hex)</Label>
                <div className="flex gap-2">
                  <Input 
                    type="color" 
                    name="colorPrimary" 
                    value={localConfig.colorPrimary || '#B91C1C'} 
                    onChange={handleChange} 
                    className="w-12 h-10 p-1 rounded border cursor-pointer"
                  />
                  <Input 
                    required 
                    type="text" 
                    name="colorPrimary" 
                    value={localConfig.colorPrimary || '#B91C1C'} 
                    onChange={handleChange} 
                    placeholder="#B91C1C"
                  />
                </div>
              </FormGroup>
              <FormGroup>
                <Label>Secondary Color (Hex)</Label>
                <div className="flex gap-2">
                  <Input 
                    type="color" 
                    name="colorSecondary" 
                    value={localConfig.colorSecondary || '#B45309'} 
                    onChange={handleChange} 
                    className="w-12 h-10 p-1 rounded border cursor-pointer"
                  />
                  <Input 
                    required 
                    type="text" 
                    name="colorSecondary" 
                    value={localConfig.colorSecondary || '#B45309'} 
                    onChange={handleChange} 
                    placeholder="#B45309"
                  />
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
              <Textarea name="seoKeywords" value={localConfig.seoKeywords || ''} onChange={handleChange} rows={3} placeholder="{{brideName}} and {{groomName}}'s wedding..." />
              <FormMessage>Comma-separated list. Use templates like {'{{brideName}}'}. Variables: brideName, groomName, venueName, venueCity, venueState.</FormMessage>
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
            <Label>Bride Name</Label>
            <Input
              required
              type="text"
              value={newProfileData.brideName}
              onChange={(e) => setNewProfileData(prev => ({ ...prev, brideName: e.target.value }))}
              placeholder="e.g. Abby"
            />
          </FormGroup>
          <FormGroup>
            <Label>Groom Name</Label>
            <Input
              required
              type="text"
              value={newProfileData.groomName}
              onChange={(e) => setNewProfileData(prev => ({ ...prev, groomName: e.target.value }))}
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
