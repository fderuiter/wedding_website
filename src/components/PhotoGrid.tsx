'use client'

import React, { useState } from 'react'
import Image from 'next/image'
import { GalleryImage } from './Gallery'
import Lightbox from './Lightbox'
import { useInView } from 'react-intersection-observer'

interface PhotoGridProps {
  images: GalleryImage[]
}

const PhotoGrid: React.FC<PhotoGridProps> = ({ images }) => {
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)

  const openLightbox = (index: number) => {
    setCurrentIndex(index)
    setLightboxOpen(true)
  }

  const closeLightbox = () => {
    setLightboxOpen(false)
  }

  const nextImage = () => {
    setCurrentIndex((prevIndex) => (prevIndex + 1) % images.length)
  }

  const prevImage = () => {
    setCurrentIndex(
      (prevIndex) => (prevIndex - 1 + images.length) % images.length
    )
  }

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

const GridImage: React.FC<GridImageProps> = ({
  image,
  index,
  openLightbox,
}) => {
  const { ref, inView } = useInView({
    triggerOnce: true,
    threshold: 0.1,
  })

  return (
    <div
      ref={ref}
      className="aspect-w-1 aspect-h-1 cursor-pointer"
      onClick={() => openLightbox(index)}
    >
      {inView ? (
        <Image
          src={image.src}
          alt={image.alt}
          width={500}
          height={500}
          className="object-cover w-full h-full rounded-lg shadow-md hover:shadow-xl transition-shadow"
        />
      ) : (
        <div className="w-full h-full bg-gray-200 dark:bg-gray-800 rounded-lg" />
      )}
    </div>
  )
}

export default PhotoGrid
