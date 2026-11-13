'use client';

import { useState, useCallback, useMemo, useRef } from 'react';
import type { SubEventRsvpSubmissionItem } from '@/features/sub-events';

export type EventRsvpFiniteState = 'idle' | 'dirty' | 'submitting' | 'success' | 'error';

export interface SubEventRsvpData {
  status: 'attending' | 'declined' | 'pending';
  plusOneCount: number;
  dietaryNotes: string;
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

export interface UseScheduleRsvpManagerOptions {
  initialEvents?: Array<{
    id: string;
    title?: string;
    userRsvp?: Partial<SubEventRsvpData> | null;
  }>;
  apiEndpoint?: string;
  onSuccess?: (_updatedRsvps: any[]) => void;
  onError?: (_error: Error) => void;
}

function normalizeRsvpData(userRsvp?: Partial<SubEventRsvpData> | null): SubEventRsvpData {
  return {
    status: userRsvp?.status || 'pending',
    plusOneCount: Math.max(0, userRsvp?.plusOneCount ?? 0),
    dietaryNotes: (userRsvp?.dietaryNotes ?? '').trim(),
  };
}

function isRsvpDirty(current: SubEventRsvpData, baseline: SubEventRsvpData): boolean {
  return (
    current.status !== baseline.status ||
    current.plusOneCount !== baseline.plusOneCount ||
    current.dietaryNotes.trim() !== baseline.dietaryNotes.trim()
  );
}

export function useScheduleRsvpManager(options?: UseScheduleRsvpManagerOptions) {
  const apiEndpoint = options?.apiEndpoint || '/api/rsvp';
  const [eventsMap, setEventsMap] = useState<Record<string, SubEventRsvpItemState>>(() => {
    const map: Record<string, SubEventRsvpItemState> = {};
    if (options?.initialEvents) {
      options.initialEvents.forEach((ev) => {
        const baseline = normalizeRsvpData(ev.userRsvp);
        map[ev.id] = {
          id: ev.id,
          baseline,
          current: { ...baseline },
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
  optionsRef.current = options;

  const initializeEvents = useCallback(
    (events: Array<{ id: string; title?: string; userRsvp?: Partial<SubEventRsvpData> | null }>) => {
      setEventsMap((prev) => {
        const next = { ...prev };
        events.forEach((ev) => {
          const newBaseline = normalizeRsvpData(ev.userRsvp);
          const existing = prev[ev.id];
          if (!existing) {
            next[ev.id] = {
              id: ev.id,
              baseline: newBaseline,
              current: { ...newBaseline },
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
                current: { ...newBaseline },
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
      setBatchError(null);
      setBatchSuccessMessage(null);

      setEventsMap((prev) => {
        const existing = prev[subEventId] || {
          id: subEventId,
          baseline: { status: 'pending', plusOneCount: 0, dietaryNotes: '' },
          current: { status: 'pending', plusOneCount: 0, dietaryNotes: '' },
          state: 'idle',
          isDirty: false,
          isSubmitting: false,
          message: null,
          error: null,
        };

        const newCurrent: SubEventRsvpData = {
          ...existing.current,
          ...updates,
          plusOneCount:
            updates.plusOneCount !== undefined
              ? Math.max(0, updates.plusOneCount)
              : existing.current.plusOneCount,
        };

        const dirty = isRsvpDirty(newCurrent, existing.baseline);

        return {
          ...prev,
          [subEventId]: {
            ...existing,
            current: newCurrent,
            isDirty: dirty,
            state: dirty ? 'dirty' : 'idle',
            // Requirement 6: Clear stale status banners whenever the user modifies event details
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
          baseline: { status: 'pending', plusOneCount: 0, dietaryNotes: '' },
          current: { status: 'pending', plusOneCount: 0, dietaryNotes: '' },
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
    setEventsMap((prev) => {
      const next = { ...prev };
      if (subEventId) {
        const item = prev[subEventId];
        if (item) {
          next[subEventId] = {
            ...item,
            current: { ...item.baseline },
            state: 'idle',
            isDirty: false,
            message: null,
            error: null,
          };
        }
      } else {
        Object.keys(next).forEach((id) => {
          next[id] = {
            ...next[id],
            current: { ...next[id].baseline },
            state: 'idle',
            isDirty: false,
            message: null,
            error: null,
          };
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

      try {
        const res = await fetch(apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subEventId,
            status: item.current.status,
            plusOneCount: item.current.plusOneCount,
            dietaryNotes: item.current.dietaryNotes,
          }),
        });

        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || 'Failed to submit RSVP.');
        }

        const returnedRecords = Array.isArray(json.data) ? json.data : [];
        const record = returnedRecords.find((r: any) => r.subEventId === subEventId);

        const newBaseline: SubEventRsvpData = record
          ? {
            status: record.status,
            plusOneCount: record.plusOneCount ?? item.current.plusOneCount,
            dietaryNotes: record.dietaryNotes ?? item.current.dietaryNotes,
          }
          : { ...item.current };

        setEventsMap((prev) => ({
          ...prev,
          [subEventId]: {
            ...prev[subEventId],
            baseline: newBaseline,
            current: { ...newBaseline },
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
        setEventsMap((prev) => ({
          ...prev,
          [subEventId]: {
            ...prev[subEventId],
            state: 'error',
            isSubmitting: false,
            // Pending user edits preserved in item.current
            message: errorMessage,
            error: errorMessage,
          },
        }));
        setLiveMessage(`Failed to save RSVP: ${errorMessage}`);
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
      rsvps: dirtyItems.map((item) => ({
        subEventId: item.id,
        status: item.current.status,
        plusOneCount: item.current.plusOneCount,
        dietaryNotes: item.current.dietaryNotes,
      })),
    };

    try {
      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to submit batch RSVPs.');
      }

      const returnedRecords: any[] = Array.isArray(json.data) ? json.data : [];

      setEventsMap((prev) => {
        const next = { ...prev };
        dirtyItems.forEach((item) => {
          const record = returnedRecords.find((r) => r.subEventId === item.id);
          const newBaseline: SubEventRsvpData = record
            ? {
              status: record.status,
              plusOneCount: record.plusOneCount ?? item.current.plusOneCount,
              dietaryNotes: record.dietaryNotes ?? item.current.dietaryNotes,
            }
            : { ...item.current };

          next[item.id] = {
            ...next[item.id],
            baseline: newBaseline,
            current: { ...newBaseline },
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
      setBatchError(errorMessage);
      setLiveMessage(`Failed to save RSVPs: ${errorMessage}. Please try again.`);

      setEventsMap((prev) => {
        const next = { ...prev };
        dirtyItems.forEach((item) => {
          next[item.id] = {
            ...next[item.id],
            state: 'error',
            isSubmitting: false,
            // Pending user edits preserved
            message: errorMessage,
            error: errorMessage,
          };
        });
        return next;
      });

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
