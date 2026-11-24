import type { Page } from '@playwright/test';

export interface FocusOcclusionSampleResult {
  tag: string;
  id: string;
  label: string;
  totalPoints: number;
  occludedPoints: number;
  fullyObscured: boolean;
  hasVisibleFocusIndicator: boolean;
  obscuringElement: string | null;
}

export async function inspectFocusedControlOcclusion(
  page: Page
): Promise<FocusOcclusionSampleResult | null> {
  return page.evaluate(async () => {
    const getScrollSignature = (el: Element | null): string => {
      const parts: number[] = [Math.round(window.scrollX), Math.round(window.scrollY)];
      let cur: Element | null = el;
      while (cur && cur !== document.documentElement) {
        if (cur instanceof HTMLElement) {
          parts.push(Math.round(cur.scrollTop), Math.round(cur.scrollLeft));
        }
        cur = cur.parentElement;
      }
      return parts.join(',');
    };

    const waitFrame = () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });

    // Wait for html:focus-within smooth scrolling to settle before sampling hit points
    let prevSig = getScrollSignature(document.activeElement);
    let stableFrames = 0;
    const deadline = performance.now() + 700;
    while (performance.now() < deadline && stableFrames < 2) {
      await waitFrame();
      const nextSig = getScrollSignature(document.activeElement);
      if (nextSig === prevSig) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
        prevSig = nextSig;
      }
    }

    const active = document.activeElement;
    if (
      !(active instanceof HTMLElement) ||
      active === document.body ||
      active === document.documentElement
    ) {
      return null;
    }

    const rect = active.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const insetX = Math.min(4, Math.max(1, rect.width * 0.2));
    const insetY = Math.min(4, Math.max(1, rect.height * 0.2));
    const points: Array<[number, number]> = [
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
      [rect.left + insetX, rect.top + insetY],
      [rect.right - insetX, rect.top + insetY],
      [rect.left + insetX, rect.bottom - insetY],
      [rect.right - insetX, rect.bottom - insetY],
    ];

    const associatedLabels =
      'labels' in active && active.labels
        ? Array.from(active.labels as NodeListOf<HTMLLabelElement>)
        : [];

    let occludedPoints = 0;
    let obscuringElement: string | null = null;

    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
        occludedPoints += 1;
        obscuringElement = obscuringElement ?? 'outside-viewport';
        continue;
      }
      const hit = document.elementFromPoint(x, y);
      const belongsToControl =
        hit !== null &&
        (hit === active ||
          active.contains(hit) ||
          hit.contains(active) ||
          associatedLabels.some((lbl) => lbl === hit || lbl.contains(hit)));

      if (!belongsToControl) {
        occludedPoints += 1;
        if (!obscuringElement && hit instanceof HTMLElement) {
          obscuringElement = `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}${
            hit.getAttribute('aria-label') ? `[aria-label="${hit.getAttribute('aria-label')}"]` : ''
          }`;
        }
      }
    }

    const style = window.getComputedStyle(active);
    const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
    const hasOutline = style.outlineStyle !== 'none' && outlineWidth > 0;
    const hasBoxShadow = style.boxShadow !== 'none' && style.boxShadow !== '';

    return {
      tag: active.tagName.toLowerCase(),
      id: active.id || '',
      label:
        active.getAttribute('aria-label') ||
        active.getAttribute('name') ||
        active.textContent?.trim().slice(0, 40) ||
        active.tagName.toLowerCase(),
      totalPoints: points.length,
      occludedPoints,
      fullyObscured: occludedPoints === points.length,
      hasVisibleFocusIndicator: hasOutline || hasBoxShadow,
      obscuringElement,
    };
  });
}
