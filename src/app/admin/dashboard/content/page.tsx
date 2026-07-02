"use client";
import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import type { ContentNodeDTO } from '@/features/content/schemas';
import { useAdminEntity } from '@/lib/admin/useAdminEntity';
import { apiClient } from '@/lib/admin/apiClient';

import AdminPreviewLayout from "@/components/admin/AdminPreviewLayout";

/**
 * Admin interface for listing, creating, editing, deleting, and previewing content nodes.
 *
 * Renders a dashboard UI that enforces admin authentication, shows existing content nodes,
 * provides an inline editor for node metadata and dynamic key/value fields, supports
 * creating and removing nodes, and offers a preview integration (including optional
 * photo metadata scraping when a node is of type `Photo`).
 *
 * @returns A React element rendering the content dashboard UI with list, editor, and preview controls.
 */
export default function ContentDashboardPage() {
  const router = useRouter();

  const {
    data: nodes,
    loading,
    error,
    fetchAll,
    create,
    update,
    remove
  } = useAdminEntity<ContentNodeDTO>('content-nodes');

  const [isEditing, setIsEditing] = useState(false);
  const [currentNode, setCurrentNode] = useState<Partial<ContentNodeDTO>>({});
  const [dynamicData, setDynamicData] = useState<{key: string, value: string}[]>([]);


  const handleSave = async () => {
    try {
      const dataObj: Record<string, string> = {};
      dynamicData.forEach(item => {
        if (item.key.trim()) dataObj[item.key.trim()] = item.value;
      });

      const payload = {
        type: currentNode.type || 'FAQ',
        tags: currentNode.tags || ['Homepage'],
        data: dataObj
      };

      if (currentNode.id) {
        await update(currentNode.id, payload);
      } else {
        await create(payload);
      }
      setIsEditing(false);
    } catch (e: unknown) {
      alert((e instanceof Error ? e.message : String(e)) || 'Error saving node');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this content node?')) return;
    try {
      await remove(id);
    } catch (e: unknown) {
      alert((e instanceof Error ? e.message : String(e)) || 'Error deleting node');
    }
  };

  const handleScrapePhoto = async () => {
    try {
      const urlItem = dynamicData.find(d => d.key === 'url');
      if (!urlItem || !urlItem.value) {
        alert("Please add a 'url' key with a value first.");
        return;
      }
      
      const scraped = await apiClient.post<any>('/api/registry/scrape', { url: urlItem.value });
      
      setDynamicData(prev => {
        const newData = [...prev];
        const addOrUpdate = (key: string, val: string) => {
          if (!val) return;
          const existing = newData.find(d => d.key === key);
          if (existing) existing.value = val;
          else newData.push({ key, value: val });
        };
        addOrUpdate('title', scraped.name);
        addOrUpdate('description', scraped.description);
        addOrUpdate('previewImage', scraped.image);
        return newData;
      });
    } catch (e: unknown) {
      alert((e instanceof Error ? e.message : String(e)) || 'Error scraping');
    }
  };

  const addField = () => {
    setDynamicData([...dynamicData, { key: '', value: '' }]);
  };

  const removeField = (index: number) => {
    setDynamicData(dynamicData.filter((_, i) => i !== index));
  };

  const updateField = (index: number, field: 'key' | 'value', val: string) => {
    const newData = [...dynamicData];
    newData[index][field] = val;
    setDynamicData(newData);
  };

  if (loading) return <main className="min-h-screen flex items-center justify-center"><p>Loading...</p></main>;
  if (error) return <main className="min-h-screen flex items-center justify-center"><p className="text-red-500">Error: {error}</p></main>;

  const draftDataObj: Record<string, string> = {};
  dynamicData.forEach(item => {
    if (item.key.trim()) draftDataObj[item.key.trim()] = item.value;
  });
  
  const draftNode = {
    id: currentNode.id || 'draft',
    type: currentNode.type || 'FAQ',
    tags: currentNode.tags || ['Homepage'],
    data: draftDataObj
  };

  const currentNodesWithDraft = nodes.map(n => n.id === currentNode.id ? draftNode : n);
  if (!currentNode.id && isEditing) {
    currentNodesWithDraft.push(draftNode as ContentNodeDTO);
  }

  return (
    <AdminPreviewLayout
      previewUrl="/"
      draftType="content"
      draftData={currentNodesWithDraft}
      entityId={currentNode.id}
      onRestore={() => {
        setIsEditing(false);
        fetchAll();
      }}
    >
      <div className="py-10 px-4 sm:px-6 max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-extrabold text-primary">Content Hub</h1>
          <div>
            <button onClick={() => router.push('/admin/dashboard')} className="mr-4 px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition">Back to Registry</button>
            <button onClick={() => { 
              setCurrentNode({ type: 'FAQ', tags: ['Homepage'] }); 
              setDynamicData([{key: 'question', value: ''}, {key: 'answer', value: ''}]); 
              setIsEditing(true); 
            }} className="px-4 py-2 bg-primary text-white rounded hover:bg-primary transition">Add New Content</button>
          </div>
        </div>

        {isEditing && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg mb-8 border border-primary dark:border-gray-700">
            <h2 className="text-2xl font-bold mb-4">{currentNode.id ? 'Edit' : 'Create'} Content Node</h2>
            <div className="grid gap-4 mb-4">
              <div>
                <label className="block text-sm font-semibold mb-1">Type (e.g. FAQ, Logistics, Photo)</label>
                <input type="text" className="w-full border rounded p-2 text-black" value={currentNode.type || ''} onChange={e => setCurrentNode({...currentNode, type: e.target.value})} />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Tags (comma separated)</label>
                <input type="text" className="w-full border rounded p-2 text-black" value={currentNode.tags?.join(', ') || ''} onChange={e => setCurrentNode({...currentNode, tags: e.target.value.split(',').map(t => t.trim())})} />
              </div>
              
              <div>
                <label className="block text-sm font-semibold mb-2">Dynamic Data Fields</label>
                {dynamicData.map((field, idx) => (
                  <div key={idx} className="flex gap-2 mb-2 items-center">
                    <input type="text" placeholder="Key" className="border rounded p-2 text-black w-1/3" value={field.key} onChange={(e) => updateField(idx, 'key', e.target.value)} />
                    <input type="text" placeholder="Value" className="border rounded p-2 text-black w-2/3" value={field.value} onChange={(e) => updateField(idx, 'value', e.target.value)} />
                    <button onClick={() => removeField(idx)} className="bg-red-500 text-white px-2 py-2 rounded font-bold">X</button>
                  </div>
                ))}
                <button onClick={addField} className="text-sm bg-gray-200 dark:bg-gray-700 px-3 py-1 rounded mt-2">+ Add Field</button>
              </div>

            </div>
            <div className="flex gap-4 mt-6">
              <button onClick={handleSave} className="bg-green-600 text-white px-4 py-2 rounded font-bold">Save</button>
              {currentNode.type === 'Photo' && (
                <button onClick={handleScrapePhoto} className="bg-blue-600 text-white px-4 py-2 rounded">Scrape Metadata from URL</button>
              )}
              <button onClick={() => setIsEditing(false)} className="bg-gray-400 text-white px-4 py-2 rounded">Cancel</button>
            </div>
          </div>
        )}

        <div className="grid gap-4 pb-10">
          {nodes.map(node => (
            <div key={node.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-primary flex justify-between items-center">
              <div>
                <div className="font-bold text-lg">{node.type} <span className="text-sm font-normal text-gray-500">({node.tags.join(', ')})</span></div>
                <div className="text-sm mt-1 text-gray-700 dark:text-gray-300">
                  {JSON.stringify(node.data).substring(0, 100)}...
                </div>
              </div>
              <div className="space-x-2 flex">
                <button onClick={() => { 
                  setCurrentNode(node); 
                  const d = node.data as Record<string, string>;
                  setDynamicData(Object.keys(d).map(k => ({key: k, value: String(d[k])})));
                  setIsEditing(true); 
                }} className="bg-secondary text-white px-3 py-1 rounded text-sm">Edit</button>
                <button onClick={() => handleDelete(node.id)} className="bg-primary text-white px-3 py-1 rounded text-sm">Delete</button>
              </div>
            </div>
          ))}
          {nodes.length === 0 && <p className="text-gray-500">No content nodes found.</p>}
        </div>
      </div>
    </AdminPreviewLayout>
  );
}

