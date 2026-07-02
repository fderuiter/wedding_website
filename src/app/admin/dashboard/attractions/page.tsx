"use client";
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import type { AttractionDTO } from '@/features/attractions/schemas';
import { useAdminAttractions } from '@/hooks/admin/useAdminAttractions';

import AdminPreviewLayout from "@/components/admin/AdminPreviewLayout";
import { AdminEditorContainer } from "@/components/admin/AdminEditorContainer";
import { FormGroup, Label, Input, Textarea, Select, Checkbox } from "@/components/ui/forms";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";
import { useFocusSuccessor } from "@/hooks/useFocusSuccessor";

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

  if (isLoading) return <main className="min-h-screen flex items-center justify-center"><p>Loading...</p></main>;
  if (error) return <main className="min-h-screen flex items-center justify-center"><p className="text-red-500">Error: {error.message}</p></main>;

  const draftAttraction = {
    id: currentAttraction.id || 'draft',
    name: currentAttraction.name || '',
    description: currentAttraction.description || '',
    image: currentAttraction.image || '',
    category: currentAttraction.category || 'food',
    website: currentAttraction.website || '',
    directions: currentAttraction.directions || '',
    latitude: currentAttraction.latitude || 0,
    longitude: currentAttraction.longitude || 0,
    isVisible: currentAttraction.isVisible !== false,
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
              setCurrentAttraction({ name: '', description: '', image: '', category: 'food', website: '', directions: '', latitude: 0, longitude: 0, isVisible: true }); 
              setIsEditing(true); 
            }}>Add New Attraction</Button>
          </div>
        </div>

        {isEditing && (
          <AdminEditorContainer title={`${currentAttraction.id ? 'Edit' : 'Create'} Attraction`}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <FormGroup>
                <Label>Name</Label>
                <Input type="text" value={currentAttraction.name || ''} onChange={e => setCurrentAttraction({...currentAttraction, name: e.target.value})} />
              </FormGroup>
              <FormGroup>
                <Label>Category</Label>
                <Select value={currentAttraction.category || 'food'} onChange={e => setCurrentAttraction({...currentAttraction, category: e.target.value})}>
                  <option value="food">Food</option>
                  <option value="coffee">Coffee</option>
                  <option value="park">Park</option>
                  <option value="museum">Museum</option>
                  <option value="hotel">Hotel</option>
                  <option value="venue">Venue</option>
                </Select>
              </FormGroup>
              <FormGroup className="md:col-span-2">
                <Label>Description</Label>
                <Textarea value={currentAttraction.description || ''} onChange={e => setCurrentAttraction({...currentAttraction, description: e.target.value})} />
              </FormGroup>
              <FormGroup>
                <Label>Image URL</Label>
                <Input type="text" value={currentAttraction.image || ''} onChange={e => setCurrentAttraction({...currentAttraction, image: e.target.value})} />
              </FormGroup>
              <FormGroup>
                <Label>Website URL</Label>
                <Input type="text" value={currentAttraction.website || ''} onChange={e => setCurrentAttraction({...currentAttraction, website: e.target.value})} />
              </FormGroup>
              <FormGroup>
                <Label>Directions URL</Label>
                <Input type="text" value={currentAttraction.directions || ''} onChange={e => setCurrentAttraction({...currentAttraction, directions: e.target.value})} />
              </FormGroup>
              <FormGroup>
                <Label className="flex items-center gap-2">
                  <Checkbox checked={currentAttraction.isVisible !== false} onChange={e => setCurrentAttraction({...currentAttraction, isVisible: e.target.checked})} />
                  Is Visible
                </Label>
              </FormGroup>
              <FormGroup>
                <Label>Latitude</Label>
                <Input type="number" step="any" value={currentAttraction.latitude || 0} onChange={e => setCurrentAttraction({...currentAttraction, latitude: parseFloat(e.target.value)})} />
              </FormGroup>
              <FormGroup>
                <Label>Longitude</Label>
                <Input type="number" step="any" value={currentAttraction.longitude || 0} onChange={e => setCurrentAttraction({...currentAttraction, longitude: parseFloat(e.target.value)})} />
              </FormGroup>
            </div>
            <div className="flex gap-4 mt-6">
              <Button onClick={handleSave} variant="primary">Save</Button>
              <Button variant="secondary" onClick={() => setIsEditing(false)}>Cancel</Button>
            </div>
          </AdminEditorContainer>
        )}

        <div className="grid gap-4 pb-10" ref={containerRef}>
          {attractions.map(attraction => (
            <div key={attraction.id} className={`bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-primary flex justify-between items-center ${!attraction.isVisible ? 'opacity-50' : ''}`}>
              <div className="flex items-center gap-4">
                {attraction.image && <img src={attraction.image} alt={attraction.name} className="w-16 h-16 rounded-lg object-cover" />}
                <div>
                  <div className="font-bold text-lg">{attraction.name} {!attraction.isVisible && <span className="text-red-500 text-sm">(Hidden)</span>}</div>
                  <div className="text-sm font-semibold text-secondary uppercase">{attraction.category}</div>
                  <div className="text-sm mt-1 text-gray-700 dark:text-gray-300">
                    {attraction.description}
                  </div>
                </div>
              </div>
              <div className="space-x-2 flex flex-col gap-2">
                <Button variant="secondary" size="sm" onClick={() => { 
                  setCurrentAttraction(attraction); 
                  setIsEditing(true); 
                }}>Edit</Button>
                <Button variant="danger" size="sm" onClick={(e) => handleDelete(attraction.id, e)}>Delete</Button>
              </div>
            </div>
          ))}
          {attractions.length === 0 && <p className="text-gray-500 dark:text-gray-400">No attractions found.</p>}
        </div>
      </div>
    </AdminPreviewLayout>
  );
}
