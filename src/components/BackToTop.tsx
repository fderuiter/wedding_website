'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';

/**
 * @function BackToTop
 * @description A React component that provides a "Back to Top" button.
 * The button appears when the user scrolls down the page and, when clicked,
 * smoothly scrolls the page to the top.
 * @returns {JSX.Element} The rendered BackToTop component.
 */
export default function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let rAF = 0;
    const onScroll = () => {
      cancelAnimationFrame(rAF);
      rAF = requestAnimationFrame(() => {
        setVisible(window.scrollY > 600);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      cancelAnimationFrame(rAF);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });

    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      if (!mainContent.hasAttribute('tabindex')) {
        mainContent.setAttribute('tabindex', '-1');
      }
      mainContent.focus({ preventScroll: true });
    } else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      scrollToTop();
    }
  };

  return (
    <button
      type="button"
      onClick={scrollToTop}
      onKeyDown={handleKeyDown}
      tabIndex={visible ? 0 : -1}
      aria-hidden={!visible}
      aria-label="Back to top"
      className={[
        'fixed right-4 bottom-6 z-40',
        'rounded-full px-4 py-3 text-sm font-medium',
        'bg-black text-white dark:bg-white dark:text-black',
        'shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-black dark:focus-visible:ring-white',
        'flex items-center gap-2',
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        'transition-opacity',
      ].join(' ')}
    >
      <Icon name="ArrowUp" className="w-4 h-4" />
      Back to top
    </button>
  );
}
