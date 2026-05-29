"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { checkAdminClient } from '@/utils/adminAuth.client';

export default function AdminSettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<any>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function init() {
      const isAdmin = await checkAdminClient();
      if (!isAdmin) {
        router.replace('/admin/login');
        return;
      }
      try {
        const res = await fetch('/api/admin/settings');
        if (res.ok) {
          const data = await res.json();
          // format date for input type="date"
          if (data.weddingDate) {
            data.weddingDate = data.weddingDate.split('T')[0];
          }
          setConfig(data);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");

    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          weddingDate: new Date(config.weddingDate).toISOString(),
        }),
      });

      if (res.ok) {
        setMessage("Settings saved successfully.");
      } else {
        setMessage("Failed to save settings.");
      }
    } catch (err) {
      console.error(err);
      setMessage("Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setConfig((prev: any) => ({ ...prev, [name]: value }));
  };

  if (loading) return <div className="p-8 text-center">Loading settings...</div>;

  if (!config) return <div className="p-8 text-center text-red-500">Failed to load settings.</div>;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="text-3xl font-bold mb-8">Site Settings</h1>
      
      {message && (
        <div className="mb-6 p-4 rounded bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
          <h2 className="text-xl font-semibold mb-4">Core Identity</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Bride Name</label>
              <input required type="text" name="brideName" value={config.brideName} onChange={handleChange} className="w-full p-2 border rounded text-black" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Groom Name</label>
              <input required type="text" name="groomName" value={config.groomName} onChange={handleChange} className="w-full p-2 border rounded text-black" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Wedding Date</label>
              <input required type="date" name="weddingDate" value={config.weddingDate} onChange={handleChange} className="w-full p-2 border rounded text-black" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Base URL</label>
              <input required type="url" name="baseUrl" value={config.baseUrl} onChange={handleChange} className="w-full p-2 border rounded text-black" />
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
          <h2 className="text-xl font-semibold mb-4">Venue & Location</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Venue Name</label>
              <input required type="text" name="venueName" value={config.venueName} onChange={handleChange} className="w-full p-2 border rounded text-black" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Address</label>
              <input required type="text" name="venueAddress" value={config.venueAddress} onChange={handleChange} className="w-full p-2 border rounded text-black" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">City</label>
              <input required type="text" name="venueCity" value={config.venueCity} onChange={handleChange} className="w-full p-2 border rounded text-black" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">State</label>
              <input required type="text" name="venueState" value={config.venueState} onChange={handleChange} className="w-full p-2 border rounded text-black" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Zip Code</label>
              <input required type="text" name="venueZip" value={config.venueZip} onChange={handleChange} className="w-full p-2 border rounded text-black" />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-sm font-medium mb-1">Latitude</label>
              <input required type="number" step="any" name="latitude" value={config.latitude} onChange={handleChange} className="w-full p-2 border rounded text-black" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Longitude</label>
              <input required type="number" step="any" name="longitude" value={config.longitude} onChange={handleChange} className="w-full p-2 border rounded text-black" />
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
            <textarea required name="storyText" value={config.storyText} onChange={handleChange} rows={6} className="w-full p-2 border rounded text-black" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Venue Description</label>
            <textarea required name="venueDescription" value={config.venueDescription} onChange={handleChange} rows={4} className="w-full p-2 border rounded text-black" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Travel Advice</label>
            <textarea required name="travelAdvice" value={config.travelAdvice} onChange={handleChange} rows={4} className="w-full p-2 border rounded text-black" />
          </div>
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
        </section>

        <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
          <h2 className="text-xl font-semibold mb-4">Feature Visibility Toggles</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: 'Hero', name: 'showHero' },
              { label: 'Story', name: 'showStory' },
              { label: 'Details', name: 'showDetails' },
              { label: 'Accommodations', name: 'showAccommodations' },
              { label: 'Venue', name: 'showVenue' },
              { label: 'Travel', name: 'showTravel' },
              { label: 'FAQ', name: 'showFaq' },
            ].map((toggle) => (
              <div key={toggle.name} className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id={toggle.name}
                  name={toggle.name}
                  checked={config[toggle.name]}
                  onChange={(e) => setConfig({ ...config, [toggle.name]: e.target.checked })}
                  className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor={toggle.name} className="font-medium text-gray-700 dark:text-gray-300">
                  Show {toggle.label}
                </label>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md space-y-4">
          <h2 className="text-xl font-semibold mb-4">Social Media Links</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Facebook</label>
              <input type="url" name="socialFacebook" value={config.socialFacebook || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" placeholder="https://facebook.com/..." />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Instagram</label>
              <input type="url" name="socialInstagram" value={config.socialInstagram || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" placeholder="https://instagram.com/..." />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Twitter</label>
              <input type="url" name="socialTwitter" value={config.socialTwitter || ''} onChange={handleChange} className="w-full p-2 border rounded text-black" placeholder="https://twitter.com/..." />
            </div>
          </div>
        </section>

        <div className="flex justify-end">
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
  );
}
