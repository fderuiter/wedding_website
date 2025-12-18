'use client'

import React, { useState, useCallback, memo } from 'react'
import Image from 'next/image'
import { GalleryImage } from './Gallery'
import Lightbox from './Lightbox'

/**
 * @interface PhotoGridProps
 * @description Defines the props for the PhotoGrid component.
 * @property {GalleryImage[]} images - An array of image objects to be displayed in the grid.
 */
interface PhotoGridProps {
  images: GalleryImage[]
}

/**
 * @function PhotoGrid
 * @description A React component that displays a grid of photos.
 * Clicking on a photo opens it in a lightbox for a larger view.
 * @param {PhotoGridProps} props - The props for the component.
 * @returns {JSX.Element} The rendered PhotoGrid component.
 */
const PhotoGrid: React.FC<PhotoGridProps> = ({ images }) => {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)

  // Memoize handlers to prevent unnecessary re-renders of child components
  const openLightbox = useCallback((index: number) => {
    setCurrentIndex(index)
    setLightboxOpen(true)
  }, [])

  const closeLightbox = useCallback(() => {
    setLightboxOpen(false)
  }, [])

  const nextImage = useCallback(() => {
    setCurrentIndex((prevIndex) => (prevIndex + 1) % images.length)
  }, [images.length])

  const prevImage = useCallback(() => {
    setCurrentIndex(
      (prevIndex) => (prevIndex - 1 + images.length) % images.length
    )
  }, [images.length])

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {images.map((image, index) => (
          <GridImage
            key={index}
            image={image}
            index={index}
            openLightbox={openLightbox}
          />
        ))}
      </div>
      {lightboxOpen && (
        <Lightbox
          images={images}
          currentIndex={currentIndex}
          onClose={closeLightbox}
          onNext={nextImage}
          onPrev={prevImage}
        />
      )}
    </>
  )
}

interface GridImageProps {
  image: GalleryImage
  index: number
  openLightbox: (index: number) => void
}

// Memoize GridImage to prevent re-rendering when PhotoGrid state changes (e.g. lightbox opens)
// This is a performance optimization, especially for large grids.
const GridImage = memo<GridImageProps>(({
  image,
  index,
  openLightbox,
}) => {
  // Optimization: Removed useInView overhead.
  // Next.js Image component handles lazy loading (network) natively.
  // We use standard CSS aspect-ratio and relative positioning for the container.

  return (
    <div
      className="aspect-square relative cursor-pointer bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden"
      onClick={() => openLightbox(index)}
    >
      <Image
        src={image.src}
        alt={image.alt}
        fill
        sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
        className="object-cover hover:scale-105 transition-transform duration-300"
      />
    </div>
  )
})

GridImage.displayName = 'GridImage'

export default PhotoGrid
