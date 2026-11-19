'use client';

import React, { useState, useEffect, useRef } from 'react';
import type { AttractionDTO } from '@/features/attractions';
import { useAdminAttractions } from '@/hooks/admin/useAdminAttractions';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { AttractionEditorForm, AttractionCard } from '@/components/admin/AttractionEditor';
import { useToast } from '@/components/ui/ToastProvider';

interface AttractionsManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AttractionsManagerModal({ isOpen, onClose }: AttractionsManagerModalProps) {
  let toastConfirm: ((_msg: string) => Promise<boolean>) | null = null;
  try {
    const toast = useToast();
    toastConfirm = toast.confirm;
  } catch {
    // Fallback if rendered outside ToastProvider
  }

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

  const formRef = useRef<HTMLFormElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const doneButtonRef = useRef<HTMLButtonElement | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const editingIdRef = useRef<string | null>(null);
  const prevIsEditingRef = useRef(isEditing);
  const pendingDeleteFocusRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      prevIsEditingRef.current = isEditing;
      return;
    }

    if (!prevIsEditingRef.current && isEditing) {
      const firstField = formRef.current?.querySelector<HTMLElement>(
        'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled)'
      );
      firstField?.focus();
    } else if (prevIsEditingRef.current && !isEditing) {
      const targetCard = editingIdRef.current
        ? cardRefs.current.get(editingIdRef.current)
        : undefined;
      const editBtn = targetCard?.querySelector<HTMLButtonElement>('button:not(:disabled)');
      if (editBtn && editBtn.isConnected) {
        editBtn.focus();
      } else {
        (addButtonRef.current ?? doneButtonRef.current)?.focus();
      }
      editingIdRef.current = null;
    }

    prevIsEditingRef.current = isEditing;
  }, [isOpen, isEditing]);

  useEffect(() => {
    if (isOpen && !isEditing && pendingDeleteFocusRef.current) {
      pendingDeleteFocusRef.current = false;
      (addButtonRef.current ?? doneButtonRef.current)?.focus();
    }
  }, [isOpen, isEditing, attractions.length]);

  const handleStartAdd = () => {
    editingIdRef.current = null;
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
    editingIdRef.current = attraction.id;
    setCurrentAttraction(attraction);
    setIsEditing(true);
  };

  const handleSave = async (e: React.FormEvent) => {
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
    const isConfirmed = toastConfirm
      ? await toastConfirm('Are you sure you want to delete this attraction?')
      : window.confirm('Are you sure you want to delete this attraction?');

    if (!isConfirmed) return;
    try {
      pendingDeleteFocusRef.current = true;
      await remove(id);
      if (!isEditing) {
        pendingDeleteFocusRef.current = false;
        (addButtonRef.current ?? doneButtonRef.current)?.focus();
      }
    } catch {
      pendingDeleteFocusRef.current = false;
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
            <Button ref={addButtonRef} onClick={handleStartAdd} variant="primary" size="sm">
              Add New Attraction
            </Button>
          </div>
        )}

        {isEditing && (
          <AttractionEditorForm
            ref={formRef}
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
                  ref={(node) => {
                    if (node) {
                      cardRefs.current.set(attraction.id, node);
                    } else {
                      cardRefs.current.delete(attraction.id);
                    }
                  }}
                  attraction={attraction}
                  onEdit={handleStartEdit}
                  onDelete={(id) => handleDelete(id)}
                />
              ))
            )}
          </div>
        )}

        <div className="flex justify-end pt-4 border-t border-gray-200 dark:border-zinc-800">
          <Button ref={doneButtonRef} variant="secondary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
