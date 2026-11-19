'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { ContentNodeDTO } from '@/features/content';
import { useAdminContent } from '@/hooks/admin/useAdminContent';
// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';

import AdminPreviewLayout from '@/components/admin/AdminPreviewLayout';
import { AdminViewState } from '@/components/admin/AdminViewState';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Textarea, Select, FormMessage } from '@/components/ui/forms';
import { useFocusSuccessor } from '@/hooks/useFocusSuccessor';
import { useToast } from '@/components/ui/ToastProvider';

const STANDARD_CONTENT_TYPES = ['FAQ', 'Logistics', 'Schedule', 'Photo'] as const;
type StandardContentType = (typeof STANDARD_CONTENT_TYPES)[number];

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
  photoDescription: '',
  altText: '',
  isVisible: true,
  photoStatus: 'APPROVED',
};

const KNOWN_DATA_KEYS: Record<StandardContentType, string[]> = {
  FAQ: ['question', 'answer', 'category', 'categoryTags', 'keywords'],
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
  Photo: ['url', 'title', 'description', 'altText', 'isVisible', 'status'],
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

function toDatetimeLocalValue(isoVal: unknown): string {
  if (typeof isoVal !== 'string' || !isoVal.trim()) return '';
  const trimmed = isoVal.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return '';
  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, '0');
  const dd = String(parsed.getDate()).padStart(2, '0');
  const hh = String(parsed.getHours()).padStart(2, '0');
  const min = String(parsed.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function toIsoTimestamp(localVal: string): string | undefined {
  const trimmed = localVal.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function formatReadableTimestamp(isoVal: unknown): string {
  if (typeof isoVal !== 'string' || !isoVal.trim()) return '';
  const parsed = new Date(isoVal);
  if (isNaN(parsed.getTime())) return isoVal;
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function buildFormStateFromNode(node: ContentNodeDTO): {
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
    startTime: toDatetimeLocalValue(rawData.startTime),
    endTime: toDatetimeLocalValue(rawData.endTime),
    ceremonyTitle: typeof rawData.ceremonyTitle === 'string' ? rawData.ceremonyTitle : '',
    ceremonyTime: typeof rawData.ceremonyTime === 'string' ? rawData.ceremonyTime : '',
    receptionTitle: typeof rawData.receptionTitle === 'string' ? rawData.receptionTitle : '',
    receptionTime: typeof rawData.receptionTime === 'string' ? rawData.receptionTime : '',
    receptionDetails: typeof rawData.receptionDetails === 'string' ? rawData.receptionDetails : '',
    receptionAttire: typeof rawData.receptionAttire === 'string' ? rawData.receptionAttire : '',
    photoUrl: typeof rawData.url === 'string' ? rawData.url : '',
    photoTitle: typeof rawData.title === 'string' ? rawData.title : '',
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
  isNewNode: boolean
): Record<string, unknown> {
  if (nodeType === 'FAQ') {
    const keywords = parseCommaList(form.faqKeywords);
    const category = form.faqCategory.trim();
    const existingTags = Array.isArray(extraData.categoryTags) ? extraData.categoryTags : undefined;
    return {
      ...extraData,
      question: form.question.trim(),
      answer: form.answer.trim(),
      ...(category ? { category } : {}),
      ...(existingTags ? { categoryTags: existingTags } : category ? { categoryTags: [category] } : {}),
      keywords,
    };
  }

  if (nodeType === 'Logistics') {
    const startTime = toIsoTimestamp(form.startTime);
    const endTime = toIsoTimestamp(form.endTime);
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
    const startTime = toIsoTimestamp(form.startTime);
    const endTime = toIsoTimestamp(form.endTime);
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
    const resolvedStatus =
      isNewNode || form.isVisible ? 'APPROVED' : form.photoStatus || 'APPROVED';
    return {
      ...extraData,
      ...(trimmedUrl ? { url: trimmedUrl } : {}),
      title: form.photoTitle.trim(),
      description: form.photoDescription.trim(),
      altText: form.altText.trim() || form.photoTitle.trim(),
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

function summarizeNodePreview(node: ContentNodeDTO): {
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
    return {
      heading: question,
      details: answer.length > 140 ? `${answer.slice(0, 140)}…` : answer,
      badge: category ? { label: category, tone: 'neutral' } : undefined,
    };
  }

  if (node.type === 'Schedule') {
    const title = typeof d.title === 'string' && d.title.trim() ? d.title.trim() : 'Untitled schedule item';
    const startLabel = formatReadableTimestamp(d.startTime);
    const endLabel = formatReadableTimestamp(d.endTime);
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
    const title =
      (typeof d.title === 'string' && d.title.trim()) ||
      (typeof d.altText === 'string' && d.altText.trim()) ||
      'Gallery Photo';
    const desc = typeof d.description === 'string' && d.description.trim() ? d.description.trim() : '';
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
}

function ContentDashboardContent({
  nodes,
  fetchAll,
  create,
  update,
  remove,
}: ContentDashboardContentProps) {
  const router = useRouter();
  const { containerRef, captureFocusTarget } = useFocusSuccessor<HTMLDivElement>();
  const { confirm, addToast } = useToast();

  const [isEditing, setIsEditing] = useState(false);
  const [currentNode, setCurrentNode] = useState<Partial<ContentNodeDTO>>({});
  const [formState, setFormState] = useState<ContentFormState>(EMPTY_FORM_STATE);
  const [extraData, setExtraData] = useState<Record<string, unknown>>({});
  const [tagsInput, setTagsInput] = useState('Homepage');
  const [formError, setFormError] = useState('');
  const [scrapingUrl, setScrapingUrl] = useState(false);

  const selectedType = currentNode.type || 'FAQ';
  const isCustomType = !isStandardContentType(selectedType);

  const defaultTagsForType = (type: string): string => {
    if (type === 'Schedule') return 'Schedule';
    if (type === 'Photo') return 'Gallery';
    return 'Homepage';
  };

  const handleOpenCreate = () => {
    setCurrentNode({ type: 'FAQ', tags: ['Homepage'] });
    setFormState({ ...EMPTY_FORM_STATE, isVisible: true, photoStatus: 'APPROVED' });
    setExtraData({});
    setTagsInput('Homepage');
    setFormError('');
    setIsEditing(true);
  };

  const handleOpenEdit = (node: ContentNodeDTO) => {
    const { form, extraData: preserved } = buildFormStateFromNode(node);
    setCurrentNode(node);
    setFormState(form);
    setExtraData(preserved);
    setTagsInput(Array.isArray(node.tags) ? node.tags.join(', ') : '');
    setFormError('');
    setIsEditing(true);
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
      const startIso = toIsoTimestamp(formState.startTime);
      const endIso = toIsoTimestamp(formState.endTime);
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
      const payloadData = buildTypedNodeData(activeType, formState, extraData, !currentNode.id);
      const payload: Partial<ContentNodeDTO> = {
        type: activeType,
        tags: parsedTags.length > 0 ? parsedTags : [defaultTagsForType(activeType)],
        data: payloadData,
      };

      if (currentNode.id) {
        await update(currentNode.id, payload);
      } else {
        await create(payload);
      }
      setIsEditing(false);
    } catch {
      // Error handled by global MutationCache
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
    tags: draftTags.length > 0 ? draftTags : [defaultTagsForType(selectedType)],
    data: buildTypedNodeData(selectedType, formState, extraData, !currentNode.id),
    createdAt: currentNode.createdAt || new Date(),
    updatedAt: currentNode.updatedAt || new Date(),
  } as ContentNodeDTO;

  const currentNodesWithDraft = nodes.map((n) => (n.id === currentNode.id ? draftNode : n));
  if (!currentNode.id && isEditing) {
    currentNodesWithDraft.push(draftNode);
  }

  return (
    <AdminPreviewLayout
      previewUrl={selectedType === 'Photo' ? '/photos' : selectedType === 'Schedule' ? '/schedule' : '/'}
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

        <div className="grid gap-4 pb-10" ref={containerRef}>
          {nodes.map((node) => {
            const preview = summarizeNodePreview(node);
            return (
              <div
                key={node.id}
                className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow border border-primary flex flex-col sm:flex-row justify-between sm:items-center gap-4"
              >
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
                <div className="space-x-2 flex shrink-0">
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={node.type ? `Edit content: ${node.type}` : 'Edit unnamed item'}
                    disabled={node.id.startsWith('temp-')}
                    onClick={() => handleOpenEdit(node)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    aria-label={node.type ? `Delete content: ${node.type}` : 'Delete unnamed item'}
                    disabled={node.id.startsWith('temp-')}
                    onClick={(e) => handleDelete(node.id, e)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            );
          })}
          {nodes.length === 0 && <p className="text-gray-500 dark:text-gray-400">No content items found.</p>}
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
      />
    </AdminViewState>
  );
}
