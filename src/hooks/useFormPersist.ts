'use client';

import { useState, useEffect, useCallback } from 'react';

export interface UseFormPersistOptions {
  enabled?: boolean;
  debounceMs?: number;
}

function readPersistedValue<T>(
  key: string,
  initialValues: T,
  enabled: boolean,
  fallbackValue: T,
  isKeyChange = false
): T {
  if (!enabled || typeof window === 'undefined') {
    return fallbackValue;
  }
  try {
    const saved = window.sessionStorage.getItem(key);
    if (saved !== null) {
      const parsed = JSON.parse(saved);
      if (
        typeof initialValues === 'object' &&
        initialValues !== null &&
        !Array.isArray(initialValues) &&
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        return { ...initialValues, ...parsed };
      }
      return parsed;
    }
    return initialValues;
  } catch (err) {
    console.warn(
      `useFormPersist: Failed to read ${isKeyChange ? 'changed ' : ''}key "${key}" from sessionStorage:`,
      err
    );
    return fallbackValue;
  }
}

/**
 * Reusable React hook that synchronizes draft form state to browser sessionStorage
 * under a specified component key.
 *
 * Automatically restores draft state on mount or Error Boundary recovery,
 * and provides a clearPersistedState method to wipe storage upon successful submission.
 */
export function useFormPersist<T>(
  key: string,
  initialValues: T,
  options: UseFormPersistOptions = {}
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const { enabled = true, debounceMs = 0 } = options;

  // Initialize state from sessionStorage if available, falling back to initialValues
  const [entry, setEntry] = useState<{ key: string; value: T }>(() => ({
    key,
    value: readPersistedValue(key, initialValues, enabled, initialValues, false),
  }));

  if (entry.key !== key) {
    setEntry({
      key,
      value: readPersistedValue(key, initialValues, enabled, entry.value, true),
    });
  }

  const state = entry.value;

  const setState: React.Dispatch<React.SetStateAction<T>> = useCallback(
    (action) => {
      setEntry((prev) => ({
        key,
        value: typeof action === 'function' ? (action as (_prevState: T) => T)(prev.value) : action,
      }));
    },
    [key]
  );

  // Sync state changes to sessionStorage with debouncing to prevent main-thread jank on large form state edits
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const handler = () => {
      try {
        if (state === undefined || state === null) {
          window.sessionStorage.removeItem(key);
        } else {
          window.sessionStorage.setItem(key, JSON.stringify(state));
        }
      } catch (err) {
        console.warn(`useFormPersist: Failed to write key "${key}" to sessionStorage:`, err);
      }
    };

    if (debounceMs > 0) {
      const timer = setTimeout(handler, debounceMs);
      return () => clearTimeout(timer);
    } else {
      handler();
    }
  }, [key, state, enabled, debounceMs]);

  // Method to clear persisted state from sessionStorage
  const clearPersistedState = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.sessionStorage.removeItem(key);
    } catch (err) {
      console.warn(`useFormPersist: Failed to clear key "${key}" from sessionStorage:`, err);
    }
  }, [key]);

  return [state, setState, clearPersistedState];
}
