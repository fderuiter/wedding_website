'use client';

import React, { useState } from 'react';
import type { AttractionDTO } from '@/features/attractions';
import { useAdminAttractions } from '@/hooks/admin/useAdminAttractions';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Textarea, Select, Checkbox } from '@/components/ui/forms';
import { useToast } from '@/components/ui/ToastProvider';

interface AttractionsManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AttractionsManagerModal({ isOpen, onClose }: AttractionsManagerModalProps) {
  let toastConfirm: ((msg: string) => Promise<boolean>) | null = null;
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
          <form onSubmit={handleSave} className="bg-gray-50 dark:bg-zinc-800/60 p-4 rounded-lg border border-gray-200 dark:border-zinc-700 space-y-4">
            <h3 className="font-semibold text-lg">
              {currentAttraction.id ? 'Edit Attraction' : 'Add New Attraction'}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormGroup>
                <Label htmlFor="attractionName">Name</Label>
                <Input
                  id="attractionName"
                  type="text"
                  value={currentAttraction.name || ''}
                  onChange={(e) => setCurrentAttraction({ ...currentAttraction, name: e.target.value })}
                  required
                />
              </FormGroup>
              <FormGroup>
                <Label htmlFor="attractionCategory">Category</Label>
                <Select
                  id="attractionCategory"
                  value={currentAttraction.category || 'food'}
                  onChange={(e) => setCurrentAttraction({ ...currentAttraction, category: e.target.value })}
                >
                  <option value="food">Food</option>
                  <option value="coffee">Coffee</option>
                  <option value="park">Park</option>
                  <option value="museum">Museum</option>
                  <option value="hotel">Hotel</option>
                  <option value="venue">Venue</option>
                </Select>
              </FormGroup>
              <FormGroup className="md:col-span-2">
                <Label htmlFor="attractionDescription">Description</Label>
                <Textarea
                  id="attractionDescription"
                  value={currentAttraction.description || ''}
                  onChange={(e) => setCurrentAttraction({ ...currentAttraction, description: e.target.value })}
                />
              </FormGroup>
              <FormGroup>
                <Label htmlFor="attractionImageUrl">Image URL</Label>
                <Input
                  id="attractionImageUrl"
                  type="text"
                  value={currentAttraction.imageUrl || (currentAttraction.image as any)?.url || ''}
                  onChange={(e) => setCurrentAttraction({ ...currentAttraction, imageUrl: e.target.value })}
                />
              </FormGroup>
              <FormGroup>
                <Label htmlFor="attractionImageAlt">Image Alt Text</Label>
                <Input
                  id="attractionImageAlt"
                  type="text"
                  value={currentAttraction.imageAlt || (currentAttraction.image as any)?.altText || ''}
                  onChange={(e) => setCurrentAttraction({ ...currentAttraction, imageAlt: e.target.value })}
                  disabled={currentAttraction.imageDecorative || (currentAttraction.image as any)?.isDecorative}
                />
              </FormGroup>
              <FormGroup className="md:col-span-2">
                <div className="flex items-center">
                  <Checkbox
                    id="attractionImageDecorative"
                    checked={currentAttraction.imageDecorative || (currentAttraction.image as any)?.isDecorative || false}
                    onChange={(e) => setCurrentAttraction({ ...currentAttraction, imageDecorative: e.target.checked })}
                    className="mr-2"
                  />
                  <Label htmlFor="attractionImageDecorative" className="mb-0">
                    Decorative (no alt text)
                  </Label>
                </div>
              </FormGroup>
              <FormGroup>
                <Label htmlFor="attractionWebsite">Website URL</Label>
                <Input
                  id="attractionWebsite"
                  type="text"
                  value={currentAttraction.website || ''}
                  onChange={(e) => setCurrentAttraction({ ...currentAttraction, website: e.target.value })}
                />
              </FormGroup>
              <FormGroup>
                <Label htmlFor="attractionDirections">Directions URL</Label>
                <Input
                  id="attractionDirections"
                  type="text"
                  value={currentAttraction.directions || ''}
                  onChange={(e) => setCurrentAttraction({ ...currentAttraction, directions: e.target.value })}
                />
              </FormGroup>
              <FormGroup className="md:col-span-2">
                <div className="flex items-center">
                  <Checkbox
                    id="attractionIsVisible"
                    checked={currentAttraction.isVisible !== false}
                    onChange={(e) => setCurrentAttraction({ ...currentAttraction, isVisible: e.target.checked })}
                    className="mr-2"
                  />
                  <Label htmlFor="attractionIsVisible" className="mb-0">
                    Visible to public guests
                  </Label>
                </div>
              </FormGroup>
              <FormGroup>
                <Label htmlFor="attractionLatitude">Latitude</Label>
                <Input
                  id="attractionLatitude"
                  type="number"
                  step="any"
                  value={currentAttraction.latitude || 0}
                  onChange={(e) => setCurrentAttraction({ ...currentAttraction, latitude: parseFloat(e.target.value) })}
                />
              </FormGroup>
              <FormGroup>
                <Label htmlFor="attractionLongitude">Longitude</Label>
                <Input
                  id="attractionLongitude"
                  type="number"
                  step="any"
                  value={currentAttraction.longitude || 0}
                  onChange={(e) => setCurrentAttraction({ ...currentAttraction, longitude: parseFloat(e.target.value) })}
                />
              </FormGroup>

              {currentAttraction.category === 'hotel' && (
                <div className="md:col-span-2 border-t border-gray-200 dark:border-zinc-700 pt-4 mt-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <h4 className="md:col-span-2 text-md font-semibold text-gray-900 dark:text-gray-100">
                    Hotel Block Details
                  </h4>
                  <FormGroup>
                    <Label htmlFor="promoCode">Promo / Group Discount Code</Label>
                    <Input
                      id="promoCode"
                      type="text"
                      placeholder="e.g. WEDDING2026"
                      value={currentAttraction.promoCode || ''}
                      onChange={(e) => setCurrentAttraction({ ...currentAttraction, promoCode: e.target.value })}
                    />
                  </FormGroup>
                  <FormGroup>
                    <Label htmlFor="roomRate">Room Rate</Label>
                    <Input
                      id="roomRate"
                      type="text"
                      placeholder="e.g. $149/night"
                      value={currentAttraction.roomRate || ''}
                      onChange={(e) => setCurrentAttraction({ ...currentAttraction, roomRate: e.target.value })}
                    />
                  </FormGroup>
                  <FormGroup>
                    <Label htmlFor="cutoffDate">Cutoff Date</Label>
                    <Input
                      id="cutoffDate"
                      type="text"
                      placeholder="e.g. October 15, 2026"
                      value={currentAttraction.cutoffDate || ''}
                      onChange={(e) => setCurrentAttraction({ ...currentAttraction, cutoffDate: e.target.value })}
                    />
                  </FormGroup>
                  <FormGroup>
                    <Label htmlFor="bookingUrl">Booking Link</Label>
                    <Input
                      id="bookingUrl"
                      type="text"
                      placeholder="https://..."
                      value={currentAttraction.bookingUrl || ''}
                      onChange={(e) => setCurrentAttraction({ ...currentAttraction, bookingUrl: e.target.value })}
                    />
                  </FormGroup>
                  <FormGroup className="md:col-span-2">
                    <Label htmlFor="shuttleInfo">Shuttle Details</Label>
                    <Textarea
                      id="shuttleInfo"
                      placeholder="e.g. Free shuttle running to/from reception every 30 minutes"
                      value={currentAttraction.shuttleInfo || ''}
                      onChange={(e) => setCurrentAttraction({ ...currentAttraction, shuttleInfo: e.target.value })}
                    />
                  </FormGroup>
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <Button type="button" variant="ghost" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save Attraction'}
              </Button>
            </div>
          </form>
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
                <div
                  key={attraction.id}
                  className={`bg-white dark:bg-zinc-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-zinc-700 flex justify-between items-center gap-4 ${
                    !attraction.isVisible ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {attraction.image && (
                      <img
                        src={(attraction.image as any)?.url || '/images/placeholder.png'}
                        alt={(attraction.image as any)?.isDecorative ? '' : ((attraction.image as any)?.altText || attraction.name)}
                        className="w-12 h-12 rounded-lg object-cover bg-gray-100"
                      />
                    )}
                    <div>
                      <div className="font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                        {attraction.name}
                        {!attraction.isVisible && (
                          <span className="text-xs text-red-500 font-normal">(Hidden)</span>
                        )}
                      </div>
                      <div className="text-xs text-secondary font-medium uppercase">{attraction.category}</div>
                      {attraction.description && (
                        <div className="text-xs text-gray-600 dark:text-gray-400 line-clamp-1 mt-0.5">
                          {attraction.description}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={`Edit attraction: ${attraction.name}`}
                      disabled={attraction.id.startsWith('temp-')}
                      onClick={() => handleStartEdit(attraction)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      aria-label={`Delete attraction: ${attraction.name}`}
                      disabled={attraction.id.startsWith('temp-')}
                      onClick={() => handleDelete(attraction.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
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
