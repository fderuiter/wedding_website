'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useKeenSlider } from 'keen-slider/react';

export interface GalleryImage {
  src: string;
  alt: string;
}

interface GalleryProps {
  images: GalleryImage[];
  autoplayDelay?: number;
}

const Gallery: React.FC<GalleryProps> = ({ images, autoplayDelay = 3000 }) => {
  const timer = useRef<NodeJS.Timeout | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sliderRef, instanceRef] = useKeenSlider<HTMLDivElement>({
    loop: true,
    created: () => setLoaded(true),
  });

  useEffect(() => {
    if (!instanceRef.current) return;
    timer.current = setInterval(() => instanceRef.current?.next(), autoplayDelay);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [instanceRef, autoplayDelay]);

  if (!loaded) {
    return (
      <div
        ref={sliderRef}
        className="keen-slider aspect-square w-full max-w-lg mx-auto rounded-lg overflow-hidden bg-gray-200 dark:bg-gray-800"
        style={{ display: 'flex', overflow: 'hidden', position: 'relative', alignItems: 'center', justifyContent: 'center' }}
        data-testid="loading-placeholder"
      />
    );
  }

  return (
    <div
      ref={sliderRef}
      className="keen-slider aspect-square w-full max-w-lg mx-auto rounded-lg overflow-hidden"
      style={{ display: 'flex', overflow: 'hidden', position: 'relative' }}
    >
      {images.map((img, idx) => (
        <div
          className="keen-slider__slide flex items-center justify-center"
          key={idx}
          style={{ minHeight: '100%', width: '100%', position: 'relative' }}
        >
          <Image
            src={img.src}
            alt={img.alt}
            fill
            sizes="(max-width: 1024px) 100vw, 50vw"
            className="object-cover w-full h-full"
          />
        </div>
      ))}
    </div>
  );
};

export default Gallery;
