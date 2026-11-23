'use client';

import React, { useState } from 'react';
import type { AttractionDTO } from '@/features/attractions';
import { useAdminAttractions } from '@/hooks/admin/useAdminAttractions';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { AttractionEditorForm, AttractionCard } from '@/components/admin/AttractionEditor';
import { EnsureToastProvider, useToast } from '@/components/ui/ToastProvider';

interface AttractionsManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function AttractionsManagerModalContent({ isOpen, onClose }: AttractionsManagerModalProps) {
  const { confirm } = useToast();

  const {
    data: attractions,
    isLoading,
    error,
    create,
    update,
    remove,
  } = useAdminAttractions();

  const [isEditing, setIsEditing] = useState(false);
  const [currentAttraction, setCurrentAttraction] = useState<Partial<AttractionDTO>>({});
  const [saving, setSaving] = useState(false);

  const handleStartAdd = () => {
    setCurrentAttraction({
      name: '',
      description: '',
      imageUrl: '',
      category: 'food',
      website: '',
      directions: '',
      latitude: 0,
      longitude: 0,
      isVisible: true,
      promoCode: '',
      bookingUrl: '',
      roomRate: '',
      cutoffDate: '',
      shuttleInfo: '',
    });
    setIsEditing(true);
  };

  const handleStartEdit = (attraction: AttractionDTO) => {
    setCurrentAttraction(attraction);
    setIsEditing(true);
  };

  const handleSave = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (currentAttraction.id) {
        await update(currentAttraction.id, currentAttraction);
      } else {
        await create(currentAttraction);
      }
      setIsEditing(false);
    } catch {
      // Error handled globally or via toast
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const isConfirmed = await confirm('Are you sure you want to delete this attraction?');
    if (!isConfirmed) return;
    try {
      await remove(id);
    } catch {
      // Error handled globally
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Manage Local Attractions"
      description="Add, edit, or remove local attractions and hotel recommendations for your guests."
      className="max-w-2xl w-full max-h-[85vh] overflow-y-auto"
    >
      <div className="space-y-6 pt-2">
        {!isEditing && (
          <div className="flex justify-between items-center pb-2 border-b border-gray-200 dark:border-zinc-800">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {attractions.length} {attractions.length === 1 ? 'attraction' : 'attractions'} configured
            </span>
            <Button onClick={handleStartAdd} variant="primary" size="sm">
              Add New Attraction
            </Button>
          </div>
        )}

        {isEditing && (
          <AttractionEditorForm
            values={currentAttraction}
            onChange={(updated) => setCurrentAttraction((prev) => ({ ...prev, ...updated }))}
            onSubmit={handleSave}
            onCancel={() => setIsEditing(false)}
            bindFieldIds
            requireName
            submitLabel="Save Attraction"
            saving={saving}
            cancelVariant="ghost"
            actionsAlign="end"
            heading={currentAttraction.id ? 'Edit Attraction' : 'Add New Attraction'}
            className="bg-gray-50 dark:bg-zinc-800/60 p-4 rounded-lg border border-gray-200 dark:border-zinc-700 space-y-4"
          />
        )}

        {isLoading && (
          <div className="py-8 text-center text-gray-500">Loading attractions...</div>
        )}

        {error && (
          <div role="alert" className="p-3 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 rounded">
            Failed to load attractions: {error.message}
          </div>
        )}

        {!isLoading && !error && (
          <div className="space-y-3">
            {attractions.length === 0 ? (
              <p className="py-6 text-center text-gray-500 dark:text-gray-400">
                No attractions added yet. Click &quot;Add New Attraction&quot; above.
              </p>
            ) : (
              attractions.map((attraction) => (
                <AttractionCard
                  key={attraction.id}
                  attraction={attraction}
                  onEdit={handleStartEdit}
                  onDelete={(id) => handleDelete(id)}
                />
              ))
            )}
          </div>
        )}

        <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-zinc-800">
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function AttractionsManagerModal(props: AttractionsManagerModalProps) {
  const ToastBoundary =
    typeof EnsureToastProvider === 'function' ? EnsureToastProvider : React.Fragment;
  return (
    <ToastBoundary>
      <AttractionsManagerModalContent {...props} />
    </ToastBoundary>
  );
}
