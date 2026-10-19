'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Checkbox } from '@/components/ui/forms';
import { apiClient } from '@/lib/apiClient';
import type { MediaDTO } from '@/features/media';
import { MediaImage } from '@/components/MediaImage';
import Dropzone from '@/components/Dropzone';
import EmptyState from '@/components/EmptyState';

export default function MediaDashboardPage() {
  const [media, setMedia] = useState<MediaDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMedia, setCurrentMedia] = useState<Partial<MediaDTO>>({});
  const [isEditing, setIsEditing] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    fetchMedia(page);
  }, [page]);

  const fetchMedia = async (targetPage = page) => {
    try {
      setLoading(true);
      const res = await apiClient.get(`/api/media?page=${targetPage}&limit=${limit}`);
      if (res && typeof res === 'object' && 'data' in res && Array.isArray(res.data)) {
        setMedia(res.data);
        setTotal(res.total ?? 0);
        setTotalPages(res.totalPages ?? 1);
        const resPage = res.page ?? targetPage;
        if (resPage !== page) {
          setPage(resPage);
        }
      } else if (Array.isArray(res)) {
        setMedia(res);
        setTotal(res.length);
        setTotalPages(1);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadSuccess = (url: string, file: File) => {
    setCurrentMedia(prev => ({
      ...prev,
      url,
      altText: (!prev.isDecorative && (!prev.altText || prev.altText.trim() === '')) ? file.name : prev.altText,
    }));
  };

  const handleSave = async () => {
    try {
      if (currentMedia.id) {
        await apiClient.put(`/api/media/${currentMedia.id}`, currentMedia);
      } else {
        await apiClient.post('/api/media', currentMedia);
      }
      setIsEditing(false);
      fetchMedia(page);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this media? It may break references.')) return;
    try {
      await apiClient.delete(`/api/media/${id}`);
      setSelectedIds(prev => prev.filter(i => i !== id));
      if (media.length === 1 && page > 1) {
        setPage(p => p - 1);
      } else {
        fetchMedia(page);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const toggleSelectMedia = (id: string) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAllPage = () => {
    if (media.length === 0) return;
    const allPageSelected = media.every(m => selectedIds.includes(m.id));
    if (allPageSelected) {
      setSelectedIds(prev => prev.filter(id => !media.some(m => m.id === id)));
    } else {
      const pageIds = media.map(m => m.id);
      setSelectedIds(prev => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const handleExportZip = async (targetIds?: string[]) => {
    setIsExporting(true);
    try {
      const payload = targetIds && targetIds.length > 0 ? { ids: targetIds } : undefined;
      const url = '/api/media/export';

      let res: Response;
      if (payload) {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch(url);
      }

      if (!res.ok) {
        throw new Error(`Export request failed with HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = targetIds && targetIds.length > 0 ? 'selected-media.zip' : 'media-export.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Failed to export media archive:', e);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="py-10 px-4 sm:px-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
        <h1 className="text-3xl font-extrabold text-primary">Media Library</h1>

        <div className="flex flex-wrap items-center gap-3">
          {selectedIds.length > 0 && (
            <Button
              onClick={() => handleExportZip(selectedIds)}
              disabled={isExporting}
              variant="secondary"
              data-testid="export-selected-admin-btn"
            >
              Export Selected ({selectedIds.length}) (.zip)
            </Button>
          )}

          <Button
            onClick={() => handleExportZip()}
            disabled={isExporting}
            variant="secondary"
            data-testid="export-all-admin-btn"
          >
            Export All (.zip)
          </Button>

          <Button onClick={() => { setCurrentMedia({ url: '', altText: '', isDecorative: false }); setIsEditing(true); }}>
            Add Media
          </Button>
        </div>
      </div>

      {isEditing && (
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg mb-8 border border-primary dark:border-gray-700">
          <h2 className="text-2xl font-bold mb-4">{currentMedia.id ? 'Edit' : 'Create'} Media</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <FormGroup className="md:col-span-2">
              <Label>File Upload</Label>
              <Dropzone onUploadSuccess={handleUploadSuccess} />
            </FormGroup>
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
                <Checkbox checked={currentMedia.isDecorative || false} onChange={e => setCurrentMedia({...currentMedia, isDecorative: e.target.checked})} className="mr-2" />
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
        <>
          {media.length === 0 ? (
            <EmptyState
              message="No media items available in the library."
              actionLabel="Add Media"
              onAction={() => {
                setCurrentMedia({ url: '', altText: '', isDecorative: false });
                setIsEditing(true);
              }}
            />
          ) : (
            <>
              <div className="flex justify-between items-center mb-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleSelectAllPage}
                  data-testid="select-all-media-btn"
                >
                  {media.length > 0 && media.every(m => selectedIds.includes(m.id))
                    ? 'Deselect Page Items'
                    : 'Select Page Items'}
                </Button>
                {selectedIds.length > 0 && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                    {selectedIds.length} item(s) selected
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {media.map(m => {
                  const isSelected = selectedIds.includes(m.id);
                  return (
                    <div
                      key={m.id}
                      className={`bg-white dark:bg-gray-800 p-4 rounded-xl shadow border flex flex-col relative ${
                        isSelected ? 'ring-2 ring-primary border-primary' : ''
                      }`}
                    >
                      <div className="absolute top-2 left-2 z-10 p-1 bg-white/80 dark:bg-gray-900/80 backdrop-blur rounded">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectMedia(m.id)}
                          aria-label={`Select media item ${m.altText || m.id}`}
                          data-testid={`media-checkbox-${m.id}`}
                          className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer"
                        />
                      </div>

                      <div className="relative h-32 w-full mb-4">
                        <MediaImage media={m} fallbackUrl="/images/placeholder.png" className="object-cover w-full h-full rounded" />
                      </div>
                      <div className="text-sm truncate mb-1" title={m.url}>{m.url}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">{m.isDecorative ? 'Decorative' : m.altText || 'No Alt Text'}</div>
                      <div className="mt-auto flex justify-between gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label={m.altText ? `Edit media: ${m.altText}` : 'Edit unnamed item'}
                          onClick={() => { setCurrentMedia(m); setIsEditing(true); }}
                          className="flex-1"
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          aria-label={m.altText ? `Delete media: ${m.altText}` : 'Delete unnamed item'}
                          onClick={() => handleDelete(m.id)}
                          className="flex-1"
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div className="flex justify-between items-center mt-8 pt-4 border-t border-gray-200 dark:border-gray-700" data-testid="media-pagination-controls">
            <Button
              variant="secondary"
              disabled={page <= 1 || loading}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              Previous
            </Button>
            <span className="text-sm text-gray-600 dark:text-gray-300">
              Page {page} of {totalPages || 1} ({total} items)
            </span>
            <Button
              variant="secondary"
              disabled={page >= totalPages || totalPages === 0 || loading}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              aria-label="Next page"
            >
              Next
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
