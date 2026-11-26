'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
  MAX_RSVP_PLUS_ONE_COUNT,
  normalizeMealOptions,
  normalizeCustomQuestions,
  normalizeMealSelections,
  normalizeCustomAnswers,
  normalizePlusOneNames,
} from '@/utils/rsvpPrompts';
import type {
  MealOptionDTO,
  CustomRsvpQuestionDTO,
  SubEventRsvpSubmissionItem,
} from '@/features/sub-events';
import { withBasePath } from '@/lib/basePath';

export type EventRsvpFiniteState = 'idle' | 'dirty' | 'submitting' | 'success' | 'error';

export interface ScheduleHouseholdMember {
  id: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  role: 'PRIMARY' | 'PARTNER' | 'CHILD' | 'PLUS_ONE';
  email?: string | null;
  phone?: string | null;
  dietaryNotes?: string | null;
  tags?: string[];
  displayOrder?: number;
}

export interface ScheduleMemberRsvpItem {
  householdMemberId: string;
  status: 'attending' | 'declined' | 'pending';
  mealOptionId: string;
  dietaryNotes: string;
}

export interface SubEventRsvpData {
  status: 'attending' | 'declined' | 'pending';
  plusOneCount: number;
  dietaryNotes: string;
  mealSelections: string[];
  customAnswers: Record<string, string>;
  plusOneNames: string[];
  memberRsvps?: ScheduleMemberRsvpItem[];
}

export interface SubEventRsvpItemState {
  id: string;
  baseline: SubEventRsvpData;
  current: SubEventRsvpData;
  state: EventRsvpFiniteState;
  isDirty: boolean;
  isSubmitting: boolean;
  message: string | null;
  error: string | null;
  fieldErrors: Record<string, string>;
}

interface EventPromptMeta {
  title?: string;
  mealOptions: MealOptionDTO[];
  customQuestions: CustomRsvpQuestionDTO[];
}

export interface ScheduleRsvpEventInit {
  id: string;
  title?: string;
  isReadOnly?: boolean;
  mealOptions?: MealOptionDTO[];
  customQuestions?: CustomRsvpQuestionDTO[];
  userRsvp?: Partial<SubEventRsvpData> | null;
}

export interface UseScheduleRsvpManagerOptions {
  initialEvents?: ScheduleRsvpEventInit[];
  maxPlusOnes?: number | null;
  defaultPlusOneNames?: string[] | null;
  householdMembers?: ScheduleHouseholdMember[] | null;
  apiEndpoint?: string;
  onSuccess?: (_updatedRsvps: any[]) => void;
  onError?: (_error: Error) => void;
  onRsvpClosed?: (_message: string) => void;
}

function getStatusValidationError(status: SubEventRsvpData['status']): string | null {
  if (status !== 'attending' && status !== 'declined') {
    return 'Please select Attending or Declined before saving.';
  }
  return null;
}

function getPlusOneValidationError(
  plusOneCount: number,
  maxPlusOnes?: number | null
): string | null {
  if (typeof maxPlusOnes === 'number') {
    const normalizedMax = Math.max(0, maxPlusOnes);
    if (plusOneCount > normalizedMax) {
      if (normalizedMax === 0) {
        return 'Plus-one guests are not allocated for your invitation.';
      }
      return `Plus-one count (${plusOneCount}) exceeds your allocated limit of ${normalizedMax}.`;
    }
  }
  if (plusOneCount > MAX_RSVP_PLUS_ONE_COUNT) {
    return `Plus-one count cannot exceed ${MAX_RSVP_PLUS_ONE_COUNT}.`;
  }
  return null;
}

interface EventValidationResult {
  summaryError: string | null;
  fieldErrors: Record<string, string>;
}

function validateEventRsvp(
  current: SubEventRsvpData,
  effectivePlusOneCount: number,
  maxPlusOnes?: number | null,
  meta?: EventPromptMeta,
  householdMembers?: ScheduleHouseholdMember[] | null
): EventValidationResult {
  const fieldErrors: Record<string, string> = {};
  let summaryError: string | null = null;

  const activeMembers = Array.isArray(householdMembers) ? householdMembers : [];
  if (activeMembers.length > 0 && Array.isArray(current.memberRsvps)) {
    const memberRsvpMap = new Map(current.memberRsvps.map((mr) => [mr.householdMemberId, mr]));
    const validMealIds =
      meta && meta.mealOptions.length > 0 ? new Set(meta.mealOptions.map((m) => m.id)) : null;

    let anyAttending = false;
    for (const member of activeMembers) {
      const mr = memberRsvpMap.get(member.id);
      const memberStatus = mr?.status ?? 'pending';
      if (memberStatus !== 'attending' && memberStatus !== 'declined') {
        const stErr = `Please select Attending or Declined for ${member.fullName} before saving.`;
        fieldErrors[`memberStatus.${member.id}`] = 'Please select Attending or Declined.';
        if (!summaryError) {
          summaryError = stErr;
        }
      } else if (memberStatus === 'attending') {
        anyAttending = true;
        if (validMealIds) {
          const mealId = (mr?.mealOptionId ?? '').trim();
          if (!mealId || !validMealIds.has(mealId)) {
            fieldErrors[`memberMeal.${member.id}`] = 'Please select an entrée option.';
            if (!summaryError) {
              summaryError = `Please select an entrée option for ${member.fullName}.`;
            }
          }
        }
      }
    }

    if (anyAttending && meta && meta.customQuestions.length > 0) {
      for (const question of meta.customQuestions) {
        const answer = (current.customAnswers[question.id] ?? '').trim();
        if (question.required && !answer) {
          const qErr = `Please answer required question: "${question.prompt}".`;
          fieldErrors[`customAnswers.${question.id}`] = qErr;
          if (!summaryError) {
            summaryError = qErr;
          }
        } else if (answer && question.type === 'choice' && !question.options.includes(answer)) {
          const qErr = `Please choose a valid option for "${question.prompt}".`;
          fieldErrors[`customAnswers.${question.id}`] = qErr;
          if (!summaryError) {
            summaryError = qErr;
          }
        }
      }
    }

    return { summaryError, fieldErrors };
  }

  const statusError = getStatusValidationError(current.status);
  if (statusError) {
    fieldErrors.status = statusError;
    summaryError = statusError;
  }

  const plusOneError = getPlusOneValidationError(effectivePlusOneCount, maxPlusOnes);
  if (plusOneError) {
    fieldErrors.plusOneCount = plusOneError;
    if (!summaryError) {
      summaryError = plusOneError;
    }
  }

  if (current.status === 'attending' && meta) {
    if (meta.mealOptions.length > 0) {
      const validMealIds = new Set(meta.mealOptions.map((m) => m.id));
      const expectedPartySize = 1 + effectivePlusOneCount;
      for (let idx = 0; idx < expectedPartySize; idx++) {
        const selectedId = (current.mealSelections[idx] ?? '').trim();
        if (!selectedId || !validMealIds.has(selectedId)) {
          fieldErrors[`mealSelections.${idx}`] = 'Please select an entrée option.';
          if (!summaryError) {
            summaryError =
              expectedPartySize === 1
                ? 'Please select an entrée option before saving.'
                : `Please select an entrée option for all ${expectedPartySize} attending guests.`;
          }
        }
      }

      for (let pIdx = 0; pIdx < effectivePlusOneCount; pIdx++) {
        if (!(current.plusOneNames[pIdx] ?? '').trim()) {
          fieldErrors[`plusOneNames.${pIdx}`] = 'Please enter the full name for this plus-one guest.';
          if (!summaryError) {
            summaryError =
              effectivePlusOneCount === 1
                ? 'Please enter the full name for your attending plus-one guest.'
                : `Please enter full names for all ${effectivePlusOneCount} attending plus-one guests.`;
          }
        }
      }
    }

    if (meta.customQuestions.length > 0) {
      for (const question of meta.customQuestions) {
        const answer = (current.customAnswers[question.id] ?? '').trim();
        if (question.required && !answer) {
          const qErr = `Please answer required question: "${question.prompt}".`;
          fieldErrors[`customAnswers.${question.id}`] = qErr;
          if (!summaryError) {
            summaryError = qErr;
          }
        } else if (answer && question.type === 'choice' && !question.options.includes(answer)) {
          const qErr = `Please choose a valid option for "${question.prompt}".`;
          fieldErrors[`customAnswers.${question.id}`] = qErr;
          if (!summaryError) {
            summaryError = qErr;
          }
        }
      }
    }
  }

  return { summaryError, fieldErrors };
}

function cloneRsvpData(data: SubEventRsvpData): SubEventRsvpData {
  return {
    status: data.status,
    plusOneCount: data.plusOneCount,
    dietaryNotes: data.dietaryNotes,
    mealSelections: [...data.mealSelections],
    customAnswers: { ...data.customAnswers },
    plusOneNames: [...data.plusOneNames],
    ...(Array.isArray(data.memberRsvps)
      ? { memberRsvps: data.memberRsvps.map((mr) => ({ ...mr })) }
      : {}),
  };
}

function createEmptyRsvpData(
  householdMembers?: ScheduleHouseholdMember[] | null
): SubEventRsvpData {
  const activeMembers = Array.isArray(householdMembers) ? householdMembers : [];
  return {
    status: 'pending',
    plusOneCount: 0,
    dietaryNotes: '',
    mealSelections: [],
    customAnswers: {},
    plusOneNames: [],
    ...(activeMembers.length > 0
      ? {
        memberRsvps: activeMembers.map((m) => ({
          householdMemberId: m.id,
          status: 'pending' as const,
          mealOptionId: '',
          dietaryNotes: '',
        })),
      }
      : {}),
  };
}

function deriveSummaryFromMemberRsvps(
  memberRsvps: ScheduleMemberRsvpItem[],
  activeMembers: ScheduleHouseholdMember[]
): {
  status: 'attending' | 'declined' | 'pending';
  plusOneCount: number;
  mealSelections: string[];
  plusOneNames: string[];
} {
  const memberById = new Map(activeMembers.map((m) => [m.id, m]));
  const attending = memberRsvps.filter((mr) => mr.status === 'attending');
  const allDeclined =
    memberRsvps.length > 0 && memberRsvps.every((mr) => mr.status === 'declined');
  const status: 'attending' | 'declined' | 'pending' =
    attending.length > 0 ? 'attending' : allDeclined ? 'declined' : 'pending';
  const plusOneCount = attending.length > 0 ? Math.max(0, attending.length - 1) : 0;
  const mealSelections = attending.map((mr) => mr.mealOptionId.trim());
  const plusOneNames = attending
    .map((mr) => memberById.get(mr.householdMemberId))
    .filter((m): m is ScheduleHouseholdMember => Boolean(m && m.role !== 'PRIMARY'))
    .map((m) => m.fullName);

  return {
    status,
    plusOneCount,
    mealSelections,
    plusOneNames,
  };
}

function normalizeRsvpData(
  userRsvp?: Partial<SubEventRsvpData> | null,
  householdMembers?: ScheduleHouseholdMember[] | null
): SubEventRsvpData {
  const activeMembers = Array.isArray(householdMembers) ? householdMembers : [];
  if (activeMembers.length > 0) {
    const rawMemberRsvps = Array.isArray(userRsvp?.memberRsvps) ? userRsvp!.memberRsvps : null;
    let resolvedMemberRsvps: ScheduleMemberRsvpItem[];

    if (rawMemberRsvps && rawMemberRsvps.length > 0) {
      const byMemberId = new Map(
        rawMemberRsvps
          .filter((mr): mr is ScheduleMemberRsvpItem => Boolean(mr && mr.householdMemberId))
          .map((mr) => [mr.householdMemberId, mr])
      );
      const fallbackStatus: 'declined' | 'pending' =
        userRsvp?.status === 'declined' ? 'declined' : 'pending';
      resolvedMemberRsvps = activeMembers.map((member) => {
        const existing = byMemberId.get(member.id);
        if (!existing) {
          return {
            householdMemberId: member.id,
            status: fallbackStatus,
            mealOptionId: '',
            dietaryNotes: '',
          };
        }
        const st: 'attending' | 'declined' | 'pending' =
          existing.status === 'attending' || existing.status === 'declined'
            ? existing.status
            : 'pending';
        return {
          householdMemberId: member.id,
          status: st,
          mealOptionId: st === 'attending' ? (existing.mealOptionId ?? '').trim() : '',
          dietaryNotes: st === 'attending' ? (existing.dietaryNotes ?? '').trim() : '',
        };
      });
    } else if (userRsvp?.status === 'declined') {
      resolvedMemberRsvps = activeMembers.map((member) => ({
        householdMemberId: member.id,
        status: 'declined',
        mealOptionId: '',
        dietaryNotes: '',
      }));
    } else if (userRsvp?.status === 'attending') {
      const attendingCount = 1 + Math.max(0, userRsvp.plusOneCount ?? 0);
      const legacyMeals = normalizeMealSelections(userRsvp.mealSelections);
      resolvedMemberRsvps = activeMembers.map((member, idx) => {
        const isAttending = idx < attendingCount;
        return {
          householdMemberId: member.id,
          status: isAttending ? 'attending' : 'declined',
          mealOptionId: isAttending ? (legacyMeals[idx] ?? '').trim() : '',
          dietaryNotes: '',
        };
      });
    } else {
      resolvedMemberRsvps = activeMembers.map((member) => ({
        householdMemberId: member.id,
        status: 'pending',
        mealOptionId: '',
        dietaryNotes: '',
      }));
    }

    const derived = deriveSummaryFromMemberRsvps(resolvedMemberRsvps, activeMembers);
    return {
      status: derived.status,
      plusOneCount: derived.plusOneCount,
      dietaryNotes: (userRsvp?.dietaryNotes ?? '').trim(),
      mealSelections: derived.mealSelections,
      customAnswers:
        derived.status === 'declined' ? {} : normalizeCustomAnswers(userRsvp?.customAnswers),
      plusOneNames: derived.plusOneNames,
      memberRsvps: resolvedMemberRsvps,
    };
  }

  const status = userRsvp?.status || 'pending';
  const plusOneCount = status === 'declined' ? 0 : Math.max(0, userRsvp?.plusOneCount ?? 0);
  return {
    status,
    plusOneCount,
    dietaryNotes: (userRsvp?.dietaryNotes ?? '').trim(),
    mealSelections:
      status === 'declined'
        ? []
        : normalizeMealSelections(userRsvp?.mealSelections).slice(0, 1 + plusOneCount),
    customAnswers:
      status === 'declined' ? {} : normalizeCustomAnswers(userRsvp?.customAnswers),
    plusOneNames:
      status === 'declined' || plusOneCount === 0
        ? []
        : normalizePlusOneNames(userRsvp?.plusOneNames).slice(0, plusOneCount),
  };
}

function areStringArraysEqual(a: string[], b: string[]): boolean {
  const maxLen = Math.max(a.length, b.length);
  for (let i = 0; i < maxLen; i++) {
    const valA = (a[i] ?? '').trim();
    const valB = (b[i] ?? '').trim();
    if (valA !== valB) return false;
  }
  return true;
}

function areAnswerRecordsEqual(
  a: Record<string, string>,
  b: Record<string, string>
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const valA = (a[key] ?? '').trim();
    const valB = (b[key] ?? '').trim();
    if (valA !== valB) return false;
  }
  return true;
}

function areMemberRsvpsEqual(
  a?: ScheduleMemberRsvpItem[],
  b?: ScheduleMemberRsvpItem[]
): boolean {
  if (!a && !b) return true;
  const listA = a ?? [];
  const listB = b ?? [];
  if (listA.length !== listB.length) return false;
  for (let i = 0; i < listA.length; i++) {
    const itemA = listA[i];
    const itemB = listB[i];
    if (
      itemA.householdMemberId !== itemB.householdMemberId ||
      itemA.status !== itemB.status ||
      itemA.mealOptionId.trim() !== itemB.mealOptionId.trim() ||
      itemA.dietaryNotes.trim() !== itemB.dietaryNotes.trim()
    ) {
      return false;
    }
  }
  return true;
}

function isRsvpDirty(current: SubEventRsvpData, baseline: SubEventRsvpData): boolean {
  if (Array.isArray(current.memberRsvps) || Array.isArray(baseline.memberRsvps)) {
    return (
      !areMemberRsvpsEqual(current.memberRsvps, baseline.memberRsvps) ||
      current.dietaryNotes.trim() !== baseline.dietaryNotes.trim() ||
      !areAnswerRecordsEqual(current.customAnswers, baseline.customAnswers)
    );
  }
  return (
    current.status !== baseline.status ||
    current.plusOneCount !== baseline.plusOneCount ||
    current.dietaryNotes.trim() !== baseline.dietaryNotes.trim() ||
    !areStringArraysEqual(current.mealSelections, baseline.mealSelections) ||
    !areAnswerRecordsEqual(current.customAnswers, baseline.customAnswers) ||
    !areStringArraysEqual(current.plusOneNames, baseline.plusOneNames)
  );
}

function buildSubmissionPayloadItem(
  item: SubEventRsvpItemState,
  meta?: EventPromptMeta,
  householdMembers?: ScheduleHouseholdMember[] | null
): SubEventRsvpSubmissionItem {
  const activeMembers = Array.isArray(householdMembers) ? householdMembers : [];
  if (activeMembers.length > 0 && Array.isArray(item.current.memberRsvps)) {
    const derived = deriveSummaryFromMemberRsvps(item.current.memberRsvps, activeMembers);
    const isDeclined = derived.status === 'declined';
    const resolvedStatus: 'attending' | 'declined' = isDeclined ? 'declined' : 'attending';
    const hasMealsConfigured = (meta?.mealOptions.length ?? 0) > 0;

    const payloadItem: SubEventRsvpSubmissionItem = {
      subEventId: item.id,
      status: resolvedStatus,
      plusOneCount: derived.plusOneCount,
      dietaryNotes: item.current.dietaryNotes,
      memberRsvps: item.current.memberRsvps.map((mr) => ({
        householdMemberId: mr.householdMemberId,
        status: mr.status === 'attending' ? 'attending' : 'declined',
        mealOptionId:
          mr.status === 'attending' && hasMealsConfigured
            ? mr.mealOptionId.trim() || null
            : null,
        ...(mr.status === 'attending' && mr.dietaryNotes.trim()
          ? { dietaryNotes: mr.dietaryNotes.trim() }
          : {}),
      })),
    };

    if (
      !isDeclined &&
      item.baseline.dietaryNotes.trim().length > 0 &&
      item.current.dietaryNotes.trim().length === 0
    ) {
      payloadItem.clearDietaryNotes = true;
    }

    if (hasMealsConfigured) {
      payloadItem.mealSelections = isDeclined ? [] : derived.mealSelections;
    }

    const hasQuestionsConfigured = (meta?.customQuestions.length ?? 0) > 0;
    const hasAnswerValues =
      Object.values(item.current.customAnswers).some((v) => v.trim().length > 0) ||
      Object.values(item.baseline.customAnswers).some((v) => v.trim().length > 0);
    if (hasQuestionsConfigured || hasAnswerValues) {
      payloadItem.customAnswers = isDeclined
        ? {}
        : normalizeCustomAnswers(item.current.customAnswers);
    }

    if (derived.plusOneNames.length > 0 || item.baseline.plusOneNames.length > 0) {
      payloadItem.plusOneNames = isDeclined ? [] : derived.plusOneNames;
    }

    return payloadItem;
  }

  const isDeclined = item.current.status === 'declined';
  const resolvedStatus: 'attending' | 'declined' = isDeclined ? 'declined' : 'attending';
  const effectivePlusOneCount = isDeclined ? 0 : item.current.plusOneCount;

  const payloadItem: SubEventRsvpSubmissionItem = {
    subEventId: item.id,
    status: resolvedStatus,
    plusOneCount: effectivePlusOneCount,
    dietaryNotes: item.current.dietaryNotes,
  };

  if (
    !isDeclined &&
    item.baseline.dietaryNotes.trim().length > 0 &&
    item.current.dietaryNotes.trim().length === 0
  ) {
    payloadItem.clearDietaryNotes = true;
  }

  const hasMealsConfigured = (meta?.mealOptions.length ?? 0) > 0;
  const hasMealValues =
    item.current.mealSelections.some((s) => s.trim().length > 0) ||
    item.baseline.mealSelections.some((s) => s.trim().length > 0);
  if (hasMealsConfigured || hasMealValues) {
    payloadItem.mealSelections = isDeclined
      ? []
      : item.current.mealSelections
        .slice(0, 1 + effectivePlusOneCount)
        .map((s) => s.trim());
  }

  const hasQuestionsConfigured = (meta?.customQuestions.length ?? 0) > 0;
  const hasAnswerValues =
    Object.values(item.current.customAnswers).some((v) => v.trim().length > 0) ||
    Object.values(item.baseline.customAnswers).some((v) => v.trim().length > 0);
  if (hasQuestionsConfigured || hasAnswerValues) {
    payloadItem.customAnswers = isDeclined
      ? {}
      : normalizeCustomAnswers(item.current.customAnswers);
  }

  const hasPlusOneNames =
    item.current.plusOneNames.some((n) => n.trim().length > 0) ||
    item.baseline.plusOneNames.some((n) => n.trim().length > 0);
  if (hasPlusOneNames) {
    payloadItem.plusOneNames =
      isDeclined || effectivePlusOneCount === 0
        ? []
        : item.current.plusOneNames
          .slice(0, effectivePlusOneCount)
          .map((s) => s.trim());
  }

  return payloadItem;
}

function extractSharedPlusOneNames(
  events?: ScheduleRsvpEventInit[],
  defaults?: string[] | null
): string[] {
  const shared: string[] = [];
  if (Array.isArray(events)) {
    for (const ev of events) {
      if (ev.isReadOnly || !Array.isArray(ev.userRsvp?.plusOneNames)) continue;
      ev.userRsvp.plusOneNames.forEach((raw, idx) => {
        const trimmed = typeof raw === 'string' ? raw.trim() : '';
        if (trimmed && !shared[idx]) {
          shared[idx] = trimmed;
        }
      });
    }
  }
  if (Array.isArray(defaults)) {
    defaults.forEach((raw, idx) => {
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (trimmed && !shared[idx]) {
        shared[idx] = trimmed;
      }
    });
  }
  return shared;
}

export function useScheduleRsvpManager(options?: UseScheduleRsvpManagerOptions) {
  const apiEndpoint = options?.apiEndpoint || '/api/rsvp';
  const householdMembersRef = useRef<ScheduleHouseholdMember[]>(
    Array.isArray(options?.householdMembers) ? options.householdMembers : []
  );
  const sharedPlusOneNamesRef = useRef<string[]>(
    extractSharedPlusOneNames(options?.initialEvents, options?.defaultPlusOneNames)
  );
  const readOnlyIdsRef = useRef<Set<string>>(
    new Set(
      (options?.initialEvents ?? [])
        .filter((ev) => Boolean(ev.isReadOnly))
        .map((ev) => ev.id)
    )
  );
  const eventMetaRef = useRef<Record<string, EventPromptMeta>>((() => {
    const meta: Record<string, EventPromptMeta> = {};
    if (options?.initialEvents) {
      options.initialEvents.forEach((ev) => {
        if (ev.isReadOnly) return;
        meta[ev.id] = {
          title: ev.title,
          mealOptions: normalizeMealOptions(ev.mealOptions),
          customQuestions: normalizeCustomQuestions(ev.customQuestions),
        };
      });
    }
    return meta;
  })());

  const [eventsMap, setEventsMap] = useState<Record<string, SubEventRsvpItemState>>(() => {
    const map: Record<string, SubEventRsvpItemState> = {};
    if (options?.initialEvents) {
      options.initialEvents.forEach((ev) => {
        if (ev.isReadOnly) return;
        const baseline = normalizeRsvpData(ev.userRsvp, options?.householdMembers);
        map[ev.id] = {
          id: ev.id,
          baseline,
          current: cloneRsvpData(baseline),
          state: 'idle',
          isDirty: false,
          isSubmitting: false,
          message: null,
          error: null,
          fieldErrors: {},
        };
      });
    }
    return map;
  });

  const [isBatchSubmitting, setIsBatchSubmitting] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchSuccessMessage, setBatchSuccessMessage] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);
  const inFlightSubmittingRef = useRef(false);

  // Keep options in a ref to avoid recreating callbacks
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
    if (Array.isArray(options?.householdMembers)) {
      householdMembersRef.current = options.householdMembers;
    }
    if (Array.isArray(options?.defaultPlusOneNames)) {
      options.defaultPlusOneNames.forEach((raw, idx) => {
        const trimmed = typeof raw === 'string' ? raw.trim() : '';
        if (trimmed && !sharedPlusOneNamesRef.current[idx]) {
          sharedPlusOneNamesRef.current[idx] = trimmed;
        }
      });
    }
  }, [options]);

  const initializeEvents = useCallback(
    (
      events: ScheduleRsvpEventInit[],
      defaultNamesOverride?: string[] | null,
      householdMembersOverride?: ScheduleHouseholdMember[] | null
    ) => {
      if (householdMembersOverride !== undefined) {
        householdMembersRef.current = Array.isArray(householdMembersOverride)
          ? householdMembersOverride
          : [];
      }
      const activeMembers = householdMembersRef.current;

      const discovered = extractSharedPlusOneNames(
        events,
        defaultNamesOverride !== undefined
          ? defaultNamesOverride
          : optionsRef.current?.defaultPlusOneNames
      );
      discovered.forEach((name, idx) => {
        if (name && !sharedPlusOneNamesRef.current[idx]) {
          sharedPlusOneNamesRef.current[idx] = name;
        }
      });

      events.forEach((ev) => {
        if (ev.isReadOnly) {
          readOnlyIdsRef.current.add(ev.id);
          delete eventMetaRef.current[ev.id];
          return;
        }
        readOnlyIdsRef.current.delete(ev.id);
        eventMetaRef.current[ev.id] = {
          title: ev.title,
          mealOptions: normalizeMealOptions(ev.mealOptions),
          customQuestions: normalizeCustomQuestions(ev.customQuestions),
        };
      });

      setEventsMap((prev) => {
        const next = { ...prev };
        events.forEach((ev) => {
          if (ev.isReadOnly) {
            delete next[ev.id];
            return;
          }
          const newBaseline = normalizeRsvpData(ev.userRsvp, activeMembers);
          const existing = prev[ev.id];
          if (!existing) {
            next[ev.id] = {
              id: ev.id,
              baseline: newBaseline,
              current: cloneRsvpData(newBaseline),
              state: 'idle',
              isDirty: false,
              isSubmitting: false,
              message: null,
              error: null,
              fieldErrors: {},
            };
          } else {
            // If existing item is dirty, preserve user's pending edits but update baseline
            if (existing.isDirty) {
              const dirty = isRsvpDirty(existing.current, newBaseline);
              next[ev.id] = {
                ...existing,
                baseline: newBaseline,
                isDirty: dirty,
                state: dirty ? 'dirty' : 'idle',
              };
            } else {
              // Not dirty, sync both baseline and current
              next[ev.id] = {
                ...existing,
                baseline: newBaseline,
                current: cloneRsvpData(newBaseline),
                state: 'idle',
                isDirty: false,
                isSubmitting: false,
                message: null,
                error: null,
                fieldErrors: {},
              };
            }
          }
        });
        return next;
      });
    },
    []
  );

  const updateRsvp = useCallback(
    (subEventId: string, updates: Partial<SubEventRsvpData>) => {
      if (readOnlyIdsRef.current.has(subEventId)) return;
      setBatchError(null);
      setBatchSuccessMessage(null);

      setEventsMap((prev) => {
        const activeMembers = householdMembersRef.current;
        const existing = prev[subEventId] || {
          id: subEventId,
          baseline: createEmptyRsvpData(activeMembers),
          current: createEmptyRsvpData(activeMembers),
          state: 'idle' as const,
          isDirty: false,
          isSubmitting: false,
          message: null,
          error: null,
          fieldErrors: {},
        };

        if (activeMembers.length > 0) {
          const baseMemberRsvps =
            updates.memberRsvps !== undefined
              ? updates.memberRsvps.map((mr) => ({ ...mr }))
              : Array.isArray(existing.current.memberRsvps)
                ? existing.current.memberRsvps.map((mr) => ({ ...mr }))
                : activeMembers.map((m) => ({
                  householdMemberId: m.id,
                  status: 'pending' as const,
                  mealOptionId: '',
                  dietaryNotes: '',
                }));

          let resolvedMemberRsvps = baseMemberRsvps;
          if (
            updates.memberRsvps === undefined &&
            (updates.status === 'attending' || updates.status === 'declined')
          ) {
            resolvedMemberRsvps = baseMemberRsvps.map((mr) => ({
              ...mr,
              status: updates.status as 'attending' | 'declined',
              mealOptionId: updates.status === 'declined' ? '' : mr.mealOptionId,
              dietaryNotes: updates.status === 'declined' ? '' : mr.dietaryNotes,
            }));
          }

          const derived = deriveSummaryFromMemberRsvps(resolvedMemberRsvps, activeMembers);
          const nextCustomAnswers =
            derived.status === 'declined'
              ? {}
              : updates.customAnswers !== undefined
                ? { ...updates.customAnswers }
                : { ...existing.current.customAnswers };

          const newCurrent: SubEventRsvpData = {
            status: derived.status,
            plusOneCount: derived.plusOneCount,
            dietaryNotes:
              updates.dietaryNotes !== undefined
                ? updates.dietaryNotes
                : existing.current.dietaryNotes,
            mealSelections: derived.mealSelections,
            customAnswers: nextCustomAnswers,
            plusOneNames: derived.plusOneNames,
            memberRsvps: resolvedMemberRsvps,
          };

          const dirty = isRsvpDirty(newCurrent, existing.baseline);
          return {
            ...prev,
            [subEventId]: {
              ...existing,
              current: newCurrent,
              isDirty: dirty,
              state: dirty ? 'dirty' : 'idle',
              message: null,
              error: null,
              fieldErrors: {},
            },
          };
        }

        const prevSharedSnapshot = [...sharedPlusOneNamesRef.current];
        const nextStatus = updates.status ?? existing.current.status;
        const configuredMax = optionsRef.current?.maxPlusOnes;
        let nextPlusOnes = existing.current.plusOneCount;
        if (nextStatus === 'declined') {
          nextPlusOnes = 0;
        } else if (updates.plusOneCount !== undefined) {
          nextPlusOnes = configuredMax === 0 ? 0 : Math.max(0, updates.plusOneCount);
        } else if (configuredMax === 0) {
          nextPlusOnes = 0;
        }

        let nextMealSelections: string[];
        let nextPlusOneNames: string[];
        let nextCustomAnswers: Record<string, string>;

        if (nextStatus === 'declined') {
          nextMealSelections = [];
          nextPlusOneNames = [];
          nextCustomAnswers = {};
        } else {
          const rawMeals =
            updates.mealSelections !== undefined
              ? [...updates.mealSelections]
              : [...existing.current.mealSelections];
          nextMealSelections = rawMeals.slice(0, 1 + nextPlusOnes);

          if (nextPlusOnes === 0) {
            nextPlusOneNames = [];
          } else if (updates.plusOneNames !== undefined) {
            nextPlusOneNames = updates.plusOneNames.slice(0, nextPlusOnes);
            nextPlusOneNames.forEach((val, idx) => {
              sharedPlusOneNamesRef.current[idx] = val;
            });
          } else {
            const baseNames = existing.current.plusOneNames.slice(0, nextPlusOnes);
            const defaults = optionsRef.current?.defaultPlusOneNames;
            for (let idx = 0; idx < nextPlusOnes; idx++) {
              if (!baseNames[idx]?.trim()) {
                const candidate =
                  sharedPlusOneNamesRef.current[idx]?.trim() ||
                  (Array.isArray(defaults) ? defaults[idx]?.trim() : '');
                if (candidate) {
                  baseNames[idx] = candidate;
                  sharedPlusOneNamesRef.current[idx] = candidate;
                }
              }
            }
            nextPlusOneNames = baseNames;
          }

          nextCustomAnswers =
            updates.customAnswers !== undefined
              ? { ...updates.customAnswers }
              : { ...existing.current.customAnswers };
        }

        const newCurrent: SubEventRsvpData = {
          ...existing.current,
          ...updates,
          status: nextStatus,
          plusOneCount: nextPlusOnes,
          mealSelections: nextMealSelections,
          customAnswers: nextCustomAnswers,
          plusOneNames: nextPlusOneNames,
        };

        const dirty = isRsvpDirty(newCurrent, existing.baseline);

        const nextMap: Record<string, SubEventRsvpItemState> = {
          ...prev,
          [subEventId]: {
            ...existing,
            current: newCurrent,
            isDirty: dirty,
            state: dirty ? 'dirty' : 'idle',
            // Clear stale status banners whenever the user modifies event details
            message: null,
            error: null,
            fieldErrors: {},
          },
        };

        if (updates.plusOneNames !== undefined && nextStatus !== 'declined' && nextPlusOnes > 0) {
          for (const [otherId, otherItem] of Object.entries(prev)) {
            if (otherId === subEventId) continue;
            if (otherItem.current.status === 'declined' || otherItem.current.plusOneCount <= 0) {
              continue;
            }
            let otherChanged = false;
            const syncedOtherNames = Array.from(
              { length: otherItem.current.plusOneCount },
              (_, idx) => otherItem.current.plusOneNames[idx] ?? ''
            );
            for (let idx = 0; idx < Math.min(nextPlusOnes, otherItem.current.plusOneCount); idx++) {
              const editedVal = nextPlusOneNames[idx] ?? '';
              const prevValOnTarget = existing.current.plusOneNames[idx] ?? '';
              if (editedVal === prevValOnTarget) continue;
              const existingOtherVal = syncedOtherNames[idx] ?? '';
              const prevSharedVal = prevSharedSnapshot[idx] ?? '';
              if (
                !existingOtherVal.trim() ||
                existingOtherVal === prevValOnTarget ||
                existingOtherVal === prevSharedVal
              ) {
                syncedOtherNames[idx] = editedVal;
                otherChanged = true;
              }
            }
            if (otherChanged) {
              const updatedOtherCurrent: SubEventRsvpData = {
                ...otherItem.current,
                plusOneNames: syncedOtherNames,
              };
              const otherDirty = isRsvpDirty(updatedOtherCurrent, otherItem.baseline);
              nextMap[otherId] = {
                ...otherItem,
                current: updatedOtherCurrent,
                isDirty: otherDirty,
                state: otherDirty ? 'dirty' : 'idle',
                message: null,
                error: null,
                fieldErrors: {},
              };
            }
          }
        }

        return nextMap;
      });
    },
    []
  );

  const updateMemberRsvp = useCallback(
    (
      subEventId: string,
      householdMemberId: string,
      patch: Partial<Omit<ScheduleMemberRsvpItem, 'householdMemberId'>>
    ) => {
      if (readOnlyIdsRef.current.has(subEventId)) return;
      const activeMembers = householdMembersRef.current;
      if (activeMembers.length === 0) return;

      setBatchError(null);
      setBatchSuccessMessage(null);

      setEventsMap((prev) => {
        const existing = prev[subEventId] || {
          id: subEventId,
          baseline: createEmptyRsvpData(activeMembers),
          current: createEmptyRsvpData(activeMembers),
          state: 'idle' as const,
          isDirty: false,
          isSubmitting: false,
          message: null,
          error: null,
          fieldErrors: {},
        };

        const currentRows = Array.isArray(existing.current.memberRsvps)
          ? existing.current.memberRsvps
          : activeMembers.map((m) => ({
            householdMemberId: m.id,
            status: 'pending' as const,
            mealOptionId: '',
            dietaryNotes: '',
          }));

        const nextMemberRsvps = activeMembers.map((member) => {
          const cur = currentRows.find((r) => r.householdMemberId === member.id) ?? {
            householdMemberId: member.id,
            status: 'pending' as const,
            mealOptionId: '',
            dietaryNotes: '',
          };
          if (member.id !== householdMemberId) {
            return { ...cur };
          }
          const nextStatus = patch.status ?? cur.status;
          return {
            householdMemberId: member.id,
            status: nextStatus,
            mealOptionId:
              nextStatus === 'declined'
                ? ''
                : patch.mealOptionId !== undefined
                  ? patch.mealOptionId
                  : cur.mealOptionId,
            dietaryNotes:
              nextStatus === 'declined'
                ? ''
                : patch.dietaryNotes !== undefined
                  ? patch.dietaryNotes
                  : cur.dietaryNotes,
          };
        });

        const derived = deriveSummaryFromMemberRsvps(nextMemberRsvps, activeMembers);
        const newCurrent: SubEventRsvpData = {
          ...existing.current,
          status: derived.status,
          plusOneCount: derived.plusOneCount,
          mealSelections: derived.mealSelections,
          plusOneNames: derived.plusOneNames,
          customAnswers:
            derived.status === 'declined' ? {} : { ...existing.current.customAnswers },
          memberRsvps: nextMemberRsvps,
        };

        const dirty = isRsvpDirty(newCurrent, existing.baseline);
        return {
          ...prev,
          [subEventId]: {
            ...existing,
            current: newCurrent,
            isDirty: dirty,
            state: dirty ? 'dirty' : 'idle',
            message: null,
            error: null,
            fieldErrors: {},
          },
        };
      });
    },
    []
  );

  const getRsvpState = useCallback(
    (subEventId: string): SubEventRsvpItemState => {
      return (
        eventsMap[subEventId] || {
          id: subEventId,
          baseline: createEmptyRsvpData(householdMembersRef.current),
          current: createEmptyRsvpData(householdMembersRef.current),
          state: 'idle',
          isDirty: false,
          isSubmitting: false,
          message: null,
          error: null,
          fieldErrors: {},
        }
      );
    },
    [eventsMap]
  );

  const dirtyEventIds = useMemo(() => {
    return Object.keys(eventsMap).filter((id) => eventsMap[id].isDirty);
  }, [eventsMap]);

  const dirtyCount = dirtyEventIds.length;

  const isAnySubmitting = useMemo(() => {
    if (isBatchSubmitting) return true;
    return Object.values(eventsMap).some((item) => item.isSubmitting);
  }, [isBatchSubmitting, eventsMap]);

  const submitSingle = useCallback(
    async (subEventId: string): Promise<boolean> => {
      if (inFlightSubmittingRef.current || isAnySubmitting) {
        return false;
      }

      const item = eventsMap[subEventId];
      if (!item) return false;

      const effectivePlusOneCount =
        item.current.status === 'declined' ? 0 : item.current.plusOneCount;
      const meta = eventMetaRef.current[subEventId];
      const activeMembers = householdMembersRef.current;
      const { summaryError: validationError, fieldErrors } = validateEventRsvp(
        item.current,
        effectivePlusOneCount,
        optionsRef.current?.maxPlusOnes,
        meta,
        activeMembers
      );
      if (validationError) {
        const err = new Error(validationError);
        setEventsMap((prev) => ({
          ...prev,
          [subEventId]: {
            ...prev[subEventId],
            state: 'error',
            isSubmitting: false,
            message: validationError,
            error: validationError,
            fieldErrors,
          },
        }));
        setLiveMessage(null);
        optionsRef.current?.onError?.(err);
        return false;
      }

      inFlightSubmittingRef.current = true;

      // Update state to submitting
      setEventsMap((prev) => ({
        ...prev,
        [subEventId]: {
          ...prev[subEventId],
          state: 'submitting',
          isSubmitting: true,
          message: null,
          error: null,
          fieldErrors: {},
        },
      }));

      const payloadBody = buildSubmissionPayloadItem(item, meta, activeMembers);

      try {
        const res = await fetch(withBasePath(apiEndpoint), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadBody),
        });

        const json = await res.json();
        if (!res.ok) {
          const httpErr = Object.assign(
            new Error(json.error || 'Failed to submit RSVP.'),
            { status: res.status }
          );
          throw httpErr;
        }

        const returnedRecords = Array.isArray(json.data) ? json.data : [];
        const record = returnedRecords.find((r: any) => r.subEventId === subEventId);

        const newBaseline: SubEventRsvpData = record
          ? normalizeRsvpData(
            {
              status: record.status ?? item.current.status,
              plusOneCount: record.plusOneCount ?? effectivePlusOneCount,
              dietaryNotes: record.dietaryNotes ?? item.current.dietaryNotes,
              mealSelections: record.mealSelections ?? item.current.mealSelections,
              customAnswers: record.customAnswers ?? item.current.customAnswers,
              plusOneNames: record.plusOneNames ?? item.current.plusOneNames,
              memberRsvps: record.memberRsvps ?? item.current.memberRsvps,
            },
            activeMembers
          )
          : cloneRsvpData(item.current);

        setEventsMap((prev) => ({
          ...prev,
          [subEventId]: {
            ...prev[subEventId],
            baseline: newBaseline,
            current: cloneRsvpData(newBaseline),
            state: 'success',
            isDirty: false,
            isSubmitting: false,
            message: 'RSVP submitted successfully!',
            error: null,
            fieldErrors: {},
          },
        }));

        setLiveMessage('Successfully saved RSVP.');
        optionsRef.current?.onSuccess?.(json.data);
        return true;
      } catch (err: any) {
        const errorMessage = err.message || 'Error submitting RSVP.';
        const isRsvpClosedError =
          err?.status === 403 && !/^Forbidden:\s*You do not have access/i.test(errorMessage);
        setEventsMap((prev) => ({
          ...prev,
          [subEventId]: {
            ...prev[subEventId],
            state: 'error',
            isSubmitting: false,
            message: errorMessage,
            error: errorMessage,
            fieldErrors: {},
          },
        }));
        setLiveMessage(isRsvpClosedError ? errorMessage : null);
        if (isRsvpClosedError) {
          optionsRef.current?.onRsvpClosed?.(errorMessage);
        }
        optionsRef.current?.onError?.(err);
        return false;
      } finally {
        inFlightSubmittingRef.current = false;
      }
    },
    [eventsMap, apiEndpoint, isAnySubmitting]
  );

  const submitBatch = useCallback(async (): Promise<boolean> => {
    if (inFlightSubmittingRef.current || isAnySubmitting) {
      return false;
    }

    const dirtyItems = dirtyEventIds
      .map((id) => eventsMap[id])
      .filter((item): item is SubEventRsvpItemState => Boolean(item && item.isDirty));

    if (dirtyItems.length === 0) {
      return true;
    }

    const configuredMax = optionsRef.current?.maxPlusOnes;
    const activeMembers = householdMembersRef.current;
    const invalidItems = dirtyItems
      .map((item) => {
        const effectiveCount =
          item.current.status === 'declined' ? 0 : item.current.plusOneCount;
        const meta = eventMetaRef.current[item.id];
        const { summaryError, fieldErrors } = validateEventRsvp(
          item.current,
          effectiveCount,
          configuredMax,
          meta,
          activeMembers
        );
        return {
          id: item.id,
          error: summaryError,
          fieldErrors,
        };
      })
      .filter(
        (entry): entry is { id: string; error: string; fieldErrors: Record<string, string> } =>
          Boolean(entry.error)
      );

    if (invalidItems.length > 0) {
      const firstError = invalidItems[0].error;
      setBatchError(firstError);
      setLiveMessage(null);
      setEventsMap((prev) => {
        const next = { ...prev };
        invalidItems.forEach(({ id, error, fieldErrors }) => {
          if (next[id]) {
            next[id] = {
              ...next[id],
              state: 'error',
              isSubmitting: false,
              message: error,
              error,
              fieldErrors,
            };
          }
        });
        return next;
      });
      optionsRef.current?.onError?.(new Error(firstError));
      return false;
    }

    inFlightSubmittingRef.current = true;
    setIsBatchSubmitting(true);
    setBatchError(null);
    setBatchSuccessMessage(null);

    // Transition all dirty items to submitting
    setEventsMap((prev) => {
      const next = { ...prev };
      dirtyItems.forEach((item) => {
        next[item.id] = {
          ...next[item.id],
          state: 'submitting',
          isSubmitting: true,
          message: null,
          error: null,
          fieldErrors: {},
        };
      });
      return next;
    });

    const payload: { rsvps: SubEventRsvpSubmissionItem[] } = {
      rsvps: dirtyItems.map((item) =>
        buildSubmissionPayloadItem(item, eventMetaRef.current[item.id], activeMembers)
      ),
    };

    try {
      const res = await fetch(withBasePath(apiEndpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        const httpErr = Object.assign(
          new Error(json.error || 'Failed to submit batch RSVPs.'),
          { status: res.status }
        );
        throw httpErr;
      }

      const returnedRecords: any[] = Array.isArray(json.data) ? json.data : [];

      setEventsMap((prev) => {
        const next = { ...prev };
        dirtyItems.forEach((item) => {
          const record = returnedRecords.find((r) => r.subEventId === item.id);
          const effectivePlusOnes =
            item.current.status === 'declined' ? 0 : item.current.plusOneCount;
          const newBaseline: SubEventRsvpData = record
            ? normalizeRsvpData(
              {
                status: record.status ?? item.current.status,
                plusOneCount: record.plusOneCount ?? effectivePlusOnes,
                dietaryNotes: record.dietaryNotes ?? item.current.dietaryNotes,
                mealSelections: record.mealSelections ?? item.current.mealSelections,
                customAnswers: record.customAnswers ?? item.current.customAnswers,
                plusOneNames: record.plusOneNames ?? item.current.plusOneNames,
                memberRsvps: record.memberRsvps ?? item.current.memberRsvps,
              },
              activeMembers
            )
            : cloneRsvpData(item.current);

          next[item.id] = {
            ...next[item.id],
            baseline: newBaseline,
            current: cloneRsvpData(newBaseline),
            state: 'success',
            isDirty: false,
            isSubmitting: false,
            message: 'RSVP submitted successfully!',
            error: null,
            fieldErrors: {},
          };
        });
        return next;
      });

      const count = dirtyItems.length;
      const successText = `Saved ${count} RSVP update${count === 1 ? '' : 's'}.`;
      setBatchSuccessMessage(successText);
      setLiveMessage(`Successfully saved RSVPs for ${count} event${count === 1 ? '' : 's'}.`);
      optionsRef.current?.onSuccess?.(json.data);
      return true;
    } catch (err: any) {
      const errorMessage = err.message || 'Error submitting batch RSVPs.';
      const isRsvpClosedError =
        err?.status === 403 && !/^Forbidden:\s*You do not have access/i.test(errorMessage);
      setBatchError(errorMessage);
      setLiveMessage(isRsvpClosedError ? errorMessage : null);

      setEventsMap((prev) => {
        const next = { ...prev };
        dirtyItems.forEach((item) => {
          next[item.id] = {
            ...next[item.id],
            state: 'error',
            isSubmitting: false,
            message: errorMessage,
            error: errorMessage,
            fieldErrors: {},
          };
        });
        return next;
      });

      if (isRsvpClosedError) {
        optionsRef.current?.onRsvpClosed?.(errorMessage);
      }
      optionsRef.current?.onError?.(err);
      return false;
    } finally {
      inFlightSubmittingRef.current = false;
      setIsBatchSubmitting(false);
    }
  }, [dirtyEventIds, eventsMap, apiEndpoint, isAnySubmitting]);

  return {
    getRsvpState,
    updateRsvp,
    updateMemberRsvp,
    submitSingle,
    submitBatch,
    initializeEvents,
    dirtyCount,
    isBatchSubmitting,
    isAnySubmitting,
    batchError,
    batchSuccessMessage,
    liveMessage,
  };
}
