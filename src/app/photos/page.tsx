import { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { AccessibleExternalLink } from '@/components/ui/AccessibleExternalLink';
import { Icon } from '@/components/ui/Icon';
import { contentService } from '@/features/content';
import type { ContentNodeDTO } from '@/features/content';
import { withPageQuery } from '@/lib/query-wrapper';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isGuestRequest } from '@/core/auth/guest.server';
import {
  enforceActiveGuestPageSession,
  getActivePhotoUploadSession,
  getGuestInviteSession,
} from '@/core/auth/guestInviteSession';
import { getSignedPhotoUploadSession } from '@/core/auth/photoUploadToken';

import {
  PhotoCategory,
  PhotoGalleryClient,
  PublicPhotoItem,
} from '@/components/photos/PhotoGalleryClient';

export const metadata: Metadata = {
  title: 'Photos',
  alternates: {
    canonical: '/photos',
  },
};

interface PhotosPageProps {
  searchParams?: Promise<{ tab?: string | string[] }>;
}

function redirectToGuestLogin(): never {
  try {
    redirect('/guest/login?callbackUrl=%2Fphotos%3Ftab%3Dguest');
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'digest' in err &&
      typeof (err as { digest?: unknown }).digest === 'string' &&
      (err as { digest: string }).digest.startsWith('NEXT_REDIRECT;')
    ) {
      (err as { digest: string }).digest = (err as { digest: string }).digest.replace(
        /;30[78];$/,
        ';303;'
      );
    }
    throw err;
  }
}
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
export default async function PhotosPage(props?: PhotosPageProps) {
  await enforceActiveGuestPageSession();
  const isStaticExport =
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export';
  const [config, isAdmin, guestSession, resolvedSearchParams] = await Promise.all([
    getAppConfig(),
    isStaticExport ? Promise.resolve(false) : isAdminRequest(),
    isStaticExport
      ? Promise.resolve(null)
      : getGuestInviteSession().catch(() => null),
    isStaticExport || !props?.searchParams
      ? Promise.resolve(undefined)
      : props.searchParams,
  ]);
  if (!isFeatureEnabled('gallery', config.modules)) {
    notFound();
  }

  let isPhotoScopedVisitor = false;

  if (!isStaticExport) {
    const signedPhoto = await getSignedPhotoUploadSession();
    if (signedPhoto) {
      const hasFullAuth = isAdmin || (await isGuestRequest()) || Boolean(guestSession);
      if (!hasFullAuth) {
        const activePhotoSession = await getActivePhotoUploadSession(
          undefined,
          config.guestPhotoQrTokenVersion
        );
        if (!activePhotoSession) {
          redirectToGuestLogin();
        }
        isPhotoScopedVisitor = true;
      }
    }
  }

  const photoNodes = await withPageQuery(
    () => contentService.getPublicPhotos(),
    [] as ContentNodeDTO[]
  );

  const initialPhotos: PublicPhotoItem[] = photoNodes
    .map((n): PublicPhotoItem | null => {
      const data = n.data as
        | {
          url?: string;
          title?: string;
          altText?: string;
          mediaId?: string;
          caption?: string;
          uploaderName?: string;
        }
        | undefined;
      if (!data?.url) {
        return null;
      }
      const isGuestUpload = Boolean(n.tags?.includes('guest-upload'));
      const caption = data.caption?.trim() || undefined;
      const uploaderName = data.uploaderName?.trim() || undefined;
      const explicitTitle = data.title?.trim() || undefined;
      const explicitAltText = data.altText?.trim() || undefined;
      return {
        id: n.id,
        ...(data.mediaId ? { mediaId: data.mediaId } : {}),
        url: data.url,
        title:
          explicitTitle ||
          caption ||
          explicitAltText ||
          (uploaderName ? `Photo by ${uploaderName}` : undefined),
        ...(explicitAltText ? { altText: explicitAltText } : {}),
        ...(caption ? { caption } : {}),
        ...(uploaderName ? { uploaderName } : {}),
        isGuestUpload,
        category: isGuestUpload ? 'guest' : 'curated',
      };
    })
    .filter((item): item is PublicPhotoItem => item !== null);

  const rawRequestedTab = Array.isArray(resolvedSearchParams?.tab)
    ? resolvedSearchParams?.tab[0]
    : resolvedSearchParams?.tab;
  const requestedTab: PhotoCategory | undefined =
    rawRequestedTab === 'guest' || rawRequestedTab === 'curated'
      ? rawRequestedTab
      : undefined;

  const hasCuratedPhotos = initialPhotos.some((p) => p.category === 'curated');
  const defaultTab: PhotoCategory =
    requestedTab ??
    (isPhotoScopedVisitor
      ? 'guest'
      : hasCuratedPhotos || initialPhotos.length === 0
        ? 'curated'
        : 'guest');
  const defaultUploaderName = guestSession?.guestName?.trim() || undefined;
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
            {...(defaultUploaderName ? { defaultUploaderName } : {})}
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
