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

  const photoNodes = await withPageQuery(
    () => contentService.getPublicPhotos(),
    [] as ContentNodeDTO[]
  );

  const initialPhotos: SlideshowPhoto[] = photoNodes
    .map((n): SlideshowPhoto | null => {
      const data = n.data as
        | {
          url?: string;
          title?: string;
          altText?: string;
          caption?: string;
          uploaderName?: string;
        }
        | undefined;
      if (!data?.url) return null;
      const caption = data.caption?.trim() || undefined;
      const uploaderName = data.uploaderName?.trim() || undefined;
      const explicitTitle = data.title?.trim() || undefined;
      const explicitAltText = data.altText?.trim() || undefined;
      return {
        id: n.id,
        url: data.url,
        title:
          explicitTitle ||
          caption ||
          explicitAltText ||
          (uploaderName ? `Photo by ${uploaderName}` : 'Reception Photo'),
        altText: explicitAltText || caption || explicitTitle,
        ...(caption ? { caption } : {}),
        ...(uploaderName ? { uploaderName } : {}),
        isGuestUpload: Boolean(n.tags?.includes('guest-upload')),
        createdAt: n.createdAt ? new Date(n.createdAt).toISOString() : undefined,
        ...(n.updatedAt ? { updatedAt: new Date(n.updatedAt).toISOString() } : {}),
      };
    })
    .filter((item): item is SlideshowPhoto => item !== null);

  const uploadUrl = config.baseUrl
    ? `${config.baseUrl.replace(/\/$/, '')}/photos?tab=guest`
    : undefined;

  return (
    <ReceptionSlideshowClient
      initialPhotos={initialPhotos}
      uploadUrl={uploadUrl}
    />
  );
}
