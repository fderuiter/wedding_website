'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/Button';
import { Heading, type HeadingLevel } from '@/components/ui/Layout';
import { ThemedQRCode } from '@/components/ui/ThemedQRCode';
import { EnsureToastProvider } from '@/components/ui/ToastProvider';
import { resolveConfiguredBaseUrl, useAdminSettings } from '@/hooks/admin/useAdminSettings';
import { withBasePath } from '@/lib/basePath';

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
  headingLevel?: HeadingLevel;
}

const CHUNK_SIZE = 30;

interface InvitationQRPrintLabelsContentProps {
  codes: PrintableInvitationCode[];
  onClose: () => void;
}

const InvitationQRPrintLabelsContent: React.FC<InvitationQRPrintLabelsContentProps> = ({
  codes,
  onClose,
}) => {
  const { config } = useAdminSettings();
  const [template, setTemplate] = useState<LabelTemplateType>('avery_5163');
  const [renderedCount, setRenderedCount] = useState<number>(() =>
    Math.min(CHUNK_SIZE, codes.length)
  );

  const guestPath = withBasePath('/guest');
  const basePathPrefix = guestPath.endsWith('/guest')
    ? guestPath.slice(0, -'/guest'.length)
    : '';
  const rawBaseOrigin = resolveConfiguredBaseUrl(config?.baseUrl);
  const baseOrigin =
    basePathPrefix && rawBaseOrigin.endsWith(basePathPrefix)
      ? rawBaseOrigin.slice(0, -basePathPrefix.length)
      : rawBaseOrigin;

  // Non-blocking chunked progressive rendering for up to 1,000 items
  useEffect(() => {
    if (renderedCount < codes.length) {
      const timer = setTimeout(() => {
        setRenderedCount((prev) => Math.min(prev + CHUNK_SIZE, codes.length));
      }, 16);
      return () => clearTimeout(timer);
    }
  }, [renderedCount, codes.length]);

  const visibleCodes = useMemo(() => {
    return codes.slice(0, renderedCount);
  }, [codes, renderedCount]);

  const isRenderingPending = renderedCount < codes.length;
  const isPrintDisabled = codes.length === 0 || isRenderingPending;

  const handlePrintNow = () => {
    if (isPrintDisabled) return;
    if (typeof window !== 'undefined') {
      window.print();
    }
  };

  const isAvery5163 = template === 'avery_5163';
  const qrCanvasSize = isAvery5163 ? 84 : 54;
  const sheetTemplateClass = isAvery5163
    ? 'qr-print-sheet--avery-5163'
    : 'qr-print-sheet--avery-5160';
  const cardTemplateClass = isAvery5163
    ? 'qr-label-card--avery-5163'
    : 'qr-label-card--avery-5160';

  return (
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
              <option value="avery_5163">Avery 5163 (2&quot; x 4&quot;, 10 per sheet)</option>
              <option value="avery_5160">Avery 5160 (1&quot; x 2-5/8&quot;, 30 per sheet)</option>
            </select>
          </div>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handlePrintNow}
            disabled={isPrintDisabled}
            className="flex items-center gap-1.5"
            srContext="of QR code labels"
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
            onClick={onClose}
          >
            Done
          </Button>
        </div>
      </div>

      {/* Progress indicator during large rendering */}
      {isRenderingPending && (
        <div className="no-print py-2 px-3 bg-blue-50 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 rounded-lg text-xs flex items-center justify-between">
          <span>Preparing QR code canvases...</span>
          <span className="font-semibold">{renderedCount} / {codes.length}</span>
        </div>
      )}

      {/* Printable Sheet Grid Container */}
      <div
        data-testid="qr-print-sheet"
        data-template={template}
        className={`qr-print-sheet ${sheetTemplateClass} grid gap-3 max-h-[70vh] overflow-y-auto p-2 border border-gray-100 dark:border-zinc-800 rounded-lg bg-white ${
          isAvery5163 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
        }`}
        style={{
          minHeight: '200px',
        }}
      >
        {visibleCodes.map((item) => {
          const rsvpUrl = `${baseOrigin}${guestPath}?code=${encodeURIComponent(item.code || '')}`;
          const plusOne = [item.plusOneFirstName, item.plusOneLastName].filter(Boolean).join(' ');

          return (
            <div
              key={item.id}
              data-testid="qr-label-card"
              className={`qr-label-card ${cardTemplateClass} border border-dashed border-gray-300 dark:border-gray-600 rounded-lg bg-white text-gray-900 flex items-center gap-3 break-inside-avoid ${
                isAvery5163 ? 'min-h-[1.9in] p-3' : 'min-h-[0.95in] p-2'
              }`}
              style={{
                pageBreakInside: 'avoid',
                breakInside: 'avoid',
                boxSizing: 'border-box',
              }}
            >
              {/* QR Canvas */}
              <div className="qr-label-qr-box shrink-0 p-1 bg-white rounded border border-gray-100 flex items-center justify-center">
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
              <div className="qr-label-details flex-1 min-w-0 leading-tight">
                <div className="qr-label-guest-name font-bold text-sm text-gray-900 truncate" title={item.guestName}>
                  {item.guestName}
                </div>
                {plusOne && (
                  <div className="qr-label-plus-one text-[11px] text-gray-600 truncate">
                    &amp; {plusOne}
                  </div>
                )}
                {item.householdName && !plusOne && (
                  <div className="qr-label-household text-[10px] text-purple-700 truncate font-medium">
                    {item.householdName}
                  </div>
                )}
                <div className="qr-label-code mt-1 font-mono text-xs font-semibold text-red-600 tracking-wide">
                  {item.code}
                </div>
                <div className="qr-label-cta mt-0.5 text-[9px] uppercase tracking-wider text-gray-400 font-sans">
                  Scan to RSVP
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const InvitationQRPrintLabelsModal: React.FC<InvitationQRPrintLabelsModalProps> = ({
  isOpen,
  onClose,
  codes,
  headingLevel = 'h2',
}) => {
  const handleClose = () => {
    if (typeof document !== 'undefined') {
      document.body.classList.remove('printing-qr-labels');
    }
    onClose();
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (isOpen) {
      document.body.classList.add('printing-qr-labels');
    } else {
      document.body.classList.remove('printing-qr-labels');
    }
    return () => {
      document.body.classList.remove('printing-qr-labels');
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        if (typeof document !== 'undefined') {
          document.body.classList.remove('printing-qr-labels');
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  const modalContent = (
    <EnsureToastProvider>
      <div
        className="printable-qr-portal-root fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="printable-qr-modal-title"
      >
        <div
          className="printable-qr-backdrop no-print fixed inset-0 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
          aria-hidden="true"
        />
        <div className="printable-qr-dialog-panel relative z-10 max-w-4xl w-full rounded-2xl bg-white dark:bg-zinc-900 border border-gray-200 dark:border-zinc-800 shadow-2xl p-6">
          <Heading
            as={headingLevel}
            variant="none"
            unstyledColor
            id="printable-qr-modal-title"
            className="sr-only no-print"
          >
            Printable Invitation QR Labels
          </Heading>
          <InvitationQRPrintLabelsContent
            key={codes.length}
            codes={codes}
            onClose={handleClose}
          />
        </div>
      </div>
    </EnsureToastProvider>
  );

  return createPortal(modalContent, document.body);
};
