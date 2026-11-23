'use client';
import React, { useState, useEffect, useRef } from 'react';

import { useToast } from '@/components/ui/ToastProvider';
import { Icon } from '@/components/ui/Icon';
import { formatDate } from '@/utils/intl';
import { apiClient } from '@/features/admin';

interface AdminPreviewLayoutProps {
  children: React.ReactNode;
  previewUrl: string;
  draftData: any; // The current form state
  draftType: 'config' | 'content' | 'wedding-party' | 'attractions';
  entityId?: string; // e.g. 'global' or content node id
  onRestore?: () => void;
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
  const desktopBtnRef = useRef<HTMLButtonElement>(null);
  const mobileBtnRef = useRef<HTMLButtonElement>(null);
  const [versions, setVersions] = useState<any[]>([]);

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

  // Send draft updates to the iframe within 500ms
  useEffect(() => {
    if (!iframeRef.current || !iframeRef.current.contentWindow) return;
    
    // We consider it a draft if we are passing draftData
    setViewState(showVersions ? 'Historical' : 'Draft');

    const timer = setTimeout(() => {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'DRAFT_UPDATE',
          draftType,
          draftData
        }, '*');
      }
    }, 300); // 300ms debounce

    return () => clearTimeout(timer);
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

  return (
    <div className="flex h-screen w-full bg-gray-100 dark:bg-gray-900 overflow-hidden">
      {/* Editor Pane */}
      <div className="w-1/2 h-full overflow-y-auto border-r border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl z-10 relative">
        <div className="absolute top-4 right-4 flex space-x-2">
          <button 
            onClick={() => setShowVersions(!showVersions)}
            className="px-3 py-1 bg-gray-200 dark:bg-gray-700 rounded text-sm font-semibold hover:bg-gray-300"
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
              <div key={v.id} className="p-4 border rounded bg-gray-50 dark:bg-gray-800 flex justify-between items-center">
                <div>
                  <p className="font-semibold">{formatDate(v.createdAt, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">By {v.author}</p>
                </div>
                <div className="space-x-2">
                  <button
                    onClick={() => {
                      // send this historical data to the iframe
                      if (iframeRef.current && iframeRef.current.contentWindow) {
                        iframeRef.current.contentWindow.postMessage({
                          type: 'DRAFT_UPDATE',
                          draftType,
                          draftData: v.data
                        }, '*');
                      }
                    }}
                    className="px-3 py-1 bg-blue-500 text-white rounded text-sm"
                  >
                    Preview
                  </button>
                  <button
                    onClick={() => handleRestore(v.id)}
                    className="px-3 py-1 bg-primary text-white rounded text-sm"
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
          className={showVersions ? 'hidden' : 'h-full'}
          hidden={showVersions}
          aria-hidden={showVersions}
        >
          {children}
        </div>
      </div>

      {/* Preview Pane */}
      <div className="w-1/2 h-full flex flex-col bg-gray-100 dark:bg-gray-950">
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
              src={`${previewUrl}?preview=true`}
              className="w-full h-full border-none"
              title="Live Preview"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
