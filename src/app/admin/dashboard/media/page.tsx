"use client";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { FormGroup, Label, Input } from "@/components/ui/forms";
import { apiClient } from "@/lib/apiClient";
import { MediaDTO } from "@/features/media/schemas";
import { MediaImage } from "@/components/MediaImage";

export default function MediaDashboardPage() {
  const [media, setMedia] = useState<MediaDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMedia, setCurrentMedia] = useState<Partial<MediaDTO>>({});
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    fetchMedia();
  }, []);

  const fetchMedia = async () => {
    try {
      setLoading(true);
      const data = await apiClient.get('/api/media');
      setMedia(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      if (currentMedia.id) {
        await apiClient.put(`/api/media/${currentMedia.id}`, currentMedia);
      } else {
        await apiClient.post('/api/media', currentMedia);
      }
      setIsEditing(false);
      fetchMedia();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this media? It may break references.')) return;
    try {
      await apiClient.delete(`/api/media/${id}`);
      fetchMedia();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="py-10 px-4 sm:px-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-extrabold text-primary">Media Library</h1>
        <Button onClick={() => { setCurrentMedia({ url: '', altText: '', isDecorative: false }); setIsEditing(true); }}>Add Media</Button>
      </div>

      {isEditing && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg mb-8 border border-primary dark:border-gray-700">
          <h2 className="text-2xl font-bold mb-4">{currentMedia.id ? 'Edit' : 'Create'} Media</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <FormGroup>
              <Label>Image URL</Label>
              <Input type="url" value={currentMedia.url || ''} onChange={e => setCurrentMedia({...currentMedia, url: e.target.value})} />
            </FormGroup>
            <FormGroup>
              <Label>Alternative Text</Label>
              <Input type="text" value={currentMedia.altText || ''} onChange={e => setCurrentMedia({...currentMedia, altText: e.target.value})} disabled={currentMedia.isDecorative} />
            </FormGroup>
            <FormGroup className="md:col-span-2">
              <div className="flex items-center">
                <input type="checkbox" checked={currentMedia.isDecorative || false} onChange={e => setCurrentMedia({...currentMedia, isDecorative: e.target.checked})} className="mr-2" />
                <Label className="mb-0">Decorative (no alt text)</Label>
              </div>
            </FormGroup>
          </div>
          <div className="flex gap-4 mt-6">
            <Button onClick={handleSave} variant="primary">Save</Button>
            <Button onClick={() => setIsEditing(false)} variant="ghost">Cancel</Button>
          </div>
        </div>
      )}

      {loading ? <p>Loading...</p> : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {media.map(m => (
            <div key={m.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border flex flex-col">
              <div className="relative h-32 w-full mb-4">
                <MediaImage media={m} fallbackUrl="/images/placeholder.png" className="object-cover w-full h-full rounded" />
              </div>
              <div className="text-sm truncate mb-1" title={m.url}>{m.url}</div>
              <div className="text-sm text-gray-500 mb-4">{m.isDecorative ? 'Decorative' : m.altText || 'No Alt Text'}</div>
              <div className="mt-auto flex justify-between gap-2">
                <Button variant="secondary" size="sm" onClick={() => { setCurrentMedia(m); setIsEditing(true); }} className="flex-1">Edit</Button>
                <Button variant="danger" size="sm" onClick={() => handleDelete(m.id)} className="flex-1">Delete</Button>
              </div>
            </div>
          ))}
          {media.length === 0 && <p className="col-span-full">No media found.</p>}
        </div>
      )}
    </div>
  );
}
