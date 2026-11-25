'use client';

import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { cn } from '@/utils/cn';

type StickyOffsetEdge = 'top' | 'bottom';
type StickyOffsetScope = 'document' | 'scroll-region';
type StickyOffsetCombineMode = 'max' | 'sum';

interface ContributorEntry {
  value: number;
  mode: StickyOffsetCombineMode;
}

const containerRegistry = new WeakMap<
  HTMLElement,
  Map<string, Map<symbol, ContributorEntry>>
>();

function resolveDefaultCssVar(
  scope: StickyOffsetScope,
  edge: StickyOffsetEdge
): string {
  if (scope === 'document') {
    return edge === 'top' ? '--sticky-top-extra' : '--sticky-bottom-extra';
  }
  return edge === 'top' ? '--local-sticky-top' : '--local-sticky-bottom';
}

function syncContainerCssVar(container: HTMLElement, cssVar: string): void {
  const varMap = containerRegistry.get(container);
  const contributors = varMap?.get(cssVar);
  if (!contributors || contributors.size === 0) {
    container.style.removeProperty(cssVar);
    return;
  }

  let sumTotal = 0;
  let maxTotal = 0;
  let hasSum = false;

  contributors.forEach((entry) => {
    if (entry.value <= 0) {
      return;
    }
    if (entry.mode === 'sum') {
      hasSum = true;
      sumTotal += entry.value;
    } else if (entry.value > maxTotal) {
      maxTotal = entry.value;
    }
  });

  const resolvedPx = hasSum ? Math.max(sumTotal, maxTotal) : maxTotal;
  if (resolvedPx > 0) {
    container.style.setProperty(cssVar, `${resolvedPx}px`);
  } else {
    container.style.removeProperty(cssVar);
  }
}

function setContributorOffset(
  container: HTMLElement,
  cssVar: string,
  contributorId: symbol,
  entry: ContributorEntry
): void {
  let varMap = containerRegistry.get(container);
  if (!varMap) {
    varMap = new Map();
    containerRegistry.set(container, varMap);
  }
  let contributors = varMap.get(cssVar);
  if (!contributors) {
    contributors = new Map();
    varMap.set(cssVar, contributors);
  }
  contributors.set(contributorId, entry);
  syncContainerCssVar(container, cssVar);
}

function removeContributorOffset(
  container: HTMLElement,
  cssVar: string,
  contributorId: symbol
): void {
  const varMap = containerRegistry.get(container);
  const contributors = varMap?.get(cssVar);
  if (!contributors) {
    return;
  }
  contributors.delete(contributorId);
  if (contributors.size === 0) {
    varMap?.delete(cssVar);
  }
  syncContainerCssVar(container, cssVar);
}

function measureElementClearance(
  el: HTMLElement,
  edge: StickyOffsetEdge
): number {
  const win = el.ownerDocument?.defaultView;
  let style: CSSStyleDeclaration | null = null;
  if (win && typeof win.getComputedStyle === 'function') {
    style = win.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return 0;
    }
  }

  const rect = el.getBoundingClientRect();
  const rawHeight = rect.height || el.offsetHeight || 0;
  if (rawHeight <= 0) {
    return 0;
  }

  let extraInset = 0;
  if (edge === 'bottom' && style && style.position === 'fixed') {
    const parsedBottom = Number.parseFloat(style.bottom);
    if (Number.isFinite(parsedBottom) && parsedBottom > 0) {
      extraInset = parsedBottom;
    }
  }

  return Math.ceil(rawHeight + extraInset);
}

function resolveTargetContainer(
  el: HTMLElement,
  scope: StickyOffsetScope,
  containerRef?: React.RefObject<HTMLElement | null>,
  containerSelector?: string
): HTMLElement | null {
  if (containerRef?.current) {
    return containerRef.current;
  }
  if (scope === 'document') {
    return el.ownerDocument?.documentElement ?? null;
  }
  if (containerSelector) {
    const matched = el.closest<HTMLElement>(containerSelector);
    if (matched) {
      return matched;
    }
  }
  return el.closest<HTMLElement>('[data-scroll-region]');
}

export interface UseStickyOffsetOptions<T extends HTMLElement = HTMLElement> {
  edge?: StickyOffsetEdge;
  scope?: StickyOffsetScope;
  cssVar?: string;
  targetRef?: React.RefObject<T | null>;
  containerRef?: React.RefObject<HTMLElement | null>;
  containerSelector?: string;
  combineMode?: StickyOffsetCombineMode;
  enabled?: boolean;
  disableAtMaxHeight?: number;
  onMeasure?: (height: number) => void;
}

export function useStickyOffset<T extends HTMLElement = HTMLElement>(
  options: UseStickyOffsetOptions<T> = {}
): React.RefObject<T | null> {
  const {
    edge = 'top',
    scope = 'document',
    cssVar,
    targetRef,
    containerRef,
    containerSelector,
    combineMode = edge === 'bottom' ? 'max' : 'sum',
    enabled = true,
    disableAtMaxHeight,
    onMeasure,
  } = options;

  const internalRef = useRef<T | null>(null);
  const resolvedRef = targetRef ?? internalRef;
  const onMeasureRef = useRef(onMeasure);

  useLayoutEffect(() => {
    onMeasureRef.current = onMeasure;
  });

  const effectiveCssVar = cssVar ?? resolveDefaultCssVar(scope, edge);

  useLayoutEffect(() => {
    if (!enabled) {
      onMeasureRef.current?.(0);
      return;
    }

    const el = resolvedRef.current;
    if (!el) {
      return;
    }

    const container = resolveTargetContainer(
      el,
      scope,
      containerRef,
      containerSelector
    );
    const contributorId = Symbol(effectiveCssVar);

    const isDisabledByViewportHeight = (currentEl: HTMLElement): boolean => {
      if (typeof disableAtMaxHeight !== 'number' || disableAtMaxHeight <= 0) {
        return false;
      }
      const currentWin = currentEl.ownerDocument?.defaultView;
      if (!currentWin) {
        return false;
      }
      if (typeof currentWin.matchMedia === 'function') {
        const mql = currentWin.matchMedia(`(max-height: ${disableAtMaxHeight}px)`);
        if (mql?.matches) {
          return true;
        }
      }
      return (
        typeof currentWin.innerHeight === 'number' &&
        currentWin.innerHeight > 0 &&
        currentWin.innerHeight <= disableAtMaxHeight
      );
    };

    const updateMeasurement = () => {
      const currentEl = resolvedRef.current;
      if (!currentEl) {
        return;
      }
      const clearance = isDisabledByViewportHeight(currentEl)
        ? 0
        : measureElementClearance(currentEl, edge);
      onMeasureRef.current?.(clearance);
      if (container) {
        setContributorOffset(container, effectiveCssVar, contributorId, {
          value: clearance,
          mode: combineMode,
        });
      }
    };

    updateMeasurement();

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => {
        updateMeasurement();
      });
      try {
        observer.observe(el, { box: 'border-box' });
      } catch {
        observer.observe(el);
      }
    }

    const win = el.ownerDocument?.defaultView;
    win?.addEventListener('resize', updateMeasurement, { passive: true });
    const maxHeightMql =
      typeof disableAtMaxHeight === 'number' &&
      disableAtMaxHeight > 0 &&
      win &&
      typeof win.matchMedia === 'function'
        ? win.matchMedia(`(max-height: ${disableAtMaxHeight}px)`)
        : null;
    maxHeightMql?.addEventListener?.('change', updateMeasurement);

    return () => {
      observer?.disconnect();
      win?.removeEventListener('resize', updateMeasurement);
      maxHeightMql?.removeEventListener?.('change', updateMeasurement);
      if (container) {
        removeContributorOffset(container, effectiveCssVar, contributorId);
      }
    };
  }, [
    combineMode,
    containerRef,
    containerSelector,
    disableAtMaxHeight,
    edge,
    effectiveCssVar,
    enabled,
    resolvedRef,
    scope,
  ]);

  return resolvedRef;
}

type StickyBarElementTag = 'div' | 'nav' | 'aside' | 'footer' | 'header';

export interface StickyBarProps extends React.HTMLAttributes<HTMLElement> {
  as?: StickyBarElementTag;
  edge?: StickyOffsetEdge;
  scope?: StickyOffsetScope;
  cssVar?: string;
  containerRef?: React.RefObject<HTMLElement | null>;
  containerSelector?: string;
  combineMode?: StickyOffsetCombineMode;
  enabled?: boolean;
  disableAtMaxHeight?: number;
  onMeasure?: (height: number) => void;
  ref?: React.Ref<HTMLElement>;
}

export function StickyBar({
  as: Component = 'div',
  edge = 'bottom',
  scope = 'scroll-region',
  cssVar,
  containerRef,
  containerSelector,
  combineMode,
  enabled = true,
  disableAtMaxHeight,
  onMeasure,
  className,
  children,
  ref,
  ...rest
}: StickyBarProps) {
  const internalRef = useStickyOffset<HTMLElement>({
    edge,
    scope,
    cssVar,
    containerRef,
    containerSelector,
    combineMode,
    enabled,
    disableAtMaxHeight,
    onMeasure,
  });

  const setMergedRef = useCallback(
    (node: HTMLElement | null) => {
      internalRef.current = node;
      if (typeof ref === 'function') {
        ref(node);
      } else if (ref) {
        (ref as React.MutableRefObject<HTMLElement | null>).current = node;
      }
    },
    [internalRef, ref]
  );

  return React.createElement(
    Component,
    {
      ...rest,
      ref: setMergedRef,
      className: cn(className),
    },
    children
  );
}
