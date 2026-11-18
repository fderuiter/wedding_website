import { useCallback, type KeyboardEvent, type RefObject } from 'react';

const NAVIGATION_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
const DEFAULT_ITEM_SELECTOR = '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])';

/**
 * Provides keyboard navigation (`ArrowDown`, `ArrowUp`, `Home`, and `End`) across menu items
 * within a container element.
 *
 * Supports cyclic wrapping between the first and last menu items, safely exits when the menu
 * container is unmounted or empty, and targets the first menu item when relative navigation
 * keys are pressed while no menu item currently holds focus.
 *
 * @param containerRef - Ref attached to the menu or overlay container element
 * @param itemSelector - Optional CSS selector used to locate focusable menu items
 * @returns An object containing `handleMenuKeyDown` to attach to the menu or its items
 */
export function useMenuNavigation<T extends HTMLElement = HTMLElement>(
  containerRef: RefObject<T | null>,
  itemSelector: string = DEFAULT_ITEM_SELECTOR
) {
  const handleMenuKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!NAVIGATION_KEYS.includes(e.key)) {
        return;
      }

      e.preventDefault();
      const items = containerRef.current?.querySelectorAll<HTMLElement>(itemSelector);
      if (!items || items.length === 0) {
        return;
      }

      const itemList = Array.from(items);
      const index = itemList.indexOf(document.activeElement as HTMLElement);
      let nextIndex = 0;

      if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = itemList.length - 1;
      } else if (index === -1) {
        nextIndex = 0;
      } else if (e.key === 'ArrowDown') {
        nextIndex = index + 1 < itemList.length ? index + 1 : 0;
      } else if (e.key === 'ArrowUp') {
        nextIndex = index - 1 >= 0 ? index - 1 : itemList.length - 1;
      }

      itemList[nextIndex]?.focus();
    },
    [containerRef, itemSelector]
  );

  return { handleMenuKeyDown };
}
