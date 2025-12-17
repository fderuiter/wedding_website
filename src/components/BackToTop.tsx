'use client';

import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

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
  };

  return (
    <button
      onClick={scrollToTop}
      aria-label="Back to top"
      className={[
        'fixed right-4 bottom-6 z-40',
        'rounded-full px-4 py-3 text-sm font-medium',
        'bg-black text-white dark:bg-white dark:text-black',
        'shadow-md focus-visible:ring-2',
        'flex items-center gap-2',
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        'transition-opacity',
      ].join(' ')}
    >
      <ArrowUp className="w-4 h-4" />
      Back to top
    </button>
  );
}
