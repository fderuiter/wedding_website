'use client';

import React, { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

export interface Interactive3DCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
}

export function Interactive3DCard({ children, className = '', onClick }: Interactive3DCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const x = useMotionValue(0);
  const y = useMotionValue(0);

  // Smooth the motion values using springs
  const mouseXSpring = useSpring(x, { stiffness: 300, damping: 20 });
  const mouseYSpring = useSpring(y, { stiffness: 300, damping: 20 });

  // Transform mouse position to rotation
  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ['10deg', '-10deg']);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ['-10deg', '10deg']);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const { width, height, left, top } = rect;
    if (width === 0 || height === 0) return;
    const mouseX = e.clientX - left;
    const mouseY = e.clientY - top;
    const xPct = Math.max(-0.5, Math.min(0.5, mouseX / width - 0.5));
    const yPct = Math.max(-0.5, Math.min(0.5, mouseY / height - 0.5));

    x.set(xPct);
    y.set(yPct);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };
  
  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!ref.current || !e.touches[0]) return;
    const rect = ref.current.getBoundingClientRect();
    const { width, height, left, top } = rect;
    if (width === 0 || height === 0) return;
    const touch = e.touches[0];
    const mouseX = touch.clientX - left;
    const mouseY = touch.clientY - top;
    const xPct = Math.max(-0.5, Math.min(0.5, mouseX / width - 0.5));
    const yPct = Math.max(-0.5, Math.min(0.5, mouseY / height - 0.5));

    x.set(xPct);
    y.set(yPct);
  };

  const handleTouchEnd = () => {
    x.set(0);
    y.set(0);
  };

  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <motion.div
      ref={ref}
      onMouseMove={reduceMotion ? undefined : handleMouseMove}
      onMouseLeave={reduceMotion ? undefined : handleMouseLeave}
      onTouchMove={reduceMotion ? undefined : handleTouchMove}
      onTouchEnd={reduceMotion ? undefined : handleTouchEnd}
      onClick={onClick}
      style={{
        transformPerspective: 1000,
        rotateX: reduceMotion ? '0deg' : rotateX,
        rotateY: reduceMotion ? '0deg' : rotateY,
        transformStyle: 'preserve-3d',
        willChange: 'transform',
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
