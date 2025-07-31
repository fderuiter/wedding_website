'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type Section = { id: string; label: string };

const SECTIONS: Section[] = [
  { id: 'details', label: 'Details' },
  { id: 'travel', label: 'Travel' },
  { id: 'faq', label: 'FAQ' },
  { id: 'registry', label: 'Registry' },
];

export default function StickyHeader() {
  const [active, setActive] = useState<string>('details');

  useEffect(() => {
    const headings = SECTIONS
      .map(s => document.getElementById(s.id))
      .filter((el): el is HTMLElement => !!el);

    if (!('IntersectionObserver' in window) || headings.length === 0) return;

    const io = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
          }
        });
      },
      { rootMargin: '-40% 0px -55% 0px', threshold: 0.01 }
    );

    headings.forEach(h => io.observe(h));
    return () => io.disconnect();
  }, []);

  const items = useMemo(
    () =>
      SECTIONS.map(s => (
        <li key={s.id}>
          <Link
            href={`#${s.id}`}
            className={[
              'px-3 py-2 rounded-md text-sm font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
              active === s.id
                ? 'bg-black/10 dark:bg-white/10'
                : 'hover:bg-black/5 dark:hover:bg-white/5',
            ].join(' ')}
            aria-current={active === s.id ? 'true' : undefined}
          >
            {s.label}
          </Link>
        </li>
      )),
    [active]
  );

  return (
    <header
      className={[
        'sticky top-0 z-40 h-14',
        'backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:supports-[backdrop-filter]:bg-neutral-900/60',
        'border-b border-white/10',
      ].join(' ')}
      style={{ height: 'var(--header-h, 56px)' }}
    >
      {/* Skip to content (first tabbable item on the page) */}
      <a href="#main" className="skip-link">Skip to content</a>

      <nav
        className="mx-auto w-full max-w-5xl h-full flex items-center px-3"
        aria-label="Section navigation"
      >
        <ul
          className={[
            'flex min-w-0 items-center gap-1 justify-center',
            'max-sm:overflow-x-auto max-sm:scrollbar-none max-sm:justify-start',
            'nav-scroll-fade',
          ].join(' ')}
        >
          {items}
        </ul>
      </nav>
    </header>
  );
}
