'use client';

import React, { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  compareFaqNodesByOrder,
  isFaqNodeVisible,
  type ContentNodeDTO,
} from '@/features/content';
import { useAdminContent } from '@/hooks/admin/useAdminContent';
// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';

import AdminPreviewLayout from '@/components/admin/AdminPreviewLayout';
import { AdminViewState } from '@/components/admin/AdminViewState';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Textarea, Select, FormMessage } from '@/components/ui/forms';
import { useFocusSuccessor } from '@/hooks/useFocusSuccessor';
import { useToast } from '@/components/ui/ToastProvider';
import { useTheme } from '@/components/ThemeProvider';
import {
  toDateTimeLocalValue,
  fromDateTimeLocalValue,
  isValidIanaTimeZone,
} from '@/utils/dateTime';

const STANDARD_CONTENT_TYPES = ['FAQ', 'Logistics', 'Schedule', 'Photo'] as const;
type StandardContentType = (typeof STANDARD_CONTENT_TYPES)[number];
type ContentFilterTab = 'ALL' | StandardContentType | 'CUSTOM';

interface StarterFaqTemplate {
  id: string;
  label: string;
  question: string;
  answer: string;
  category: string;
  keywords: string;
}

const STARTER_FAQ_TEMPLATES: readonly StarterFaqTemplate[] = [
  {
    id: 'attire',
    label: 'Dress Code & Attire',
    question: 'What is the dress code for the wedding?',
    answer:
      'Cocktail or formal attire is kindly requested. Check the homepage schedule for any outdoor or weather-related footwear tips.',
    category: 'Attire',
    keywords: 'dress code, attire, formal, cocktail',
  },
  {
    id: 'rsvp-deadline',
    label: 'RSVP Deadline & Dietary Notes',
    question: 'When is the RSVP deadline and how do I share food allergies?',
    answer:
      'Please submit your attendance and dietary notes in the [Guest Portal](/guest) by the RSVP deadline listed on your invitation.',
    category: 'RSVP',
    keywords: 'rsvp, deadline, allergy, dietary, meal',
  },
  {
    id: 'plus-ones-kids',
    label: 'Plus-Ones & Children',
    question: 'Can I bring a plus-one or children?',
    answer:
      'Due to venue capacity, invitations include all named household guests and any allocated plus-ones shown in your [Guest Portal](/guest) profile.',
    category: 'Guests',
    keywords: 'plus one, children, kids, guests',
  },
  {
    id: 'accommodations',
    label: 'Hotel Blocks & Where to Stay',
    question: 'Where should out-of-town guests book accommodations?',
    answer:
      'We reserved discounted group rates at nearby hotels—see our [Local Guide](/things-to-do) and #accommodations section for booking links and cutoff dates.',
    category: 'Travel',
    keywords: 'hotel, room block, accommodations, lodging',
  },
  {
    id: 'parking-shuttle',
    label: 'Parking & Venue Transportation',
    question: 'Is there parking or shuttle service at the venue?',
    answer:
      'On-site parking is available at the venue entrance, and shuttle pickup times from partner hotels are posted in #accommodations.',
    category: 'Venue',
    keywords: 'parking, shuttle, transportation, directions',
  },
  {
    id: 'registry',
    label: 'Wedding Registry & Gifts',
    question: 'Where can we find your wedding registry?',
    answer:
      'Your presence is the greatest gift! If you would like to browse our wish list or group funds, visit our [Wedding Registry](/registry).',
    category: 'Registry',
    keywords: 'registry, gifts, honeymoon fund',
  },
];

interface ContentFormState {
  // FAQ
  question: string;
  answer: string;
  faqCategory: string;
  faqKeywords: string;
  // Logistics & Schedule shared / specific
  title: string;
  description: string;
  category: string;
  categoryTags: string;
  locationName: string;
  attireRules: string;
  startTime: string;
  endTime: string;
  ceremonyTitle: string;
  ceremonyTime: string;
  receptionTitle: string;
  receptionTime: string;
  receptionDetails: string;
  receptionAttire: string;
  // Photo
  photoUrl: string;
  photoTitle: string;
  photoCaption: string;
  photoUploaderName: string;
  photoDescription: string;
  altText: string;
  isVisible: boolean;
  photoStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
}

const EMPTY_FORM_STATE: ContentFormState = {
  question: '',
  answer: '',
  faqCategory: '',
  faqKeywords: '',
  title: '',
  description: '',
  category: '',
  categoryTags: '',
  locationName: '',
  attireRules: '',
  startTime: '',
  endTime: '',
  ceremonyTitle: '',
  ceremonyTime: '',
  receptionTitle: '',
  receptionTime: '',
  receptionDetails: '',
  receptionAttire: '',
  photoUrl: '',
  photoTitle: '',
  photoCaption: '',
  photoUploaderName: '',
  photoDescription: '',
  altText: '',
  isVisible: true,
  photoStatus: 'APPROVED',
};

const KNOWN_DATA_KEYS: Record<StandardContentType, string[]> = {
  FAQ: ['question', 'answer', 'category', 'categoryTags', 'keywords', 'isVisible'],
  Logistics: [
    'title',
    'description',
    'category',
    'categoryTags',
    'locationName',
    'location',
    'attireRules',
    'attire',
    'startTime',
    'endTime',
    'ceremonyTitle',
    'ceremonyTime',
    'receptionTitle',
    'receptionTime',
    'receptionDetails',
    'receptionAttire',
  ],
  Schedule: [
    'title',
    'description',
    'category',
    'categoryTags',
    'locationName',
    'location',
    'attireRules',
    'attire',
    'startTime',
    'endTime',
  ],
  Photo: [
    'url',
    'imageUrl',
    'title',
    'caption',
    'uploaderName',
    'description',
    'altText',
    'isVisible',
    'status',
  ],
};

function isStandardContentType(type: string | undefined): type is StandardContentType {
  return Boolean(type && (STANDARD_CONTENT_TYPES as readonly string[]).includes(type));
}

function parseCommaList(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatListForInput(val: unknown): string {
  if (Array.isArray(val)) {
    return val
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object' && 'name' in item && typeof (item as { name?: unknown }).name === 'string') {
          return ((item as { name: string }).name).trim();
        }
        return '';
      })
      .filter(Boolean)
      .join(', ');
  }
  if (typeof val === 'string') {
    return val;
  }
  return '';
}

function toDatetimeLocalValue(isoVal: unknown, timeZone?: string): string {
  if (typeof isoVal !== 'string' || !isoVal.trim()) return '';
  return toDateTimeLocalValue(isoVal, timeZone);
}

function toIsoTimestamp(localVal: string, timeZone?: string): string | undefined {
  return fromDateTimeLocalValue(localVal, timeZone) ?? undefined;
}

function formatReadableTimestamp(isoVal: unknown, timeZone?: string): string {
  if (typeof isoVal !== 'string' || !isoVal.trim()) return '';
  const parsed = new Date(isoVal);
  if (isNaN(parsed.getTime())) return isoVal;
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone && isValidIanaTimeZone(timeZone) ? { timeZone } : {}),
  });
}

function buildFormStateFromNode(
  node: ContentNodeDTO,
  timeZone?: string
): {
  form: ContentFormState;
  extraData: Record<string, unknown>;
} {
  const rawData =
    node.data && typeof node.data === 'object' && !Array.isArray(node.data)
      ? (node.data as Record<string, unknown>)
      : {};

  const nodeType = node.type;
  const knownKeys = isStandardContentType(nodeType) ? KNOWN_DATA_KEYS[nodeType] : [];
  const extraData: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rawData)) {
    if (!knownKeys.includes(key)) {
      extraData[key] = value;
    }
  }

  const rawVisible = rawData.isVisible;
  const parsedVisible =
    typeof rawVisible === 'boolean'
      ? rawVisible
      : typeof rawVisible === 'string'
        ? rawVisible.toLowerCase() !== 'false'
        : true;

  const rawStatus = rawData.status;
  const parsedStatus: 'PENDING' | 'APPROVED' | 'REJECTED' =
    rawStatus === 'PENDING' || rawStatus === 'APPROVED' || rawStatus === 'REJECTED'
      ? rawStatus
      : 'APPROVED';

  const form: ContentFormState = {
    question: typeof rawData.question === 'string' ? rawData.question : '',
    answer: typeof rawData.answer === 'string' ? rawData.answer : '',
    faqCategory: typeof rawData.category === 'string' ? rawData.category : '',
    faqKeywords: formatListForInput(rawData.keywords),
    title: typeof rawData.title === 'string' ? rawData.title : '',
    description: typeof rawData.description === 'string' ? rawData.description : '',
    category: typeof rawData.category === 'string' ? rawData.category : '',
    categoryTags: formatListForInput(rawData.categoryTags),
    locationName:
      typeof rawData.locationName === 'string'
        ? rawData.locationName
        : typeof rawData.location === 'string'
          ? rawData.location
          : '',
    attireRules:
      typeof rawData.attireRules === 'string'
        ? rawData.attireRules
        : typeof rawData.attire === 'string'
          ? rawData.attire
          : '',
    startTime: toDatetimeLocalValue(rawData.startTime, timeZone),
    endTime: toDatetimeLocalValue(rawData.endTime, timeZone),
    ceremonyTitle: typeof rawData.ceremonyTitle === 'string' ? rawData.ceremonyTitle : '',
    ceremonyTime: typeof rawData.ceremonyTime === 'string' ? rawData.ceremonyTime : '',
    receptionTitle: typeof rawData.receptionTitle === 'string' ? rawData.receptionTitle : '',
    receptionTime: typeof rawData.receptionTime === 'string' ? rawData.receptionTime : '',
    receptionDetails: typeof rawData.receptionDetails === 'string' ? rawData.receptionDetails : '',
    receptionAttire: typeof rawData.receptionAttire === 'string' ? rawData.receptionAttire : '',
    photoUrl:
      typeof rawData.url === 'string'
        ? rawData.url
        : typeof rawData.imageUrl === 'string'
          ? rawData.imageUrl
          : '',
    photoTitle: typeof rawData.title === 'string' ? rawData.title : '',
    photoCaption: typeof rawData.caption === 'string' ? rawData.caption : '',
    photoUploaderName: typeof rawData.uploaderName === 'string' ? rawData.uploaderName : '',
    photoDescription: typeof rawData.description === 'string' ? rawData.description : '',
    altText: typeof rawData.altText === 'string' ? rawData.altText : '',
    isVisible: parsedVisible,
    photoStatus: parsedStatus,
  };

  return { form, extraData };
}

function buildTypedNodeData(
  nodeType: string,
  form: ContentFormState,
  extraData: Record<string, unknown>,
  isNewNode: boolean,
  timeZone?: string
): Record<string, unknown> {
  if (nodeType === 'FAQ') {
    const keywords = parseCommaList(form.faqKeywords);
    const category = form.faqCategory.trim();
    const existingTags = Array.isArray(extraData.categoryTags) ? extraData.categoryTags : undefined;
    const { isSample: _removedSampleFlag, ...preservedFaqExtra } = extraData;
    return {
      ...preservedFaqExtra,
      question: form.question.trim(),
      answer: form.answer.trim(),
      ...(category ? { category } : {}),
      ...(existingTags ? { categoryTags: existingTags } : category ? { categoryTags: [category] } : {}),
      keywords,
      isVisible: Boolean(form.isVisible),
    };
  }

  if (nodeType === 'Logistics') {
    const startTime = toIsoTimestamp(form.startTime, timeZone);
    const endTime = toIsoTimestamp(form.endTime, timeZone);
    const categoryTags = parseCommaList(form.categoryTags);
    const data: Record<string, unknown> = {
      ...extraData,
      ...(form.title.trim() ? { title: form.title.trim() } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.category.trim() ? { category: form.category.trim() } : {}),
      categoryTags,
      ...(form.locationName.trim() ? { locationName: form.locationName.trim() } : {}),
      ...(form.attireRules.trim() ? { attireRules: form.attireRules.trim() } : {}),
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
      ...(form.ceremonyTitle.trim() ? { ceremonyTitle: form.ceremonyTitle.trim() } : {}),
      ...(form.ceremonyTime.trim() ? { ceremonyTime: form.ceremonyTime.trim() } : {}),
      ...(form.receptionTitle.trim() ? { receptionTitle: form.receptionTitle.trim() } : {}),
      ...(form.receptionTime.trim() ? { receptionTime: form.receptionTime.trim() } : {}),
      ...(form.receptionDetails.trim() ? { receptionDetails: form.receptionDetails.trim() } : {}),
      ...(form.receptionAttire.trim() ? { receptionAttire: form.receptionAttire.trim() } : {}),
    };
    return data;
  }

  if (nodeType === 'Schedule') {
    const startTime = toIsoTimestamp(form.startTime, timeZone);
    const endTime = toIsoTimestamp(form.endTime, timeZone);
    const categoryTags = parseCommaList(form.categoryTags);
    return {
      ...extraData,
      title: form.title.trim(),
      ...(startTime ? { startTime } : {}),
      ...(endTime ? { endTime } : {}),
      categoryTags,
      ...(form.category.trim() ? { category: form.category.trim() } : {}),
      ...(form.locationName.trim() ? { locationName: form.locationName.trim() } : {}),
      ...(form.attireRules.trim() ? { attireRules: form.attireRules.trim() } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
    };
  }

  if (nodeType === 'Photo') {
    const trimmedUrl = form.photoUrl.trim();
    const trimmedTitle = form.photoTitle.trim();
    const trimmedCaption = form.photoCaption.trim();
    const trimmedUploaderName = form.photoUploaderName.trim();
    const resolvedStatus =
      isNewNode || form.isVisible ? 'APPROVED' : form.photoStatus || 'APPROVED';
    const {
      caption: _staleCaption,
      uploaderName: _staleUploader,
      imageUrl: _staleImageUrl,
      ...preservedPhotoExtra
    } = extraData;
    const fallbackAlt =
      trimmedTitle ||
      trimmedCaption ||
      (trimmedUploaderName ? `Photo by ${trimmedUploaderName}` : '');
    return {
      ...preservedPhotoExtra,
      ...(trimmedUrl ? { url: trimmedUrl } : {}),
      title: trimmedTitle,
      description: form.photoDescription.trim(),
      altText: form.altText.trim() || fallbackAlt,
      ...(trimmedCaption ? { caption: trimmedCaption } : {}),
      ...(trimmedUploaderName ? { uploaderName: trimmedUploaderName } : {}),
      isVisible: Boolean(form.isVisible),
      status: resolvedStatus,
    };
  }

  return {
    ...extraData,
    ...(form.title.trim() ? { title: form.title.trim() } : {}),
    ...(form.description.trim() ? { description: form.description.trim() } : {}),
  };
}

function summarizeNodePreview(
  node: ContentNodeDTO,
  timeZone?: string
): {
  heading: string;
  details: string;
  badge?: { label: string; tone: 'success' | 'warning' | 'neutral' };
} {
  const d =
    node.data && typeof node.data === 'object' && !Array.isArray(node.data)
      ? (node.data as Record<string, unknown>)
      : {};

  if (node.type === 'FAQ') {
    const question = typeof d.question === 'string' && d.question.trim() ? d.question.trim() : 'Untitled question';
    const answer = typeof d.answer === 'string' && d.answer.trim() ? d.answer.trim() : 'No answer provided yet.';
    const category = typeof d.category === 'string' && d.category.trim() ? d.category.trim() : '';
    const visible = isFaqNodeVisible(node);
    const isSample = d.isSample === true || d.isSample === 'true';
    const badge = !visible
      ? { label: 'Hidden from Public', tone: 'warning' as const }
      : isSample
        ? { label: category ? `${category} • Sample` : 'Sample FAQ', tone: 'neutral' as const }
        : category
          ? { label: category, tone: 'neutral' as const }
          : undefined;
    return {
      heading: question,
      details: answer.length > 140 ? `${answer.slice(0, 140)}…` : answer,
      badge,
    };
  }

  if (node.type === 'Schedule') {
    const title = typeof d.title === 'string' && d.title.trim() ? d.title.trim() : 'Untitled schedule item';
    const startLabel = formatReadableTimestamp(d.startTime, timeZone);
    const endLabel = formatReadableTimestamp(d.endTime, timeZone);
    const location =
      typeof d.locationName === 'string' && d.locationName.trim()
        ? d.locationName.trim()
        : typeof d.location === 'string' && d.location.trim()
          ? d.location.trim()
          : '';
    const desc = typeof d.description === 'string' && d.description.trim() ? d.description.trim() : '';
    const timeRange = startLabel && endLabel ? `${startLabel} – ${endLabel}` : startLabel || endLabel;
    const summaryParts = [timeRange, location, desc].filter(Boolean);
    const tagsList = formatListForInput(d.categoryTags);
    return {
      heading: title,
      details: summaryParts.join(' • ') || 'No schedule time or location set yet.',
      badge: tagsList ? { label: tagsList, tone: 'neutral' } : undefined,
    };
  }

  if (node.type === 'Logistics') {
    const title =
      (typeof d.title === 'string' && d.title.trim()) ||
      (typeof d.ceremonyTitle === 'string' && d.ceremonyTitle.trim()) ||
      (typeof d.receptionTitle === 'string' && d.receptionTitle.trim()) ||
      'Logistics & Venue Details';
    const parts = [
      typeof d.description === 'string' ? d.description.trim() : '',
      typeof d.ceremonyTime === 'string' && d.ceremonyTime.trim() ? `Ceremony: ${d.ceremonyTime.trim()}` : '',
      typeof d.receptionTime === 'string' && d.receptionTime.trim() ? `Reception: ${d.receptionTime.trim()}` : '',
      typeof d.locationName === 'string' ? d.locationName.trim() : '',
      typeof d.receptionDetails === 'string' ? d.receptionDetails.trim() : '',
    ].filter(Boolean);
    const category = typeof d.category === 'string' && d.category.trim() ? d.category.trim() : '';
    return {
      heading: title,
      details: parts.join(' • ') || 'No logistics details entered yet.',
      badge: category ? { label: category, tone: 'neutral' } : undefined,
    };
  }

  if (node.type === 'Photo') {
    const caption = typeof d.caption === 'string' && d.caption.trim() ? d.caption.trim() : '';
    const uploaderName =
      typeof d.uploaderName === 'string' && d.uploaderName.trim() ? d.uploaderName.trim() : '';
    const title =
      (typeof d.title === 'string' && d.title.trim()) ||
      caption ||
      (typeof d.altText === 'string' && d.altText.trim()) ||
      (uploaderName ? `Photo by ${uploaderName}` : '') ||
      'Gallery Photo';
    const desc = [
      caption && caption !== title ? caption : '',
      uploaderName ? `Uploaded by ${uploaderName}` : '',
      typeof d.description === 'string' && d.description.trim() ? d.description.trim() : '',
    ]
      .filter(Boolean)
      .join(' • ');
    const url = typeof d.url === 'string' && d.url.trim() ? d.url.trim() : '';
    const status = typeof d.status === 'string' ? d.status : 'APPROVED';
    const visible = d.isVisible !== false && status === 'APPROVED';
    const badgeLabel =
      status === 'PENDING'
        ? 'Pending Moderation'
        : visible
          ? 'Visible in Gallery'
          : 'Hidden from Gallery';
    return {
      heading: title,
      details: [desc, url].filter(Boolean).join(' • ') || 'No photo URL provided yet.',
      badge: {
        label: badgeLabel,
        tone: visible ? 'success' : 'warning',
      },
    };
  }

  const entries = Object.entries(d)
    .filter(([, val]) => val !== null && val !== undefined && String(val).trim() !== '')
    .slice(0, 3)
    .map(([k, val]) => `${k}: ${Array.isArray(val) ? val.join(', ') : String(val)}`);

  return {
    heading: (typeof d.title === 'string' && d.title.trim()) || node.type || 'Custom Content',
    details: entries.join(' • ') || 'No details entered yet.',
  };
}

interface ContentDashboardContentProps {
  nodes: ContentNodeDTO[];
  fetchAll: () => unknown;
  create: (_payload: Partial<ContentNodeDTO>) => Promise<ContentNodeDTO>;
  update: (_id: string, _payload: Partial<ContentNodeDTO>) => Promise<ContentNodeDTO>;
  remove: (_id: string) => Promise<unknown>;
  removeBatch?: (_ids: string[]) => Promise<unknown>;
  reorder?: (_orderedIds: string[]) => Promise<unknown>;
}

function ContentDashboardContent({
  nodes,
  fetchAll,
  create,
  update,
  remove,
  removeBatch,
  reorder,
}: ContentDashboardContentProps) {
  const router = useRouter();
  const { containerRef, captureFocusTarget } = useFocusSuccessor<HTMLDivElement>();
  const { confirm, addToast } = useToast();
  const { timezone } = useTheme();
  const effectiveTimezone = timezone || undefined;

  const [activeFilter, setActiveFilter] = useState<ContentFilterTab>('ALL');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedStarterId, setSelectedStarterId] = useState('');
  const [displayOrderOverrides, setDisplayOrderOverrides] = useState<Record<string, number>>({});
  const [visibilityOverrides, setVisibilityOverrides] = useState<Record<string, boolean>>({});
  const filterTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const [isEditing, setIsEditing] = useState(false);
  const [currentNode, setCurrentNode] = useState<Partial<ContentNodeDTO>>({});
  const [formState, setFormState] = useState<ContentFormState>(EMPTY_FORM_STATE);
  const [extraData, setExtraData] = useState<Record<string, unknown>>({});
  const [tagsInput, setTagsInput] = useState('Homepage');
  const [formError, setFormError] = useState('');
  const [scrapingUrl, setScrapingUrl] = useState(false);

  const selectedType = currentNode.type || 'FAQ';
  const isCustomType = !isStandardContentType(selectedType);

  const effectiveNodes = useMemo(() => {
    const mapped = nodes.map((node) => {
      const hasOrderOverride = Object.prototype.hasOwnProperty.call(displayOrderOverrides, node.id);
      const hasVisibilityOverride = Object.prototype.hasOwnProperty.call(visibilityOverrides, node.id);
      if (!hasOrderOverride && !hasVisibilityOverride) return node;
      const rawData =
        node.data && typeof node.data === 'object' && !Array.isArray(node.data)
          ? (node.data as Record<string, unknown>)
          : {};
      return {
        ...node,
        data: {
          ...rawData,
          ...(hasOrderOverride ? { displayOrder: displayOrderOverrides[node.id] } : {}),
          ...(hasVisibilityOverride ? { isVisible: visibilityOverrides[node.id] } : {}),
        },
      } as ContentNodeDTO;
    });

    const sortedFaqs = mapped
      .filter((n) => n.type === 'FAQ')
      .sort(compareFaqNodesByOrder);
    let faqCursor = 0;
    return mapped.map((n) => (n.type === 'FAQ' ? sortedFaqs[faqCursor++] : n));
  }, [nodes, displayOrderOverrides, visibilityOverrides]);

  const orderedFaqNodes = useMemo(
    () => effectiveNodes.filter((n) => n.type === 'FAQ'),
    [effectiveNodes]
  );

  const hasCustomNodes = useMemo(
    () => effectiveNodes.some((n) => !isStandardContentType(n.type)),
    [effectiveNodes]
  );

  const filterTabs = useMemo(() => {
    const base: { id: ContentFilterTab; label: string; count: number }[] = [
      { id: 'ALL', label: 'All', count: effectiveNodes.length },
      {
        id: 'FAQ',
        label: 'FAQs',
        count: effectiveNodes.filter((n) => n.type === 'FAQ').length,
      },
      {
        id: 'Logistics',
        label: 'Logistics',
        count: effectiveNodes.filter((n) => n.type === 'Logistics').length,
      },
      {
        id: 'Schedule',
        label: 'Schedule',
        count: effectiveNodes.filter((n) => n.type === 'Schedule').length,
      },
      {
        id: 'Photo',
        label: 'Photos',
        count: effectiveNodes.filter((n) => n.type === 'Photo').length,
      },
    ];
    if (hasCustomNodes) {
      base.push({
        id: 'CUSTOM',
        label: 'Custom',
        count: effectiveNodes.filter((n) => !isStandardContentType(n.type)).length,
      });
    }
    return base;
  }, [effectiveNodes, hasCustomNodes]);

  const resolvedActiveFilter = filterTabs.some((t) => t.id === activeFilter) ? activeFilter : 'ALL';

  const filteredNodes = useMemo(() => {
    if (resolvedActiveFilter === 'ALL') return effectiveNodes;
    if (resolvedActiveFilter === 'CUSTOM') {
      return effectiveNodes.filter((n) => !isStandardContentType(n.type));
    }
    return effectiveNodes.filter((n) => n.type === resolvedActiveFilter);
  }, [effectiveNodes, resolvedActiveFilter]);

  const selectableFilteredIds = useMemo(
    () => filteredNodes.filter((n) => !n.id.startsWith('temp-')).map((n) => n.id),
    [filteredNodes]
  );

  const existingIdSet = useMemo(() => new Set(effectiveNodes.map((n) => n.id)), [effectiveNodes]);
  const activeSelectedIds = useMemo(
    () => selectedIds.filter((id) => existingIdSet.has(id)),
    [selectedIds, existingIdSet]
  );
  const allFilteredSelected =
    selectableFilteredIds.length > 0 &&
    selectableFilteredIds.every((id) => activeSelectedIds.includes(id));

  const defaultTagsForType = (type: string): string => {
    if (type === 'Schedule') return 'Schedule';
    if (type === 'Photo') return 'Gallery';
    if (type === 'FAQ') return 'Homepage, FAQ';
    return 'Homepage';
  };

  const handleOpenCreate = () => {
    const initialType: StandardContentType =
      resolvedActiveFilter !== 'ALL' && resolvedActiveFilter !== 'CUSTOM'
        ? resolvedActiveFilter
        : 'FAQ';
    const initialTags =
      initialType === 'FAQ' ? 'Homepage' : defaultTagsForType(initialType);
    setCurrentNode({ type: initialType, tags: parseCommaList(initialTags) });
    setFormState({ ...EMPTY_FORM_STATE, isVisible: true, photoStatus: 'APPROVED' });
    setExtraData({});
    setSelectedStarterId('');
    setTagsInput(initialTags);
    setFormError('');
    setIsEditing(true);
  };

  const handleOpenEdit = (node: ContentNodeDTO) => {
    const { form, extraData: preserved } = buildFormStateFromNode(node, effectiveTimezone);
    setCurrentNode(node);
    setFormState(form);
    setExtraData(preserved);
    setSelectedStarterId('');
    setTagsInput(Array.isArray(node.tags) ? node.tags.join(', ') : '');
    setFormError('');
    setIsEditing(true);
  };

  const handleApplyStarterTemplate = (templateId: string) => {
    setSelectedStarterId(templateId);
    const template = STARTER_FAQ_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    setFormState((prev) => ({
      ...prev,
      question: template.question,
      answer: template.answer,
      faqCategory: template.category,
      faqKeywords: template.keywords,
      isVisible: true,
    }));
  };

  const handleTypeSelectChange = (nextVal: string) => {
    setFormError('');
    if (nextVal === '__custom__') {
      setCurrentNode((prev) => ({ ...prev, type: isCustomType ? prev.type : 'Custom' }));
      return;
    }
    setCurrentNode((prev) => {
      const shouldUpdateDefaultTags =
        !prev.id &&
        (tagsInput === defaultTagsForType(prev.type || 'FAQ') || !tagsInput.trim());
      if (shouldUpdateDefaultTags) {
        const nextDefault = defaultTagsForType(nextVal);
        setTagsInput(nextDefault);
        return { ...prev, type: nextVal, tags: [nextDefault] };
      }
      return { ...prev, type: nextVal };
    });
  };

  const handleSave = async () => {
    setFormError('');
    const activeType = (currentNode.type || 'FAQ').trim();
    if (!activeType) {
      setFormError('Please choose a content type before saving.');
      return;
    }

    if (activeType === 'Schedule' || activeType === 'Logistics') {
      const startIso = toIsoTimestamp(formState.startTime, effectiveTimezone);
      const endIso = toIsoTimestamp(formState.endTime, effectiveTimezone);
      if (formState.startTime.trim() && !startIso) {
        setFormError('Please enter a valid start date and time.');
        return;
      }
      if (formState.endTime.trim() && !endIso) {
        setFormError('Please enter a valid end date and time.');
        return;
      }
      if (startIso && endIso && new Date(endIso).getTime() < new Date(startIso).getTime()) {
        setFormError('End time must be equal to or after the start time.');
        return;
      }
    }

    if (activeType === 'Photo') {
      const trimmedPhotoUrl = formState.photoUrl.trim();
      if (!trimmedPhotoUrl) {
        setFormError('Please enter a photo URL or import details from a page URL.');
        return;
      }
    }

    try {
      const parsedTags = parseCommaList(tagsInput);
      const nextFaqOrder =
        activeType === 'FAQ' && !currentNode.id
          ? orderedFaqNodes.reduce((maxOrder, faq, idx) => {
            const rawOrder = (faq.data as Record<string, unknown> | undefined)?.displayOrder;
            const numeric =
              typeof rawOrder === 'number' && Number.isFinite(rawOrder) ? rawOrder : idx;
            return Math.max(maxOrder, numeric + 1);
          }, 0)
          : undefined;
      const baseExtra =
        nextFaqOrder !== undefined && extraData.displayOrder === undefined
          ? { ...extraData, displayOrder: nextFaqOrder }
          : extraData;
      const payloadData = buildTypedNodeData(
        activeType,
        formState,
        baseExtra,
        !currentNode.id,
        effectiveTimezone
      );
      const payload: Partial<ContentNodeDTO> = {
        type: activeType,
        tags: parsedTags.length > 0 ? parsedTags : parseCommaList(defaultTagsForType(activeType)),
        data: payloadData,
      };

      if (currentNode.id) {
        if (activeType === 'FAQ') {
          setVisibilityOverrides((prev) => ({
            ...prev,
            [currentNode.id!]: Boolean(formState.isVisible),
          }));
        }
        await update(currentNode.id, payload);
      } else {
        await create(payload);
      }
      setIsEditing(false);
    } catch {
      // Error handled by global MutationCache
    }
  };

  const handleToggleFaqVisibility = async (node: ContentNodeDTO) => {
    const rawData =
      node.data && typeof node.data === 'object' && !Array.isArray(node.data)
        ? (node.data as Record<string, unknown>)
        : {};
    const nextVisible = !isFaqNodeVisible(node);
    setVisibilityOverrides((prev) => ({ ...prev, [node.id]: nextVisible }));
    try {
      await update(node.id, {
        type: node.type,
        tags: node.tags,
        data: {
          ...rawData,
          isVisible: nextVisible,
        },
      });
    } catch {
      setVisibilityOverrides((prev) => {
        const next = { ...prev };
        delete next[node.id];
        return next;
      });
    }
  };

  const handleMoveFaq = async (nodeId: string, direction: 'up' | 'down') => {
    const currentIndex = orderedFaqNodes.findIndex((n) => n.id === nodeId);
    if (currentIndex === -1) return;
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= orderedFaqNodes.length) return;

    const reorderedFaqs = [...orderedFaqNodes];
    const [moved] = reorderedFaqs.splice(currentIndex, 1);
    reorderedFaqs.splice(targetIndex, 0, moved);

    const nextOverrides: Record<string, number> = {};
    reorderedFaqs.forEach((faq, index) => {
      nextOverrides[faq.id] = index;
    });
    setDisplayOrderOverrides((prev) => ({ ...prev, ...nextOverrides }));

    const orderedFaqIds = reorderedFaqs.map((faq) => faq.id);
    try {
      if (typeof reorder === 'function') {
        await reorder(orderedFaqIds);
      } else {
        await Promise.all(
          reorderedFaqs.map((faq, index) => {
            const rawData =
              faq.data && typeof faq.data === 'object' && !Array.isArray(faq.data)
                ? (faq.data as Record<string, unknown>)
                : {};
            return update(faq.id, {
              type: faq.type,
              tags: faq.tags,
              data: {
                ...rawData,
                displayOrder: index,
              },
            });
          })
        );
      }
    } catch {
      setDisplayOrderOverrides({});
    }
  };

  const handleToggleSelectId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAllFiltered = () => {
    if (allFilteredSelected) {
      const filteredSet = new Set(selectableFilteredIds);
      setSelectedIds((prev) => prev.filter((id) => !filteredSet.has(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...selectableFilteredIds])));
    }
  };

  const handleBulkDelete = async () => {
    if (activeSelectedIds.length === 0) return;
    const count = activeSelectedIds.length;
    if (
      !(await confirm(
        `Are you sure you want to delete ${count} selected content ${count === 1 ? 'item' : 'items'}?`
      ))
    ) {
      return;
    }
    const idsToDelete = [...activeSelectedIds];
    setSelectedIds([]);
    try {
      if (typeof removeBatch === 'function') {
        await removeBatch(idsToDelete);
      } else {
        await Promise.all(idsToDelete.map((id) => remove(id)));
      }
    } catch {
      // Error handled by global MutationCache
    }
  };

  const handleFilterTabKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    const total = filterTabs.length;
    if (total === 0) return;
    let nextIdx: number | null = null;
    if (e.key === 'ArrowRight') nextIdx = (index + 1) % total;
    else if (e.key === 'ArrowLeft') nextIdx = (index - 1 + total) % total;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = total - 1;
    if (nextIdx !== null) {
      e.preventDefault();
      const targetTab = filterTabs[nextIdx];
      setActiveFilter(targetTab.id);
      filterTabRefs.current[targetTab.id]?.focus();
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent<HTMLButtonElement>) => {
    const card = e.currentTarget.closest('.bg-white');
    if (!(await confirm('Are you sure you want to delete this content item?'))) return;
    if (card) {
      captureFocusTarget(card as HTMLElement);
    }
    try {
      await remove(id);
    } catch {
      // Error handled by global MutationCache
    }
  };

  const handleScrapePhoto = async () => {
    const sourceUrl = formState.photoUrl.trim();
    if (!sourceUrl) {
      addToast('Enter a page or photo URL first to import details.', 'error');
      return;
    }

    setScrapingUrl(true);
    try {
      const scraped = await apiClient.post<{
        name?: string;
        description?: string;
        imageUrl?: string;
        imageAlt?: string;
      }>('/api/registry/scrape', { url: sourceUrl });

      setFormState((prev) => ({
        ...prev,
        photoUrl: scraped.imageUrl?.trim() || prev.photoUrl,
        photoTitle: scraped.name?.trim() || prev.photoTitle,
        photoDescription: scraped.description?.trim() || prev.photoDescription,
        altText: scraped.imageAlt?.trim() || scraped.name?.trim() || prev.altText,
      }));
      addToast('Imported photo details from URL.', 'success');
    } catch (e: unknown) {
      addToast((e instanceof Error ? e.message : String(e)) || 'Could not import details from URL.', 'error');
    } finally {
      setScrapingUrl(false);
    }
  };

  const draftTags = parseCommaList(tagsInput);
  const draftNode = {
    id: currentNode.id || 'draft',
    type: selectedType,
    tags: draftTags.length > 0 ? draftTags : parseCommaList(defaultTagsForType(selectedType)),
    data: buildTypedNodeData(
      selectedType,
      formState,
      extraData,
      !currentNode.id,
      effectiveTimezone
    ),
    createdAt: currentNode.createdAt || new Date(),
    updatedAt: currentNode.updatedAt || new Date(),
  } as ContentNodeDTO;

  const currentNodesWithDraft = effectiveNodes.map((n) =>
    n.id === currentNode.id ? draftNode : n
  );
  if (!currentNode.id && isEditing) {
    currentNodesWithDraft.push(draftNode);
  }

  return (
    <AdminPreviewLayout
      previewUrl={selectedType === 'Photo' ? '/photos' : selectedType === 'Schedule' ? '/#schedule' : '/'}
      draftType="content"
      draftData={currentNodesWithDraft}
      entityId={currentNode.id}
      onRestore={() => {
        setIsEditing(false);
        fetchAll();
      }}
    >
      <div className="py-10 px-4 sm:px-6 max-w-5xl mx-auto">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
          <h1 className="text-3xl font-extrabold text-primary">Content Hub</h1>
          <div className="flex gap-4">
            <Button variant="ghost" onClick={() => router.push('/admin/dashboard')}>
              Back to Dashboard
            </Button>
            <Button onClick={handleOpenCreate}>Add New Content</Button>
          </div>
        </div>

        {isEditing && (
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-lg mb-8 border border-primary dark:border-gray-700">
            <h2 className="text-2xl font-bold mb-4">
              {currentNode.id ? 'Edit Content Item' : 'Add Content Item'}
            </h2>

            <div className="grid gap-4 mb-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <FormGroup>
                  <Label htmlFor="content-type-select">Content Type</Label>
                  <Select
                    id="content-type-select"
                    value={isCustomType ? '__custom__' : selectedType}
                    onChange={(e) => handleTypeSelectChange(e.target.value)}
                  >
                    <option value="FAQ">FAQ (Question & Answer)</option>
                    <option value="Logistics">Logistics & Venue Details</option>
                    <option value="Schedule">Schedule Event</option>
                    <option value="Photo">Gallery Photo</option>
                    {isCustomType && <option value="__custom__">Custom Section</option>}
                  </Select>
                </FormGroup>

                <FormGroup>
                  <Label htmlFor="content-tags-input">Placement Tags (comma separated)</Label>
                  <Input
                    id="content-tags-input"
                    type="text"
                    placeholder="e.g. Homepage, Gallery, Schedule"
                    value={tagsInput}
                    onChange={(e) => {
                      const raw = e.target.value;
                      setTagsInput(raw);
                      setCurrentNode((prev) => ({
                        ...prev,
                        tags: parseCommaList(raw),
                      }));
                    }}
                  />
                </FormGroup>
              </div>

              {isCustomType && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <FormGroup>
                    <Label htmlFor="custom-type-input">Custom Section Name</Label>
                    <Input
                      id="custom-type-input"
                      type="text"
                      value={currentNode.type || ''}
                      onChange={(e) => setCurrentNode({ ...currentNode, type: e.target.value })}
                    />
                  </FormGroup>
                  <FormGroup>
                    <Label htmlFor="custom-title-input">Heading</Label>
                    <Input
                      id="custom-title-input"
                      type="text"
                      value={formState.title}
                      onChange={(e) => setFormState((prev) => ({ ...prev, title: e.target.value }))}
                    />
                  </FormGroup>
                  <FormGroup className="sm:col-span-2">
                    <Label htmlFor="custom-description-input">Details</Label>
                    <Textarea
                      id="custom-description-input"
                      rows={3}
                      value={formState.description}
                      onChange={(e) => setFormState((prev) => ({ ...prev, description: e.target.value }))}
                    />
                  </FormGroup>
                </div>
              )}

              {selectedType === 'FAQ' && (
                <div className="space-y-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600">
                  <FormGroup>
                    <Label htmlFor="faq-starter-template-select">
                      Starter Question Template (Optional)
                    </Label>
                    <Select
                      id="faq-starter-template-select"
                      value={selectedStarterId}
                      onChange={(e) => handleApplyStarterTemplate(e.target.value)}
                    >
                      <option value="">Choose a starter wedding Q&amp;A template...</option>
                      {STARTER_FAQ_TEMPLATES.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.label} — {template.question}
                        </option>
                      ))}
                    </Select>
                  </FormGroup>
                  <FormGroup>
                    <Label htmlFor="faq-question-input">Question</Label>
                    <Input
                      id="faq-question-input"
                      type="text"
                      placeholder="e.g. Is there shuttle transportation to the venue?"
                      value={formState.question}
                      onChange={(e) => setFormState((prev) => ({ ...prev, question: e.target.value }))}
                    />
                  </FormGroup>
                  <FormGroup>
                    <Label htmlFor="faq-answer-input">Answer</Label>
                    <Textarea
                      id="faq-answer-input"
                      rows={4}
                      placeholder="Provide a clear, helpful answer for guests..."
                      value={formState.answer}
                      onChange={(e) => setFormState((prev) => ({ ...prev, answer: e.target.value }))}
                    />
                    <FormMessage>
                      Links are supported automatically: paste web URLs (https://...), emails, phone numbers, internal paths (/guest, /registry, /things-to-do), or [Label](https://...) markdown links.
                    </FormMessage>
                  </FormGroup>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <FormGroup>
                      <Label htmlFor="faq-category-input">FAQ Category</Label>
                      <Input
                        id="faq-category-input"
                        type="text"
                        placeholder="e.g. Travel, Venue, Dress Code"
                        value={formState.faqCategory}
                        onChange={(e) => setFormState((prev) => ({ ...prev, faqCategory: e.target.value }))}
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label htmlFor="faq-keywords-input">FAQ Keywords (comma separated)</Label>
                      <Input
                        id="faq-keywords-input"
                        type="text"
                        placeholder="e.g. shuttle, parking, attire"
                        value={formState.faqKeywords}
                        onChange={(e) => setFormState((prev) => ({ ...prev, faqKeywords: e.target.value }))}
                      />
                    </FormGroup>
                  </div>
                  <div className="flex items-center gap-3 pt-1">
                    <input
                      id="faq-visible-checkbox"
                      type="checkbox"
                      checked={formState.isVisible}
                      onChange={(e) => setFormState((prev) => ({ ...prev, isVisible: e.target.checked }))}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <label
                      htmlFor="faq-visible-checkbox"
                      className="text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer"
                    >
                      Visible on Public Homepage &amp; Guest Help
                    </label>
                  </div>
                </div>
              )}

              {selectedType === 'Logistics' && (
                <div className="space-y-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <FormGroup>
                      <Label htmlFor="logistics-title-input">Section Title</Label>
                      <Input
                        id="logistics-title-input"
                        type="text"
                        placeholder="e.g. Hotel Room Block or Getting There"
                        value={formState.title}
                        onChange={(e) => setFormState((prev) => ({ ...prev, title: e.target.value }))}
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label htmlFor="logistics-location-input">Location Name</Label>
                      <Input
                        id="logistics-location-input"
                        type="text"
                        placeholder="e.g. The Grand Hotel"
                        value={formState.locationName}
                        onChange={(e) => setFormState((prev) => ({ ...prev, locationName: e.target.value }))}
                      />
                    </FormGroup>
                  </div>

                  <FormGroup>
                    <Label htmlFor="logistics-description-input">Description</Label>
                    <Textarea
                      id="logistics-description-input"
                      rows={3}
                      placeholder="Share travel tips, booking instructions, or arrival guidance..."
                      value={formState.description}
                      onChange={(e) => setFormState((prev) => ({ ...prev, description: e.target.value }))}
                    />
                  </FormGroup>

                  <div className="grid sm:grid-cols-3 gap-4">
                    <FormGroup>
                      <Label htmlFor="logistics-category-input">Category</Label>
                      <Input
                        id="logistics-category-input"
                        type="text"
                        placeholder="e.g. Lodging, Parking"
                        value={formState.category}
                        onChange={(e) => setFormState((prev) => ({ ...prev, category: e.target.value }))}
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label htmlFor="logistics-tags-input">Category Tags (comma separated)</Label>
                      <Input
                        id="logistics-tags-input"
                        type="text"
                        placeholder="e.g. Hotel, Shuttle"
                        value={formState.categoryTags}
                        onChange={(e) => setFormState((prev) => ({ ...prev, categoryTags: e.target.value }))}
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label htmlFor="logistics-attire-input">Attire Guidance</Label>
                      <Input
                        id="logistics-attire-input"
                        type="text"
                        placeholder="e.g. Cocktail Attire"
                        value={formState.attireRules}
                        onChange={(e) => setFormState((prev) => ({ ...prev, attireRules: e.target.value }))}
                      />
                    </FormGroup>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <FormGroup>
                      <Label htmlFor="logistics-start-input">Start Time (Optional)</Label>
                      <Input
                        id="logistics-start-input"
                        type="datetime-local"
                        value={formState.startTime}
                        onChange={(e) => setFormState((prev) => ({ ...prev, startTime: e.target.value }))}
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label htmlFor="logistics-end-input">End Time (Optional)</Label>
                      <Input
                        id="logistics-end-input"
                        type="datetime-local"
                        value={formState.endTime}
                        onChange={(e) => setFormState((prev) => ({ ...prev, endTime: e.target.value }))}
                      />
                    </FormGroup>
                  </div>

                  <div className="pt-3 border-t border-gray-200 dark:border-gray-600 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      Ceremony & Reception Highlights (Optional)
                    </p>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <FormGroup>
                        <Label htmlFor="logistics-ceremony-title">Ceremony Title</Label>
                        <Input
                          id="logistics-ceremony-title"
                          type="text"
                          placeholder="e.g. Garden Ceremony"
                          value={formState.ceremonyTitle}
                          onChange={(e) => setFormState((prev) => ({ ...prev, ceremonyTitle: e.target.value }))}
                        />
                      </FormGroup>
                      <FormGroup>
                        <Label htmlFor="logistics-ceremony-time">Ceremony Time</Label>
                        <Input
                          id="logistics-ceremony-time"
                          type="text"
                          placeholder="e.g. 4:00 PM"
                          value={formState.ceremonyTime}
                          onChange={(e) => setFormState((prev) => ({ ...prev, ceremonyTime: e.target.value }))}
                        />
                      </FormGroup>
                      <FormGroup>
                        <Label htmlFor="logistics-reception-title">Reception Title</Label>
                        <Input
                          id="logistics-reception-title"
                          type="text"
                          placeholder="e.g. Dinner & Dancing"
                          value={formState.receptionTitle}
                          onChange={(e) => setFormState((prev) => ({ ...prev, receptionTitle: e.target.value }))}
                        />
                      </FormGroup>
                      <FormGroup>
                        <Label htmlFor="logistics-reception-time">Reception Time</Label>
                        <Input
                          id="logistics-reception-time"
                          type="text"
                          placeholder="e.g. 5:30 PM – 11:00 PM"
                          value={formState.receptionTime}
                          onChange={(e) => setFormState((prev) => ({ ...prev, receptionTime: e.target.value }))}
                        />
                      </FormGroup>
                      <FormGroup>
                        <Label htmlFor="logistics-reception-attire">Reception Attire</Label>
                        <Input
                          id="logistics-reception-attire"
                          type="text"
                          placeholder="e.g. Semi-Formal"
                          value={formState.receptionAttire}
                          onChange={(e) => setFormState((prev) => ({ ...prev, receptionAttire: e.target.value }))}
                        />
                      </FormGroup>
                      <FormGroup>
                        <Label htmlFor="logistics-reception-details">Reception Details</Label>
                        <Input
                          id="logistics-reception-details"
                          type="text"
                          placeholder="e.g. Cocktail hour on the terrace followed by dinner"
                          value={formState.receptionDetails}
                          onChange={(e) => setFormState((prev) => ({ ...prev, receptionDetails: e.target.value }))}
                        />
                      </FormGroup>
                    </div>
                  </div>
                </div>
              )}

              {selectedType === 'Schedule' && (
                <div className="space-y-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <FormGroup>
                      <Label htmlFor="schedule-title-input">Event Title</Label>
                      <Input
                        id="schedule-title-input"
                        type="text"
                        placeholder="e.g. Welcome Drinks"
                        value={formState.title}
                        onChange={(e) => setFormState((prev) => ({ ...prev, title: e.target.value }))}
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label htmlFor="schedule-location-input">Location Name</Label>
                      <Input
                        id="schedule-location-input"
                        type="text"
                        placeholder="e.g. Harbor Rooftop Lounge"
                        value={formState.locationName}
                        onChange={(e) => setFormState((prev) => ({ ...prev, locationName: e.target.value }))}
                      />
                    </FormGroup>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <FormGroup>
                      <Label htmlFor="schedule-start-input">Start Time</Label>
                      <Input
                        id="schedule-start-input"
                        type="datetime-local"
                        value={formState.startTime}
                        onChange={(e) => setFormState((prev) => ({ ...prev, startTime: e.target.value }))}
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label htmlFor="schedule-end-input">End Time</Label>
                      <Input
                        id="schedule-end-input"
                        type="datetime-local"
                        value={formState.endTime}
                        onChange={(e) => setFormState((prev) => ({ ...prev, endTime: e.target.value }))}
                      />
                    </FormGroup>
                  </div>

                  <div className="grid sm:grid-cols-3 gap-4">
                    <FormGroup>
                      <Label htmlFor="schedule-category-input">Category</Label>
                      <Input
                        id="schedule-category-input"
                        type="text"
                        placeholder="e.g. Ceremony, Celebration"
                        value={formState.category}
                        onChange={(e) => setFormState((prev) => ({ ...prev, category: e.target.value }))}
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label htmlFor="schedule-tags-input">Category Tags (comma separated)</Label>
                      <Input
                        id="schedule-tags-input"
                        type="text"
                        placeholder="e.g. Friday, All Guests"
                        value={formState.categoryTags}
                        onChange={(e) => setFormState((prev) => ({ ...prev, categoryTags: e.target.value }))}
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label htmlFor="schedule-attire-input">Attire Guidance</Label>
                      <Input
                        id="schedule-attire-input"
                        type="text"
                        placeholder="e.g. Smart Casual"
                        value={formState.attireRules}
                        onChange={(e) => setFormState((prev) => ({ ...prev, attireRules: e.target.value }))}
                      />
                    </FormGroup>
                  </div>

                  <FormGroup>
                    <Label htmlFor="schedule-description-input">Event Description</Label>
                    <Textarea
                      id="schedule-description-input"
                      rows={3}
                      placeholder="Describe what guests can expect during this event..."
                      value={formState.description}
                      onChange={(e) => setFormState((prev) => ({ ...prev, description: e.target.value }))}
                    />
                  </FormGroup>
                </div>
              )}

              {selectedType === 'Photo' && (
                <div className="space-y-4 p-4 rounded-lg bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-600">
                  <FormGroup>
                    <Label htmlFor="photo-url-input">Photo URL</Label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <Input
                        id="photo-url-input"
                        type="url"
                        placeholder="https://example.com/photo.jpg or page URL to import"
                        value={formState.photoUrl}
                        onChange={(e) => setFormState((prev) => ({ ...prev, photoUrl: e.target.value }))}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={handleScrapePhoto}
                        disabled={scrapingUrl}
                        className="shrink-0"
                      >
                        {scrapingUrl ? 'Importing...' : 'Import Details from URL'}
                      </Button>
                    </div>
                    <FormMessage>
                      Paste a direct image link or a webpage URL and click Import Details from URL to fill in the photo address, title, and description automatically.
                    </FormMessage>
                  </FormGroup>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <FormGroup>
                      <Label htmlFor="photo-title-input">Photo Title</Label>
                      <Input
                        id="photo-title-input"
                        type="text"
                        placeholder="e.g. Sunset Engagement Portrait"
                        value={formState.photoTitle}
                        onChange={(e) => setFormState((prev) => ({ ...prev, photoTitle: e.target.value }))}
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label htmlFor="photo-alt-input">Alt Text (Accessibility Description)</Label>
                      <Input
                        id="photo-alt-input"
                        type="text"
                        placeholder="e.g. Couple smiling by the lake at sunset"
                        value={formState.altText}
                        onChange={(e) => setFormState((prev) => ({ ...prev, altText: e.target.value }))}
                      />
                    </FormGroup>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <FormGroup>
                      <Label htmlFor="photo-caption-input">Caption</Label>
                      <Input
                        id="photo-caption-input"
                        type="text"
                        placeholder="e.g. Sparkler exit!"
                        value={formState.photoCaption}
                        onChange={(e) =>
                          setFormState((prev) => ({ ...prev, photoCaption: e.target.value }))
                        }
                      />
                    </FormGroup>
                    <FormGroup>
                      <Label htmlFor="photo-uploader-input">Uploader Name</Label>
                      <Input
                        id="photo-uploader-input"
                        type="text"
                        placeholder="e.g. Aunt Clara"
                        value={formState.photoUploaderName}
                        onChange={(e) =>
                          setFormState((prev) => ({ ...prev, photoUploaderName: e.target.value }))
                        }
                      />
                    </FormGroup>
                  </div>

                  <FormGroup>
                    <Label htmlFor="photo-description-input">Photo Description</Label>
                    <Textarea
                      id="photo-description-input"
                      rows={3}
                      placeholder="Optional caption or story behind this photo..."
                      value={formState.photoDescription}
                      onChange={(e) => setFormState((prev) => ({ ...prev, photoDescription: e.target.value }))}
                    />
                  </FormGroup>

                  <div className="flex items-center gap-3 pt-1">
                    <input
                      id="photo-visible-checkbox"
                      type="checkbox"
                      checked={formState.isVisible}
                      onChange={(e) => setFormState((prev) => ({ ...prev, isVisible: e.target.checked }))}
                      className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <label
                      htmlFor="photo-visible-checkbox"
                      className="text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer"
                    >
                      Visible on Public Photo Gallery
                    </label>
                  </div>
                </div>
              )}

              {formError && (
                <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-400">
                  {formError}
                </p>
              )}
            </div>

            <div className="flex gap-4 mt-6">
              <Button onClick={handleSave} variant="primary">
                Save
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setIsEditing(false);
                  setFormError('');
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        <div className="mb-6 space-y-3">
          <div
            role="tablist"
            aria-label="Filter content by type"
            className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-gray-700 pb-2"
          >
            {filterTabs.map((tab, idx) => {
              const selected = tab.id === resolvedActiveFilter;
              const tabDomId = `content-filter-tab-${tab.id.toLowerCase()}`;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    filterTabRefs.current[tab.id] = el;
                  }}
                  id={tabDomId}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="content-items-tabpanel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActiveFilter(tab.id)}
                  onKeyDown={(e) => handleFilterTabKeyDown(e, idx)}
                  className={`px-3.5 py-2 text-sm font-semibold rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    selected
                      ? 'bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100'
                      : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 dark:hover:bg-gray-700'
                  }`}
                >
                  {tab.label} ({tab.count})
                </button>
              );
            })}
          </div>

          {selectableFilteredIds.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <input
                  id="select-all-content-checkbox"
                  type="checkbox"
                  checked={allFilteredSelected}
                  onChange={handleToggleSelectAllFiltered}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                <label
                  htmlFor="select-all-content-checkbox"
                  className="text-sm font-medium text-gray-800 dark:text-gray-200 cursor-pointer"
                >
                  Select all ({selectableFilteredIds.length})
                </label>
              </div>

              {activeSelectedIds.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                    {activeSelectedIds.length} selected
                  </span>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    onClick={handleBulkDelete}
                  >
                    Delete Selected ({activeSelectedIds.length})
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedIds([])}
                  >
                    Clear Selection
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <div
          id="content-items-tabpanel"
          role="tabpanel"
          aria-labelledby={`content-filter-tab-${resolvedActiveFilter.toLowerCase()}`}
          className="grid gap-4 pb-10"
          ref={containerRef}
        >
          {filteredNodes.map((node) => {
            const preview = summarizeNodePreview(node, effectiveTimezone);
            const isTemp = node.id.startsWith('temp-');
            const isSelected = activeSelectedIds.includes(node.id);
            const isFaq = node.type === 'FAQ';
            const faqIndex = isFaq ? orderedFaqNodes.findIndex((f) => f.id === node.id) : -1;
            const faqVisible = isFaq ? isFaqNodeVisible(node) : true;
            return (
              <div
                key={node.id}
                className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-primary flex flex-col sm:flex-row justify-between sm:items-center gap-4"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <input
                    id={`select-content-${node.id}`}
                    type="checkbox"
                    checked={isSelected}
                    disabled={isTemp}
                    onChange={() => handleToggleSelectId(node.id)}
                    aria-label={`Select ${preview.heading}`}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-primary/10 text-primary">
                        {node.type || 'Unnamed'}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        ({node.tags.join(', ')})
                      </span>
                      {preview.badge && (
                        <span
                          className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                            preview.badge.tone === 'success'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'
                              : preview.badge.tone === 'warning'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
                                : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
                          }`}
                        >
                          {preview.badge.label}
                        </span>
                      )}
                    </div>
                    <div className="font-bold text-lg text-gray-900 dark:text-gray-100 break-words">
                      {preview.heading}
                    </div>
                    <div className="text-sm text-gray-700 dark:text-gray-300 break-words">
                      {preview.details}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {isFaq && (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Move FAQ up: ${preview.heading}`}
                        disabled={isTemp || faqIndex <= 0}
                        onClick={() => handleMoveFaq(node.id, 'up')}
                      >
                        ↑ Up
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={`Move FAQ down: ${preview.heading}`}
                        disabled={isTemp || faqIndex < 0 || faqIndex >= orderedFaqNodes.length - 1}
                        onClick={() => handleMoveFaq(node.id, 'down')}
                      >
                        ↓ Down
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label={
                          faqVisible
                            ? `Hide FAQ: ${preview.heading}`
                            : `Show FAQ: ${preview.heading}`
                        }
                        disabled={isTemp}
                        onClick={() => handleToggleFaqVisibility(node)}
                      >
                        {faqVisible ? 'Hide' : 'Show'}
                      </Button>
                    </>
                  )}
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={node.type ? `Edit content: ${node.type}` : 'Edit unnamed item'}
                    disabled={isTemp}
                    onClick={() => handleOpenEdit(node)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    aria-label={node.type ? `Delete content: ${node.type}` : 'Delete unnamed item'}
                    disabled={isTemp}
                    onClick={(e) => handleDelete(node.id, e)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
          {filteredNodes.length === 0 && (
            <p className="text-gray-500 dark:text-gray-400">No content items found.</p>
          )}
        </div>
      </div>
    </AdminPreviewLayout>
  );
}

/**
 * Admin interface for listing, creating, editing, deleting, and previewing typed content items.
 */
export default function ContentDashboardPage() {
  const {
    data: nodes,
    isLoading,
    error,
    fetchAll,
    create,
    update,
    remove,
    removeBatch,
    reorder,
  } = useAdminContent();

  return (
    <AdminViewState
      isLoading={isLoading}
      error={error}
      onRetry={fetchAll}
      loadingMessage="Loading content..."
    >
      <ContentDashboardContent
        nodes={nodes}
        fetchAll={fetchAll}
        create={create}
        update={update}
        remove={remove}
        removeBatch={removeBatch}
        reorder={reorder}
      />
    </AdminViewState>
  );
}
