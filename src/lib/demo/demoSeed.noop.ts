import type { RegistryShippingAddress } from '@/features/registry';
import type { ArchetypeId } from '@/lib/sampleData/archetypes';
import type { ArchetypeDataset } from './demoSeed';

export const DEMO_SHIPPING_ADDRESS: RegistryShippingAddress = {
  recipientName: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  zip: '',
  country: '',
  phone: '',
  deliveryNotes: '',
};

export function createSampleItemSvgDataUrl(
  _title: string,
  _category: string
): string {
  return '';
}

export function buildArchetypeDataset(
  _archetypeId: ArchetypeId
): ArchetypeDataset {
  return {
    registryItems: [],
    offlineContributors: [],
    guests: [],
    seatingTables: [],
    weddingParty: [],
    attractions: [],
    faqs: [],
    logisticsNodes: [],
    scheduleNodes: [],
    customNodes: [],
    photos: [],
    media: [],
    subEvents: [],
    subEventAccess: [],
    subEventRsvps: [],
    features: [],
    modules: {
      registry: false,
      groupGifting: false,
      weather: false,
      weddingParty: false,
      attractions: false,
      gallery: false,
      countdown: false,
      addToCalendar: false,
      interactive3D: false,
    },
    broadcastMessages: [],
    snapshotVersions: [],
    siteConfig: {
      partner1Name: '',
      partner2Name: '',
      weddingDate: '',
      baseUrl: '',
      venueName: '',
      venueAddress: '',
      venueCity: '',
      venueState: '',
      venueZip: '',
      latitude: 0,
      longitude: 0,
      storyText: '',
      venueDescription: '',
      travelAdvice: '',
      heroTitle: '',
      heroSubtitle: '',
      seoTitle: '',
      seoDescription: '',
      contactEmail: '',
      faviconUrl: '',
      ogImageUrl: '',
      heroImageUrl: '',
      heroImageAlt: '',
      colorPrimary: '',
      colorSecondary: '',
      themePreset: 'classic',
      timezone: 'UTC',
      autoApproveGuestPhotos: false,
      guestPhotoQrTokenVersion: 1,
      rsvpOpen: false,
      rsvpDeadlineDate: null,
      rsvpGracePeriodHours: 0,
      rsvpClosedMessage: '',
      showCountdown: false,
      showAddToCalendar: false,
      shippingRecipientName: '',
      shippingAddressLine1: '',
      shippingAddressLine2: '',
      shippingCity: '',
      shippingState: '',
      shippingZip: '',
      shippingCountry: '',
      shippingPhone: '',
      shippingDeliveryNotes: '',
      defaultPaymentHandleType: '',
      defaultPaymentHandle: '',
      registryGiftAccessTier: 'PASSCODE_GUESTS',
      shippingDisclosureTier: 'PASSCODE_GUESTS',
      maxPendingReservations: 5,
    },
  };
}
