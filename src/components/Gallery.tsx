import React, { useEffect, useRef } from 'react';
import Image from 'next/image';
import { useKeenSlider } from 'keen-slider/react';
import 'keen-slider/keen-slider.min.css';

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
  const [sliderRef, instanceRef] = useKeenSlider<HTMLDivElement>({
    loop: true,
  });

  useEffect(() => {
    if (!instanceRef.current) return;
    timer.current = setInterval(() => instanceRef.current?.next(), autoplayDelay);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [instanceRef, autoplayDelay]);

  return (
    <div ref={sliderRef} className="keen-slider aspect-square w-full max-w-lg mx-auto rounded-lg overflow-hidden">
      {images.map((img, idx) => (
        <div className="keen-slider__slide flex items-center justify-center" key={idx}>
          <Image src={img.src} alt={img.alt} width={600} height={600} className="object-cover w-full h-full" />
        </div>
      ))}
    </div>
  );
};

export default Gallery;
