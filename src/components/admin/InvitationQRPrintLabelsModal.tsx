'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { ThemedQRCode } from '@/components/ui/ThemedQRCode';

export interface PrintableInvitationCode {
  id: string;
  guestName: string;
  code: string;
  householdName?: string | null;
  partyGroup?: string | null;
  plusOneFirstName?: string | null;
  plusOneLastName?: string | null;
}

type LabelTemplateType = 'avery_5163' | 'avery_5160';

export interface InvitationQRPrintLabelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  codes: PrintableInvitationCode[];
}

const CHUNK_SIZE = 30;

export const InvitationQRPrintLabelsModal: React.FC<InvitationQRPrintLabelsModalProps> = ({
  isOpen,
  onClose,
  codes,
}) => {
  const [template, setTemplate] = useState<LabelTemplateType>('avery_5163');
  const [renderedCount, setRenderedCount] = useState<number>(CHUNK_SIZE);
  const printTriggeredRef = useRef(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  // Non-blocking chunked progressive rendering for up to 500 items
  useEffect(() => {
    if (!isOpen) {
      setRenderedCount(CHUNK_SIZE);
      printTriggeredRef.current = false;
      if (typeof document !== 'undefined') {
        document.body.classList.remove('printing-qr-labels');
      }
      return;
    }

    if (typeof document !== 'undefined') {
      document.body.classList.add('printing-qr-labels');
    }

    if (renderedCount < codes.length) {
      const timer = setTimeout(() => {
        setRenderedCount((prev) => Math.min(prev + CHUNK_SIZE, codes.length));
      }, 16);
      return () => clearTimeout(timer);
    } else {
      // Automatically open print dialog once all label canvases are mounted
      if (!printTriggeredRef.current && codes.length > 0) {
        printTriggeredRef.current = true;
        const printTimer = setTimeout(() => {
          if (typeof window !== 'undefined') {
            window.print();
          }
        }, 300);
        return () => clearTimeout(printTimer);
      }
    }
  }, [isOpen, renderedCount, codes.length]);

  const visibleCodes = useMemo(() => {
    return codes.slice(0, renderedCount);
  }, [codes, renderedCount]);

  const handlePrintNow = () => {
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  const handleClose = () => {
    if (typeof document !== 'undefined') {
      document.body.classList.remove('printing-qr-labels');
    }
    onClose();
  };

  if (!isOpen) return null;

  const isAvery5163 = template === 'avery_5163';
  const qrCanvasSize = isAvery5163 ? 84 : 54;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="Printable Invitation QR Labels"
      className="max-w-4xl w-full p-6 printable-qr-modal-dialog"
    >
      <div className="printable-qr-labels-area space-y-6">
        {/* Controls Toolbar (hidden during print) */}
        <div className="no-print bg-gray-50 dark:bg-zinc-800/80 p-4 rounded-xl border border-gray-200 dark:border-zinc-700 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              Print QR Code Labels ({codes.length} guest{codes.length === 1 ? '' : 's'})
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Compatible with standard Avery adhesive sheets. Admin dashboard chrome will be hidden when printing.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs font-medium text-gray-700 dark:text-gray-300">
              <span>Template:</span>
              <select
                value={template}
                onChange={(e) => setTemplate(e.target.value as LabelTemplateType)}
                className="text-xs bg-white dark:bg-zinc-900 border border-gray-300 dark:border-zinc-700 rounded-md px-2 py-1"
                aria-label="Select Avery label template"
              >
                <option value="avery_5163">Avery 5163 (2" x 4", 10 per sheet)</option>
                <option value="avery_5160">Avery 5160 (1" x 2-5/8", 30 per sheet)</option>
              </select>
            </div>

            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={handlePrintNow}
              className="flex items-center gap-1.5"
              aria-label="Print label sheet"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect width="12" height="8" x="6" y="14" />
              </svg>
              <span>Print Sheet</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClose}
            >
              Done
            </Button>
          </div>
        </div>

        {/* Progress indicator during large rendering */}
        {renderedCount < codes.length && (
          <div className="no-print py-2 px-3 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 rounded-lg text-xs flex items-center justify-between">
            <span>Preparing QR code canvases...</span>
            <span className="font-semibold">{renderedCount} / {codes.length}</span>
          </div>
        )}

        {/* Printable Sheet Grid Container */}
        <div
          data-testid="qr-print-sheet"
          className={`qr-print-sheet grid gap-3 max-h-[70vh] overflow-y-auto p-2 border border-gray-100 dark:border-zinc-800 rounded-lg bg-white ${
            isAvery5163 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
          }`}
          style={{
            minHeight: '200px',
          }}
        >
          {visibleCodes.map((item) => {
            const rsvpUrl = `${origin}/guest?code=${encodeURIComponent(item.code || '')}`;
            const plusOne = [item.plusOneFirstName, item.plusOneLastName].filter(Boolean).join(' ');

            return (
              <div
                key={item.id}
                data-testid="qr-label-card"
                className={`qr-label-card border border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-3 bg-white text-gray-900 flex items-center gap-3 break-inside-avoid ${
                  isAvery5163 ? 'min-h-[1.9in]' : 'min-h-[0.95in] p-2'
                }`}
                style={{
                  pageBreakInside: 'avoid',
                  breakInside: 'avoid',
                  boxSizing: 'border-box',
                }}
              >
                {/* QR Canvas */}
                <div className="shrink-0 p-1 bg-white rounded border border-gray-100 flex items-center justify-center">
                  <ThemedQRCode
                    value={rsvpUrl}
                    size={qrCanvasSize * 2}
                    style={{ width: qrCanvasSize, height: qrCanvasSize }}
                    level="M"
                    fgColor="#000000"
                    bgColor="#ffffff"
                    aria-label={`QR code for ${item.guestName}`}
                  />
                </div>

                {/* Label Guest Details */}
                <div className="flex-1 min-w-0 leading-tight">
                  <div className="font-bold text-sm text-gray-900 truncate" title={item.guestName}>
                    {item.guestName}
                  </div>
                  {plusOne && (
                    <div className="text-[11px] text-gray-600 truncate">
                      &amp; {plusOne}
                    </div>
                  )}
                  {item.householdName && !plusOne && (
                    <div className="text-[10px] text-purple-700 truncate font-medium">
                      {item.householdName}
                    </div>
                  )}
                  <div className="mt-1 font-mono text-xs font-semibold text-red-600 tracking-wide">
                    {item.code}
                  </div>
                  <div className="mt-0.5 text-[9px] uppercase tracking-wider text-gray-400 font-sans">
                    Scan to RSVP
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
};
