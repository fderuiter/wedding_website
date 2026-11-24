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

export interface SubEventRsvpData {
  status: 'attending' | 'declined' | 'pending';
  plusOneCount: number;
  dietaryNotes: string;
  mealSelections: string[];
  customAnswers: Record<string, string>;
  plusOneNames: string[];
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

    for (let pIdx = 0; pIdx < effectivePlusOneCount; pIdx++) {
      if (!(current.plusOneNames[pIdx] ?? '').trim()) {
        return effectivePlusOneCount === 1
          ? 'Please enter the full name for your attending plus-one guest.'
          : `Please enter full names for all ${effectivePlusOneCount} attending plus-one guests.`;
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
        const baseline = normalizeRsvpData(ev.userRsvp);
        map[ev.id] = {
          id: ev.id,
          baseline,
          current: cloneRsvpData(baseline),
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
    (events: ScheduleRsvpEventInit[], defaultNamesOverride?: string[] | null) => {
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
          const newBaseline = normalizeRsvpData(ev.userRsvp);
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
              };
            }
          }
        }

        return nextMap;
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
      const item = eventsMap[subEventId];
      if (!item) return false;

      const effectivePlusOneCount =
        item.current.status === 'declined' ? 0 : item.current.plusOneCount;
      const meta = eventMetaRef.current[subEventId];
      const validationError =
        getStatusValidationError(item.current.status) ||
        getPlusOneValidationError(effectivePlusOneCount, optionsRef.current?.maxPlusOnes) ||
        getEventPromptValidationError(item.current, effectivePlusOneCount, meta);
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

      const payloadBody = buildSubmissionPayloadItem(item, meta);

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
        const effectiveCount =
          item.current.status === 'declined' ? 0 : item.current.plusOneCount;
        const meta = eventMetaRef.current[item.id];
        return {
          id: item.id,
          error:
            getStatusValidationError(item.current.status) ||
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

    const payload: { rsvps: SubEventRsvpSubmissionItem[] } = {
      rsvps: dirtyItems.map((item) =>
        buildSubmissionPayloadItem(item, eventMetaRef.current[item.id])
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
            ...next[item.id],
            baseline: newBaseline,
            current: cloneRsvpData(newBaseline),
            state: 'success',
            isDirty: false,
            isSubmitting: false,
            message: 'RSVP submitted successfully!',
            error: null,
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

  return {
    getRsvpState,
    updateRsvp,
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
