import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { contentService } from '@/features/content';
import type { ContentNodeDTO } from '@/features/content';
import { withPageQuery } from '@/lib/query-wrapper';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { enforceActiveGuestPageSession } from '@/core/auth/guestInviteSession';
import { ReceptionSlideshowClient, SlideshowPhoto } from '@/components/photos/ReceptionSlideshowClient';

export const metadata: Metadata = {
  title: 'Live Reception Slideshow',
  alternates: {
    canonical: '/photos/slideshow',
  },
};

/**
 * @page PhotosSlideshowPage
 * @description A standalone presentation route designed for venue projectors and monitors.
 * Displays cycling approved public wedding photos with a toggleable QR code overlay and background polling.
 *
 * @returns {Promise<JSX.Element>} The rendered standalone slideshow page.
 */
export default async function PhotosSlideshowPage() {
  await enforceActiveGuestPageSession();
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    notFound();
  }

  const defaultUrls: SlideshowPhoto[] = [
    {
      id: 'default-1',
      url: 'https://lh3.googleusercontent.com/pw/AP1GczNPp0Rk6pvvMtymS3RUx7F6cAyOkFaovF20N5_FkaDupk3QkgjNWfTiMxZbgtnyO-Ny0tH3JPkT6Vld35Pg8xFq1AAcZcxnHdTQ3DfHKsNLKpA59mEw=w1920-h1080',
      title: 'Our Special Day',
    },
    {
      id: 'default-2',
      url: 'https://lh3.googleusercontent.com/pw/AP1GczODgnqdtUHWdCR_PDvAcDDm-RlYv0HE_oJtRCDTKF9nCREFVhZRl_020THVphEdxLAjgYfUdz0KYgCBw1sqmaF1GC7RBh0u3CZmUgBtwD7Z-bEkPm5A=w1920-h1080',
      title: 'Celebrating Together',
    },
    {
      id: 'default-3',
      url: 'https://lh3.googleusercontent.com/pw/AP1GczPzyrWDTfT2ofwHN6_wBKO8luOfDy2xpvoQNOiOw1cSoO1yUaLPW3mPbTBCUFGoCqI1hB0udanXyfM55PXEMYtmkkTSqQhoUVqQnBmz5qnYUYU_NnhB=w1920-h1080',
      title: 'Cherished Memories',
    },
    {
      id: 'default-4',
      url: 'https://lh3.googleusercontent.com/pw/AP1GczPeRWHDkvouhncUEhhHHOAo5u-uPM3S7a6EXZTH8qO3BsG2Yo-f_y7XpK8TqALxpm4_OeA14gzpGOiiTBj6b2JP27xNQ39P159CbZn8BML4cRrcrSYw=w1920-h1080',
      title: 'Wedding Highlights',
    },
    {
      id: 'default-5',
      url: 'https://lh3.googleusercontent.com/pw/AP1GczP2x9gDf6MmKoAhEBg3cUOCg42Mk-l0uPPOuhBp77b-KrlgnPN_1yqUT2F_tc3ffa4BIvQBVcONVuV3_AXp_1T6l0PugHstYE0IDKKqikjy16ZNpiu7=w1920-h1080',
      title: 'Evening Celebration',
    },
  ];

  const photoNodes = await withPageQuery(
    () => contentService.getPublicPhotos(),
    [] as ContentNodeDTO[]
  );

  const initialPhotos: SlideshowPhoto[] =
    photoNodes.length > 0
      ? photoNodes
        .map((n) => {
          const data = n.data as { url?: string; title?: string; altText?: string; mediaId?: string } | undefined;
          if (!data?.url) return null;
          return {
            id: n.id,
            url: data.url,
            title: data.title || data.altText || 'Reception Photo',
            altText: data.altText || data.title,
            isGuestUpload: Boolean(data.mediaId),
            createdAt: n.createdAt ? new Date(n.createdAt).toISOString() : undefined,
          };
        })
        .filter(Boolean) as SlideshowPhoto[]
      : defaultUrls;

  const uploadUrl = config.baseUrl ? `${config.baseUrl.replace(/\/$/, '')}/photos` : undefined;

  return (
    <ReceptionSlideshowClient
      initialPhotos={initialPhotos}
      uploadUrl={uploadUrl}
    />
  );
}
