'use client';

import React, { useRef, useState } from 'react';
import { cn } from '@/utils/cn';
import { Icon } from './Icon';

export interface ToggleButtonOption<T extends string = string> {
  value: T;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  'aria-label'?: string;
  className?: string;
  activeClassName?: string;
  inactiveClassName?: string;
}

type GroupAccessibleLabel =
  | { 'aria-label': string; 'aria-labelledby'?: string }
  | { 'aria-labelledby': string; 'aria-label'?: string };

type BaseToggleButtonGroupProps<T extends string = string> = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'onChange' | 'aria-label' | 'aria-labelledby' | 'role'
> &
  GroupAccessibleLabel & {
    options: ToggleButtonOption<T>[];
    buttonClassName?: string;
    activateOnFocus?: boolean;
  };

type SingleToggleButtonGroupProps<T extends string = string> = BaseToggleButtonGroupProps<T> & {
  mode?: 'radiogroup' | 'group';
  multiple?: false;
  value: T | null;
  onChange: (_value: T) => void;
};

type MultiToggleButtonGroupProps<T extends string = string> = BaseToggleButtonGroupProps<T> & {
  mode: 'group';
  multiple: true;
  value: T[];
  onChange: (_value: T[]) => void;
};

export type ToggleButtonGroupProps<T extends string = string> =
  | SingleToggleButtonGroupProps<T>
  | MultiToggleButtonGroupProps<T>;

function findNextEnabledIndex<T extends string>(
  options: ToggleButtonOption<T>[],
  startIndex: number,
  step: 1 | -1
): number {
  const count = options.length;
  if (count === 0) return -1;
  for (let offset = 1; offset <= count; offset++) {
    const candidate = (startIndex + step * offset + count) % count;
    if (!options[candidate]?.disabled) {
      return candidate;
    }
  }
  return -1;
}

function findFirstEnabledIndex<T extends string>(options: ToggleButtonOption<T>[]): number {
  return options.findIndex((opt) => !opt.disabled);
}

function findLastEnabledIndex<T extends string>(options: ToggleButtonOption<T>[]): number {
  for (let i = options.length - 1; i >= 0; i--) {
    if (!options[i]?.disabled) return i;
  }
  return -1;
}

function ToggleButtonGroupInner<T extends string = string>(
  props: ToggleButtonGroupProps<T>,
  ref: React.ForwardedRef<HTMLDivElement>
) {
  const {
    options,
    mode = 'radiogroup',
    multiple,
    value,
    onChange,
    className,
    buttonClassName,
    activateOnFocus,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    ...rest
  } = props;

  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [focusedValue, setFocusedValue] = useState<T | null>(null);

  const isOptionSelected = (optValue: T): boolean => {
    if (multiple) {
      return (value as T[]).includes(optValue);
    }
    return value === optValue;
  };

  const firstSelectedIndex = options.findIndex(
    (opt) => !opt.disabled && isOptionSelected(opt.value)
  );
  const focusedOptionIndex =
    focusedValue !== null
      ? options.findIndex((opt) => !opt.disabled && opt.value === focusedValue)
      : -1;
  const firstEnabledIndex = findFirstEnabledIndex(options);

  const rovingIndex =
    mode === 'radiogroup'
      ? firstSelectedIndex >= 0
        ? firstSelectedIndex
        : firstEnabledIndex
      : focusedOptionIndex >= 0
        ? focusedOptionIndex
        : firstSelectedIndex >= 0
          ? firstSelectedIndex
          : firstEnabledIndex;

  const shouldActivateOnFocus = activateOnFocus ?? mode === 'radiogroup';

  const triggerSelect = (opt: ToggleButtonOption<T>) => {
    if (opt.disabled) return;
    setFocusedValue(opt.value);
    if (multiple) {
      const current = value as T[];
      const next = current.includes(opt.value)
        ? current.filter((v) => v !== opt.value)
        : [...current, opt.value];
      (onChange as (_val: T[]) => void)(next);
    } else {
      (onChange as (_val: T) => void)(opt.value);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let targetIndex = -1;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        targetIndex = findNextEnabledIndex(options, currentIndex, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        targetIndex = findNextEnabledIndex(options, currentIndex, -1);
        break;
      case 'Home':
        e.preventDefault();
        targetIndex = findFirstEnabledIndex(options);
        break;
      case 'End':
        e.preventDefault();
        targetIndex = findLastEnabledIndex(options);
        break;
      default:
        return;
    }

    if (targetIndex < 0) return;

    const targetOption = options[targetIndex];
    if (!targetOption || targetOption.disabled) return;

    setFocusedValue(targetOption.value);
    buttonRefs.current[targetIndex]?.focus();

    if (shouldActivateOnFocus && !multiple) {
      (onChange as (_val: T) => void)(targetOption.value);
    }
  };

  const defaultContainerStyles =
    'inline-flex flex-wrap items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700';

  return (
    <div
      ref={ref}
      role={mode}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn(defaultContainerStyles, className)}
      {...rest}
    >
      {options.map((opt, index) => {
        const isSelected = isOptionSelected(opt.value);
        const isRovingStop = index === rovingIndex;
        const isCardOption = opt.description !== undefined;

        const defaultActiveStyles = isCardOption
          ? 'border-2 border-primary bg-primary/10 ring-2 ring-primary font-semibold'
          : 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm font-bold border border-primary ring-2 ring-primary/30';

        const defaultInactiveStyles = isCardOption
          ? 'border border-gray-300 dark:border-gray-700 hover:border-gray-400'
          : 'text-gray-600 dark:text-gray-300 border border-transparent hover:text-gray-900 dark:hover:text-white';

        const forcedColorStyles = isSelected
          ? 'forced-colors:outline forced-colors:outline-2'
          : '';

        return (
          <button
            key={opt.value}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            role={mode === 'radiogroup' ? 'radio' : undefined}
            aria-checked={mode === 'radiogroup' ? isSelected : undefined}
            aria-pressed={mode === 'group' ? isSelected : undefined}
            aria-label={opt['aria-label']}
            disabled={opt.disabled}
            tabIndex={opt.disabled ? -1 : isRovingStop ? 0 : -1}
            onFocus={() => setFocusedValue(opt.value)}
            onClick={() => triggerSelect(opt)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              isCardOption
                ? 'p-4 rounded-xl text-left transition-all'
                : 'inline-flex items-center justify-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 disabled:cursor-not-allowed',
              isSelected
                ? opt.activeClassName ?? defaultActiveStyles
                : opt.inactiveClassName ?? defaultInactiveStyles,
              forcedColorStyles,
              buttonClassName,
              opt.className
            )}
          >
            {isCardOption ? (
              <div className="w-full">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-bold text-sm text-primary">{opt.label}</div>
                  {isSelected && (
                    <Icon
                      name="Check"
                      className="h-4 w-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                  {opt.description}
                </div>
              </div>
            ) : (
              <>
                {isSelected && (
                  <Icon
                    name="Check"
                    className="h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                )}
                <span>{opt.label}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

export const ToggleButtonGroup = React.forwardRef(ToggleButtonGroupInner) as (<
  T extends string = string,
>(
  _props: ToggleButtonGroupProps<T> & { ref?: React.ForwardedRef<HTMLDivElement> }
) => React.ReactElement) & { displayName?: string };

ToggleButtonGroup.displayName = 'ToggleButtonGroup';
