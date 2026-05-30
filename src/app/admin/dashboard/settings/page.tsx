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
  const [features, setFeatures] = useState<any[]>([]);

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
          if (data.weddingDate) {
            data.weddingDate = data.weddingDate.split('T')[0];
          }
          setConfig(data);
          setFeatures(Array.isArray(data.features) ? data.features : []);
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
          features: features,
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

  const moveFeature = (index: number, direction: 'up' | 'down') => {
    const newFeatures = [...features];
    if (direction === 'up' && index > 0) {
      [newFeatures[index - 1], newFeatures[index]] = [newFeatures[index], newFeatures[index - 1]];
    } else if (direction === 'down' && index < newFeatures.length - 1) {
      [newFeatures[index + 1], newFeatures[index]] = [newFeatures[index], newFeatures[index + 1]];
    }
    setFeatures(newFeatures);
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    const dragIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (dragIndex === dropIndex) return;
    
    const newFeatures = [...features];
    const draggedItem = newFeatures[dragIndex];
    newFeatures.splice(dragIndex, 1);
    newFeatures.splice(dropIndex, 0, draggedItem);
    setFeatures(newFeatures);
  };

  const toggleVisibility = (index: number) => {
    const newFeatures = [...features];
    newFeatures[index].isVisible = !newFeatures[index].isVisible;
    setFeatures(newFeatures);
  };

  const addCustomSection = async () => {
    const title = prompt("Enter the title for the new section:");
    if (!title) return;

    // We can just create a feature ID based on title
    const id = "custom-" + title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    // First, create the content node in DB via API
    try {
      const res = await fetch('/api/admin/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'Custom',
          tags: ['Homepage'],
          data: { content: 'Add your content here...' },
          id: id // We need the id to match
        })
      });
      if (res.ok) {
        // Now add to features
        setFeatures([...features, { id, title, type: 'Custom', isVisible: true }]);
        alert("Section added! Don't forget to save settings.");
      } else {
        alert("Failed to create content node.");
      }
    } catch (e) {
      console.error(e);
      alert("Error creating content node.");
    }
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
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-xl font-semibold">Visual Site Manager (Homepage Layout)</h2>
              <p className="text-sm text-gray-500">Reorder sections or toggle their visibility on the homepage and navigation menu.</p>
            </div>
            <button type="button" onClick={addCustomSection} className="bg-rose-600 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-rose-700">
              + Add Custom Section
            </button>
          </div>
          <div className="space-y-2">
            {features.map((feature, idx) => (
              <div 
                key={feature.id} 
                draggable
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, idx)}
                className="flex items-center justify-between p-3 border rounded border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 cursor-move transition hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <div className="flex items-center space-x-4">
                  <div className="text-gray-400 cursor-grab px-2 flex-shrink-0" title="Drag to reorder">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>
                  </div>
                  <span className="font-semibold w-32">{feature.title}</span>
                  <span className="text-xs text-gray-400">({feature.type})</span>
                </div>
                <div className="flex items-center space-x-4">
                  <button type="button" onClick={() => toggleVisibility(idx)} className={`px-3 py-1 text-xs rounded font-bold text-white ${feature.isVisible ? 'bg-green-500' : 'bg-red-500'}`}>
                    {feature.isVisible ? 'Visible' : 'Hidden'}
                  </button>
                  <div className="flex flex-col space-y-1">
                    <button type="button" onClick={() => moveFeature(idx, 'up')} disabled={idx === 0} className="px-2 bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-30">▲</button>
                    <button type="button" onClick={() => moveFeature(idx, 'down')} disabled={idx === features.length - 1} className="px-2 bg-gray-200 dark:bg-gray-700 rounded disabled:opacity-30">▼</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

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
