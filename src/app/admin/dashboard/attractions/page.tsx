'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { AttractionDTO } from '@/features/attractions';
import { useAdminAttractions } from '@/hooks/admin/useAdminAttractions';

import AdminPreviewLayout from '@/components/admin/AdminPreviewLayout';
import { AdminEditorContainer } from '@/components/admin/AdminEditorContainer';
import { AttractionEditorForm, AttractionCard } from '@/components/admin/AttractionEditor';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/ToastProvider';
import { useFocusSuccessor } from '@/hooks/useFocusSuccessor';

/**
 * Renders the Attractions admin page: an authenticated CRUD interface for creating, editing, previewing, and deleting attractions.
 *
 * The page enforces an admin check on mount, displays loading/error states, integrates a live preview via AdminPreviewLayout, and provides an editor panel and list view for attractions.
 *
 * @returns The React element for the Attractions admin dashboard page.
 */
export default function AttractionsDashboardPage() {
  const router = useRouter();
  const { confirm } = useToast();
  const { containerRef, captureFocusTarget } = useFocusSuccessor<HTMLDivElement>();

  const {
    data: attractions,
    isLoading,
    error,
    fetchAll,
    create,
    update,
    remove
  } = useAdminAttractions();

  const [isEditing, setIsEditing] = useState(false);
  const [currentAttraction, setCurrentAttraction] = useState<Partial<AttractionDTO>>({});


  const handleSave = async () => {
    try {
      if (currentAttraction.id) {
        await update(currentAttraction.id, currentAttraction);
      } else {
        await create(currentAttraction);
      }
      setIsEditing(false);
    } catch (e: any) {
      // Error is handled by global MutationCache
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const card = e.currentTarget.closest('.bg-white');
    const isConfirmed = await confirm('Are you sure you want to delete this attraction?');
    if (!isConfirmed) return;
    if (card) {
      captureFocusTarget(card as HTMLElement);
    }
    try {
      await remove(id);
    } catch (e: any) {
      // Error is handled by global MutationCache
    }
  };

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><p>Loading...</p></div>;
  if (error) return <div className="min-h-screen flex items-center justify-center"><p className="text-red-500">Error: {error.message}</p></div>;

  const draftAttraction = {
    id: currentAttraction.id || 'draft',
    name: currentAttraction.name || '',
    description: currentAttraction.description || '',
    image: {
      url: currentAttraction.imageUrl || (currentAttraction.image as any)?.url || '',
      altText: currentAttraction.imageAlt || (currentAttraction.image as any)?.altText || '',
      isDecorative: currentAttraction.imageDecorative || (currentAttraction.image as any)?.isDecorative || false,
    },
    category: currentAttraction.category || 'food',
    website: currentAttraction.website || '',
    directions: currentAttraction.directions || '',
    latitude: currentAttraction.latitude || 0,
    longitude: currentAttraction.longitude || 0,
    isVisible: currentAttraction.isVisible !== false,
    promoCode: currentAttraction.promoCode || null,
    bookingUrl: currentAttraction.bookingUrl || null,
    roomRate: currentAttraction.roomRate || null,
    cutoffDate: currentAttraction.cutoffDate || null,
    shuttleInfo: currentAttraction.shuttleInfo || null,
  };

  const currentAttractionsWithDraft = attractions.map(a => a.id === currentAttraction.id ? draftAttraction : a);
  if (!currentAttraction.id && isEditing) {
    currentAttractionsWithDraft.push(draftAttraction as AttractionDTO);
  }

  return (
    <AdminPreviewLayout
      previewUrl="/things-to-do"
      draftType="attractions"
      draftData={currentAttractionsWithDraft}
      entityId={currentAttraction.id}
      onRestore={() => {
        setIsEditing(false);
        fetchAll();
      }}
    >
      <div className="py-10 px-4 sm:px-6 max-w-5xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-extrabold text-primary">Attractions Studio</h1>
          <div className="flex gap-4">
            <Button variant="ghost" onClick={() => router.push('/admin/dashboard')}>Back to Dashboard</Button>
            <Button onClick={() => { 
              setCurrentAttraction({ name: '', description: '', imageUrl: '', category: 'food', website: '', directions: '', latitude: 0, longitude: 0, isVisible: true, promoCode: '', bookingUrl: '', roomRate: '', cutoffDate: '', shuttleInfo: '' }); 
              setIsEditing(true); 
            }}>Add New Attraction</Button>
          </div>
        </div>

        {isEditing && (
          <AdminEditorContainer title={`${currentAttraction.id ? 'Edit' : 'Create'} Attraction`}>
            <AttractionEditorForm
              values={currentAttraction}
              onChange={(updated) => setCurrentAttraction((prev) => ({ ...prev, ...updated }))}
              onSubmit={handleSave}
              onCancel={() => setIsEditing(false)}
              submitLabel="Save"
              cancelVariant="secondary"
            />
          </AdminEditorContainer>
        )}

        <div className="grid gap-4 pb-10" ref={containerRef}>
          {attractions.map((attraction) => (
            <AttractionCard
              key={attraction.id}
              attraction={attraction}
              showSampleBadge
              unnamedAriaFallback
              className="dark:bg-gray-800 rounded-xl shadow border-primary dark:border-primary"
              onEdit={(item) => {
                setCurrentAttraction(item);
                setIsEditing(true);
              }}
              onDelete={handleDelete}
            />
          ))}
          {attractions.length === 0 && <p className="text-gray-500 dark:text-gray-400">No attractions found.</p>}
        </div>
      </div>
    </AdminPreviewLayout>
  );
}
