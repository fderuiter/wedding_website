'use client';

import React, { useEffect } from 'react';
import Image from 'next/image';
import { GalleryImage } from './Gallery';
import { Icon } from '@/components/ui/Icon';
import { Overlay } from '@/components/ui/Overlay';

/**
 * @interface LightboxProps
 * @description Defines the props for the Lightbox component.
 * @property {GalleryImage[]} images - An array of image objects to be displayed in the lightbox.
 * @property {number} currentIndex - The index of the currently displayed image in the `images` array.
 * @property {() => void} onClose - Callback function to close the lightbox.
 * @property {() => void} onNext - Callback function to navigate to the next image.
 * @property {() => void} onPrev - Callback function to navigate to the previous image.
 */
interface LightboxProps {
  isOpen: boolean
  images: GalleryImage[]
  currentIndex: number
  onClose: () => void
  onNext: () => void
  onPrev: () => void
}

/**
 * @function Lightbox
 * @description A React component that displays an image in a full-screen modal,
 * allowing navigation between images.
 * @param {LightboxProps} props - The props for the component.
 * @returns {JSX.Element} The rendered Lightbox component.
 */
const Lightbox: React.FC<LightboxProps> = ({
  isOpen,
  images,
  currentIndex,
  onClose,
  onNext,
  onPrev,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        onNext();
      } else if (e.key === 'ArrowLeft') {
        onPrev();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onNext, onPrev, isOpen]);

  if (images.length === 0) return null;

  const image = images[currentIndex] || images[0];

  return (
    <Overlay isOpen={isOpen} onClose={onClose} animationType="scale" layoutClassName="fixed inset-0 z-50 flex items-center justify-center">
      <div className="relative w-screen h-screen max-w-[90vw] max-h-[90vh]">
        <Image
          src={image.src}
          alt={image.alt}
          fill
          style={{ objectFit: 'contain' }}
          className="rounded-lg"
        />
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
          aria-label="Close"
        >
          <Icon name="X" size="calc(32px * var(--scale-factor))" />
        </button>
        <button
          onClick={onPrev}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
          aria-label="Previous image"
        >
          <Icon name="ChevronLeft" size="calc(48px * var(--scale-factor))" />
        </button>
        <button
          onClick={onNext}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded"
          aria-label="Next image"
        >
          <Icon name="ChevronRight" size="calc(48px * var(--scale-factor))" />
        </button>
      </div>
    </Overlay>
  );
};

export default Lightbox;
