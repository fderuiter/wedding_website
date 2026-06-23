"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { checkAdminClient } from '@/utils/adminAuth.client';
import { apiClient } from '@/lib/admin/apiClient';

export default function SiteManagerPage() {
  const router = useRouter();
  const [features, setFeatures] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customTitle, setCustomTitle] = useState("");
  const [customContent, setCustomContent] = useState("");

  useEffect(() => {
    async function init() {
      const isAdmin = await checkAdminClient();
      if (!isAdmin) {
        router.replace('/admin/login');
        return;
      }
      fetchFeatures();
    }
    init();
  }, [router]);

  const fetchFeatures = async () => {
    setLoading(true);
    try {
      let data = await apiClient.get<any[]>('/api/admin/features');
      
      // Fallback defaults
      if (!data || data.length === 0) {
        data = [
          { id: 'story', type: 'story', title: 'Our Story', visible: true },
          { id: 'registry', type: 'registry', title: 'Gift Registry', visible: true },
          { id: 'rsvp', type: 'rsvp', title: 'RSVP', visible: true },
          { id: 'details', type: 'details', title: 'Wedding Day Details', visible: true },
          { id: 'accommodations', type: 'accommodations', title: 'Accommodations', visible: true },
          { id: 'venue', type: 'venue', title: 'About Our Venue', visible: true },
          { id: 'travel', type: 'travel', title: 'Travel & Things to Do', visible: true },
          { id: 'faq', type: 'faq', title: 'Questions You Probably Have', visible: true }
        ];
      }
      setFeatures(data);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const saveFeatures = async (newFeatures: any[]) => {
    try {
      await apiClient.put('/api/admin/features', { features: newFeatures });
      setFeatures(newFeatures);
    } catch (e: any) {
      alert(e.message || 'Error saving');
    }
  };

  const toggleVisibility = (id: string) => {
    const updated = features.map(f => f.id === id ? { ...f, visible: !f.visible } : f);
    saveFeatures(updated);
  };

  const addCustomSection = () => {
    if (!customTitle.trim() || !customContent.trim()) {
      alert("Title and content are required.");
      return;
    }
    const newId = 'custom-' + Date.now();
    const newFeature = {
      id: newId,
      type: 'custom',
      title: customTitle,
      content: customContent,
      visible: true
    };
    const updated = [...features, newFeature];
    saveFeatures(updated);
    setShowCustomModal(false);
    setCustomTitle("");
    setCustomContent("");
  };

  // Drag and Drop
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.dataTransfer.setData('dragIndex', index.toString());
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, dropIndex: number) => {
    const dragIndex = parseInt(e.dataTransfer.getData('dragIndex'));
    if (dragIndex === dropIndex) return;

    const newFeatures = [...features];
    const draggedItem = newFeatures[dragIndex];
    newFeatures.splice(dragIndex, 1);
    newFeatures.splice(dropIndex, 0, draggedItem);
    saveFeatures(newFeatures);
  };

  if (loading) return <div className="p-8 text-center text-primary">Loading Site Manager...</div>;
  if (error) return <div className="p-8 text-center text-red-500">Error: {error}</div>;

  return (
    <main className="min-h-screen bg-[var(--color-background)] text-[var(--color-foreground)] py-10 px-4 sm:px-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-extrabold text-primary tracking-tight">Visual Site Manager</h1>
          <div className="space-x-4">
            <button onClick={() => setShowCustomModal(true)} className="px-4 py-2 bg-secondary text-white rounded hover:bg-secondary transition">Add Custom Section</button>
            <button onClick={() => router.push('/admin/dashboard')} className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition">Back to Dashboard</button>
          </div>
        </div>

        <p className="mb-6 text-lg text-gray-700 dark:text-gray-300">
          Drag and drop sections to reorder them on the homepage. Toggle the eye icon to show or hide a section.
        </p>

        <div className="space-y-4">
          {features.map((feature, index) => (
            <div 
              key={feature.id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
              className={`p-4 rounded-xl shadow border border-primary dark:border-primary flex justify-between items-center cursor-move transition ${!feature.visible ? 'opacity-50 bg-gray-50 dark:bg-gray-900' : 'bg-white dark:bg-gray-800'}`}
            >
              <div className="flex items-center gap-4">
                <div className="text-gray-400">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 8h16M4 16h16" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-bold text-xl text-primary">{feature.title || feature.id}</h3>
                  <span className="text-sm font-semibold text-gray-500 uppercase tracking-wider">{feature.type}</span>
                </div>
              </div>
              <div>
                <button 
                  onClick={() => toggleVisibility(feature.id)} 
                  className={`px-4 py-2 rounded text-sm font-bold ${feature.visible ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}
                >
                  {feature.visible ? 'Visible' : 'Hidden'}
                </button>
              </div>
            </div>
          ))}
        </div>

        {showCustomModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-xl max-w-lg w-full">
              <h2 className="text-2xl font-bold mb-4 text-primary">Add Custom Section</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold mb-1">Section Title</label>
                  <input type="text" value={customTitle} onChange={e => setCustomTitle(e.target.value)} className="w-full border rounded p-2 text-black" placeholder="e.g. Health & Safety" />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-1">Content</label>
                  <textarea value={customContent} onChange={e => setCustomContent(e.target.value)} className="w-full border rounded p-2 text-black" rows={5} placeholder="Add your content here... Use double line breaks for paragraphs." />
                </div>
                <div className="flex gap-4 mt-6">
                  <button onClick={addCustomSection} className="flex-1 bg-green-600 text-white px-4 py-2 rounded font-bold">Save Section</button>
                  <button onClick={() => setShowCustomModal(false)} className="flex-1 bg-gray-400 text-white px-4 py-2 rounded font-bold">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
