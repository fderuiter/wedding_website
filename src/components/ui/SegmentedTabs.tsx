'use client';

import React, { useId, useRef } from 'react';
import { cn } from '@/utils/cn';
import { Icon } from './Icon';

export interface SegmentedTabItem<T extends string = string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  'aria-label'?: string;
  id?: string;
  panelId?: string;
  content?: React.ReactNode;
  className?: string;
}

type TablistAccessibleLabel =
  | { 'aria-label': string; 'aria-labelledby'?: string }
  | { 'aria-labelledby': string; 'aria-label'?: string };

export type SegmentedTabsProps<T extends string = string> = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  'onChange' | 'aria-label' | 'aria-labelledby' | 'role'
> &
  TablistAccessibleLabel & {
    tabs: SegmentedTabItem<T>[];
    value: T;
    onChange: (_value: T) => void;
    idPrefix?: string;
    panelId?: string;
    size?: 'sm' | 'md';
    panelClassName?: string;
  };

export interface SegmentedTabPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  id: string;
  tabId: string;
}

function slugifyTabValue(val: string): string {
  return val
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tab';
}

function findNextEnabledTabIndex<T extends string>(
  tabs: SegmentedTabItem<T>[],
  startIndex: number,
  step: 1 | -1
): number {
  const count = tabs.length;
  if (count === 0) return -1;
  for (let offset = 1; offset <= count; offset++) {
    const candidate = (startIndex + step * offset + count) % count;
    if (!tabs[candidate]?.disabled) {
      return candidate;
    }
  }
  return -1;
}

export const SegmentedTabPanel = React.forwardRef<HTMLDivElement, SegmentedTabPanelProps>(
  ({ id, tabId, className, tabIndex = 0, children, ...props }, ref) => (
    <div
      ref={ref}
      id={id}
      role="tabpanel"
      aria-labelledby={tabId}
      tabIndex={tabIndex}
      className={cn('focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg', className)}
      {...props}
    >
      {children}
    </div>
  )
);
SegmentedTabPanel.displayName = 'SegmentedTabPanel';

function SegmentedTabsInner<T extends string = string>(
  props: SegmentedTabsProps<T>,
  ref: React.ForwardedRef<HTMLDivElement>
) {
  const {
    tabs,
    value,
    onChange,
    idPrefix,
    panelId,
    size = 'md',
    className,
    panelClassName,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    ...rest
  } = props;

  const reactId = useId().replace(/:/g, '');
  const resolvedPrefix = idPrefix || `segmented-${reactId}`;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const hasInlinePanels = tabs.some((tab) => tab.content !== undefined);
  const sharedPanelId = panelId ?? (hasInlinePanels ? `${resolvedPrefix}-panel` : undefined);

  const activeIndex = tabs.findIndex((tab) => !tab.disabled && tab.value === value);
  const firstEnabledIndex = tabs.findIndex((tab) => !tab.disabled);
  const rovingIndex = activeIndex >= 0 ? activeIndex : firstEnabledIndex;

  const getTabId = (tab: SegmentedTabItem<T>) =>
    tab.id ?? `${resolvedPrefix}-tab-${slugifyTabValue(tab.value)}`;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex = -1;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      nextIndex = findNextEnabledTabIndex(tabs, currentIndex, 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      nextIndex = findNextEnabledTabIndex(tabs, currentIndex, -1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      nextIndex = tabs.findIndex((t) => !t.disabled);
    } else if (e.key === 'End') {
      e.preventDefault();
      for (let i = tabs.length - 1; i >= 0; i--) {
        if (!tabs[i]?.disabled) {
          nextIndex = i;
          break;
        }
      }
    } else {
      return;
    }

    if (nextIndex >= 0 && tabs[nextIndex] && !tabs[nextIndex].disabled) {
      onChange(tabs[nextIndex].value);
      tabRefs.current[nextIndex]?.focus();
    }
  };

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
  };

  const activeTabItem = tabs.find((tab) => tab.value === value) ?? tabs[0];
  const activeTabId = activeTabItem ? getTabId(activeTabItem) : `${resolvedPrefix}-tab-0`;

  const tablistElement = (
    <div
      ref={ref}
      role="tablist"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={cn(
        'inline-flex flex-wrap items-center rounded-lg bg-gray-100 dark:bg-gray-800 p-1 border border-gray-200 dark:border-gray-700',
        className
      )}
      {...rest}
    >
      {tabs.map((tab, index) => {
        const isActive = tab.value === value;
        const tabId = getTabId(tab);
        const targetPanelId = tab.panelId ?? sharedPanelId;

        return (
          <button
            key={tab.value}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            id={tabId}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={targetPanelId}
            aria-label={tab['aria-label']}
            disabled={tab.disabled}
            tabIndex={tab.disabled ? -1 : index === rovingIndex ? 0 : -1}
            onClick={() => {
              if (!tab.disabled) {
                onChange(tab.value);
              }
            }}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 font-medium rounded-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 disabled:cursor-not-allowed',
              sizeStyles[size],
              isActive
                ? 'bg-white dark:bg-gray-700 text-primary dark:text-white shadow-sm font-semibold border border-primary/50 underline decoration-2 underline-offset-4 forced-colors:outline forced-colors:outline-2'
                : 'text-gray-600 dark:text-gray-300 border border-transparent hover:text-gray-900 dark:hover:text-white',
              tab.className
            )}
          >
            {isActive && (
              <Icon
                name="Check"
                className="h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
            )}
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );

  if (!hasInlinePanels) {
    return tablistElement;
  }

  return (
    <div className="space-y-4">
      {tablistElement}
      {sharedPanelId && (
        <SegmentedTabPanel
          id={sharedPanelId}
          tabId={activeTabId}
          className={panelClassName}
        >
          {activeTabItem?.content}
        </SegmentedTabPanel>
      )}
    </div>
  );
}

export const SegmentedTabs = React.forwardRef(SegmentedTabsInner) as (<
  T extends string = string,
>(
  _props: SegmentedTabsProps<T> & { ref?: React.ForwardedRef<HTMLDivElement> }
) => React.ReactElement) & { displayName?: string };

SegmentedTabs.displayName = 'SegmentedTabs';
