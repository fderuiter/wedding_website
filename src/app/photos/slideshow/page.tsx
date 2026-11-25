import { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { contentService } from '@/features/content';
import type { ContentNodeDTO } from '@/features/content';
import { withPageQuery } from '@/lib/query-wrapper';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { enforceActiveGuestPageSession } from '@/core/auth/guestInviteSession';
import {
  PHOTO_QR_QUERY_PARAM,
  signPhotoQrLinkToken,
} from '@/core/auth/photoUploadToken';
import { resolveTenantClaimsForSigning } from '@/core/auth/tenantClaims.node';
import {
  isHostAllowed,
  resolveRequestHost,
  resolveRequestProtocol,
} from '@/utils/hostValidation';
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
  const isStaticExport =
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export';
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

  let uploadUrl: string | undefined;
  let activeUploadUrl: string | undefined;
  let configuredUploadUrl: string | null = null;
  if (isStaticExport) {
    configuredUploadUrl = config.baseUrl
      ? `${config.baseUrl.replace(/\/$/, '')}/photos?tab=guest`
      : null;
    uploadUrl = configuredUploadUrl ?? undefined;
  } else {
    let headerHost: string | undefined;
    let headerProto: 'http' | 'https' | undefined;
    try {
      const headerStore = await headers();
      if (headerStore && typeof headerStore.get === 'function') {
        headerHost = resolveRequestHost(headerStore) ?? undefined;
        headerProto =
          resolveRequestProtocol(
            headerStore,
            process.env.NODE_ENV === 'production' ? 'https' : 'http'
          ) ?? undefined;
      }
    } catch {
      // Request headers may be unavailable in isolated unit test renders
    }

    const cleanConfigured = config.baseUrl?.trim().replace(/\/+$/, '') || '';
    let activeOrigin = '';
    if (headerHost && isHostAllowed(headerHost)) {
      const protocol =
        headerProto === 'https' || headerProto === 'http'
          ? headerProto
          : process.env.NODE_ENV === 'production'
            ? 'https'
            : 'http';
      activeOrigin = `${protocol}://${headerHost}`;
    }

    const fallbackOrigin = cleanConfigured || activeOrigin;

    try {
      const tenantClaims = await resolveTenantClaimsForSigning(undefined, config);
      const token = await signPhotoQrLinkToken({
        v: config.guestPhotoQrTokenVersion,
        ...tenantClaims,
      });
      const query = `${PHOTO_QR_QUERY_PARAM}=${encodeURIComponent(token)}`;
      configuredUploadUrl = cleanConfigured ? `${cleanConfigured}/photos?${query}` : null;
      activeUploadUrl = activeOrigin ? `${activeOrigin}/photos?${query}` : `/photos?${query}`;
      uploadUrl = configuredUploadUrl ?? activeUploadUrl;
    } catch {
      configuredUploadUrl = cleanConfigured ? `${cleanConfigured}/photos?tab=guest` : null;
      activeUploadUrl = activeOrigin ? `${activeOrigin}/photos?tab=guest` : '/photos?tab=guest';
      uploadUrl = fallbackOrigin ? `${fallbackOrigin}/photos?tab=guest` : '/photos?tab=guest';
    }
  }

  return (
    <ReceptionSlideshowClient
      initialPhotos={initialPhotos}
      uploadUrl={uploadUrl}
      activeUploadUrl={activeUploadUrl}
      configuredUploadUrl={configuredUploadUrl}
    />
  );
}
