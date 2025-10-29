import React from 'react';
import { Metadata } from 'next';
import Link from 'next/link';
import { Camera } from 'lucide-react';
import Image from 'next/image';

export const metadata: Metadata = {
  title: "Photos",
  alternates: {
    canonical: '/photos',
  },
};

const featuredPhotos = [
    {
        src: 'https://lh3.googleusercontent.com/pw/AP1GczODgnqdtUHWdCR_PDvAcDDm-RlYv0HE_oJtRCDTKF9nCREFVhZRl_020THVphEdxLAjgYfUdz0KYgCBw1sqmaF1GC7RBh0u3CZmUgBtwD7Z-bEkPm5A=w1080-h720-no',
        alt: 'Photo 1',
    },
    {
        src: 'https://lh3.googleusercontent.com/pw/AP1GczPzyrWDTfT2ofwHN6_wBKO8luOfDy2xpvoQNOiOw1cSoO1yUaLPW3mPbTBCUFGoCqI1hB0udanXyfM55PXEMYtmkkTSqQhoUVqQnBmz5qnYUYU_NnhB=w1080-h720-no',
        alt: 'Photo 2',
    },
    {
        src: 'https://lh3.googleusercontent.com/pw/AP1GczPeRWHDkvouhncUEhhHHOAo5u-uPM3S7a6EXZTH8qO3BsG2Yo-f_y7XpK8TqALxpm4_OeA14gzpGOiiTBj6b2JP27xNQ39P159CbZn8BML4cRrcrSYw=w480-h720-no',
        alt: 'Photo 3',
    },
    {
        src: 'https://lh3.googleusercontent.com/pw/AP1GczP2x9gDf6MmKoAhEBg3cUOCg42Mk-l0uPPOuhBp77b-KrlgnPN_1yqUT2F_tc3ffa4BIvQBVcONVuV3_AXp_1T6l0PugHstYE0IDKKqikjy16ZNpiu7=w480-h720-no',
        alt: 'Photo 4',
    },
    {
        src: 'https://lh3.googleusercontent.com/pw/AP1GczMfm0jygX3akWEN6XZXxKi72qPDtykQtA30g2hU3aWsP_bqtDMSuJAfDJUUABiO6XSrpoaOATGSw1HN6ZX91dOiXvha6GGqYkakGL24hgUXUSek_EHM=w480-h720-no',
        alt: 'Photo 5',
    },
    {
        src: 'https://lh3.googleusercontent.com/pw/AP1GczPkTva_2XGwF8d1eVuuWinGtR_bfqpJHHhDEshfYUKDcwzXn0-egIBsf8TbYbmAcuowf-p72HDytwpK3ORDcD5AOtbXG7Lup_wS2yZYSDzqXqrH3iNc=w480-h720-no',
        alt: 'Photo 6',
    },
];

export default function PhotosPage() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-center mb-8 text-rose-700 dark:text-rose-400">
        Our Wedding Photos
      </h1>
      <p className="text-center text-lg mb-12">
        Here is a small selection of photos from our special day. You can view the full album on Google Photos.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-8">
        {featuredPhotos.map((photo) => (
          <div key={photo.src} className="relative aspect-w-1 aspect-h-1">
            <Image
              src={photo.src}
              alt={photo.alt}
              fill
              style={{objectFit: "cover"}}
              className="rounded-lg"
            />
          </div>
        ))}
      </div>
      <div className="flex justify-center mt-12">
        <Link href="https://photos.app.goo.gl/v1Rw81HSoyLVNEDx5"
          target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-rose-700 to-amber-500 px-8 py-3 text-white shadow-lg transition hover:shadow-xl">
            View Full Album
            <Camera className="w-5 h-5" />
        </Link>
      </div>
    </main>
  );
}
