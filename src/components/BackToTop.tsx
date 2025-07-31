'use client';

import { useEffect, useState } from 'react';

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

  return (
    <a
      href="#top"
      aria-label="Back to top"
      className={[
        'fixed right-4 bottom-6 z-40',
        'rounded-full px-4 py-3 text-sm font-medium',
        'bg-black text-white dark:bg-white dark:text-black',
        'shadow-md focus-visible:ring-2',
        visible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        'transition-opacity',
      ].join(' ')}
    >
      ↑ Back to top
    </a>
  );
}
