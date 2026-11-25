'use client';

import React, { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/forms';
import { cn } from '@/utils/cn';

const FALLBACK_TIMEZONES = [
  'UTC',
  'America/Chicago',
  'America/New_York',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Australia/Sydney',
];

export interface SearchableTimezoneSelectProps {
  id?: string;
  name?: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  /**
   * When true, clicking outside commits any typed draft value to `onChange`
   * instead of reverting non-catalog text, allowing form submission to surface
   * explicit validation feedback.
   */
  commitRawOnBlur?: boolean;
}

export const SearchableTimezoneSelect = forwardRef<
  HTMLInputElement,
  SearchableTimezoneSelectProps
>(function SearchableTimezoneSelect(
  {
    id,
    name,
    value,
    onChange,
    placeholder = 'Search and select timezone (e.g. Europe/Paris)...',
    disabled = false,
    required = false,
    className,
    commitRawOnBlur = false,
  },
  forwardedRef
) {
  const ianaTimezones = useMemo(() => {
    try {
      const supported = Intl.supportedValuesOf('timeZone');
      if (!Array.isArray(supported) || supported.length === 0) {
        return FALLBACK_TIMEZONES;
      }
      return supported.includes('UTC') ? supported : ['UTC', ...supported];
    } catch {
      return FALLBACK_TIMEZONES;
    }
  }, []);

  const [draftSearch, setDraftSearch] = useState<string | null>(null);
  const search = draftSearch ?? (value || 'America/Chicago');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

  const listboxId = id ? `${id}-listbox` : 'timezone-listbox';
  const resolvedListboxId = id === 'timezone' || !id ? 'timezone-listbox' : listboxId;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setHighlightedIndex(-1);
        if (draftSearch !== null) {
          if (commitRawOnBlur || ianaTimezones.includes(draftSearch)) {
            onChange(draftSearch);
          }
          setDraftSearch(null);
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [draftSearch, ianaTimezones, onChange, commitRawOnBlur]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ianaTimezones;
    return ianaTimezones.filter((tz) => tz.toLowerCase().includes(q));
  }, [search, ianaTimezones]);

  const handleSelect = (tz: string) => {
    onChange(tz);
    setDraftSearch(null);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextValue = e.target.value;
    setDraftSearch(nextValue);
    if (commitRawOnBlur) {
      onChange(nextValue);
    }
    setIsOpen(true);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      }
      if (filtered.length > 0) {
        setHighlightedIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : 0));
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      }
      if (filtered.length > 0) {
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filtered.length - 1));
      }
    } else if (e.key === 'Enter') {
      if (isOpen && highlightedIndex >= 0 && highlightedIndex < filtered.length) {
        e.preventDefault();
        handleSelect(filtered[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      if (isOpen) {
        e.preventDefault();
        setIsOpen(false);
        setHighlightedIndex(-1);
        setDraftSearch(null);
      }
    } else if (e.key === 'Home') {
      if (isOpen && filtered.length > 0) {
        e.preventDefault();
        setHighlightedIndex(0);
      }
    } else if (e.key === 'End') {
      if (isOpen && filtered.length > 0) {
        e.preventDefault();
        setHighlightedIndex(filtered.length - 1);
      }
    }
  };

  useEffect(() => {
    if (highlightedIndex >= 0 && optionRefs.current[highlightedIndex]) {
      optionRefs.current[highlightedIndex]?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <Input
        ref={forwardedRef}
        id={id}
        name={name}
        type="text"
        placeholder={placeholder}
        value={search}
        disabled={disabled}
        required={required}
        onChange={handleInputChange}
        onFocus={() => {
          if (!disabled) {
            setIsOpen(true);
          }
        }}
        onKeyDown={handleKeyDown}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={resolvedListboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          isOpen && highlightedIndex >= 0 && filtered[highlightedIndex]
            ? `timezone-option-${highlightedIndex}`
            : undefined
        }
        className="w-full"
      />
      {isOpen && !disabled && (
        <div
          id={resolvedListboxId}
          role="listbox"
          aria-label="Timezone options"
          className="absolute left-0 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-lg z-50"
        >
          {filtered.length > 0 ? (
            filtered.map((tz, index) => {
              const isHighlighted = index === highlightedIndex;
              return (
                <div
                  key={tz}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  id={`timezone-option-${index}`}
                  role="option"
                  aria-selected={isHighlighted}
                  onClick={() => handleSelect(tz)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`block w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-zinc-200 cursor-pointer ${
                    isHighlighted
                      ? 'bg-gray-100 dark:bg-zinc-700'
                      : 'hover:bg-gray-100 dark:hover:bg-zinc-700'
                  }`}
                >
                  {tz}
                </div>
              );
            })
          ) : (
            <div className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400">
              No matching standard IANA timezones found
            </div>
          )}
        </div>
      )}
    </div>
  );
});
