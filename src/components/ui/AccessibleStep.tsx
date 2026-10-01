'use client';

import React, { useEffect, useRef } from 'react';

interface AccessibleStepProps {
  isActive: boolean;
  children: React.ReactNode;
  className?: string;
}

export function AccessibleStep({ isActive, children, className }: AccessibleStepProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (isActive && containerRef.current) {
      containerRef.current.focus();
    }
  }, [isActive]);

  if (!isActive) return null;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      aria-hidden={!isActive}
      className={`outline-none ${className || ''}`.trim()}
    >
      {children}
    </div>
  );
}
