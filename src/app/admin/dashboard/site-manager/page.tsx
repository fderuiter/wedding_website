'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

import { FormGroup, Label, Input, Textarea } from '@/components/ui/forms';
import { useToast } from '@/components/ui/ToastProvider';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { useAdminFeatures } from '@/hooks/admin/useAdminFeatures';

function DragDropSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          className="p-4 rounded-xl shadow border border-primary dark:border-primary flex justify-between items-center bg-white dark:bg-gray-800 animate-pulse"
        >
          <div className="flex items-center gap-4 w-full">
            <div className="h-6 w-6 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="space-y-2 w-1/3">
              <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
              <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
            </div>
          </div>
          <div className="h-10 w-20 bg-gray-200 dark:bg-gray-700 rounded" />
        </div>
      ))}
    </div>
  );
}

const DragDropContainer = dynamic(
  () => import('./components/DragDropContainer'),
  {
    ssr: false,
    loading: () => <DragDropSkeleton />,
  }
);

export default function SiteManagerPage() {
  const { addToast } = useToast();
  const { features, loading, error, saveFeatures } = useAdminFeatures();

  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [customContent, setCustomContent] = useState('');

  const toggleVisibility = (id: string) => {
    const updated = features.map(f => f.id === id ? { ...f, visible: !f.visible } : f);
    saveFeatures(updated).then(() => addToast('Section visibility updated', 'success'));
  };

  const addCustomSection = () => {
    if (!customTitle.trim() || !customContent.trim()) {
      addToast('Title and content are required.', 'error');
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
    saveFeatures(updated).then(() => addToast('Section added', 'success'));
    setShowCustomModal(false);
    setCustomTitle('');
    setCustomContent('');
  };

  if (loading) return <div className="p-8 text-center text-primary">Loading Site Manager...</div>;
  if (error) return <div className="p-8 text-center text-red-500">Error: {error}</div>;

  return (
    <div className="py-10">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-extrabold text-primary tracking-tight">Visual Site Manager</h1>
          <div className="space-x-4">
            <Button onClick={() => setShowCustomModal(true)} variant="secondary">Add Custom Section</Button>
          </div>
        </div>

        <p className="mb-6 text-lg text-gray-700 dark:text-gray-300">
          Drag and drop sections to reorder them on the homepage. Toggle the eye icon to show or hide a section. Use Tab to navigate and Space/Enter to select and move items.
        </p>

        <DragDropContainer
          features={features}
          saveFeatures={saveFeatures}
          toggleVisibility={toggleVisibility}
        />

        <Dialog
          isOpen={showCustomModal}
          onClose={() => setShowCustomModal(false)}
          title="Add Custom Section"
          aria-labelledby="modal-title"
          className="dark:bg-gray-800"
        >
          <div className="space-y-4">
            <FormGroup>
              <Label>Section Title</Label>
              <Input type="text" value={customTitle} onChange={e => setCustomTitle(e.target.value)} placeholder="e.g. Health & Safety" />
            </FormGroup>
            <FormGroup>
              <Label>Content</Label>
              <Textarea value={customContent} onChange={e => setCustomContent(e.target.value)} rows={5} placeholder="Add your content here... Use double line breaks for paragraphs." />
            </FormGroup>
            <div className="flex gap-4 mt-6">
              <Button onClick={addCustomSection} className="flex-1 bg-green-600 hover:bg-green-700">Save Section</Button>
              <Button onClick={() => setShowCustomModal(false)} variant="ghost" className="flex-1">Cancel</Button>
            </div>
          </div>
        </Dialog>
      </div>
    </div>
  );
}
