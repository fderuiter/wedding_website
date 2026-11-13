'use client';

import React, { useRef, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/ToastProvider';
import { ThemedQRCode } from '@/components/ui/ThemedQRCode';

export interface InvitationQRPreviewGuest {
  id?: string;
  guestName: string;
  code: string;
  householdName?: string | null;
  partyGroup?: string | null;
  plusOneFirstName?: string | null;
  plusOneLastName?: string | null;
}

export interface InvitationQRPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  guest: InvitationQRPreviewGuest | null;
}

export const InvitationQRPreviewModal: React.FC<InvitationQRPreviewModalProps> = ({
  isOpen,
  onClose,
  guest,
}) => {
  const { addToast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);

  if (!guest) return null;

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const rsvpUrl = `${origin}/guest?code=${encodeURIComponent(guest.code || '')}`;
  const plusOneName = [guest.plusOneFirstName, guest.plusOneLastName].filter(Boolean).join(' ');

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(rsvpUrl);
      setCopied(true);
      addToast('Personalized RSVP link copied to clipboard!', 'success');
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

      // Generate a strict 512x512 high-resolution PNG image
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = 512;
      exportCanvas.height = 512;
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) {
        throw new Error('Canvas 2D context unavailable');
      }

      // Fill white background for maximum contrast compatibility on external viewer apps
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 512, 512);

      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sourceCanvas, 0, 0, 512, 512);

      const dataUrl = exportCanvas.toDataURL('image/png');
      const downloadLink = document.createElement('a');
      downloadLink.href = dataUrl;
      downloadLink.download = `qr-${guest.code || 'code'}.png`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);

      addToast(`Downloaded qr-${guest.code || 'code'}.png`, 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to download QR code image.', 'error');
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Guest Invitation QR Preview"
      className="max-w-md w-full p-6"
    >
      <div className="space-y-5">
        {/* Guest Summary Header */}
        <div className="text-center space-y-1">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white" data-testid="qr-modal-guest-name">
            {guest.guestName}
          </h2>
          {plusOneName && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Plus-One: <span className="font-medium text-gray-700 dark:text-gray-200">{plusOneName}</span>
            </p>
          )}
          {guest.householdName && (
            <p className="text-xs text-purple-700 dark:text-purple-300 font-medium">
              Household: {guest.householdName}
            </p>
          )}
          <div className="pt-1">
            <span className="text-xs uppercase tracking-wider text-gray-500 font-semibold mr-1.5">
              Code:
            </span>
            <code className="bg-gray-100 dark:bg-gray-800 text-red-600 dark:text-red-400 px-2 py-0.5 rounded font-mono font-bold text-sm">
              {guest.code}
            </code>
          </div>
        </div>

        {/* QR Code Canvas Display */}
        <div className="flex flex-col items-center justify-center p-4 bg-white dark:bg-zinc-800 rounded-2xl border border-gray-200 dark:border-zinc-700 shadow-inner">
          <div className="p-2 bg-white rounded-xl shadow-sm">
            <ThemedQRCode
              ref={canvasRef}
              value={rsvpUrl}
              size={512}
              style={{ width: 220, height: 220, maxWidth: '100%' }}
              level="H"
              minContrastRatio={4.5}
              aria-label={`Personalized QR code for ${guest.guestName}`}
            />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 font-medium">
            Scan to pre-authenticate guest session
          </p>
        </div>

        {/* Personalized RSVP URL */}
        <FormGroup className="space-y-1.5">
          <Label htmlFor="personalized-rsvp-url" className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            Personalized RSVP URL
          </Label>
          <div className="flex items-center gap-2">
            <Input
              id="personalized-rsvp-url"
              readOnly
              value={rsvpUrl}
              className="text-xs font-mono select-all bg-gray-50 dark:bg-zinc-800 text-gray-800 dark:text-gray-200"
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleCopyLink}
              aria-label="Copy personalized RSVP URL"
              className="shrink-0 flex items-center gap-1.5"
            >
              <Icon name={copied ? 'Check' : 'Copy'} size={15} />
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </Button>
          </div>
        </FormGroup>

        {/* Modal Action Footer */}
        <div className="pt-2 flex items-center justify-between gap-3 border-t border-gray-100 dark:border-zinc-700">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
          >
            Close
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleDownloadPng}
            className="flex items-center gap-1.5"
            aria-label="Download QR code as PNG image"
          >
            <Icon name="Download" size={15} />
            <span>Download PNG</span>
          </Button>
        </div>
      </div>
    </Dialog>
  );
};
