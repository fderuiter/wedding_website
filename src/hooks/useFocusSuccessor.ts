import { useRef, useEffect, useCallback } from 'react';

/**
 * Hook to manage focus shifting when an item is deleted from a list.
 * Helps maintain accessibility by ensuring focus doesn't reset to the document body.
 *
 * @returns {object} containerRef to attach to the list container, and captureFocusTarget to call before an item is removed.
 */
export function useFocusSuccessor<T extends HTMLElement>() {
  const containerRef = useRef<T>(null);
  const nextFocusRef = useRef<HTMLElement | null>(null);

  const captureFocusTarget = useCallback((deletedItemElement: HTMLElement) => {
    if (!containerRef.current) return;

    const children = Array.from(containerRef.current.children) as HTMLElement[];
    const index = children.indexOf(deletedItemElement);

    if (index !== -1) {
      if (index + 1 < children.length) {
        // Next sibling
        nextFocusRef.current = children[index + 1];
      } else if (index - 1 >= 0) {
        // Previous sibling
        nextFocusRef.current = children[index - 1];
      } else {
        // Parent container (or heading if configured)
        nextFocusRef.current = containerRef.current;
      }
    } else {
      nextFocusRef.current = containerRef.current;
    }
  }, []);

  useEffect(() => {
    if (nextFocusRef.current) {
      // Ensure the target is focusable programmatically
      if (nextFocusRef.current.tabIndex === -1 && !nextFocusRef.current.hasAttribute('tabindex')) {
        nextFocusRef.current.setAttribute('tabindex', '-1');
      }
      nextFocusRef.current.focus();
      nextFocusRef.current = null;
    }
  });

  return { containerRef, captureFocusTarget };
}
