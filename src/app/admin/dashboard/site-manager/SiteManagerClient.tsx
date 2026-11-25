'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';

import { FormGroup, Label, Input, Textarea } from '@/components/ui/forms';
import { useToast } from '@/components/ui/ToastProvider';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { AdminViewState } from '@/components/admin/AdminViewState';
import { useAdminFeatures } from '@/hooks/admin/useAdminFeatures';

import type { Feature } from './components/DragDropContainer';

function DragDropSkeleton() {
  return (
    <div className="space-y-4">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          className="p-4 rounded-xl shadow border border-primary dark:border-primary flex flex-wrap justify-between items-center gap-3 bg-white dark:bg-gray-800 animate-pulse"
        >
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <div className="h-6 w-6 shrink-0 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="space-y-2 w-1/3 min-w-24">
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
  const { features, loading, error, saveFeatures, fetchAll } = useAdminFeatures();

  const [showCustomModal, setShowCustomModal] = useState(false);
  const [sectionToDelete, setSectionToDelete] = useState<Feature | null>(null);
  const [customTitle, setCustomTitle] = useState('');
  const [customContent, setCustomContent] = useState('');

  const toggleVisibility = (id: string) => {
    const updated = features.map(f => f.id === id ? { ...f, visible: !f.visible } : f);
    saveFeatures(updated).then(() => addToast('Section visibility updated', 'success'));
  };

  const deleteCustomSection = (id: string) => {
    const updated = features.filter(f => f.id !== id);
    saveFeatures(updated).then(() => addToast('Section deleted', 'success'));
    setSectionToDelete(null);
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

  return (
    <AdminViewState
      isLoading={loading}
      error={error}
      onRetry={fetchAll}
      loadingSkeleton={<DragDropSkeleton />}
    >
      <div className="py-10">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
            <h1 className="text-3xl sm:text-4xl font-extrabold text-primary tracking-tight">Visual Site Manager</h1>
            <div className="flex flex-wrap items-center gap-3">
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
            onDeleteSection={(id) => {
              const target = features.find(f => f.id === id);
              if (target) setSectionToDelete(target);
            }}
          />

          <Dialog
            isOpen={!!sectionToDelete}
            onClose={() => setSectionToDelete(null)}
            title="Delete Custom Section"
            className="dark:bg-gray-800"
          >
            <div className="space-y-4">
              <p className="text-gray-700 dark:text-gray-300">
                Are you sure you want to delete the section &quot;{sectionToDelete?.title || sectionToDelete?.id}&quot;? This action cannot be undone.
              </p>
              <div className="flex gap-4 mt-6">
                <Button
                  onClick={() => sectionToDelete && deleteCustomSection(sectionToDelete.id)}
                  variant="danger"
                  className="flex-1"
                >
                  Delete
                </Button>
                <Button
                  onClick={() => setSectionToDelete(null)}
                  variant="ghost"
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          </Dialog>

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
    </AdminViewState>
  );
}
