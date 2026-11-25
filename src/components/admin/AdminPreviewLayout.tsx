'use client';
import React, { useState, useEffect, useRef } from 'react';

import { useToast } from '@/components/ui/ToastProvider';
import { Icon } from '@/components/ui/Icon';
import { SegmentedTabs } from '@/components/ui/SegmentedTabs';
import { formatDate } from '@/utils/intl';
import { apiClient } from '@/features/admin';
import { withBasePath } from '@/lib/basePath';

interface AdminPreviewLayoutProps {
  children: React.ReactNode;
  previewUrl: string;
  draftData: any; // The current form state
  draftType: 'config' | 'content' | 'wedding-party' | 'attractions';
  entityId?: string; // e.g. 'global' or content node id
  onRestore?: () => void;
}

function buildPreviewIframeSrc(previewUrl: string): string {
  const hashIndex = previewUrl.indexOf('#');
  const basePath = hashIndex >= 0 ? previewUrl.slice(0, hashIndex) : previewUrl;
  const hashFragment = hashIndex >= 0 ? previewUrl.slice(hashIndex) : '';
  const normalizedBase = withBasePath(basePath || '/');
  const separator = normalizedBase.includes('?') ? '&' : '?';
  return `${normalizedBase}${separator}preview=true${hashFragment}`;
}

function computeIsMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') {
    const mql = window.matchMedia('(max-width: 767px)');
    if (mql?.matches) return true;
  }
  return typeof window.innerWidth === 'number' && window.innerWidth < 768;
}

export default function AdminPreviewLayout({ 
  children, 
  previewUrl, 
  draftData, 
  draftType,
  entityId,
  onRestore
}: AdminPreviewLayoutProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [viewState, setViewState] = useState<'Live' | 'Draft' | 'Historical'>('Live');
  const [viewport, setViewport] = useState<'desktop' | 'mobile'>('desktop');
  const [mobilePane, setMobilePane] = useState<'editor' | 'preview'>('editor');
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(computeIsMobileViewport);
  const desktopBtnRef = useRef<HTMLButtonElement>(null);
  const mobileBtnRef = useRef<HTMLButtonElement>(null);
  const [versions, setVersions] = useState<any[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncViewport = () => {
      setIsMobileViewport(computeIsMobileViewport());
    };
    syncViewport();

    window.addEventListener('resize', syncViewport);
    const mql =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 767px)')
        : null;
    if (mql && typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', syncViewport);
    }

    return () => {
      window.removeEventListener('resize', syncViewport);
      if (mql && typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', syncViewport);
      }
    };
  }, []);

  const handleViewportKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    current: 'desktop' | 'mobile',
  ) => {
    let next: 'desktop' | 'mobile' | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      next = current === 'desktop' ? 'mobile' : 'desktop';
    } else if (e.key === 'Home') {
      next = 'desktop';
    } else if (e.key === 'End') {
      next = 'mobile';
    }
    if (!next) return;
    e.preventDefault();
    setViewport(next);
    if (next === 'desktop') {
      desktopBtnRef.current?.focus();
    } else {
      mobileBtnRef.current?.focus();
    }
  };
  const [showVersions, setShowVersions] = useState(false);
  const { confirm, addToast } = useToast();

  const postDraftToIframe = (payloadData: unknown = draftData) => {
    if (
      typeof window === 'undefined' ||
      !window.location?.origin ||
      !iframeRef.current?.contentWindow
    ) {
      return;
    }
    iframeRef.current.contentWindow.postMessage(
      {
        type: 'DRAFT_UPDATE',
        draftType,
        draftData: payloadData,
      },
      window.location.origin
    );
  };

  // Send draft updates to the iframe within 500ms
  useEffect(() => {
    if (!iframeRef.current || !iframeRef.current.contentWindow) return;
    
    // We consider it a draft if we are passing draftData
    setViewState(showVersions ? 'Historical' : 'Draft');

    const timer = setTimeout(() => {
      postDraftToIframe(draftData);
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftData, draftType, showVersions]);

  useEffect(() => {
    if (entityId && showVersions) {
      // Fetch versions
      let entityType = 'ContentNode';
      if (draftType === 'config') entityType = 'AppConfig';
      if (draftType === 'wedding-party') entityType = 'WeddingPartyMember';
      if (draftType === 'attractions') entityType = 'Attraction';
      
      apiClient.get<any>(`/api/admin/versions?entityType=${entityType}&entityId=${entityId}`)
        .then(data => {
          if (Array.isArray(data)) {
            setVersions(data);
          } else if (data && Array.isArray(data.items)) {
            setVersions(data.items);
          }
        })
        .catch(console.error);
    }
  }, [entityId, showVersions, draftType]);

  const handleRestore = async (versionId: string) => {
    if (!(await confirm('Are you sure you want to restore this version? This will instantly replace the Live content.'))) return;
    try {
      await apiClient.post(`/api/admin/versions/${versionId}/restore`);
      addToast('Restored successfully.', 'success');
      setShowVersions(false);
      if (onRestore) onRestore();
    } catch (e: any) {
      addToast(e.message || 'Failed to restore.', 'error');
    }
  };

  const iframeSrc = buildPreviewIframeSrc(previewUrl);

  return (
    <div className="flex flex-col md:flex-row h-screen w-full bg-gray-100 dark:bg-gray-900 overflow-hidden">
      {/* Mobile Segmented Workspace Switcher */}
      <div className="md:hidden w-full border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 shrink-0 z-20">
        <SegmentedTabs<'editor' | 'preview'>
          aria-label="Studio workspace views"
          data-testid="studio-mobile-tabs"
          value={mobilePane}
          onChange={setMobilePane}
          className="flex w-full rounded-xl p-1"
          tabs={[
            {
              value: 'editor',
              id: 'studio-mobile-tab-editor',
              panelId: 'studio-left-pane',
              'data-testid': 'studio-mobile-tab-editor',
              label: 'Editor',
              className: 'flex-1 rounded-lg',
            },
            {
              value: 'preview',
              id: 'studio-mobile-tab-preview',
              panelId: 'studio-right-pane',
              'data-testid': 'studio-mobile-tab-preview',
              label: 'Live Preview',
              className: 'flex-1 rounded-lg',
            },
          ]}
        />
      </div>

      {/* Editor Pane */}
      <div
        id="studio-left-pane"
        data-testid="studio-left-pane"
        data-scroll-region=""
        role={isMobileViewport ? 'tabpanel' : undefined}
        aria-labelledby={isMobileViewport ? 'studio-mobile-tab-editor' : undefined}
        hidden={isMobileViewport ? mobilePane !== 'editor' : undefined}
        className={`${
          mobilePane === 'editor' ? 'flex' : 'hidden'
        } md:flex flex-col w-full md:w-1/2 flex-1 min-h-0 md:h-full overflow-y-auto md:border-r border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl z-10 relative`}
      >
        <div className="flex items-center justify-end px-4 sm:px-6 pt-3 pb-2 border-b border-gray-100 dark:border-gray-700/60 shrink-0">
          <button
            type="button"
            onClick={() => setShowVersions(!showVersions)}
            className="px-3 py-1.5 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-lg text-sm font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            {showVersions ? 'Hide History' : 'Version History'}
          </button>
        </div>

        <div
          data-testid="studio-history-pane"
          className={showVersions ? 'p-6' : 'hidden'}
          hidden={!showVersions}
          aria-hidden={!showVersions}
        >
          <h2 className="text-2xl font-bold mb-4">Version History</h2>
          <div className="space-y-4">
            {versions.length === 0 && <p className="text-gray-500 dark:text-gray-400">No versions found.</p>}
            {versions.map((v) => (
              <div key={v.id} className="p-4 border rounded bg-gray-50 dark:bg-gray-800 flex flex-wrap gap-3 justify-between items-center">
                <div>
                  <p className="font-semibold">{formatDate(v.createdAt, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">By {v.author}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      postDraftToIframe(v.data);
                      setMobilePane('preview');
                    }}
                    className="px-3 py-1 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700"
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRestore(v.id)}
                    className="px-3 py-1 bg-primary text-white rounded text-sm font-medium"
                  >
                    Restore
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          data-testid="studio-editor-pane"
          className={showVersions ? 'hidden' : 'flex-1'}
          hidden={showVersions}
          aria-hidden={showVersions}
        >
          {children}
        </div>
      </div>

      {/* Preview Pane */}
      <div
        id="studio-right-pane"
        data-testid="studio-right-pane"
        role={isMobileViewport ? 'tabpanel' : undefined}
        aria-labelledby={isMobileViewport ? 'studio-mobile-tab-preview' : undefined}
        hidden={isMobileViewport ? mobilePane !== 'preview' : undefined}
        className={`${
          mobilePane === 'preview' ? 'flex' : 'hidden'
        } md:flex flex-col w-full md:w-1/2 flex-1 min-h-0 md:h-full bg-gray-100 dark:bg-gray-950`}
      >
        {/* Viewport Toggle & Status Toolbar */}
        <div
          role="toolbar"
          aria-label="Preview controls"
          className="flex items-center justify-between gap-3 px-4 py-2.5 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shrink-0"
        >
          <div
            role="group"
            aria-label="Preview viewport"
            className="inline-flex items-center rounded-lg bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700"
          >
            <button
              ref={desktopBtnRef}
              type="button"
              aria-pressed={viewport === 'desktop'}
              onClick={() => setViewport('desktop')}
              onKeyDown={(e) => handleViewportKeyDown(e, 'desktop')}
              className={`inline-flex min-h-[30px] items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                viewport === 'desktop'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <Icon name="Monitor" size={14} />
              <span>Desktop</span>
            </button>
            <button
              ref={mobileBtnRef}
              type="button"
              aria-pressed={viewport === 'mobile'}
              onClick={() => setViewport('mobile')}
              onKeyDown={(e) => handleViewportKeyDown(e, 'mobile')}
              className={`inline-flex min-h-[30px] items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                viewport === 'mobile'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              <Icon name="Smartphone" size={14} />
              <span>Mobile (375px)</span>
            </button>
          </div>

          <span
            className={`px-3 py-1 rounded-full text-xs font-bold text-white shadow ${
              viewState === 'Draft'
                ? 'bg-amber-800'
                : viewState === 'Historical'
                  ? 'bg-purple-700'
                  : 'bg-emerald-700'
            }`}
          >
            {viewState} Preview
          </span>
        </div>

        <div className="flex-1 w-full overflow-auto flex justify-center bg-gray-100 dark:bg-black">
          <div
            data-testid="admin-preview-viewport"
            data-viewport={viewport}
            style={viewport === 'mobile' ? { width: '375px', maxWidth: '100%' } : undefined}
            className={
              viewport === 'mobile'
                ? 'h-full bg-white dark:bg-gray-900 border-x border-gray-300 dark:border-gray-700 shadow-2xl transition-all'
                : 'w-full h-full'
            }
          >
            <iframe
              ref={iframeRef}
              src={iframeSrc}
              onLoad={() => postDraftToIframe(draftData)}
              className="w-full h-full border-none"
              title="Live Preview"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
