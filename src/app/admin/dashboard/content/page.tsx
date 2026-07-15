"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";

import type { ContentNodeDTO } from '@/features/content/schemas';
import { useAdminContent } from '@/hooks/admin/useAdminContent';
import { apiClient } from '@/features/admin/apiClient';

import AdminPreviewLayout from "@/components/admin/AdminPreviewLayout";
import { Button } from "@/components/ui/Button";
import { FormGroup, Label, Input } from "@/components/ui/forms";
import { useFocusSuccessor } from "@/hooks/useFocusSuccessor";
import { useToast } from "@/components/ui/ToastProvider";

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
  const { containerRef, captureFocusTarget } = useFocusSuccessor<HTMLDivElement>();
  const { confirm, addToast } = useToast();

  const {
    data: nodes,
    isLoading,
    error,
    fetchAll,
    create,
    update,
    remove
  } = useAdminContent();

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
      // Error handled by global MutationCache
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const card = e.currentTarget.closest('.bg-white');
    if (!(await confirm('Are you sure you want to delete this content node?'))) return;
    if (card) {
      captureFocusTarget(card as HTMLElement);
    }
    try {
      await remove(id);
    } catch (err: unknown) {
      // Error handled by global MutationCache
    }
  };

  const handleScrapePhoto = async () => {
    try {
      const urlItem = dynamicData.find(d => d.key === 'url');
      if (!urlItem || !urlItem.value) {
        addToast("Please add a 'url' key with a value first.", 'error');
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
      addToast((e instanceof Error ? e.message : String(e)) || 'Error scraping', 'error');
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

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><p>Loading...</p></div>;
  if (error) return <div className="min-h-screen flex items-center justify-center"><p className="text-red-500">Error: {error.message}</p></div>;

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
          <div className="flex gap-4">
            <Button variant="ghost" onClick={() => router.push('/admin/dashboard')}>Back to Registry</Button>
            <Button onClick={() => { 
              setCurrentNode({ type: 'FAQ', tags: ['Homepage'] }); 
              setDynamicData([{key: 'question', value: ''}, {key: 'answer', value: ''}]); 
              setIsEditing(true); 
            }}>Add New Content</Button>
          </div>
        </div>

        {isEditing && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg mb-8 border border-primary dark:border-gray-700">
            <h2 className="text-2xl font-bold mb-4">{currentNode.id ? 'Edit' : 'Create'} Content Node</h2>
            <div className="grid gap-4 mb-4">
              <FormGroup>
                <Label>Type (e.g. FAQ, Logistics, Photo)</Label>
                <Input type="text" value={currentNode.type || ''} onChange={e => setCurrentNode({...currentNode, type: e.target.value})} />
              </FormGroup>
              <FormGroup>
                <Label>Tags (comma separated)</Label>
                <Input type="text" value={currentNode.tags?.join(', ') || ''} onChange={e => setCurrentNode({...currentNode, tags: e.target.value.split(',').map(t => t.trim())})} />
              </FormGroup>
              
              <div>
                <label className="block text-sm font-semibold mb-2 text-gray-900 dark:text-gray-100">Dynamic Data Fields</label>
                {dynamicData.map((field, idx) => (
                  <div key={idx} className="flex gap-2 mb-2 items-center">
                    <FormGroup className="w-1/3">
                      <Input type="text" placeholder="Key" value={field.key} onChange={(e) => updateField(idx, 'key', e.target.value)} />
                    </FormGroup>
                    <FormGroup className="w-2/3">
                      <Input type="text" placeholder="Value" value={field.value} onChange={(e) => updateField(idx, 'value', e.target.value)} />
                    </FormGroup>
                    <Button variant="danger" size="sm" onClick={() => removeField(idx)}>X</Button>
                  </div>
                ))}
                <Button variant="outline" size="sm" onClick={addField} className="mt-2">+ Add Field</Button>
              </div>

            </div>
            <div className="flex gap-4 mt-6">
              <Button onClick={handleSave} variant="primary">Save</Button>
              {currentNode.type === 'Photo' && (
                <Button onClick={handleScrapePhoto} variant="secondary">Scrape Metadata from URL</Button>
              )}
              <Button variant="ghost" onClick={() => setIsEditing(false)}>Cancel</Button>
            </div>
          </div>
        )}

        <div className="grid gap-4 pb-10" ref={containerRef}>
          {nodes.map(node => (
            <div key={node.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-primary flex justify-between items-center">
              <div>
                <div className="font-bold text-lg">{node.type} <span className="text-sm font-normal text-gray-500 dark:text-gray-400">({node.tags.join(', ')})</span></div>
                <div className="text-sm mt-1 text-gray-700 dark:text-gray-300">
                  {JSON.stringify(node.data).substring(0, 100)}...
                </div>
              </div>
              <div className="space-x-2 flex">
                <Button variant="secondary" size="sm" onClick={() => { 
                  setCurrentNode(node); 
                  const d = node.data as Record<string, string>;
                  setDynamicData(Object.keys(d).map(k => ({key: k, value: String(d[k])})));
                  setIsEditing(true); 
                }}>Edit</Button>
                <Button variant="danger" size="sm" onClick={(e) => handleDelete(node.id, e)}>Delete</Button>
              </div>
            </div>
          ))}
          {nodes.length === 0 && <p className="text-gray-500 dark:text-gray-400">No content nodes found.</p>}
        </div>
      </div>
    </AdminPreviewLayout>
  );
}

