'use client';
import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Checkbox } from '@/components/ui/forms';
import { apiClient } from '@/lib/apiClient';
import type { MediaDTO } from '@/features/media';
import { MediaImage } from '@/components/MediaImage';
import Dropzone from '@/components/Dropzone';
import EmptyState from '@/components/EmptyState';
import { Icon } from '@/components/ui/Icon';

interface PendingPhoto {
  id: string;
  mediaId?: string;
  url: string;
  title?: string;
  createdAt: string | Date;
  status?: string;
  data?: any;
}

export default function MediaDashboardPage() {
  const [media, setMedia] = useState<MediaDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMedia, setCurrentMedia] = useState<Partial<MediaDTO>>({});
  const [isEditing, setIsEditing] = useState(false);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [a11yNotice, setA11yNotice] = useState<string>('');

  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    fetchMedia(page);
    fetchPendingPhotos();
  }, [page]);

  const fetchPendingPhotos = async () => {
    try {
      const res = await apiClient.get('/api/admin/photos/moderation');
      if (res && res.photos && Array.isArray(res.photos)) {
        setPendingPhotos(res.photos);
      } else if (res && res.data && Array.isArray(res.data)) {
        setPendingPhotos(res.data);
      } else if (Array.isArray(res)) {
        setPendingPhotos(res);
      }
    } catch (e) {
      console.error('Failed to load pending photos:', e);
    }
  };

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

  const handleApprove = async (id: string) => {
    try {
      await apiClient.patch('/api/admin/photos/moderation', { id, action: 'approve' });
      setPendingPhotos((prev) => prev.filter((p) => p.id !== id));
      setA11yNotice('Photo approved successfully.');
      fetchMedia(page);
    } catch (e) {
      console.error(e);
      setA11yNotice('Failed to approve photo.');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await apiClient.patch('/api/admin/photos/moderation', { id, action: 'reject' });
      setPendingPhotos((prev) => prev.filter((p) => p.id !== id));
      setA11yNotice('Photo rejected and removed.');
    } catch (e) {
      console.error(e);
      setA11yNotice('Failed to reject photo.');
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
      <div role="status" aria-live="polite" className="sr-only" data-testid="moderation-announcer">
        {a11yNotice}
      </div>

      <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-primary">Media Library</h1>
          <p className="text-sm text-stone-500 dark:text-stone-400 mt-1">
            Manage photo gallery assets and inspect guest upload submissions.
          </p>
        </div>

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

          <Button
            variant={drawerOpen ? 'primary' : 'outline'}
            onClick={() => setDrawerOpen(!drawerOpen)}
            aria-expanded={drawerOpen}
            aria-controls="moderation-drawer"
            data-testid="toggle-moderation-drawer"
            className="relative flex items-center gap-2"
          >
            <Icon name="Camera" className="w-4 h-4" />
            <span>Moderation Queue</span>
            {pendingPhotos.length > 0 && (
              <span
                data-testid="pending-count-badge"
                className="ml-1 px-2 py-0.5 text-xs font-bold rounded-full bg-amber-500 text-stone-900"
              >
                {pendingPhotos.length}
              </span>
            )}
          </Button>

          <Button onClick={() => { setCurrentMedia({ url: '', altText: '', isDecorative: false }); setIsEditing(true); }}>
            Add Media
          </Button>
        </div>
      </div>

      {drawerOpen && (
        <div
          id="moderation-drawer"
          role="region"
          aria-label="Guest Photo Moderation Drawer"
          data-testid="moderation-drawer"
          className="mb-8 p-6 bg-stone-50 dark:bg-stone-900 border-2 border-amber-500/30 rounded-2xl shadow-lg transition-all"
        >
          <div className="flex justify-between items-center mb-6 pb-4 border-b border-stone-200 dark:border-stone-800">
            <div>
              <h2 className="text-xl font-bold text-stone-900 dark:text-stone-100 flex items-center gap-2">
                <Icon name="Camera" className="w-5 h-5 text-amber-500" />
                <span>Guest Photo Moderation</span>
              </h2>
              <p className="text-xs text-stone-500 dark:text-stone-400 mt-0.5">
                Review and approve photos submitted by guests before public gallery rendering.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold px-3 py-1 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800" data-testid="pending-photo-counter">
                {pendingPhotos.length} Pending
              </span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200 p-1 rounded-lg"
                aria-label="Close moderation drawer"
              >
                <Icon name="X" className="w-5 h-5" />
              </button>
            </div>
          </div>

          {pendingPhotos.length === 0 ? (
            <div className="text-center py-8" data-testid="empty-moderation-queue">
              <Icon name="Check" className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
              <p className="text-sm font-medium text-stone-700 dark:text-stone-300">
                All caught up! No guest photos waiting for review.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="pending-photos-list">
              {pendingPhotos.map((photo) => {
                const photoData = photo.data || {};
                const imageUrl = photo.url || photoData.url;
                const title = photo.title || photoData.title || photoData.altText || 'Guest Photo';
                const createdDate = photo.createdAt ? new Date(photo.createdAt).toLocaleString() : 'Recently';

                return (
                  <div
                    key={photo.id}
                    data-testid={`pending-photo-card-${photo.id}`}
                    className="p-4 rounded-xl border border-stone-200 dark:border-stone-800 bg-white dark:bg-stone-950 shadow-sm flex flex-col justify-between"
                  >
                    <div>
                      <div className="relative h-40 w-full mb-3 overflow-hidden rounded-lg bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800">
                        <MediaImage
                          media={{ id: photo.id, url: imageUrl, altText: title }}
                          fallbackUrl="/images/placeholder.png"
                          fallbackAlt="Unlabelled media asset"
                          className="object-cover w-full h-full"
                        />
                        <span className="absolute top-2 right-2 px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-amber-500 text-stone-900 shadow">
                          Pending
                        </span>
                      </div>
                      <div className="text-sm font-semibold text-stone-800 dark:text-stone-200 truncate mb-1" title={title}>
                        {title}
                      </div>
                      <div className="text-xs text-stone-500 dark:text-stone-400 mb-4 flex items-center gap-1">
                        <Icon name="Calendar" className="w-3 h-3 text-stone-400" />
                        <span>Submitted {createdDate}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-3 border-t border-stone-100 dark:border-stone-900">
                      <Button
                        variant="primary"
                        size="sm"
                        data-testid={`approve-photo-${photo.id}`}
                        onClick={() => handleApprove(photo.id)}
                        className="flex-1 flex items-center justify-center gap-1 text-xs py-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                        aria-label={`Approve photo ${title}`}
                      >
                        <Icon name="Check" className="w-3.5 h-3.5" />
                        Approve
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        data-testid={`reject-photo-${photo.id}`}
                        onClick={() => handleReject(photo.id)}
                        className="flex-1 flex items-center justify-center gap-1 text-xs py-2"
                        aria-label={`Reject photo ${title}`}
                      >
                        <Icon name="X" className="w-3.5 h-3.5" />
                        Reject
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
                        <MediaImage media={m} fallbackUrl="/images/placeholder.png" fallbackAlt="Unlabelled media asset" className="object-cover w-full h-full rounded" />
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
