'use client';

import React, { useState, useEffect, useRef, useId, useCallback } from 'react';
import { FormGroup, Input, Label } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { cn } from '@/utils/cn';
import { hasValidCoordinates } from '@/utils/maps';

export interface AddressLookupCandidate {
  displayName: string;
  name: string;
  streetAddress: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  latitude: number;
  longitude: number;
}

export interface AddressLookupInputProps {
  id?: string;
  label?: string;
  placeholder?: string;
  helperText?: string;
  verifiedCoordinates?: {
    latitude?: number | null;
    longitude?: number | null;
  } | null;
  onSelect: (_candidate: AddressLookupCandidate) => void;
  debounceMs?: number;
  className?: string;
  ref?: React.Ref<HTMLInputElement>;
}

export function AddressLookupInput({
  id,
  label = 'Search Address',
  placeholder = 'Search place name or street address...',
  helperText,
  verifiedCoordinates,
  onSelect,
  debounceMs = 300,
  className,
  ref,
}: AddressLookupInputProps) {
  const generatedId = useId();
  const inputId = id || `address-lookup-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const statusId = `${inputId}-status`;

  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<AddressLookupCandidate[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const runLookup = useCallback(async (rawQuery: string) => {
    const trimmed = rawQuery.trim();
    if (trimmed.length < 2) {
      abortControllerRef.current?.abort();
      setCandidates([]);
      setIsSearching(false);
      setHasSearched(false);
      setLookupError(null);
      setIsOpen(false);
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsSearching(true);
    setLookupError(null);

    try {
      const res = await fetch(
        `/api/admin/geocode?q=${encodeURIComponent(trimmed)}&limit=5`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        }
      );

      if (controller.signal.aborted) return;

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        setCandidates([]);
        setHasSearched(true);
        setLookupError(
          typeof errJson?.error === 'string' && errJson.error
            ? errJson.error
            : 'Unable to look up address right now. You can still enter address details below.'
        );
        setIsOpen(false);
        return;
      }

      const json = await res.json().catch(() => ({}));
      if (controller.signal.aborted) return;

      const items: AddressLookupCandidate[] = Array.isArray(json?.data)
        ? json.data
        : Array.isArray(json)
          ? json
          : [];

      setCandidates(items);
      setHasSearched(true);
      setIsOpen(items.length > 0);
      setHighlightedIndex(items.length > 0 ? 0 : -1);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      setCandidates([]);
      setHasSearched(true);
      setLookupError('Address lookup is temporarily unavailable. You can still enter fields manually.');
      setIsOpen(false);
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  }, []);

  const handleQueryChange = (nextQuery: string) => {
    setQuery(nextQuery);
    if (nextQuery.trim().length < 2) {
      abortControllerRef.current?.abort();
      setCandidates([]);
      setHasSearched(false);
      setLookupError(null);
      setIsOpen(false);
      setIsSearching(false);
      setHighlightedIndex(-1);
    }
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return;
    }

    const timer = setTimeout(() => {
      void runLookup(trimmed);
    }, debounceMs);

    return () => {
      clearTimeout(timer);
    };
  }, [query, debounceMs, runLookup]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (highlightedIndex >= 0 && optionRefs.current[highlightedIndex]) {
      optionRefs.current[highlightedIndex]?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  const handleSelectCandidate = (candidate: AddressLookupCandidate) => {
    onSelect(candidate);
    setQuery(candidate.displayName);
    setIsOpen(false);
    setHighlightedIndex(-1);
    setHasSearched(false);
    setLookupError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      if (candidates.length > 0) {
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        }
        setHighlightedIndex((prev) => (prev < candidates.length - 1 ? prev + 1 : 0));
      }
    } else if (e.key === 'ArrowUp') {
      if (candidates.length > 0) {
        e.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        }
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : candidates.length - 1));
      }
    } else if (e.key === 'Home') {
      if (isOpen && candidates.length > 0) {
        e.preventDefault();
        setHighlightedIndex(0);
      }
    } else if (e.key === 'End') {
      if (isOpen && candidates.length > 0) {
        e.preventDefault();
        setHighlightedIndex(candidates.length - 1);
      }
    } else if (e.key === 'Enter') {
      if (isOpen && highlightedIndex >= 0 && candidates[highlightedIndex]) {
        e.preventDefault();
        handleSelectCandidate(candidates[highlightedIndex]);
      } else if (query.trim().length >= 2) {
        e.preventDefault();
        void runLookup(query);
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    }
  };

  const hasVerifiedCoords = hasValidCoordinates(
    verifiedCoordinates?.latitude,
    verifiedCoordinates?.longitude
  );

  const showListbox = isOpen && candidates.length > 0;

  return (
    <FormGroup ref={containerRef} className={cn('relative w-full space-y-1.5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={inputId} className="mb-0">
          {label}
        </Label>
        {hasVerifiedCoords && (
          <span
            data-testid={`${inputId}-verified-badge`}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-700 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-200"
          >
            Verified pin ({Number(verifiedCoordinates!.latitude).toFixed(4)},{' '}
            {Number(verifiedCoordinates!.longitude).toFixed(4)})
          </span>
        )}
      </div>

      <div className="flex items-stretch gap-2">
        <Input
          ref={ref}
          id={inputId}
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            handleQueryChange(e.target.value);
          }}
          onFocus={() => {
            if (candidates.length > 0) {
              setIsOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          role="combobox"
          aria-expanded={showListbox}
          aria-haspopup="listbox"
          aria-controls={showListbox ? listboxId : undefined}
          aria-autocomplete="list"
          aria-describedby={statusId}
          aria-activedescendant={
            showListbox && highlightedIndex >= 0 && candidates[highlightedIndex]
              ? `${inputId}-option-${highlightedIndex}`
              : undefined
          }
          className="flex-1 min-h-11"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void runLookup(query);
          }}
          disabled={isSearching || query.trim().length < 2}
          className="min-h-11 min-w-11 px-4 shrink-0"
        >
          {isSearching ? 'Searching...' : 'Lookup'}
        </Button>
        {query && (
          <Button
            type="button"
            variant="ghost"
            aria-label="Clear address search"
            onClick={() => {
              abortControllerRef.current?.abort();
              setQuery('');
              setCandidates([]);
              setIsOpen(false);
              setHasSearched(false);
              setLookupError(null);
              setHighlightedIndex(-1);
            }}
            className="min-h-11 min-w-11 px-3 shrink-0"
          >
            Clear
          </Button>
        )}
      </div>

      <div id={statusId} aria-live="polite" className="text-xs text-gray-600 dark:text-gray-300">
        {lookupError ? (
          <span className="text-amber-700 dark:text-amber-300">{lookupError}</span>
        ) : isSearching ? (
          <span>Searching matching addresses...</span>
        ) : hasSearched && candidates.length === 0 && query.trim().length >= 2 ? (
          <span>No matching locations found. Try a street address or city, or fill fields below.</span>
        ) : helperText ? (
          <span>{helperText}</span>
        ) : null}
      </div>

      {showListbox && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={`${label} suggestions`}
          className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg divide-y divide-gray-100 dark:divide-zinc-800"
        >
          {candidates.map((candidate, index) => {
            const isHighlighted = highlightedIndex === index;
            const secondaryAddress = [
              candidate.streetAddress,
              candidate.city,
              [candidate.state, candidate.zip].filter(Boolean).join(' '),
              candidate.country,
            ]
              .filter(Boolean)
              .join(', ');

            return (
              <div
                key={`${candidate.latitude}-${candidate.longitude}-${index}`}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                id={`${inputId}-option-${index}`}
                role="option"
                aria-selected={isHighlighted}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(e) => {
                  // Prevent input blur before selection fires
                  e.preventDefault();
                }}
                onClick={() => handleSelectCandidate(candidate)}
                className={cn(
                  'min-h-11 px-3.5 py-2.5 cursor-pointer flex flex-col justify-center transition-colors',
                  isHighlighted
                    ? 'bg-amber-50 dark:bg-zinc-800 text-gray-900 dark:text-white'
                    : 'text-gray-900 dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-zinc-800/70'
                )}
              >
                <span className="text-sm font-medium leading-snug">
                  {candidate.name || candidate.displayName}
                </span>
                <span className="text-xs text-gray-600 dark:text-gray-300 leading-snug mt-0.5">
                  {secondaryAddress || candidate.displayName}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </FormGroup>
  );
}
