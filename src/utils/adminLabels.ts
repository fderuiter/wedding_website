const SECTION_LABELS: Record<string, string> = {
  AppConfig: 'Site Settings',
  appConfig: 'Site Settings',
  ContentNode: 'Website Content',
  contentNode: 'Website Content',
  WeddingPartyMember: 'Wedding Party',
  weddingPartyMember: 'Wedding Party',
  Attraction: 'Local Attractions',
  attraction: 'Local Attractions',
  RegistryItem: 'Registry Items',
  registryItem: 'Registry Items',
  Contributor: 'Gift Contributions',
  contributor: 'Gift Contributions',
  Media: 'Photos & Media',
  media: 'Photos & Media',
  InvitationCode: 'Guest Invitations',
  invitationCode: 'Guest Invitations',
  SeatingTable: 'Seating Tables',
  seatingTable: 'Seating Tables',
  SubEvent: 'Wedding Events',
  subEvent: 'Wedding Events',
  RsvpResponse: 'RSVP Responses',
  rsvpResponse: 'RSVP Responses',
  SnapshotVersion: 'Saved Snapshots',
  snapshotVersion: 'Saved Snapshots',
  BroadcastMessage: 'Guest Broadcasts',
  broadcastMessage: 'Guest Broadcasts',
  Schedule: 'Schedule',
};

const FIELD_LABELS: Record<string, string> = {
  id: 'Record ID',
  baseUrl: 'Website URL',
  weddingDate: 'Wedding Date',
  partner1Name: 'Partner 1 Name',
  partner2Name: 'Partner 2 Name',
  brideName: 'Partner 1 Name',
  groomName: 'Partner 2 Name',
  venueName: 'Venue Name',
  venueAddress: 'Venue Address',
  venueCity: 'Venue City',
  venueState: 'Venue State',
  venueZip: 'Venue Zip Code',
  latitude: 'Latitude',
  longitude: 'Longitude',
  contactEmail: 'Contact Email',
  photoAlbumUrl: 'External Photo Album URL',
  faviconUrl: 'Favicon Image',
  ogImageUrl: 'Social Sharing Image',
  seoTitle: 'SEO Title',
  seoDescription: 'SEO Description',
  seoKeywords: 'SEO Keywords',
  colorPrimary: 'Primary Color',
  colorSecondary: 'Secondary Color',
  themePreset: 'Theme Preset',
  themeTokens: 'Custom Theme Overrides',
  price: 'Price',
  quantity: 'Quantity',
  amountFunded: 'Amount Funded',
  isCashFund: 'Cash Fund Setting',
  paymentMethod: 'Payment Method',
  paymentHandle: 'Payment Handle',
  imageUrl: 'Image URL',
  vendorUrl: 'Store Link',
  name: 'Name',
  title: 'Title',
  description: 'Description',
  question: 'Question',
  answer: 'Answer',
  category: 'Category',
  categoryTags: 'Category Tags',
  keywords: 'Keywords',
  startTime: 'Start Time',
  endTime: 'End Time',
  locationName: 'Location Name',
  attireRules: 'Attire Guidance',
  url: 'URL',
  altText: 'Alt Text',
  isVisible: 'Gallery Visibility',
  status: 'Approval Status',
  email: 'Email Address',
  amount: 'Contribution Amount',
  capacity: 'Table Capacity',
  role: 'Role',
};

function humanizeIdentifier(raw: string): string {
  if (!raw) return 'General';
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim();
}

/**
 * Map an internal model/entity identifier to a plain, user-facing section name.
 */
export function formatEntitySectionLabel(entityType: string | null | undefined): string {
  if (!entityType) return 'General';
  if (SECTION_LABELS[entityType]) {
    return SECTION_LABELS[entityType];
  }
  return humanizeIdentifier(entityType);
}

/**
 * Translate a dot-separated validation path (e.g. "registryItem.0.price") into plain section and field labels.
 */
export function formatBackupDiagnosticPath(rawPath: string | null | undefined): string {
  if (!rawPath || rawPath === 'root') {
    return 'Backup File';
  }
  if (rawPath === 'JSON Syntax') {
    return 'Backup File Format';
  }
  if (rawPath === 'File Read Error') {
    return 'Backup File';
  }

  const segments = rawPath.split('.').filter(Boolean);
  if (segments.length === 0) {
    return 'Backup File';
  }

  const [first, ...rest] = segments;
  const sectionLabel = formatEntitySectionLabel(first);

  if (rest.length === 0) {
    return sectionLabel;
  }

  let entryLabel = '';
  let fieldSegments = rest;
  if (/^\d+$/.test(rest[0])) {
    entryLabel = ` (Entry ${Number(rest[0]) + 1})`;
    fieldSegments = rest.slice(1);
  }

  const filteredFields = fieldSegments.filter((seg) => seg !== 'data');
  if (filteredFields.length === 0) {
    return `${sectionLabel}${entryLabel}`;
  }

  const fieldLabel = filteredFields
    .map((seg) => (/^\d+$/.test(seg) ? `Item ${Number(seg) + 1}` : (FIELD_LABELS[seg] || humanizeIdentifier(seg))))
    .join(' › ');

  return `${sectionLabel}${entryLabel} — ${fieldLabel}`;
}
