import React from 'react';
import { Metadata } from 'next';
import PhotoGrid from '@/components/PhotoGrid';
import { GalleryImage } from '@/components/Gallery';

export const metadata: Metadata = {
  title: "Photos",
  alternates: {
    canonical: '/photos',
  },
};

const galleryImages: GalleryImage[] = [
  { src: '/images/sunset-embrace.jpg', alt: 'Abbi and Fred hug on a lakeside path at sunset, framed by twisting bare branches and a glowing orange sky.' },
  { src: '/images/jogging-buddies.jpg', alt: 'Sweaty but smiling, Abbi and Fred snap a post-run selfie on a sunny sidewalk beside a brick building.' },
  { src: '/images/winter-warmth.jpg', alt: 'Bundled in winter layers, Abbi and Fred pose against a brick wall—she in leopard-trimmed coat and hat, he in a dark jacket—both beaming.' },
  { src: '/images/sunset-kiss.jpg', alt: 'Abbi and Fred share a quiet kiss at sunset beneath leafless tree silhouettes, golden light reflecting off the lake behind them.' },
  { src: '/images/timberwolves.jpg', alt: 'Abbi and Fred smile from their seats at a packed Timberwolves basketball game, sporting team gear and surrounded by excited fans.' },
  { src: '/images/twins-wins.jpg', alt: 'Abbi and Fred grin for a selfie with Target\u202fField and a cheering Minnesota Twins crowd spread out behind them.' },
  { src: '/images/post-graduation-celebration.jpg', alt: 'Dressed up for the evening, Fred in a crisp white shirt hugs Abbi in a black dress as they smile warmly against a simple light backdrop.' },
];


/**
 * @page PhotosPage
 * @description A page that displays a gallery of photos of the couple.
 *
 * This component defines a collection of images and renders them using the `PhotoGrid`
 * component, which provides a responsive grid layout and a lightbox for viewing
_ * individual photos.
 *
 * @returns {JSX.Element} The rendered photos page.
 */
export default function PhotosPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-center mb-8 text-rose-700 dark:text-rose-400">
        Our Photos
      </h1>
      <PhotoGrid images={galleryImages} />
    </main>
  );
}
