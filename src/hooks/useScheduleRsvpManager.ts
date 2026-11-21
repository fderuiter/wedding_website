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
  HouseholdMemberEventRsvp,
} from '@/features/sub-events';

export type EventRsvpFiniteState = 'idle' | 'dirty' | 'submitting' | 'success' | 'error';

export interface SubEventRsvpData {
  status: 'attending' | 'declined' | 'pending';
  plusOneCount: number;
  dietaryNotes: string;
  mealSelections: string[];
  customAnswers: Record<string, string>;
  plusOneNames: string[];
}

export interface HouseholdMemberSubEventState {
  invitationCodeId: string;
  guestName: string;
  plusOneAllocations: number;
  savedPlusOneNames: string[];
  baseline: SubEventRsvpData;
  current: SubEventRsvpData;
  isDirty: boolean;
}

export interface SubEventRsvpItemState {
  id: string;
  baseline: SubEventRsvpData;
  current: SubEventRsvpData;
  members?: Record<string, HouseholdMemberSubEventState>;
  memberOrder?: string[];
  state: EventRsvpFiniteState;
  isDirty: boolean;
  isSubmitting: boolean;
  message: string | null;
  error: string | null;
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
  householdRsvps?: HouseholdMemberEventRsvp[];
}

export interface UseScheduleRsvpManagerOptions {
  initialEvents?: ScheduleRsvpEventInit[];
  maxPlusOnes?: number | null;
  defaultPlusOneNames?: string[] | null;
  apiEndpoint?: string;
  onSuccess?: (_updatedRsvps: any[]) => void;
  onError?: (_error: Error) => void;
  onRsvpClosed?: (_message: string) => void;
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

function getEventPromptValidationError(
  current: SubEventRsvpData,
  effectivePlusOneCount: number,
  meta?: EventPromptMeta
): string | null {
  if (current.status !== 'attending' || !meta) {
    return null;
  }

  if (meta.mealOptions.length > 0) {
    const validMealIds = new Set(meta.mealOptions.map((m) => m.id));
    const expectedPartySize = 1 + effectivePlusOneCount;
    for (let idx = 0; idx < expectedPartySize; idx++) {
      const selectedId = (current.mealSelections[idx] ?? '').trim();
      if (!selectedId || !validMealIds.has(selectedId)) {
        if (expectedPartySize === 1) {
          return 'Please select an entrée option before saving.';
        }
        return `Please select an entrée option for all ${expectedPartySize} attending guests.`;
      }
    }
  }

  if (meta.customQuestions.length > 0) {
    for (const question of meta.customQuestions) {
      const answer = (current.customAnswers[question.id] ?? '').trim();
      if (question.required && !answer) {
        return `Please answer required question: "${question.prompt}".`;
      }
      if (answer && question.type === 'choice' && !question.options.includes(answer)) {
        return `Please choose a valid option for "${question.prompt}".`;
      }
    }
  }

  return null;
}

function cloneRsvpData(data: SubEventRsvpData): SubEventRsvpData {
  return {
    status: data.status,
    plusOneCount: data.plusOneCount,
    dietaryNotes: data.dietaryNotes,
    mealSelections: [...data.mealSelections],
    customAnswers: { ...data.customAnswers },
    plusOneNames: [...data.plusOneNames],
  };
}

function createEmptyRsvpData(): SubEventRsvpData {
  return {
    status: 'pending',
    plusOneCount: 0,
    dietaryNotes: '',
    mealSelections: [],
    customAnswers: {},
    plusOneNames: [],
  };
}

function normalizeRsvpData(userRsvp?: Partial<SubEventRsvpData> | null): SubEventRsvpData {
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

function isRsvpDirty(current: SubEventRsvpData, baseline: SubEventRsvpData): boolean {
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
  meta?: EventPromptMeta
): SubEventRsvpSubmissionItem {
  const isDeclined = item.current.status === 'declined';
  const effectivePlusOneCount = isDeclined ? 0 : item.current.plusOneCount;

  const payloadItem: SubEventRsvpSubmissionItem = {
    subEventId: item.id,
    status: item.current.status,
    plusOneCount: effectivePlusOneCount,
    dietaryNotes: item.current.dietaryNotes,
  };

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

function buildMemberSubmissionPayloadItem(
  subEventId: string,
  member: HouseholdMemberSubEventState,
  meta?: EventPromptMeta
): SubEventRsvpSubmissionItem {
  const isDeclined = member.current.status === 'declined';
  const effectivePlusOneCount = isDeclined ? 0 : member.current.plusOneCount;

  const payloadItem: SubEventRsvpSubmissionItem = {
    subEventId,
    invitationCodeId: member.invitationCodeId,
    status: member.current.status,
    plusOneCount: effectivePlusOneCount,
    dietaryNotes: member.current.dietaryNotes,
  };

  const hasMealsConfigured = (meta?.mealOptions.length ?? 0) > 0;
  const hasMealValues =
    member.current.mealSelections.some((s) => s.trim().length > 0) ||
    member.baseline.mealSelections.some((s) => s.trim().length > 0);
  if (hasMealsConfigured || hasMealValues) {
    payloadItem.mealSelections = isDeclined
      ? []
      : member.current.mealSelections
        .slice(0, 1 + effectivePlusOneCount)
        .map((s) => s.trim());
  }

  const hasQuestionsConfigured = (meta?.customQuestions.length ?? 0) > 0;
  const hasAnswerValues =
    Object.values(member.current.customAnswers).some((v) => v.trim().length > 0) ||
    Object.values(member.baseline.customAnswers).some((v) => v.trim().length > 0);
  if (hasQuestionsConfigured || hasAnswerValues) {
    payloadItem.customAnswers = isDeclined
      ? {}
      : normalizeCustomAnswers(member.current.customAnswers);
  }

  const hasPlusOneNames =
    member.current.plusOneNames.some((n) => n.trim().length > 0) ||
    member.baseline.plusOneNames.some((n) => n.trim().length > 0);
  if (hasPlusOneNames) {
    payloadItem.plusOneNames =
      isDeclined || effectivePlusOneCount === 0
        ? []
        : member.current.plusOneNames
          .slice(0, effectivePlusOneCount)
          .map((s) => s.trim());
  }

  return payloadItem;
}

function buildHouseholdMembersState(
  householdRsvps?: HouseholdMemberEventRsvp[],
  existingMembers?: Record<string, HouseholdMemberSubEventState>
): {
  members?: Record<string, HouseholdMemberSubEventState>;
  memberOrder?: string[];
  anyMemberDirty: boolean;
} {
  if (!Array.isArray(householdRsvps)) {
    return { anyMemberDirty: false };
  }

  const members: Record<string, HouseholdMemberSubEventState> = {};
  const memberOrder: string[] = [];
  let anyMemberDirty = false;

  for (const hm of householdRsvps) {
    const id = hm.invitationCodeId;
    memberOrder.push(id);
    const baseline = normalizeRsvpData(hm.userRsvp);
    const prevMember = existingMembers?.[id];
    if (prevMember && prevMember.isDirty) {
      const stillDirty = isRsvpDirty(prevMember.current, baseline);
      if (stillDirty) anyMemberDirty = true;
      members[id] = {
        invitationCodeId: id,
        guestName: hm.guestName,
        plusOneAllocations: Math.max(0, hm.plusOneAllocations ?? 0),
        savedPlusOneNames: Array.isArray(hm.savedPlusOneNames) ? [...hm.savedPlusOneNames] : [],
        baseline,
        current: cloneRsvpData(prevMember.current),
        isDirty: stillDirty,
      };
    } else {
      members[id] = {
        invitationCodeId: id,
        guestName: hm.guestName,
        plusOneAllocations: Math.max(0, hm.plusOneAllocations ?? 0),
        savedPlusOneNames: Array.isArray(hm.savedPlusOneNames) ? [...hm.savedPlusOneNames] : [],
        baseline,
        current: cloneRsvpData(baseline),
        isDirty: false,
      };
    }
  }

  return { members, memberOrder, anyMemberDirty };
}

export function useScheduleRsvpManager(options?: UseScheduleRsvpManagerOptions) {
  const apiEndpoint = options?.apiEndpoint || '/api/rsvp';
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
        const baseline = normalizeRsvpData(ev.userRsvp);
        const hh = buildHouseholdMembersState(ev.householdRsvps);
        map[ev.id] = {
          id: ev.id,
          baseline,
          current: cloneRsvpData(baseline),
          ...(hh.members ? { members: hh.members, memberOrder: hh.memberOrder } : {}),
          state: 'idle',
          isDirty: false,
          isSubmitting: false,
          message: null,
          error: null,
        };
      });
    }
    return map;
  });

  const [isBatchSubmitting, setIsBatchSubmitting] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchSuccessMessage, setBatchSuccessMessage] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState<string | null>(null);

  // Keep options in a ref to avoid recreating callbacks
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const initializeEvents = useCallback((events: ScheduleRsvpEventInit[]) => {
    events.forEach((ev) => {
      if (ev.isReadOnly) {
        delete eventMetaRef.current[ev.id];
        return;
      }
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
        const newBaseline = normalizeRsvpData(ev.userRsvp);
        const existing = prev[ev.id];
        const hh = buildHouseholdMembersState(ev.householdRsvps, existing?.members);
        if (!existing) {
          next[ev.id] = {
            id: ev.id,
            baseline: newBaseline,
            current: cloneRsvpData(newBaseline),
            ...(hh.members ? { members: hh.members, memberOrder: hh.memberOrder } : {}),
            state: 'idle',
            isDirty: false,
            isSubmitting: false,
            message: null,
            error: null,
          };
        } else if (hh.members) {
          next[ev.id] = {
            ...existing,
            baseline: newBaseline,
            current: existing.isDirty ? existing.current : cloneRsvpData(newBaseline),
            members: hh.members,
            memberOrder: hh.memberOrder,
            isDirty: hh.anyMemberDirty,
            state: hh.anyMemberDirty ? 'dirty' : 'idle',
            ...(hh.anyMemberDirty ? {} : { isSubmitting: false, message: null, error: null }),
          };
        } else {
          // If existing item is dirty, preserve user's pending edits but update baseline
          if (existing.isDirty) {
            const dirty = isRsvpDirty(existing.current, newBaseline);
            next[ev.id] = {
              ...existing,
              baseline: newBaseline,
              members: undefined,
              memberOrder: undefined,
              isDirty: dirty,
              state: dirty ? 'dirty' : 'idle',
            };
          } else {
            // Not dirty, sync both baseline and current
            next[ev.id] = {
              ...existing,
              baseline: newBaseline,
              current: cloneRsvpData(newBaseline),
              members: undefined,
              memberOrder: undefined,
              state: 'idle',
              isDirty: false,
              isSubmitting: false,
              message: null,
              error: null,
            };
          }
        }
      });
      return next;
    });
  }, []);

  const updateRsvp = useCallback(
    (subEventId: string, updates: Partial<SubEventRsvpData>) => {
      setBatchError(null);
      setBatchSuccessMessage(null);

      setEventsMap((prev) => {
        const existing = prev[subEventId] || {
          id: subEventId,
          baseline: createEmptyRsvpData(),
          current: createEmptyRsvpData(),
          state: 'idle' as const,
          isDirty: false,
          isSubmitting: false,
          message: null,
          error: null,
        };

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
          } else {
            const baseNames = existing.current.plusOneNames.slice(0, nextPlusOnes);
            const defaults = optionsRef.current?.defaultPlusOneNames;
            if (Array.isArray(defaults) && defaults.length > 0) {
              for (let idx = baseNames.length; idx < nextPlusOnes; idx++) {
                if (defaults[idx]) {
                  baseNames[idx] = defaults[idx];
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

        return {
          ...prev,
          [subEventId]: {
            ...existing,
            current: newCurrent,
            isDirty: dirty,
            state: dirty ? 'dirty' : 'idle',
            // Clear stale status banners whenever the user modifies event details
            message: null,
            error: null,
          },
        };
      });
    },
    []
  );

  const updateMemberRsvp = useCallback(
    (subEventId: string, invitationCodeId: string, updates: Partial<SubEventRsvpData>) => {
      setBatchError(null);
      setBatchSuccessMessage(null);

      setEventsMap((prev) => {
        const existing = prev[subEventId];
        if (!existing || !existing.members || !existing.members[invitationCodeId]) {
          return prev;
        }

        const member = existing.members[invitationCodeId];
        const nextStatus = updates.status ?? member.current.status;
        const memberMaxPlusOnes = member.plusOneAllocations;
        let nextPlusOnes = member.current.plusOneCount;
        if (nextStatus === 'declined') {
          nextPlusOnes = 0;
        } else if (updates.plusOneCount !== undefined) {
          nextPlusOnes = memberMaxPlusOnes === 0 ? 0 : Math.max(0, updates.plusOneCount);
        } else if (memberMaxPlusOnes === 0) {
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
              : [...member.current.mealSelections];
          nextMealSelections = rawMeals.slice(0, 1 + nextPlusOnes);

          if (nextPlusOnes === 0) {
            nextPlusOneNames = [];
          } else if (updates.plusOneNames !== undefined) {
            nextPlusOneNames = updates.plusOneNames.slice(0, nextPlusOnes);
          } else {
            const baseNames = member.current.plusOneNames.slice(0, nextPlusOnes);
            if (member.savedPlusOneNames.length > 0) {
              for (let idx = baseNames.length; idx < nextPlusOnes; idx++) {
                if (member.savedPlusOneNames[idx]) {
                  baseNames[idx] = member.savedPlusOneNames[idx];
                }
              }
            }
            nextPlusOneNames = baseNames;
          }

          nextCustomAnswers =
            updates.customAnswers !== undefined
              ? { ...updates.customAnswers }
              : { ...member.current.customAnswers };
        }

        const nextMemberCurrent: SubEventRsvpData = {
          ...member.current,
          ...updates,
          status: nextStatus,
          plusOneCount: nextPlusOnes,
          mealSelections: nextMealSelections,
          customAnswers: nextCustomAnswers,
          plusOneNames: nextPlusOneNames,
        };

        const memberDirty = isRsvpDirty(nextMemberCurrent, member.baseline);
        const nextMembers: Record<string, HouseholdMemberSubEventState> = {
          ...existing.members,
          [invitationCodeId]: {
            ...member,
            current: nextMemberCurrent,
            isDirty: memberDirty,
          },
        };
        const order = existing.memberOrder || Object.keys(nextMembers);
        const anyDirty = order.some((mId) => nextMembers[mId]?.isDirty);

        return {
          ...prev,
          [subEventId]: {
            ...existing,
            members: nextMembers,
            isDirty: anyDirty,
            state: anyDirty ? 'dirty' : 'idle',
            message: null,
            error: null,
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
          baseline: createEmptyRsvpData(),
          current: createEmptyRsvpData(),
          state: 'idle',
          isDirty: false,
          isSubmitting: false,
          message: null,
          error: null,
        }
      );
    },
    [eventsMap]
  );

  const resetRsvp = useCallback((subEventId?: string) => {
    const resetItem = (item: SubEventRsvpItemState): SubEventRsvpItemState => {
      let nextMembers: Record<string, HouseholdMemberSubEventState> | undefined;
      if (item.members) {
        nextMembers = {};
        for (const [mId, member] of Object.entries(item.members)) {
          nextMembers[mId] = {
            ...member,
            current: cloneRsvpData(member.baseline),
            isDirty: false,
          };
        }
      }
      return {
        ...item,
        current: cloneRsvpData(item.baseline),
        ...(nextMembers ? { members: nextMembers } : {}),
        state: 'idle',
        isDirty: false,
        message: null,
        error: null,
      };
    };

    setEventsMap((prev) => {
      const next = { ...prev };
      if (subEventId) {
        const item = prev[subEventId];
        if (item) {
          next[subEventId] = resetItem(item);
        }
      } else {
        Object.keys(next).forEach((id) => {
          next[id] = resetItem(next[id]);
        });
      }
      return next;
    });
    setBatchError(null);
    setBatchSuccessMessage(null);
  }, []);

  const dirtyEventIds = useMemo(() => {
    return Object.keys(eventsMap).filter((id) => eventsMap[id].isDirty);
  }, [eventsMap]);

  const dirtyCount = dirtyEventIds.length;
  const isDirty = dirtyCount > 0;

  const isAnySubmitting = useMemo(() => {
    if (isBatchSubmitting) return true;
    return Object.values(eventsMap).some((item) => item.isSubmitting);
  }, [isBatchSubmitting, eventsMap]);

  const submitSingle = useCallback(
    async (subEventId: string): Promise<boolean> => {
      const item = eventsMap[subEventId];
      if (!item) return false;

      const meta = eventMetaRef.current[subEventId];
      const hasHouseholdMembers = Boolean(item.members && item.memberOrder && item.memberOrder.length > 0);

      let validationError: string | null = null;
      if (hasHouseholdMembers && item.members && item.memberOrder) {
        for (const mId of item.memberOrder) {
          const member = item.members[mId];
          if (!member) continue;
          const effectiveMemberPlusOnes =
            member.current.status === 'declined' ? 0 : member.current.plusOneCount;
          const memberErr =
            getPlusOneValidationError(effectiveMemberPlusOnes, member.plusOneAllocations) ||
            getEventPromptValidationError(member.current, effectiveMemberPlusOnes, meta);
          if (memberErr) {
            validationError = `${member.guestName}: ${memberErr}`;
            break;
          }
        }
      } else {
        const effectivePlusOneCount =
          item.current.status === 'declined' ? 0 : item.current.plusOneCount;
        validationError =
          getPlusOneValidationError(effectivePlusOneCount, optionsRef.current?.maxPlusOnes) ||
          getEventPromptValidationError(item.current, effectivePlusOneCount, meta);
      }

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
          },
        }));
        setLiveMessage(`Failed to save RSVP: ${validationError}`);
        optionsRef.current?.onError?.(err);
        return false;
      }

      // Update state to submitting
      setEventsMap((prev) => ({
        ...prev,
        [subEventId]: {
          ...prev[subEventId],
          state: 'submitting',
          isSubmitting: true,
          message: null,
          error: null,
        },
      }));

      const payloadBody =
        hasHouseholdMembers && item.members && item.memberOrder
          ? {
            rsvps: item.memberOrder
              .map((mId) => item.members![mId])
              .filter(Boolean)
              .map((member) => buildMemberSubmissionPayloadItem(subEventId, member, meta)),
          }
          : buildSubmissionPayloadItem(item, meta);

      try {
        const res = await fetch(apiEndpoint, {
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

        if (hasHouseholdMembers && item.members && item.memberOrder) {
          setEventsMap((prev) => {
            const currentEvent = prev[subEventId];
            if (!currentEvent || !currentEvent.members || !currentEvent.memberOrder) return prev;
            const nextMembers: Record<string, HouseholdMemberSubEventState> = {};
            for (const mId of currentEvent.memberOrder) {
              const member = currentEvent.members[mId];
              if (!member) continue;
              const rec = returnedRecords.find(
                (r: any) => r.subEventId === subEventId && r.invitationCodeId === mId
              );
              const effPlusOnes =
                member.current.status === 'declined' ? 0 : member.current.plusOneCount;
              const memberNewBaseline = rec
                ? normalizeRsvpData({
                  status: rec.status ?? member.current.status,
                  plusOneCount: rec.plusOneCount ?? effPlusOnes,
                  dietaryNotes: rec.dietaryNotes ?? member.current.dietaryNotes,
                  mealSelections: rec.mealSelections ?? member.current.mealSelections,
                  customAnswers: rec.customAnswers ?? member.current.customAnswers,
                  plusOneNames: rec.plusOneNames ?? member.current.plusOneNames,
                })
                : cloneRsvpData(member.current);
              nextMembers[mId] = {
                ...member,
                baseline: memberNewBaseline,
                current: cloneRsvpData(memberNewBaseline),
                isDirty: false,
              };
            }
            return {
              ...prev,
              [subEventId]: {
                ...currentEvent,
                members: nextMembers,
                state: 'success',
                isDirty: false,
                isSubmitting: false,
                message: 'RSVP submitted successfully!',
                error: null,
              },
            };
          });
        } else {
          const effectivePlusOneCount =
            item.current.status === 'declined' ? 0 : item.current.plusOneCount;
          const record = returnedRecords.find((r: any) => r.subEventId === subEventId);

          const newBaseline: SubEventRsvpData = record
            ? normalizeRsvpData({
              status: record.status ?? item.current.status,
              plusOneCount: record.plusOneCount ?? effectivePlusOneCount,
              dietaryNotes: record.dietaryNotes ?? item.current.dietaryNotes,
              mealSelections: record.mealSelections ?? item.current.mealSelections,
              customAnswers: record.customAnswers ?? item.current.customAnswers,
              plusOneNames: record.plusOneNames ?? item.current.plusOneNames,
            })
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
            },
          }));
        }

        setLiveMessage('Successfully saved RSVP.');
        optionsRef.current?.onSuccess?.(json.data);
        return true;
      } catch (err: any) {
        const errorMessage = err.message || 'Error submitting RSVP.';
        const isRsvpClosedError =
          err?.status === 403 && !/^Forbidden:/i.test(errorMessage);
        setEventsMap((prev) => ({
          ...prev,
          [subEventId]: {
            ...prev[subEventId],
            state: 'error',
            isSubmitting: false,
            message: errorMessage,
            error: errorMessage,
          },
        }));
        setLiveMessage(
          isRsvpClosedError ? errorMessage : `Failed to save RSVP: ${errorMessage}`
        );
        if (isRsvpClosedError) {
          optionsRef.current?.onRsvpClosed?.(errorMessage);
        }
        optionsRef.current?.onError?.(err);
        return false;
      }
    },
    [eventsMap, apiEndpoint]
  );

  const submitBatch = useCallback(async (): Promise<boolean> => {
    const dirtyItems = dirtyEventIds
      .map((id) => eventsMap[id])
      .filter((item): item is SubEventRsvpItemState => Boolean(item && item.isDirty));

    if (dirtyItems.length === 0) {
      return true;
    }

    const configuredMax = optionsRef.current?.maxPlusOnes;
    const invalidItems = dirtyItems
      .map((item) => {
        const meta = eventMetaRef.current[item.id];
        if (item.members && item.memberOrder && item.memberOrder.length > 0) {
          for (const mId of item.memberOrder) {
            const member = item.members[mId];
            if (!member) continue;
            const effCount =
              member.current.status === 'declined' ? 0 : member.current.plusOneCount;
            const memberErr =
              getPlusOneValidationError(effCount, member.plusOneAllocations) ||
              getEventPromptValidationError(member.current, effCount, meta);
            if (memberErr) {
              return { id: item.id, error: `${member.guestName}: ${memberErr}` };
            }
          }
          return { id: item.id, error: null };
        }
        const effectiveCount =
          item.current.status === 'declined' ? 0 : item.current.plusOneCount;
        return {
          id: item.id,
          error:
            getPlusOneValidationError(effectiveCount, configuredMax) ||
            getEventPromptValidationError(item.current, effectiveCount, meta),
        };
      })
      .filter((entry): entry is { id: string; error: string } => Boolean(entry.error));

    if (invalidItems.length > 0) {
      const firstError = invalidItems[0].error;
      setBatchError(firstError);
      setLiveMessage(`Failed to save RSVPs: ${firstError}`);
      setEventsMap((prev) => {
        const next = { ...prev };
        invalidItems.forEach(({ id, error }) => {
          if (next[id]) {
            next[id] = {
              ...next[id],
              state: 'error',
              isSubmitting: false,
              message: error,
              error,
            };
          }
        });
        return next;
      });
      optionsRef.current?.onError?.(new Error(firstError));
      return false;
    }

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
        };
      });
      return next;
    });

    const batchSubmissions: SubEventRsvpSubmissionItem[] = [];
    for (const item of dirtyItems) {
      const meta = eventMetaRef.current[item.id];
      if (item.members && item.memberOrder && item.memberOrder.length > 0) {
        for (const mId of item.memberOrder) {
          const member = item.members[mId];
          if (member) {
            batchSubmissions.push(buildMemberSubmissionPayloadItem(item.id, member, meta));
          }
        }
      } else {
        batchSubmissions.push(buildSubmissionPayloadItem(item, meta));
      }
    }

    const payload: { rsvps: SubEventRsvpSubmissionItem[] } = {
      rsvps: batchSubmissions,
    };

    try {
      const res = await fetch(apiEndpoint, {
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
          const currentItem = next[item.id];
          if (!currentItem) return;

          if (currentItem.members && currentItem.memberOrder && currentItem.memberOrder.length > 0) {
            const nextMembers: Record<string, HouseholdMemberSubEventState> = {};
            for (const mId of currentItem.memberOrder) {
              const member = currentItem.members[mId];
              if (!member) continue;
              const rec = returnedRecords.find(
                (r) => r.subEventId === item.id && r.invitationCodeId === mId
              );
              const effPlusOnes =
                member.current.status === 'declined' ? 0 : member.current.plusOneCount;
              const memberNewBaseline = rec
                ? normalizeRsvpData({
                  status: rec.status ?? member.current.status,
                  plusOneCount: rec.plusOneCount ?? effPlusOnes,
                  dietaryNotes: rec.dietaryNotes ?? member.current.dietaryNotes,
                  mealSelections: rec.mealSelections ?? member.current.mealSelections,
                  customAnswers: rec.customAnswers ?? member.current.customAnswers,
                  plusOneNames: rec.plusOneNames ?? member.current.plusOneNames,
                })
                : cloneRsvpData(member.current);
              nextMembers[mId] = {
                ...member,
                baseline: memberNewBaseline,
                current: cloneRsvpData(memberNewBaseline),
                isDirty: false,
              };
            }
            next[item.id] = {
              ...currentItem,
              members: nextMembers,
              state: 'success',
              isDirty: false,
              isSubmitting: false,
              message: 'RSVP submitted successfully!',
              error: null,
            };
          } else {
            const record = returnedRecords.find((r) => r.subEventId === item.id);
            const effectivePlusOnes =
              item.current.status === 'declined' ? 0 : item.current.plusOneCount;
            const newBaseline: SubEventRsvpData = record
              ? normalizeRsvpData({
                status: record.status ?? item.current.status,
                plusOneCount: record.plusOneCount ?? effectivePlusOnes,
                dietaryNotes: record.dietaryNotes ?? item.current.dietaryNotes,
                mealSelections: record.mealSelections ?? item.current.mealSelections,
                customAnswers: record.customAnswers ?? item.current.customAnswers,
                plusOneNames: record.plusOneNames ?? item.current.plusOneNames,
              })
              : cloneRsvpData(item.current);

            next[item.id] = {
              ...currentItem,
              baseline: newBaseline,
              current: cloneRsvpData(newBaseline),
              state: 'success',
              isDirty: false,
              isSubmitting: false,
              message: 'RSVP submitted successfully!',
              error: null,
            };
          }
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
        err?.status === 403 && !/^Forbidden:/i.test(errorMessage);
      setBatchError(errorMessage);
      setLiveMessage(
        isRsvpClosedError
          ? errorMessage
          : `Failed to save RSVPs: ${errorMessage}. Please try again.`
      );

      setEventsMap((prev) => {
        const next = { ...prev };
        dirtyItems.forEach((item) => {
          next[item.id] = {
            ...next[item.id],
            state: 'error',
            isSubmitting: false,
            message: errorMessage,
            error: errorMessage,
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
      setIsBatchSubmitting(false);
    }
  }, [dirtyEventIds, eventsMap, apiEndpoint]);

  const clearLiveMessage = useCallback(() => {
    setLiveMessage(null);
  }, []);

  return {
    eventsMap,
    getRsvpState,
    updateRsvp,
    updateMemberRsvp,
    submitSingle,
    submitBatch,
    initializeEvents,
    resetRsvp,
    dirtyCount,
    dirtyEventIds,
    isDirty,
    isBatchSubmitting,
    isAnySubmitting,
    batchError,
    batchSuccessMessage,
    liveMessage,
    clearLiveMessage,
  };
}
