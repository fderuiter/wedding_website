'use client';

import React, { useEffect, useRef } from 'react';

export interface VisibilitySentinelProps extends React.HTMLAttributes<HTMLDivElement> {
  onVisible: () => void;
  rootMargin?: string;
  threshold?: number | number[];
  children?: React.ReactNode;
}

export const VisibilitySentinel: React.FC<VisibilitySentinelProps> = ({
  onVisible,
  rootMargin = '0px',
  threshold = 0,
  children,
  ...props
}) => {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            onVisible();
          }
        });
      },
      {
        rootMargin,
        threshold,
      }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [onVisible, rootMargin, threshold]);

  return <div ref={sentinelRef} {...props} aria-hidden="true">{children}</div>;
};
