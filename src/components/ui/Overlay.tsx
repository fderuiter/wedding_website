'use client';

import React from 'react';
import { useOverlay } from '@/hooks/useOverlay';

interface OverlayProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export function Overlay({ isOpen, onClose, children, className, id }: OverlayProps) {
  const { overlayRef, handleBackdropClick } = useOverlay(isOpen, onClose);

  if (!isOpen) return null;

  return (
    <div
      ref={overlayRef}
      id={id}
      className={className}
      onClick={handleBackdropClick}
      aria-hidden={!isOpen}
      aria-modal="true"
      role="dialog"
    >
      {children}
    </div>
  );
}
