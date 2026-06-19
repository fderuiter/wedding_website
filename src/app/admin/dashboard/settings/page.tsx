"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { checkAdminClient } from '@/utils/adminAuth.client';
import { apiClient } from '@/lib/admin/apiClient';

import AdminPreviewLayout from "@/components/admin/AdminPreviewLayout";

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
      const isAdmin = await checkAdminClient();
      if (!isAdmin) {
        router.replace('/admin/login');
        return;
      }
      await refreshConfig();
      setLoading(false);
    }
    init();
  }, [router]);

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
              <div>
                <label className="block text-sm font-medium mb-1">Bride Name</label>
                <input required type="text" name="brideName" value={config.brideName || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Groom Name</label>
                <input required type="text" name="groomName" value={config.groomName || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Wedding Date</label>
                <input required type="date" name="weddingDate" value={config.weddingDate || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Base URL</label>
                <input required type="url" name="baseUrl" value={config.baseUrl || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" />
              </div>
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-4">Venue & Location</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Venue Name</label>
                <input required type="text" name="venueName" value={config.venueName || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Address</label>
                <input required type="text" name="venueAddress" value={config.venueAddress || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">City</label>
                <input required type="text" name="venueCity" value={config.venueCity || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">State</label>
                <input required type="text" name="venueState" value={config.venueState || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Zip Code</label>
                <input required type="text" name="venueZip" value={config.venueZip || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium mb-1">Latitude</label>
                <input required type="number" step="any" name="latitude" value={config.latitude || 0} onChange={handleChange} className="w-full p-2 border rounded text-black" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Longitude</label>
                <input required type="number" step="any" name="longitude" value={config.longitude || 0} onChange={handleChange} className="w-full p-2 border rounded text-black" />
              </div>
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-4">Narrative Content</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Hero Title</label>
                <input required type="text" name="heroTitle" value={config.heroTitle || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Hero Subtitle</label>
                <input required type="text" name="heroSubtitle" value={config.heroSubtitle || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Our Story</label>
              <textarea required name="storyText" value={config.storyText || ''} onChange={handleChange} rows={6} className="w-full p-2 border rounded text-black" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Venue Description</label>
              <textarea required name="venueDescription" value={config.venueDescription || ''} onChange={handleChange} rows={4} className="w-full p-2 border rounded text-black" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Travel Advice</label>
              <textarea required name="travelAdvice" value={config.travelAdvice || ''} onChange={handleChange} rows={4} className="w-full p-2 border rounded text-black" />
            </div>
          </section>

          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-4">Branding & Colors</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex flex-col items-center">
                <label className="block text-sm font-medium mb-2">Primary Color</label>
                <div className="flex items-center gap-2 w-full">
                  <input type="color" name="themePrimary" value={config.themePrimary || '#f43f5e'} onChange={handleChange} className="h-10 w-10 p-0 border-0 rounded cursor-pointer" />
                  <input type="text" name="themePrimary" value={config.themePrimary || '#f43f5e'} onChange={handleChange} className="w-full p-2 border rounded text-black font-mono text-sm uppercase" />
                </div>
              </div>
              <div className="flex flex-col items-center">
                <label className="block text-sm font-medium mb-2">Secondary Color</label>
                <div className="flex items-center gap-2 w-full">
                  <input type="color" name="themeSecondary" value={config.themeSecondary || '#fbbf24'} onChange={handleChange} className="h-10 w-10 p-0 border-0 rounded cursor-pointer" />
                  <input type="text" name="themeSecondary" value={config.themeSecondary || '#fbbf24'} onChange={handleChange} className="w-full p-2 border rounded text-black font-mono text-sm uppercase" />
                </div>
              </div>
              <div className="flex flex-col items-center">
                <label className="block text-sm font-medium mb-2">Accent Color</label>
                <div className="flex items-center gap-2 w-full">
                  <input type="color" name="themeAccent" value={config.themeAccent || '#e11d48'} onChange={handleChange} className="h-10 w-10 p-0 border-0 rounded cursor-pointer" />
                  <input type="text" name="themeAccent" value={config.themeAccent || '#e11d48'} onChange={handleChange} className="w-full p-2 border rounded text-black font-mono text-sm uppercase" />
                </div>
              </div>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-4">
              These colors will automatically synchronize across the UI components and 3D scenes.
            </p>
          </section>

          <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
            <h2 className="text-xl font-semibold mb-4">SEO & Metadata</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">SEO Title</label>
                <input required type="text" name="seoTitle" value={config.seoTitle || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">SEO Description</label>
                <input required type="text" name="seoDescription" value={config.seoDescription || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" />
              </div>
            </div>
            <div>
              <label htmlFor="seoKeywords" className="block text-sm font-medium mb-1">SEO Keywords</label>
              <textarea id="seoKeywords" name="seoKeywords" value={config.seoKeywords || ''} onChange={handleChange} rows={3} className="w-full p-2 border rounded text-black" placeholder="{{brideName}} and {{groomName}}'s wedding..." />
              <p className="text-xs text-gray-500 mt-1">Comma-separated list. Use templates like {"{{brideName}}"}. Variables: brideName, groomName, venueName, venueCity, venueState.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <div>
                <label htmlFor="faviconUpload" className="block text-sm font-medium mb-1">Favicon (.ico, .png)</label>
                <div className="flex flex-col space-y-2">
                  <input id="faviconUpload" type="file" accept=".ico,.png,image/png,image/x-icon" onChange={(e) => handleUpload(e, 'faviconUrl')} className="w-full text-sm" />
                  {config.faviconUrl && (
                    <div className="flex items-center gap-2">
                      <img src={config.faviconUrl} alt="Favicon preview" className="w-8 h-8 object-contain bg-gray-100 dark:bg-gray-700 rounded" />
                      <span className="text-xs text-gray-500 break-all">{config.faviconUrl}</span>
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label htmlFor="ogImageUpload" className="block text-sm font-medium mb-1">Social Sharing Image (OG Image)</label>
                <div className="flex flex-col space-y-2">
                  <input id="ogImageUpload" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" onChange={(e) => handleUpload(e, 'ogImageUrl')} className="w-full text-sm" />
                  {config.ogImageUrl && (
                    <div className="flex items-center gap-2">
                      <img src={config.ogImageUrl} alt="OG Image preview" className="w-32 h-auto object-contain bg-gray-100 dark:bg-gray-700 rounded" />
                      <span className="text-xs text-gray-500 break-all">{config.ogImageUrl}</span>
                    </div>
                  )}
                </div>
              </div>
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
