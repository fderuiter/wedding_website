'use client';
import { Fragment, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AdminViewState } from '@/components/admin/AdminViewState';
import { PhotoUploadQRModal } from '@/components/admin/PhotoUploadQRModal';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { FormGroup, Label, Input, Checkbox } from '@/components/ui/forms';
import { apiClient } from '@/lib/apiClient';
import type { MediaDTO } from '@/features/media';
import { MediaImage } from '@/components/MediaImage';
import Dropzone from '@/components/Dropzone';
import EmptyState from '@/components/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { EnsureToastProvider, useToast } from '@/components/ui/ToastProvider';
import { triggerNativeExportDownload } from '@/utils/exportDownload';

interface PendingPhoto {
  id: string;
  mediaId?: string;
  url: string;
  title?: string;
  uploaderName?: string;
  caption?: string;
  originalFilename?: string;
  createdAt: string | Date;
  status?: string;
  data?: any;
}

interface MediaDashboardContentProps {
  media: MediaDTO[];
  loading: boolean;
  page: number;
  totalPages: number;
  total: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  pendingPhotos: PendingPhoto[];
  setPendingPhotos: React.Dispatch<React.SetStateAction<PendingPhoto[]>>;
  drawerOpen: boolean;
  setDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  a11yNotice: string;
  setA11yNotice: React.Dispatch<React.SetStateAction<string>>;
  fetchMedia: (_targetPage?: number, _options?: { background?: boolean }) => Promise<void>;
  qrUploadUrl: string;
  qrActiveUploadUrl?: string;
  qrConfiguredUploadUrl?: string;
  qrTokenVersion: number;
  autoApproveGuestPhotos: boolean;
  onToggleAutoApprove: () => Promise<void>;
  isUpdatingAutoApprove: boolean;
  onRotateQrToken: () => Promise<void>;
  isRotatingQrToken: boolean;
  onEnsureQrLoaded: () => Promise<void>;
}

function MediaDashboardContent({
  media,
  loading,
  page,
  totalPages,
  total,
  setPage,
  pendingPhotos,
  setPendingPhotos,
  drawerOpen,
  setDrawerOpen,
  a11yNotice,
  setA11yNotice,
  fetchMedia,
  qrUploadUrl,
  qrActiveUploadUrl,
  qrConfiguredUploadUrl,
  qrTokenVersion,
  autoApproveGuestPhotos,
  onToggleAutoApprove,
  isUpdatingAutoApprove,
  onRotateQrToken,
  isRotatingQrToken,
  onEnsureQrLoaded,
}: MediaDashboardContentProps) {
  const [currentMedia, setCurrentMedia] = useState<Partial<MediaDTO>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedPendingIds, setSelectedPendingIds] = useState<string[]>([]);
  const [pendingEdits, setPendingEdits] = useState<
    Record<string, { caption: string; uploaderName: string }>
  >({});
  const [isExporting, setIsExporting] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const { confirm, addToast } = useToast();

  const handleOpenQrModal = () => {
    setQrModalOpen(true);
    void onEnsureQrLoaded();
  };

  const getPendingDraft = (photo: PendingPhoto) => {
    const existing = pendingEdits[photo.id];
    if (existing) {
      return existing;
    }
    const photoData = photo.data || {};
    return {
      caption: String(photo.caption ?? photoData.caption ?? ''),
      uploaderName: String(photo.uploaderName ?? photoData.uploaderName ?? ''),
    };
  };

  const updatePendingDraft = (
    photo: PendingPhoto,
    patch: Partial<{ caption: string; uploaderName: string }>
  ) => {
    setPendingEdits((prev) => {
      const base = prev[photo.id] ?? {
        caption: String(photo.caption ?? photo.data?.caption ?? ''),
        uploaderName: String(photo.uploaderName ?? photo.data?.uploaderName ?? ''),
      };
      return {
        ...prev,
        [photo.id]: {
          ...base,
          ...patch,
        },
      };
    });
  };

  const handleApprove = async (id: string) => {
    try {
      const draftOverride = pendingEdits[id];
      const payload = draftOverride
        ? {
          id,
          action: 'approve',
          caption: draftOverride.caption,
          uploaderName: draftOverride.uploaderName,
        }
        : { id, action: 'approve' };
      await apiClient.patch('/api/admin/photos/moderation', payload);
      setPendingPhotos((prev) => prev.filter((p) => p.id !== id));
      setPendingEdits((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setA11yNotice('Photo approved successfully.');
      fetchMedia(page, { background: true });
    } catch (e) {
      console.error(e);
      setA11yNotice('Failed to approve photo.');
    }
  };

  const handleReject = async (id: string) => {
    const confirmed = await confirm(
      'Reject this photo? Rejecting permanently deletes the uploaded photo and cannot be undone.'
    );
    if (!confirmed) return;
    try {
      await apiClient.patch('/api/admin/photos/moderation', { id, action: 'reject' });
      setPendingPhotos((prev) => prev.filter((p) => p.id !== id));
      setSelectedPendingIds((prev) => prev.filter((i) => i !== id));
      setPendingEdits((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setA11yNotice('Photo rejected and removed.');
    } catch (e) {
      console.error(e);
      setA11yNotice('Failed to reject photo.');
    }
  };

  const handleBatchApprove = async (idsToApprove: string[] = selectedPendingIds) => {
    if (idsToApprove.length === 0) return;
    try {
      const batchPendingEdits: Record<string, { caption: string; uploaderName: string }> = {};
      for (const id of idsToApprove) {
        if (pendingEdits[id] !== undefined) {
          batchPendingEdits[id] = pendingEdits[id];
        }
      }
      const payload =
        Object.keys(batchPendingEdits).length > 0
          ? { ids: idsToApprove, action: 'approve', pendingEdits: batchPendingEdits }
          : { ids: idsToApprove, action: 'approve' };
      await apiClient.post('/api/admin/photos/moderation/batch', payload);
      setPendingPhotos((prev) => prev.filter((p) => !idsToApprove.includes(p.id)));
      setSelectedPendingIds((prev) => prev.filter((id) => !idsToApprove.includes(id)));
      setPendingEdits((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of idsToApprove) {
          if (id in next) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setA11yNotice(`Successfully approved ${idsToApprove.length} photo(s).`);
      fetchMedia(page, { background: true });
    } catch (e) {
      console.error(e);
      setA11yNotice('Failed to approve selected photos.');
    }
  };

  const handleBatchReject = async (idsToReject: string[] = selectedPendingIds) => {
    if (idsToReject.length === 0) return;
    const confirmed = await confirm(
      `Reject ${idsToReject.length} selected photo(s)? Rejecting permanently deletes the uploaded photos and cannot be undone.`
    );
    if (!confirmed) return;
    try {
      await apiClient.post('/api/admin/photos/moderation/batch', { ids: idsToReject, action: 'reject' });
      setPendingPhotos((prev) => prev.filter((p) => !idsToReject.includes(p.id)));
      setSelectedPendingIds((prev) => prev.filter((id) => !idsToReject.includes(id)));
      setPendingEdits((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of idsToReject) {
          if (id in next) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setA11yNotice(`Successfully rejected and removed ${idsToReject.length} photo(s).`);
    } catch (e) {
      console.error(e);
      setA11yNotice('Failed to reject selected photos.');
    }
  };

  const toggleSelectPendingPhoto = (id: string) => {
    setSelectedPendingIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const toggleSelectAllPendingPhotos = () => {
    if (pendingPhotos.length === 0) return;
    const allSelected = pendingPhotos.every((p) => selectedPendingIds.includes(p.id));
    if (allSelected) {
      setSelectedPendingIds([]);
    } else {
      setSelectedPendingIds(pendingPhotos.map((p) => p.id));
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
        const createPayload: Record<string, unknown> = { ...currentMedia };
        if (typeof createPayload.caption === 'string' && !createPayload.caption.trim()) {
          delete createPayload.caption;
        }
        if (typeof createPayload.uploaderName === 'string' && !createPayload.uploaderName.trim()) {
          delete createPayload.uploaderName;
        }
        await apiClient.post('/api/media', createPayload);
      }
      setIsEditing(false);
      fetchMedia(page, { background: true });
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm('Delete this media? It may break references.');
    if (!confirmed) return;
    try {
      await apiClient.delete(`/api/media/${id}`);
      setSelectedIds(prev => prev.filter(i => i !== id));
      if (media.length === 1 && page > 1) {
        setPage(p => p - 1);
      } else {
        fetchMedia(page, { background: true });
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
      const hasTargetIds = Boolean(targetIds && targetIds.length > 0);
      const filename = hasTargetIds ? 'selected-media.zip' : 'media-export.zip';
      await triggerNativeExportDownload({
        url: '/api/media/export',
        filename,
        payload: hasTargetIds ? { ids: targetIds } : undefined,
      });
    } catch (e) {
      console.error('Failed to export media archive:', e);
      addToast('Failed to export media archive. Please retry the download.', 'error');
      setA11yNotice('Failed to export media archive. Please retry the download.');
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
          <div className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-lg border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800">
            <span
              id="auto-approve-guest-photos-label"
              className="text-xs sm:text-sm font-semibold text-stone-800 dark:text-stone-100"
            >
              Auto-Approve Uploads
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={autoApproveGuestPhotos}
              aria-labelledby="auto-approve-guest-photos-label"
              disabled={isUpdatingAutoApprove}
              onClick={() => {
                void onToggleAutoApprove();
              }}
              data-testid="auto-approve-guest-photos-toggle"
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:opacity-50 ${
                autoApproveGuestPhotos ? 'bg-emerald-600' : 'bg-stone-300 dark:bg-stone-600'
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  autoApproveGuestPhotos ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={handleOpenQrModal}
            data-testid="open-photo-qr-modal-btn"
            className="flex items-center gap-2"
          >
            <Icon name="Share2" className="w-4 h-4" aria-hidden="true" />
            <span>Upload QR &amp; Cards</span>
          </Button>

          <Link
            href="/photos/slideshow"
            data-testid="admin-launch-slideshow-link"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border border-stone-300 dark:border-stone-700 bg-white dark:bg-stone-800 text-stone-800 dark:text-stone-100 hover:bg-stone-100 dark:hover:bg-stone-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Icon name="Monitor" className="w-4 h-4" aria-hidden="true" />
            <span>Live Slideshow</span>
          </Link>

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
                className="text-muted-text hover:text-stone-600 dark:hover:text-stone-200 p-1 rounded-lg"
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
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4 p-3 rounded-xl bg-stone-100 dark:bg-stone-950 border border-stone-200 dark:border-stone-800">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleSelectAllPendingPhotos}
                  data-testid="select-all-pending-btn"
                >
                  {pendingPhotos.length > 0 && pendingPhotos.every((p) => selectedPendingIds.includes(p.id))
                    ? 'Deselect All Pending'
                    : 'Select All Pending'}
                </Button>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="success"
                    size="sm"
                    disabled={selectedPendingIds.length === 0}
                    onClick={() => handleBatchApprove()}
                    data-testid="batch-approve-btn"
                  >
                    Approve Selected ({selectedPendingIds.length})
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={selectedPendingIds.length === 0}
                    onClick={() => handleBatchReject()}
                    data-testid="batch-reject-btn"
                  >
                    Reject Selected ({selectedPendingIds.length})
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="pending-photos-list">
                {pendingPhotos.map((photo) => {
                  const photoData = photo.data || {};
                  const imageUrl = photo.url || photoData.url;
                  const draft = getPendingDraft(photo);
                  const uploaderName = draft.uploaderName.trim() || undefined;
                  const caption = draft.caption.trim() || undefined;
                  const hasDraftEdit = Boolean(pendingEdits[photo.id]);
                  const title =
                    caption ||
                    (!hasDraftEdit ? photo.title || photoData.title || photoData.altText : undefined) ||
                    (uploaderName ? `Photo by ${uploaderName}` : 'Guest Photo');
                  const createdDate = photo.createdAt ? new Date(photo.createdAt).toLocaleString() : 'Recently';
                  const isSelected = selectedPendingIds.includes(photo.id);

                  return (
                    <div
                      key={photo.id}
                      data-testid={`pending-photo-card-${photo.id}`}
                      className={`p-4 rounded-xl border bg-white dark:bg-stone-950 shadow-sm flex flex-col justify-between transition-all ${
                        isSelected ? 'border-amber-500 ring-2 ring-amber-500/50' : 'border-stone-200 dark:border-stone-800'
                      }`}
                    >
                      <div>
                        <div className="relative h-40 w-full mb-3 overflow-hidden rounded-lg bg-stone-100 dark:bg-stone-900 border border-stone-200 dark:border-stone-800">
                          <div className="absolute top-2 left-2 z-10 p-1 bg-white/80 dark:bg-stone-900/80 backdrop-blur rounded">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectPendingPhoto(photo.id)}
                              aria-label={`Select photo ${title} for batch action`}
                              data-testid={`pending-checkbox-${photo.id}`}
                              className="w-4 h-4 rounded border-stone-300 text-amber-500 focus:ring-amber-500 cursor-pointer"
                            />
                          </div>
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
                        <div
                          className="text-sm font-semibold text-stone-800 dark:text-stone-200 line-clamp-2 mb-1"
                          title={title}
                          data-testid={`pending-photo-title-${photo.id}`}
                        >
                          {title}
                        </div>
                        {uploaderName && (
                          <div
                            className="text-xs font-medium text-stone-700 dark:text-stone-300 mb-1 flex items-center gap-1"
                            data-testid={`pending-photo-uploader-${photo.id}`}
                          >
                            <Icon name="Users" className="w-3 h-3 text-stone-500 dark:text-stone-400 shrink-0" />
                            <span className="truncate">Uploaded by {uploaderName}</span>
                          </div>
                        )}
                        <div className="text-xs text-stone-500 dark:text-stone-400 mb-3 flex items-center gap-1">
                          <Icon name="Calendar" className="w-3 h-3 text-muted-text" />
                          <span>Submitted {createdDate}</span>
                        </div>

                        <div className="space-y-2 mb-3">
                          <div>
                            <label
                              htmlFor={`pending-caption-${photo.id}`}
                              className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1"
                            >
                              Caption
                            </label>
                            <Input
                              id={`pending-caption-${photo.id}`}
                              type="text"
                              maxLength={500}
                              placeholder="Optional guest caption"
                              value={draft.caption}
                              onChange={(e) =>
                                updatePendingDraft(photo, { caption: e.target.value })
                              }
                              data-testid={`pending-caption-input-${photo.id}`}
                            />
                          </div>
                          <div>
                            <label
                              htmlFor={`pending-uploader-${photo.id}`}
                              className="block text-xs font-medium text-stone-700 dark:text-stone-300 mb-1"
                            >
                              Uploader Name
                            </label>
                            <Input
                              id={`pending-uploader-${photo.id}`}
                              type="text"
                              maxLength={100}
                              placeholder="Optional guest name"
                              value={draft.uploaderName}
                              onChange={(e) =>
                                updatePendingDraft(photo, { uploaderName: e.target.value })
                              }
                              data-testid={`pending-uploader-input-${photo.id}`}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 pt-3 border-t border-stone-100 dark:border-stone-900">
                        <Button
                          variant="success"
                          size="sm"
                          data-testid={`approve-photo-${photo.id}`}
                          onClick={() => handleApprove(photo.id)}
                          className="flex-1 flex items-center justify-center gap-1 text-xs py-2"
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
            </>
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
              <Input
                type="text"
                placeholder="https://... or /uploads/..."
                value={currentMedia.url || ''}
                onChange={e => setCurrentMedia({...currentMedia, url: e.target.value})}
              />
            </FormGroup>
            <FormGroup>
              <Label>Alternative Text</Label>
              <Input type="text" value={currentMedia.altText || ''} onChange={e => setCurrentMedia({...currentMedia, altText: e.target.value})} disabled={currentMedia.isDecorative} />
            </FormGroup>
            <FormGroup>
              <Label htmlFor="media-caption-input">Caption</Label>
              <Input
                id="media-caption-input"
                type="text"
                maxLength={500}
                placeholder="Optional gallery caption"
                value={currentMedia.caption ?? ''}
                onChange={(e) => setCurrentMedia({ ...currentMedia, caption: e.target.value })}
                data-testid="media-caption-input"
              />
            </FormGroup>
            <FormGroup>
              <Label htmlFor="media-uploader-input">Uploader Name</Label>
              <Input
                id="media-uploader-input"
                type="text"
                maxLength={100}
                placeholder="Optional guest name"
                value={currentMedia.uploaderName ?? ''}
                onChange={(e) => setCurrentMedia({ ...currentMedia, uploaderName: e.target.value })}
                data-testid="media-uploader-input"
              />
            </FormGroup>
            <FormGroup className="md:col-span-2">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center">
                  <Checkbox checked={currentMedia.isDecorative || false} onChange={e => setCurrentMedia({...currentMedia, isDecorative: e.target.checked})} className="mr-2" />
                  <Label className="mb-0">Decorative (no alt text)</Label>
                </div>
                <div className="flex items-center">
                  <Checkbox
                    checked={Boolean(currentMedia.publishToGallery)}
                    onChange={e => setCurrentMedia({...currentMedia, publishToGallery: e.target.checked})}
                    className="mr-2"
                    data-testid="publish-to-gallery-checkbox"
                  />
                  <Label className="mb-0">Publish to Photo Gallery</Label>
                </div>
              </div>
            </FormGroup>
          </div>
          <div className="flex gap-4 mt-6">
            <Button onClick={handleSave} variant="primary">Save</Button>
            <Button onClick={() => setIsEditing(false)} variant="ghost">Cancel</Button>
          </div>
        </div>
      )}

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
                    {m.publishToGallery && (
                      <StatusBadge
                        tone="success"
                        variant="solid"
                        size="xs"
                        data-testid={`gallery-published-badge-${m.id}`}
                        className="absolute top-2 right-2 font-bold uppercase shadow"
                      >
                        In Gallery
                      </StatusBadge>
                    )}
                  </div>
                  <div className="text-sm truncate mb-1" title={m.url}>{m.url}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 mb-1">
                    {m.isDecorative ? 'Decorative' : m.altText || 'No Alt Text'}
                  </div>
                  {(m.caption || m.uploaderName) && (
                    <div className="text-xs text-stone-600 dark:text-stone-300 mb-3 space-y-0.5">
                      {m.caption && (
                        <div className="truncate" data-testid={`media-card-caption-${m.id}`}>
                          Caption: {m.caption}
                        </div>
                      )}
                      {m.uploaderName && (
                        <div className="truncate" data-testid={`media-card-uploader-${m.id}`}>
                          By {m.uploaderName}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="mt-auto pt-2 flex justify-between gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      aria-label={m.altText ? `Edit media: ${m.altText}` : 'Edit unnamed item'}
                      onClick={() => {
                        setCurrentMedia({
                          ...m,
                          caption: m.caption ?? '',
                          uploaderName: m.uploaderName ?? '',
                        });
                        setIsEditing(true);
                      }}
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

      <PhotoUploadQRModal
        isOpen={qrModalOpen}
        onClose={() => setQrModalOpen(false)}
        uploadUrl={qrUploadUrl}
        activeUploadUrl={qrActiveUploadUrl}
        configuredUploadUrl={qrConfiguredUploadUrl}
        tokenVersion={qrTokenVersion}
        isRotating={isRotatingQrToken}
        onRotateToken={onRotateQrToken}
      />
    </div>
  );
}

interface PhotoQrSettingsSnapshot {
  uploadUrl: string;
  activeUploadUrl?: string;
  configuredUploadUrl?: string;
  tokenVersion: number;
  autoApproveGuestPhotos: boolean;
}

async function requestPhotoQrSettings(): Promise<PhotoQrSettingsSnapshot | null> {
  const res = await apiClient.get<unknown>('/api/admin/photos/qr');
  if (!res || typeof res !== 'object') {
    return null;
  }
  const envelope = res as {
    uploadUrl?: unknown;
    activeUploadUrl?: unknown;
    configuredUploadUrl?: unknown;
    tokenVersion?: unknown;
    autoApproveGuestPhotos?: unknown;
    data?: {
      uploadUrl?: unknown;
      activeUploadUrl?: unknown;
      configuredUploadUrl?: unknown;
      tokenVersion?: unknown;
      autoApproveGuestPhotos?: unknown;
    };
  };
  const payload = envelope.data && typeof envelope.data === 'object' ? envelope.data : envelope;
  if (typeof payload.uploadUrl !== 'string') {
    return null;
  }
  return {
    uploadUrl: payload.uploadUrl,
    ...(typeof payload.activeUploadUrl === 'string'
      ? { activeUploadUrl: payload.activeUploadUrl }
      : {}),
    ...(typeof payload.configuredUploadUrl === 'string'
      ? { configuredUploadUrl: payload.configuredUploadUrl }
      : {}),
    tokenVersion:
      typeof payload.tokenVersion === 'number' && payload.tokenVersion >= 1
        ? payload.tokenVersion
        : 1,
    autoApproveGuestPhotos: Boolean(payload.autoApproveGuestPhotos),
  };
}

interface MediaPageSnapshot {
  media: MediaDTO[];
  total: number;
  totalPages: number;
  resolvedPage?: number;
}

interface MediaSnapshotSetters {
  currentPage: number;
  setMedia: React.Dispatch<React.SetStateAction<MediaDTO[]>>;
  setTotal: React.Dispatch<React.SetStateAction<number>>;
  setTotalPages: React.Dispatch<React.SetStateAction<number>>;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

async function requestPendingPhotos(): Promise<PendingPhoto[] | null> {
  const res = await apiClient.get<unknown>('/api/admin/photos/moderation');
  if (typeof res === 'object' && res !== null) {
    const envelope = res as { photos?: unknown; data?: unknown };
    if (Array.isArray(envelope.photos)) {
      return envelope.photos as PendingPhoto[];
    }
    if (Array.isArray(envelope.data)) {
      return envelope.data as PendingPhoto[];
    }
  }
  if (Array.isArray(res)) {
    return res as PendingPhoto[];
  }
  return null;
}

async function requestMediaSnapshot(
  targetPage: number,
  limit: number
): Promise<MediaPageSnapshot | null> {
  const res = await apiClient.get<unknown>(`/api/media?page=${targetPage}&limit=${limit}`);
  if (
    typeof res === 'object' &&
    res !== null &&
    'data' in res &&
    Array.isArray((res as { data: unknown }).data)
  ) {
    const envelope = res as {
      data: MediaDTO[];
      total?: number;
      totalPages?: number;
      page?: number;
    };
    return {
      media: envelope.data,
      total: envelope.total ?? 0,
      totalPages: envelope.totalPages ?? 1,
      resolvedPage: envelope.page ?? targetPage,
    };
  }
  if (Array.isArray(res)) {
    return {
      media: res as MediaDTO[],
      total: res.length,
      totalPages: 1,
    };
  }
  return null;
}

function applyMediaSnapshot(
  snapshot: MediaPageSnapshot | null,
  setters: MediaSnapshotSetters
): void {
  if (snapshot) {
    setters.setMedia(snapshot.media);
    setters.setTotal(snapshot.total);
    setters.setTotalPages(snapshot.totalPages);
    if (snapshot.resolvedPage !== undefined && snapshot.resolvedPage !== setters.currentPage) {
      setters.setPage(snapshot.resolvedPage);
    }
  }
  setters.setError(null);
}

function formatMediaError(err: unknown): string {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'Failed to load media library.';
  return message || 'Failed to load media library.';
}

export default function MediaDashboardPage() {
  const [media, setMedia] = useState<MediaDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [a11yNotice, setA11yNotice] = useState<string>('');

  const [page, setPage] = useState(1);
  const [limit] = useState(20);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [qrUploadUrl, setQrUploadUrl] = useState('');
  const [qrActiveUploadUrl, setQrActiveUploadUrl] = useState<string | undefined>(undefined);
  const [qrConfiguredUploadUrl, setQrConfiguredUploadUrl] = useState<string | undefined>(
    undefined
  );
  const [qrTokenVersion, setQrTokenVersion] = useState(1);
  const [autoApproveGuestPhotos, setAutoApproveGuestPhotos] = useState(false);
  const [isUpdatingAutoApprove, setIsUpdatingAutoApprove] = useState(false);
  const [isRotatingQrToken, setIsRotatingQrToken] = useState(false);

  const applyPhotoQrSnapshot = useCallback((snapshot: PhotoQrSettingsSnapshot | null) => {
    if (!snapshot) return;
    setQrUploadUrl(snapshot.uploadUrl);
    setQrActiveUploadUrl(snapshot.activeUploadUrl);
    setQrConfiguredUploadUrl(snapshot.configuredUploadUrl);
    setQrTokenVersion(snapshot.tokenVersion);
    setAutoApproveGuestPhotos(snapshot.autoApproveGuestPhotos);
  }, []);

  const ensureQrLoaded = useCallback(async () => {
    try {
      const snapshot = await requestPhotoQrSettings();
      applyPhotoQrSnapshot(snapshot);
    } catch (e: unknown) {
      console.error('Failed to load photo QR settings:', e);
    }
  }, [applyPhotoQrSnapshot]);

  const handleToggleAutoApprove = useCallback(async () => {
    const nextValue = !autoApproveGuestPhotos;
    setIsUpdatingAutoApprove(true);
    try {
      const res = await apiClient.post<unknown>('/api/admin/photos/qr', {
        autoApproveGuestPhotos: nextValue,
      });
      if (res && typeof res === 'object') {
        const envelope = res as {
          uploadUrl?: unknown;
          activeUploadUrl?: unknown;
          configuredUploadUrl?: unknown;
          tokenVersion?: unknown;
          autoApproveGuestPhotos?: unknown;
        };
        if (typeof envelope.uploadUrl === 'string') {
          setQrUploadUrl(envelope.uploadUrl);
        }
        if (typeof envelope.activeUploadUrl === 'string') {
          setQrActiveUploadUrl(envelope.activeUploadUrl);
        }
        if (typeof envelope.configuredUploadUrl === 'string') {
          setQrConfiguredUploadUrl(envelope.configuredUploadUrl);
        }
        if (typeof envelope.tokenVersion === 'number' && envelope.tokenVersion >= 1) {
          setQrTokenVersion(envelope.tokenVersion);
        }
        setAutoApproveGuestPhotos(
          typeof envelope.autoApproveGuestPhotos === 'boolean'
            ? envelope.autoApproveGuestPhotos
            : nextValue
        );
      } else {
        setAutoApproveGuestPhotos(nextValue);
      }
      setA11yNotice(
        nextValue
          ? 'Auto-approval enabled. New guest uploads will publish live immediately.'
          : 'Auto-approval disabled. New guest uploads will enter the moderation queue.'
      );
    } catch (e: unknown) {
      console.error('Failed to update auto-approve guest photos setting:', e);
      setA11yNotice('Failed to update auto-approval setting.');
    } finally {
      setIsUpdatingAutoApprove(false);
    }
  }, [autoApproveGuestPhotos]);

  const handleRotateQrToken = useCallback(async () => {
    setIsRotatingQrToken(true);
    try {
      const res = await apiClient.post<unknown>('/api/admin/photos/qr', {
        action: 'rotate',
      });
      if (res && typeof res === 'object') {
        const envelope = res as {
          uploadUrl?: unknown;
          activeUploadUrl?: unknown;
          configuredUploadUrl?: unknown;
          tokenVersion?: unknown;
        };
        if (typeof envelope.uploadUrl === 'string') {
          setQrUploadUrl(envelope.uploadUrl);
        }
        if (typeof envelope.activeUploadUrl === 'string') {
          setQrActiveUploadUrl(envelope.activeUploadUrl);
        }
        if (typeof envelope.configuredUploadUrl === 'string') {
          setQrConfiguredUploadUrl(envelope.configuredUploadUrl);
        }
        if (typeof envelope.tokenVersion === 'number' && envelope.tokenVersion >= 1) {
          setQrTokenVersion(envelope.tokenVersion);
        }
      }
      setA11yNotice('Guest photo QR link rotated. Previous QR links are now invalid.');
    } catch (e: unknown) {
      console.error('Failed to rotate guest photo QR token:', e);
      setA11yNotice('Failed to rotate guest photo QR link.');
    } finally {
      setIsRotatingQrToken(false);
    }
  }, []);

  const fetchPendingPhotos = async () => {
    try {
      const photos = await requestPendingPhotos();
      if (photos !== null) {
        setPendingPhotos(photos);
      }
    } catch (e: unknown) {
      console.error('Failed to load pending photos:', e);
    }
  };

  const fetchMedia = async (targetPage = page, options?: { background?: boolean }) => {
    if (!options?.background) {
      setLoading(true);
      setError(null);
    }
    try {
      const snapshot = await requestMediaSnapshot(targetPage, limit);
      applyMediaSnapshot(snapshot, {
        currentPage: page, setMedia, setTotal, setTotalPages, setPage, setError,
      });
    } catch (e: unknown) {
      console.error(e);
      setError(formatMediaError(e));
    } finally {
      if (!options?.background) {
        setLoading(false);
      }
    }
  };

  const handleSetPage: React.Dispatch<React.SetStateAction<number>> = useCallback((nextPage) => {
    setLoading(true);
    setError(null);
    setPage(nextPage);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const mediaTask = requestMediaSnapshot(page, limit)
      .then((snapshot) => {
        if (cancelled) return;
        applyMediaSnapshot(snapshot, {
          currentPage: page, setMedia, setTotal, setTotalPages, setPage, setError,
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error(e);
        setError(formatMediaError(e));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    const pendingTask = requestPendingPhotos()
      .then((photos) => {
        if (!cancelled && photos !== null) {
          setPendingPhotos(photos);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          console.error('Failed to load pending photos:', e);
        }
      });

    const qrTask = requestPhotoQrSettings()
      .then((qrSnapshot) => {
        if (!cancelled) {
          applyPhotoQrSnapshot(qrSnapshot);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          console.error('Failed to load photo QR settings:', e);
        }
      });

    void Promise.all([mediaTask, pendingTask, qrTask]);

    return () => {
      cancelled = true;
    };
  }, [page, limit, applyPhotoQrSnapshot]);

  const handleRetry = async () => {
    await Promise.all([fetchMedia(page), fetchPendingPhotos()]);
  };

  const ToastBoundary =
    typeof EnsureToastProvider === 'function' ? EnsureToastProvider : Fragment;

  return (
    <ToastBoundary>
      <AdminViewState
        isLoading={loading}
        error={error}
        onRetry={handleRetry}
        loadingMessage="Loading media library..."
      >
        <MediaDashboardContent
          media={media}
          loading={loading}
          page={page}
          totalPages={totalPages}
          total={total}
          setPage={handleSetPage}
          pendingPhotos={pendingPhotos}
          setPendingPhotos={setPendingPhotos}
          drawerOpen={drawerOpen}
          setDrawerOpen={setDrawerOpen}
          a11yNotice={a11yNotice}
          setA11yNotice={setA11yNotice}
          fetchMedia={fetchMedia}
          qrUploadUrl={qrUploadUrl}
          qrActiveUploadUrl={qrActiveUploadUrl}
          qrConfiguredUploadUrl={qrConfiguredUploadUrl}
          qrTokenVersion={qrTokenVersion}
          autoApproveGuestPhotos={autoApproveGuestPhotos}
          onToggleAutoApprove={handleToggleAutoApprove}
          isUpdatingAutoApprove={isUpdatingAutoApprove}
          onRotateQrToken={handleRotateQrToken}
          isRotatingQrToken={isRotatingQrToken}
          onEnsureQrLoaded={ensureQrLoaded}
        />
      </AdminViewState>
    </ToastBoundary>
  );
}
