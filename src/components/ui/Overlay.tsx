'use client';

import React, { useCallback } from 'react';
import { useOverlay } from '@/hooks/useOverlay';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/utils/cn';

export interface OverlayProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  id?: string;
  animationType?: 'scale' | 'slide-down' | 'fade';
  layoutClassName?: string;
  role?: string;
  'aria-modal'?: boolean | 'true' | 'false';
}

export const Overlay = React.forwardRef<HTMLDivElement, OverlayProps>(
  (
    {
      isOpen,
      onClose,
      children,
      className,
      style,
      id,
      animationType = 'scale',
      layoutClassName = 'fixed inset-0 z-50 flex items-center justify-center p-4',
      role,
      'aria-modal': ariaModal,
    },
    ref
  ) => {
    const { overlayRef, handleBackdropClick } = useOverlay(isOpen, onClose);

    const setOverlayRef = useCallback(
      (node: HTMLDivElement | null) => {
        (overlayRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
      },
      [overlayRef, ref]
    );

    // Transitions
    const transitions = {
      scale: {
        initial: { opacity: 0, scale: 0.95 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.95 },
        transition: { duration: 0.2 },
      },
      'slide-down': {
        initial: { opacity: 0, y: -20 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -20 },
        transition: { duration: 0.2 },
      },
      fade: {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: 0.2 },
      },
    };

    const anim = transitions[animationType];

    return (
      <AnimatePresence>
        {isOpen && (
          <motion.div
            id={id}
            className={cn(layoutClassName, 'bg-black/60 backdrop-blur-sm')}
            style={{ backgroundColor: 'var(--dialog-backdrop, rgba(0, 0, 0, 0.6))' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleBackdropClick}
            aria-hidden={!isOpen}
            role={role}
            aria-modal={ariaModal}
          >
            <motion.div
              ref={setOverlayRef}
              className={cn(className)}
              style={style}
              onClick={(e) => e.stopPropagation()}
              {...anim}
            >
              {children}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }
);

Overlay.displayName = 'Overlay';

