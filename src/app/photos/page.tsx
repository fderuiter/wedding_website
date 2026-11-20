import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AccessibleExternalLink } from '@/components/ui/AccessibleExternalLink';
import { Icon } from '@/components/ui/Icon';
import { contentService } from '@/features/content';
import type { ContentNodeDTO } from '@/features/content';
import { withPageQuery } from '@/lib/query-wrapper';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { isAdminRequest } from '@/core/auth/auth.server';

import { PhotoGalleryClient, PhotoItem } from '@/components/photos/PhotoGalleryClient';

export const metadata: Metadata = {
  title: 'Photos',
  alternates: {
    canonical: '/photos',
  },
};

/**
 * @page PhotosPage
 * @description A page that displays a gallery of wedding photos and guest uploads.
 *
 * This component renders a native, tabbed photo gallery client displaying curated
 * couple photos and moderated guest shared pictures with responsive lightbox viewing
 * and administrator archive exports.
 *
 * @returns {Promise<JSX.Element>} The rendered photos page.
 */
export default async function PhotosPage() {
  const [config, isAdmin] = await Promise.all([
    getAppConfig(),
    isAdminRequest(),
  ]);
  if (!isFeatureEnabled('gallery', config.modules)) {
    notFound();
  }

  const photoNodes = await withPageQuery(
    () => contentService.getPublicPhotos(),
    [] as ContentNodeDTO[]
  );

  const initialPhotos: PhotoItem[] = photoNodes
    .map((n): PhotoItem | null => {
      const data = n.data as { url?: string; title?: string; altText?: string } | undefined;
      if (!data?.url) {
        return null;
      }
      const isGuestUpload = Boolean(n.tags?.includes('guest-upload'));
      return {
        id: n.id,
        url: data.url,
        title: data.title || data.altText || undefined,
        isGuestUpload,
        category: isGuestUpload ? 'guest' : 'curated',
      };
    })
    .filter((item): item is PhotoItem => item !== null);

  const hasCuratedPhotos = initialPhotos.some((p) => p.category === 'curated');
  const defaultTab = hasCuratedPhotos || initialPhotos.length === 0 ? 'curated' : 'guest';
  const albumUrl = config.photoAlbumUrl?.trim() || '';

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold text-center mb-8 text-primary dark:text-primary">
        Our Wedding Photos
      </h1>
      <p className="text-center text-lg mb-8">
        {albumUrl
          ? 'Browse photos from our celebration below, visit our shared photo album, or upload your own favorite moments.'
          : 'Browse photos from our celebration below or upload your own favorite moments to share with us.'}
      </p>

      <ErrorBoundary title="Gallery Error" message="Could not render photo gallery.">
        <div className="mb-10">
          <PhotoGalleryClient
            initialPhotos={initialPhotos}
            defaultTab={defaultTab}
            isAdmin={isAdmin}
          />
        </div>
      </ErrorBoundary>

      {albumUrl && (
        <div className="flex justify-center mt-12">
          <AccessibleExternalLink
            href={albumUrl}
            className="group inline-flex items-center gap-2 rounded-full bg-primary bg-gradient-to-r from-primary to-secondary px-8 py-3 text-white shadow-lg transition hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            View Full Album
            <Icon name="Camera" className="w-5 h-5" />
          </AccessibleExternalLink>
        </div>
      )}
    </div>
  );
}
