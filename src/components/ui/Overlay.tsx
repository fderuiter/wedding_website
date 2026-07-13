'use client';

import React from 'react';
import { useOverlay } from '@/hooks/useOverlay';
import { motion, AnimatePresence } from 'framer-motion';

export interface OverlayProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  id?: string;
  animationType?: 'scale' | 'slide-down' | 'fade';
  layoutClassName?: string;
}

export function Overlay({
  isOpen,
  onClose,
  children,
  className = '',
  id,
  animationType = 'scale',
  layoutClassName = 'fixed inset-0 z-50 flex items-center justify-center p-4'
}: OverlayProps) {
  const { overlayRef, handleBackdropClick } = useOverlay(isOpen, onClose);

  // Transitions
  const transitions = {
    scale: {
      initial: { opacity: 0, scale: 0.95 },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: 0.95 },
      transition: { duration: 0.2 }
    },
    'slide-down': {
      initial: { opacity: 0, y: -20 },
      animate: { opacity: 1, y: 0 },
      exit: { opacity: 0, y: -20 },
      transition: { duration: 0.2 }
    },
    fade: {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.2 }
    }
  };

  const anim = transitions[animationType];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          id={id}
          className={`${layoutClassName} bg-black/60 backdrop-blur-sm`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleBackdropClick}
          aria-hidden={!isOpen}
          aria-modal="true"
          role="dialog"
        >
          <motion.div
            ref={overlayRef}
            className={className}
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
