"use client";
import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/utils/intl";

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
  const [versions, setVersions] = useState<any[]>([]);
  const [showVersions, setShowVersions] = useState(false);

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
      
      fetch(`/api/admin/versions?entityType=${entityType}&entityId=${entityId}`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) setVersions(data);
        })
        .catch(console.error);
    }
  }, [entityId, showVersions, draftType]);

  const handleRestore = async (versionId: string) => {
    if (!confirm("Are you sure you want to restore this version? This will instantly replace the Live content.")) return;
    try {
      const res = await fetch(`/api/admin/versions/${versionId}/restore`, { method: 'POST' });
      if (res.ok) {
        alert("Restored successfully.");
        setShowVersions(false);
        if (onRestore) onRestore();
      } else {
        alert("Failed to restore.");
      }
    } catch (e) {
      console.error(e);
      alert("Error restoring.");
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

        {showVersions ? (
          <div className="p-6">
            <h2 className="text-2xl font-bold mb-4">Version History</h2>
            <div className="space-y-4">
              {versions.length === 0 && <p className="text-gray-500">No versions found.</p>}
              {versions.map((v) => (
                <div key={v.id} className="p-4 border rounded bg-gray-50 dark:bg-gray-800 flex justify-between items-center">
                  <div>
                    <p className="font-semibold">{formatDate(v.createdAt, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                    <p className="text-sm text-gray-500">By {v.author}</p>
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
        ) : (
          <div className="h-full">
             {children}
          </div>
        )}
      </div>

      {/* Preview Pane */}
      <div className="w-1/2 h-full relative bg-gray-50 dark:bg-black">
        {/* Visual Indicator */}
        <div className="absolute top-4 right-4 z-20">
          <span className={`px-3 py-1 rounded-full text-xs font-bold text-white shadow-lg ${
            viewState === 'Draft' ? 'bg-secondary' : 
            viewState === 'Historical' ? 'bg-purple-600' : 'bg-green-600'
          }`}>
            {viewState} Preview
          </span>
        </div>
        
        <iframe 
          ref={iframeRef}
          src={`${previewUrl}?preview=true`} 
          className="w-full h-full border-none"
          title="Live Preview"
        />
      </div>
    </div>
  );
}
