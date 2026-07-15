'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { apiClient } from '@/features/admin/apiClient';
import { useAdminSettings } from '@/hooks/admin/useAdminSettings';

import AdminPreviewLayout from '@/components/admin/AdminPreviewLayout';
import { FormGroup, Label, Input, Textarea, FormMessage } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';
import { MAX_UPLOAD_SIZE, ACCEPTED_IMAGE_TYPES } from '@/utils/validation';

export default function AdminSettingsPage() {
  const router = useRouter();
  const { addToast } = useToast();
  const { config: initialConfig, loading, saving, saveSettings, fetchAll } = useAdminSettings();
  
  const [localConfig, setLocalConfig] = useState<any>(null);

  useEffect(() => {
    if (initialConfig && !localConfig) {
      setLocalConfig(initialConfig);
    }
  }, [initialConfig, localConfig]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!localConfig) return;
    try {
      await saveSettings(localConfig);
    } catch (err) {
      // Error is handled by hook
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

  if (loading) return <div className="p-8 text-center">Loading settings...</div>;

  if (!localConfig) return <div className="p-8 text-center text-red-500">Failed to load settings.</div>;

  return (
    <AdminPreviewLayout
      previewUrl="/"
      draftType="config"
      draftData={{
        ...localConfig,
        weddingDate: localConfig.weddingDate ? new Date(localConfig.weddingDate).toISOString() : new Date().toISOString()
      }}
      entityId="global"
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
            <h2 className="text-xl font-semibold mb-4">Branding & Colors</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <FormGroup className="flex flex-col items-center">
                <Label className="mb-1">Primary Color</Label>
                <div className="flex items-center gap-2 w-full">
                  <Input type="color" name="themePrimary" value={localConfig.themePrimary || '#f43f5e'} onChange={handleChange} className="h-10 w-10 p-0 border-0 rounded cursor-pointer" />
                  <Input type="text" name="themePrimary" value={localConfig.themePrimary || '#f43f5e'} onChange={handleChange} className="font-mono text-sm uppercase" />
                </div>
              </FormGroup>
              <FormGroup className="flex flex-col items-center">
                <Label className="mb-1">Secondary Color</Label>
                <div className="flex items-center gap-2 w-full">
                  <Input type="color" name="themeSecondary" value={localConfig.themeSecondary || '#fbbf24'} onChange={handleChange} className="h-10 w-10 p-0 border-0 rounded cursor-pointer" />
                  <Input type="text" name="themeSecondary" value={localConfig.themeSecondary || '#fbbf24'} onChange={handleChange} className="font-mono text-sm uppercase" />
                </div>
              </FormGroup>
              <FormGroup className="flex flex-col items-center">
                <Label className="mb-1">Accent Color</Label>
                <div className="flex items-center gap-2 w-full">
                  <Input type="color" name="themeAccent" value={localConfig.themeAccent || '#e11d48'} onChange={handleChange} className="h-10 w-10 p-0 border-0 rounded cursor-pointer" />
                  <Input type="text" name="themeAccent" value={localConfig.themeAccent || '#e11d48'} onChange={handleChange} className="font-mono text-sm uppercase" />
                </div>
              </FormGroup>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
              These colors will automatically synchronize across the UI components and 3D scenes.
            </p>
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
    </AdminPreviewLayout>
  );
}
