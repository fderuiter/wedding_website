'use client'

import React, { useEffect, useRef } from 'react'
import Image from 'next/image'
import { GalleryImage } from './Gallery'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'

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
  images,
  currentIndex,
  onClose,
  onNext,
  onPrev,
}) => {
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowRight') {
        onNext()
      } else if (e.key === 'ArrowLeft') {
        onPrev()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, onNext, onPrev])

  const image = images[currentIndex]

  return (
    <div
      ref={modalRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full h-full max-w-4xl max-h-4/5" onClick={(e) => e.stopPropagation()}>
        <Image
          src={image.src}
          alt={image.alt}
          fill
          style={{ objectFit: 'contain' }}
          className="rounded-lg"
        />
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-white hover:text-rose-400"
          aria-label="Close"
        >
          <X size={32} />
        </button>
        <button
          onClick={onPrev}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white hover:text-rose-400"
          aria-label="Previous image"
        >
          <ChevronLeft size={48} />
        </button>
        <button
          onClick={onNext}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white hover:text-rose-400"
          aria-label="Next image"
        >
          <ChevronRight size={48} />
        </button>
      </div>
    </div>
  )
}

export default Lightbox
