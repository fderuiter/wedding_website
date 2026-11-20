import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { contentService } from '@/features/content';
import type { ContentNodeDTO } from '@/features/content';
import { withPageQuery } from '@/lib/query-wrapper';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
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
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    notFound();
  }

  const photoNodes = await withPageQuery(
    () => contentService.getPublicPhotos(),
    [] as ContentNodeDTO[]
  );

  const initialPhotos: SlideshowPhoto[] = photoNodes
    .map((n) => {
      const data = n.data as { url?: string; title?: string; altText?: string } | undefined;
      if (!data?.url) return null;
      return {
        id: n.id,
        url: data.url,
        title: data.title || data.altText || 'Reception Photo',
        altText: data.altText || data.title,
        isGuestUpload: Boolean(n.tags?.includes('guest-upload')),
        createdAt: n.createdAt ? new Date(n.createdAt).toISOString() : undefined,
      };
    })
    .filter(Boolean) as SlideshowPhoto[];

  const uploadUrl = config.baseUrl ? `${config.baseUrl.replace(/\/$/, '')}/photos` : undefined;

  return (
    <ReceptionSlideshowClient
      initialPhotos={initialPhotos}
      uploadUrl={uploadUrl}
    />
  );
}
