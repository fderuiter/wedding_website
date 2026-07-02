"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiClient } from '@/lib/admin/apiClient';

import AdminPreviewLayout from "@/components/admin/AdminPreviewLayout";
import { FormGroup, Label, Input, Textarea, FormMessage } from "@/components/ui/forms";

export default function AdminSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [message, setMessage] = useState("");

  const refreshConfig = async () => {
    try {
      const data = await apiClient.get<any>('/api/admin/settings');
      if (data.weddingDate) {
        data.weddingDate = data.weddingDate.split('T')[0];
      }
      setConfig(data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    async function init() {
      await refreshConfig();
      setLoading(false);
    }
    init();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      await apiClient.put('/api/admin/settings', {
        ...config,
        weddingDate: new Date(config.weddingDate).toISOString(),
      });

      setMessage("Settings saved successfully.");
      await refreshConfig(); // ensure we have latest after save
    } catch (err) {
      console.error(err);
      setMessage("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, fieldName: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (file.size > 5 * 1024 * 1024) {
      alert('File size exceeds 5MB limit');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const { url } = await apiClient.post<{ url: string }>('/api/admin/upload', formData);
      setConfig((prev: any) => ({ ...prev, [fieldName]: url }));
      setMessage(`${fieldName} uploaded successfully.`);
    } catch (err: any) {
      setMessage(`Upload failed: ${err.message || err}`);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setConfig((prev: any) => ({ ...prev, [name]: value }));
  };

  if (loading) return <div className="p-8 text-center">Loading settings...</div>;

  if (!config) return <div className="p-8 text-center text-red-500">Failed to load settings.</div>;

  return (
    <AdminPreviewLayout
      previewUrl="/"
      draftType="config"
      draftData={{
         ...config,
         weddingDate: config.weddingDate ? new Date(config.weddingDate).toISOString() : new Date().toISOString()
      }}
      entityId="global"
      onRestore={() => refreshConfig()}
    >
      <div className="mx-auto max-w-4xl p-6">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold">Site Settings</h1>
          <button onClick={() => router.push('/admin/dashboard')} className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition">Back to Dashboard</button>
        </div>
        
        {message && (
          <div className="mb-6 p-4 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-8 pb-10">
          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-4">Core Identity</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup>
                <Label>Bride Name</Label>
                <Input required type="text" name="brideName" value={config.brideName || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Groom Name</Label>
                <Input required type="text" name="groomName" value={config.groomName || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Wedding Date</Label>
                <Input required type="date" name="weddingDate" value={config.weddingDate || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Base URL</Label>
                <Input required type="url" name="baseUrl" value={config.baseUrl || ''} onChange={handleChange} />
              </FormGroup>
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-4">Venue & Location</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup>
                <Label>Venue Name</Label>
                <Input required type="text" name="venueName" value={config.venueName || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Address</Label>
                <Input required type="text" name="venueAddress" value={config.venueAddress || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>City</Label>
                <Input required type="text" name="venueCity" value={config.venueCity || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>State</Label>
                <Input required type="text" name="venueState" value={config.venueState || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Zip Code</Label>
                <Input required type="text" name="venueZip" value={config.venueZip || ''} onChange={handleChange} />
              </FormGroup>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <FormGroup>
                <Label>Latitude</Label>
                <Input required type="number" step="any" name="latitude" value={config.latitude || 0} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Longitude</Label>
                <Input required type="number" step="any" name="longitude" value={config.longitude || 0} onChange={handleChange} />
              </FormGroup>
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-4">Narrative Content</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup>
                <Label>Hero Title</Label>
                <Input required type="text" name="heroTitle" value={config.heroTitle || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>Hero Subtitle</Label>
                <Input required type="text" name="heroSubtitle" value={config.heroSubtitle || ''} onChange={handleChange} />
              </FormGroup>
            </div>
            <FormGroup>
              <Label>Our Story</Label>
              <Textarea required name="storyText" value={config.storyText || ''} onChange={handleChange} rows={6} />
            </FormGroup>
            <FormGroup>
              <Label>Venue Description</Label>
              <Textarea required name="venueDescription" value={config.venueDescription || ''} onChange={handleChange} rows={4} />
            </FormGroup>
            <FormGroup>
              <Label>Travel Advice</Label>
              <Textarea required name="travelAdvice" value={config.travelAdvice || ''} onChange={handleChange} rows={4} />
            </FormGroup>
          </section>

          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-4">Branding & Colors</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <FormGroup className="flex flex-col items-center">
                <Label className="mb-1">Primary Color</Label>
                <div className="flex items-center gap-2 w-full">
                  <Input type="color" name="themePrimary" value={config.themePrimary || '#f43f5e'} onChange={handleChange} className="h-10 w-10 p-0 border-0 rounded cursor-pointer" />
                  <Input type="text" name="themePrimary" value={config.themePrimary || '#f43f5e'} onChange={handleChange} className="font-mono text-sm uppercase" />
                </div>
              </FormGroup>
              <FormGroup className="flex flex-col items-center">
                <Label className="mb-1">Secondary Color</Label>
                <div className="flex items-center gap-2 w-full">
                  <Input type="color" name="themeSecondary" value={config.themeSecondary || '#fbbf24'} onChange={handleChange} className="h-10 w-10 p-0 border-0 rounded cursor-pointer" />
                  <Input type="text" name="themeSecondary" value={config.themeSecondary || '#fbbf24'} onChange={handleChange} className="font-mono text-sm uppercase" />
                </div>
              </FormGroup>
              <FormGroup className="flex flex-col items-center">
                <Label className="mb-1">Accent Color</Label>
                <div className="flex items-center gap-2 w-full">
                  <Input type="color" name="themeAccent" value={config.themeAccent || '#e11d48'} onChange={handleChange} className="h-10 w-10 p-0 border-0 rounded cursor-pointer" />
                  <Input type="text" name="themeAccent" value={config.themeAccent || '#e11d48'} onChange={handleChange} className="font-mono text-sm uppercase" />
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
                <Input required type="text" name="seoTitle" value={config.seoTitle || ''} onChange={handleChange} />
              </FormGroup>
              <FormGroup>
                <Label>SEO Description</Label>
                <Input required type="text" name="seoDescription" value={config.seoDescription || ''} onChange={handleChange} />
              </FormGroup>
            </div>
            <FormGroup>
              <Label>SEO Keywords</Label>
              <Textarea name="seoKeywords" value={config.seoKeywords || ''} onChange={handleChange} rows={3} placeholder="{{brideName}} and {{groomName}}'s wedding..." />
              <FormMessage>Comma-separated list. Use templates like {"{{brideName}}"}. Variables: brideName, groomName, venueName, venueCity, venueState.</FormMessage>
            </FormGroup>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <FormGroup>
                <Label>Favicon (.ico, .png)</Label>
                <div className="flex flex-col space-y-2">
                  <Input type="file" accept=".ico,.png,image/png,image/x-icon" onChange={(e) => handleUpload(e, 'faviconUrl')} className="file:pt-1" />
                  {config.faviconUrl && (
                    <div className="flex items-center gap-2">
                      <img src={config.faviconUrl} alt="Favicon preview" className="w-8 h-8 object-contain bg-gray-100 dark:bg-gray-700 rounded" />
                      <span className="text-xs text-gray-500 break-all">{config.faviconUrl}</span>
                    </div>
                  )}
                </div>
              </FormGroup>
              <FormGroup>
                <Label>Social Sharing Image (OG Image)</Label>
                <div className="flex flex-col space-y-2">
                  <Input type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={(e) => handleUpload(e, 'ogImageUrl')} className="file:pt-1" />
                  {config.ogImageUrl && (
                    <div className="flex items-center gap-2">
                      <img src={config.ogImageUrl} alt="OG Image preview" className="w-32 h-auto object-contain bg-gray-100 dark:bg-gray-700 rounded" />
                      <span className="text-xs text-gray-500 break-all">{config.ogImageUrl}</span>
                    </div>
                  )}
                </div>
              </FormGroup>
            </div>
          </section>

          <div className="flex justify-end sticky bottom-0 bg-gray-100 dark:bg-gray-900 py-4 shadow-t">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </form>
      </div>
    </AdminPreviewLayout>
  );
}
