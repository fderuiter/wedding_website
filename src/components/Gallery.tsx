import React, { useEffect, useRef } from 'react';
import Image from 'next/image';
import { useKeenSlider } from 'keen-slider/react';
import 'keen-slider/keen-slider.min.css';

/**
 * @interface GalleryImage
 * @description Defines the structure for an image object used in the gallery.
 * @property {string} src - The source URL of the image.
 * @property {string} alt - The alternative text for the image.
 */
export interface GalleryImage {
  src: string;
  alt: string;
}

/**
 * @interface GalleryProps
 * @description Defines the props for the Gallery component.
 * @property {GalleryImage[]} images - An array of image objects to be displayed in the gallery.
 * @property {number} [autoplayDelay=4000] - The delay in milliseconds for the autoplay feature. Defaults to 4000.
 */
interface GalleryProps {
  images: GalleryImage[];
  autoplayDelay?: number;
}

/**
 * @function Gallery
 * @description A React component that displays an auto-playing image gallery/slider.
 * It uses the 'keen-slider' library for the slider functionality.
 * @param {GalleryProps} props - The props for the component.
 * @returns {JSX.Element} The rendered Gallery component.
 */
const Gallery: React.FC<GalleryProps> = ({ images, autoplayDelay = 4000 }) => {
  const timer = useRef<NodeJS.Timeout | null>(null);
  const [sliderRef, instanceRef] = useKeenSlider<HTMLDivElement>({
    loop: true,
  });

  useEffect(() => {
    if (!instanceRef.current) return;
    const slider = instanceRef.current;

    const autoplay = () => {
      timer.current = setInterval(() => slider.next(), autoplayDelay);
    };

    const resetTimer = () => {
      if (timer.current) clearInterval(timer.current);
      autoplay();
    };

    slider.on('created', autoplay);
    slider.on('dragStarted', () => {
      if (timer.current) clearInterval(timer.current);
    });
    slider.on('animationEnded', resetTimer);
    slider.on('updated', resetTimer);

    autoplay(); // Start autoplay on mount

    return () => {
      if (timer.current) clearInterval(timer.current);
      slider.destroy();
    };
  }, [instanceRef, autoplayDelay]);

  return (
    <div ref={sliderRef} className="keen-slider aspect-square w-full max-w-lg mx-auto rounded-lg overflow-hidden shadow-lg">
      {images.map((img, idx) => (
        <div className="keen-slider__slide" key={idx}>
          <Image
            src={img.src}
            alt={img.alt}
            width={600}
            height={600}
            className="object-cover w-full h-full"
            placeholder="blur"
            blurDataURL="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
            priority={idx === 0}
          />
        </div>
      ))}
    </div>
  );
};

export default Gallery;
