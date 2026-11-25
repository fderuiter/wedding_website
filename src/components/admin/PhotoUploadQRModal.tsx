'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { FormGroup, Input, Label } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/ToastProvider';
import { ThemedQRCode } from '@/components/ui/ThemedQRCode';
import { withBasePath } from '@/lib/basePath';

type PhotoPrintTemplateType = 'table_cards' | 'avery_5163' | 'avery_5160';

export interface PhotoUploadQRModalProps {
  isOpen: boolean;
  onClose: () => void;
  uploadUrl: string;
  configuredUploadUrl?: string | null;
  activeUploadUrl?: string | null;
  tokenVersion: number;
  isRotating?: boolean;
  onRotateToken: () => Promise<void>;
}

function extractUrlOrigin(rawUrl: string | null | undefined): string {
  if (!rawUrl || rawUrl.startsWith('/')) {
    return '';
  }
  try {
    return new URL(rawUrl).origin;
  } catch {
    return '';
  }
}

function swapUrlOrigin(rawUrl: string, nextOrigin: string): string {
  const cleanOrigin = nextOrigin.trim().replace(/\/+$/, '');
  if (!cleanOrigin) {
    return rawUrl;
  }
  if (!rawUrl) {
    return `${cleanOrigin}${withBasePath('/photos?tab=guest')}`;
  }
  if (rawUrl.startsWith('/')) {
    return `${cleanOrigin}${withBasePath(rawUrl)}`;
  }
  try {
    const parsed = new URL(rawUrl);
    return `${cleanOrigin}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return rawUrl;
  }
}

const DEFAULT_COPIES_BY_TEMPLATE: Record<PhotoPrintTemplateType, number> = {
  table_cards: 4,
  avery_5163: 10,
  avery_5160: 30,
};

export const PhotoUploadQRModal: React.FC<PhotoUploadQRModalProps> = ({
  isOpen,
  onClose,
  uploadUrl,
  configuredUploadUrl,
  activeUploadUrl,
  tokenVersion,
  isRotating = false,
  onRotateToken,
}) => {
  const { addToast, confirm } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [activeMode, setActiveMode] = useState<'preview' | 'print'>('preview');
  const [selectedOriginSource, setSelectedOriginSource] = useState<'configured' | 'active'>(
    'configured'
  );
  const [template, setTemplate] = useState<PhotoPrintTemplateType>('table_cards');
  const [copies, setCopies] = useState<number>(DEFAULT_COPIES_BY_TEMPLATE.table_cards);
  const [cardHeadline, setCardHeadline] = useState('Share Your Wedding Photos');

  const {
    resolvedConfiguredUrl,
    resolvedActiveUrl,
    configuredOrigin,
    activeOrigin,
    hasOriginMismatch,
  } = useMemo(() => {
    const browserOrigin =
      typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
    const rawConfigured = configuredUploadUrl || uploadUrl;

    let normalizedConfigured: string;
    if (!rawConfigured) {
      const photosPath = withBasePath('/photos?tab=guest');
      normalizedConfigured = browserOrigin ? `${browserOrigin}${photosPath}` : photosPath;
    } else if (rawConfigured.startsWith('/')) {
      const prefixed = withBasePath(rawConfigured);
      normalizedConfigured = browserOrigin ? `${browserOrigin}${prefixed}` : prefixed;
    } else {
      normalizedConfigured = rawConfigured;
    }

    let normalizedActive: string;
    if (activeUploadUrl) {
      if (activeUploadUrl.startsWith('/')) {
        const prefixed = withBasePath(activeUploadUrl);
        normalizedActive = browserOrigin ? `${browserOrigin}${prefixed}` : prefixed;
      } else {
        normalizedActive = activeUploadUrl;
      }
    } else if (browserOrigin) {
      normalizedActive = swapUrlOrigin(normalizedConfigured, browserOrigin);
    } else {
      normalizedActive = normalizedConfigured;
    }

    const cfgOrigin = extractUrlOrigin(normalizedConfigured);
    const actOrigin = browserOrigin || extractUrlOrigin(normalizedActive);
    const alignedActiveUrl =
      browserOrigin && extractUrlOrigin(normalizedActive) !== browserOrigin
        ? swapUrlOrigin(normalizedActive, browserOrigin)
        : normalizedActive;

    return {
      resolvedConfiguredUrl: normalizedConfigured,
      resolvedActiveUrl: alignedActiveUrl,
      configuredOrigin: cfgOrigin,
      activeOrigin: actOrigin,
      hasOriginMismatch: Boolean(cfgOrigin && actOrigin && cfgOrigin !== actOrigin),
    };
  }, [activeUploadUrl, configuredUploadUrl, uploadUrl]);

  const resolvedUploadUrl =
    hasOriginMismatch && selectedOriginSource === 'active'
      ? resolvedActiveUrl
      : resolvedConfiguredUrl;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (isOpen && activeMode === 'print') {
      document.body.classList.add('printing-qr-labels');
    } else {
      document.body.classList.remove('printing-qr-labels');
    }
    return () => {
      document.body.classList.remove('printing-qr-labels');
    };
  }, [isOpen, activeMode]);

  const handleClose = () => {
    if (typeof document !== 'undefined') {
      document.body.classList.remove('printing-qr-labels');
    }
    setActiveMode('preview');
    onClose();
  };

  if (!isOpen) return null;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(resolvedUploadUrl);
      setCopied(true);
      addToast('Signed guest photo upload link copied to clipboard!', 'success');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast('Failed to copy link to clipboard.', 'error');
    }
  };

  const handleDownloadPng = () => {
    try {
      const sourceCanvas = canvasRef.current;
      if (!sourceCanvas) {
        addToast('QR code canvas not found.', 'error');
        return;
      }

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = 512;
      exportCanvas.height = 512;
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas 2D context unavailable');
      }

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 512, 512);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sourceCanvas, 0, 0, 512, 512);

      const dataUrl = exportCanvas.toDataURL('image/png');
      const downloadLink = document.createElement('a');
      downloadLink.href = dataUrl;
      downloadLink.download = `guest-photo-upload-qr-v${tokenVersion}.png`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);

      addToast(`Downloaded guest-photo-upload-qr-v${tokenVersion}.png`, 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to download QR code image.';
      addToast(message, 'error');
    }
  };

  const handleRotateClick = async () => {
    const confirmed = await confirm(
      'Rotate the guest photo QR link? Previously printed or shared QR links will stop working immediately, while admin and authenticated guest sessions remain active.'
    );
    if (!confirmed) return;
    await onRotateToken();
  };

  const handleTemplateChange = (nextTemplate: PhotoPrintTemplateType) => {
    setTemplate(nextTemplate);
    setCopies(DEFAULT_COPIES_BY_TEMPLATE[nextTemplate]);
  };

  const handlePrintNow = () => {
    if (typeof document !== 'undefined') {
      document.body.classList.add('printing-qr-labels');
    }
    if (typeof window !== 'undefined' && typeof window.print === 'function') {
      window.print();
    }
  };

  const qrPrintDisplaySize =
    template === 'table_cards' ? 128 : template === 'avery_5163' ? 84 : 54;
  const printGridClass =
    template === 'avery_5160'
      ? 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'
      : 'grid-cols-1 sm:grid-cols-2';

  const cardIndices = Array.from({ length: copies }, (_, idx) => idx);

  const originMismatchBanner = hasOriginMismatch ? (
    <div
      role="region"
      aria-label="QR host mismatch warning"
      data-testid="photo-qr-origin-mismatch-warning"
      className="no-print rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/60 p-3.5 space-y-2.5 text-amber-950 dark:text-amber-100"
    >
      <div className="flex items-start gap-2.5">
        <Icon
          name="AlertTriangle"
          size={16}
          className="mt-0.5 shrink-0 text-amber-800 dark:text-amber-300"
          aria-hidden="true"
        />
        <div className="text-xs space-y-1">
          <p className="font-semibold">
            Configured site URL differs from your current browser host
          </p>
          <p className="text-amber-900 dark:text-amber-200">
            Configured domain is <span className="font-mono font-semibold">{configuredOrigin}</span>, while this dashboard is open on <span className="font-mono font-semibold">{activeOrigin}</span>. Switch origins below before copying or printing if guests should scan a different host.
          </p>
        </div>
      </div>
      <div
        role="group"
        aria-label="QR link origin"
        className="flex flex-wrap items-center gap-2 pt-0.5"
      >
        <button
          type="button"
          aria-pressed={selectedOriginSource === 'configured'}
          onClick={() => setSelectedOriginSource('configured')}
          data-testid="photo-qr-origin-configured-btn"
          className={`inline-flex items-center min-h-[32px] px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
            selectedOriginSource === 'configured'
              ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100'
              : 'bg-white text-stone-800 border-stone-300 hover:bg-stone-100 dark:bg-stone-900 dark:text-stone-100 dark:border-stone-700 dark:hover:bg-stone-800'
          }`}
        >
          Configured URL ({configuredOrigin})
        </button>
        <button
          type="button"
          aria-pressed={selectedOriginSource === 'active'}
          onClick={() => setSelectedOriginSource('active')}
          data-testid="photo-qr-origin-active-btn"
          className={`inline-flex items-center min-h-[32px] px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
            selectedOriginSource === 'active'
              ? 'bg-stone-900 text-white border-stone-900 dark:bg-stone-100 dark:text-stone-900 dark:border-stone-100'
              : 'bg-white text-stone-800 border-stone-300 hover:bg-stone-100 dark:bg-stone-900 dark:text-stone-100 dark:border-stone-700 dark:hover:bg-stone-800'
          }`}
        >
          Current Host ({activeOrigin})
        </button>
      </div>
    </div>
  ) : null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title="Guest Photo Upload QR & Printable Cards"
      className={`${activeMode === 'print' ? 'max-w-4xl' : 'max-w-lg'} w-full p-6 printable-qr-modal-dialog`}
    >
      {activeMode === 'preview' ? (
        <div className="space-y-5" data-testid="photo-qr-preview-panel">
          {originMismatchBanner}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-stone-100 dark:bg-stone-800/80 px-3.5 py-2.5 border border-stone-200 dark:border-stone-700">
            <div className="text-xs text-stone-700 dark:text-stone-300">
              <span className="font-semibold">Photo-Only Access:</span> Unlocks gallery &amp; uploads only. RSVPs and private events stay protected.
            </div>
            <span
              data-testid="photo-qr-version-badge"
              className="inline-flex items-center rounded-full bg-white dark:bg-stone-900 px-2.5 py-0.5 text-xs font-mono font-semibold text-stone-800 dark:text-stone-200 border border-stone-300 dark:border-stone-700"
            >
              Token v{tokenVersion}
            </span>
          </div>

          <div className="flex flex-col items-center justify-center p-4 bg-white dark:bg-zinc-800 rounded-2xl border border-stone-200 dark:border-zinc-700 shadow-inner">
            <div className="p-2 bg-white rounded-xl shadow-sm">
              <ThemedQRCode
                ref={canvasRef}
                value={resolvedUploadUrl}
                size={512}
                style={{ width: 220, height: 220, maxWidth: '100%' }}
                level="M"
                fgColor="#000000"
                bgColor="#ffffff"
                minContrastRatio={4.5}
                aria-label="Guest photo upload QR code"
              />
            </div>
            <p className="text-xs text-stone-600 dark:text-stone-300 mt-2 font-medium text-center">
              Guests scan with their phone camera to open the upload dropzone directly with no login prompt
            </p>
          </div>

          <FormGroup className="space-y-1.5">
            <Label
              htmlFor="photo-upload-qr-url"
              className="text-xs font-semibold text-stone-700 dark:text-stone-300"
            >
              Signed Photo Upload Link
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="photo-upload-qr-url"
                data-testid="photo-qr-signed-url-input"
                readOnly
                value={resolvedUploadUrl}
                className="text-xs font-mono select-all bg-stone-50 dark:bg-zinc-800 text-stone-800 dark:text-stone-200"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleCopyLink}
                data-testid="copy-photo-qr-link-btn"
                srContext="signed photo upload link"
                className="shrink-0 flex items-center gap-1.5"
              >
                <Icon name={copied ? 'Check' : 'Copy'} size={15} aria-hidden="true" />
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
          </FormGroup>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-stone-200 dark:border-stone-700">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRotateClick}
              disabled={isRotating}
              data-testid="rotate-photo-qr-token-btn"
              className="flex items-center gap-1.5 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40"
            >
              <Icon
                name="RotateCw"
                size={15}
                className={isRotating ? 'animate-spin' : ''}
                aria-hidden="true"
              />
              <span>{isRotating ? 'Rotating...' : 'Rotate Link'}</span>
            </Button>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setActiveMode('print')}
                data-testid="switch-photo-qr-print-view-btn"
              >
                Print Cards / Sheets
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleDownloadPng}
                data-testid="download-photo-qr-png-btn"
                srContext="512x512 QR code image"
                className="flex items-center gap-1.5"
              >
                <Icon name="Download" size={15} aria-hidden="true" />
                <span>Download PNG</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClose}
                data-testid="close-photo-qr-modal-btn"
              >
                Done
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="printable-qr-labels-area space-y-5" data-testid="photo-qr-print-panel">
          {originMismatchBanner}
          <div className="no-print bg-stone-50 dark:bg-zinc-800/80 p-4 rounded-xl border border-stone-200 dark:border-zinc-700 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-stone-900 dark:text-white">
                  Print Reception Table Cards or Avery Labels
                </h3>
                <p className="text-xs text-stone-600 dark:text-stone-400">
                  Admin navigation and modal chrome are automatically hidden when printing.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setActiveMode('preview')}
                  data-testid="back-to-photo-qr-preview-btn"
                >
                  Back to Preview
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handlePrintNow}
                  data-testid="print-photo-qr-cards-btn"
                  srContext="of QR cards or Avery labels"
                >
                  Print Sheet
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClose}
                  data-testid="close-photo-qr-modal-btn"
                >
                  Done
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormGroup>
                <Label
                  htmlFor="photo-qr-print-template"
                  className="text-xs font-semibold text-stone-700 dark:text-stone-300"
                >
                  Layout Format
                </Label>
                <select
                  id="photo-qr-print-template"
                  data-testid="photo-qr-print-template-select"
                  value={template}
                  onChange={(e) => handleTemplateChange(e.target.value as PhotoPrintTemplateType)}
                  className="w-full text-xs bg-white dark:bg-zinc-900 text-stone-900 dark:text-stone-100 border border-stone-300 dark:border-zinc-700 rounded-md px-2.5 py-2"
                >
                  <option value="table_cards">Reception Table Cards (4 per page)</option>
                  <option value="avery_5163">Avery 5163 (2&quot; x 4&quot;, 10 per sheet)</option>
                  <option value="avery_5160">Avery 5160 (1&quot; x 2-5/8&quot;, 30 per sheet)</option>
                </select>
              </FormGroup>

              <FormGroup>
                <Label
                  htmlFor="photo-qr-print-copies"
                  className="text-xs font-semibold text-stone-700 dark:text-stone-300"
                >
                  Copies to Print
                </Label>
                <select
                  id="photo-qr-print-copies"
                  data-testid="photo-qr-print-copies-select"
                  value={copies}
                  onChange={(e) => setCopies(Number(e.target.value))}
                  className="w-full text-xs bg-white dark:bg-zinc-900 text-stone-900 dark:text-stone-100 border border-stone-300 dark:border-zinc-700 rounded-md px-2.5 py-2"
                >
                  <option value={4}>4 cards</option>
                  <option value={10}>10 labels (1 sheet 5163)</option>
                  <option value={20}>20 labels (2 sheets 5163)</option>
                  <option value={30}>30 labels (1 sheet 5160)</option>
                </select>
              </FormGroup>

              <FormGroup>
                <Label
                  htmlFor="photo-qr-card-headline"
                  className="text-xs font-semibold text-stone-700 dark:text-stone-300"
                >
                  Card Heading
                </Label>
                <Input
                  id="photo-qr-card-headline"
                  data-testid="photo-qr-card-headline-input"
                  value={cardHeadline}
                  maxLength={60}
                  onChange={(e) => setCardHeadline(e.target.value)}
                  className="text-xs py-1.5"
                />
              </FormGroup>
            </div>
          </div>

          <div
            data-testid="qr-print-sheet"
            className={`qr-print-sheet grid gap-3 max-h-[60vh] overflow-y-auto p-2 border border-stone-200 dark:border-zinc-800 rounded-lg bg-white ${printGridClass}`}
            style={{ minHeight: '200px' }}
          >
            {cardIndices.map((idx) =>
              template === 'table_cards' ? (
                <div
                  key={idx}
                  data-testid="qr-label-card"
                  className="qr-label-card border border-dashed border-stone-300 rounded-xl p-5 bg-white text-stone-900 flex flex-col items-center text-center justify-center gap-3 min-h-[3.2in] break-inside-avoid"
                  style={{
                    pageBreakInside: 'avoid',
                    breakInside: 'avoid',
                    boxSizing: 'border-box',
                  }}
                >
                  <div className="p-2 bg-white rounded-lg border border-stone-200 flex items-center justify-center">
                    <ThemedQRCode
                      value={resolvedUploadUrl}
                      size={qrPrintDisplaySize * 2}
                      style={{ width: qrPrintDisplaySize, height: qrPrintDisplaySize }}
                      level="M"
                      fgColor="#000000"
                      bgColor="#ffffff"
                      aria-label={`Table card QR code ${idx + 1}`}
                    />
                  </div>
                  <div className="space-y-1">
                    <div className="font-bold text-base text-stone-900">
                      {cardHeadline || 'Share Your Wedding Photos'}
                    </div>
                    <div className="text-xs text-stone-600">
                      Scan with your phone camera to upload photos directly — no password required
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  key={idx}
                  data-testid="qr-label-card"
                  className={`qr-label-card border border-dashed border-stone-300 rounded-lg p-3 bg-white text-stone-900 flex items-center gap-3 break-inside-avoid ${
                    template === 'avery_5163' ? 'min-h-[1.9in]' : 'min-h-[0.95in] p-2'
                  }`}
                  style={{
                    pageBreakInside: 'avoid',
                    breakInside: 'avoid',
                    boxSizing: 'border-box',
                  }}
                >
                  <div className="shrink-0 p-1 bg-white rounded border border-stone-100 flex items-center justify-center">
                    <ThemedQRCode
                      value={resolvedUploadUrl}
                      size={qrPrintDisplaySize * 2}
                      style={{ width: qrPrintDisplaySize, height: qrPrintDisplaySize }}
                      level="M"
                      fgColor="#000000"
                      bgColor="#ffffff"
                      aria-label={`Printable photo upload QR label ${idx + 1}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0 leading-tight">
                    <div className="font-bold text-xs text-stone-900 truncate">
                      {cardHeadline || 'Share Your Wedding Photos'}
                    </div>
                    <div className="mt-1 text-[10px] text-stone-600">
                      Scan to upload wedding photos
                    </div>
                    <div className="mt-0.5 text-[9px] uppercase tracking-wider text-stone-600 font-sans">
                      No login needed
                    </div>
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
};
