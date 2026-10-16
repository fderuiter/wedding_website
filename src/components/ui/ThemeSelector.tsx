'use client';

import { useRef } from 'react';
import { useTheme, ThemeMode } from '@/components/ThemeProvider';
import { Icon } from '@/components/ui/Icon';

interface ThemeSelectorProps {
  className?: string;
}

export function ThemeSelector({ className = '' }: ThemeSelectorProps) {
  const { themeMode, setThemeMode } = useTheme();
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const options: { mode: ThemeMode; label: string; icon: 'Sun' | 'Moon' | 'Monitor' }[] = [
    { mode: 'light', label: 'Light', icon: 'Sun' },
    { mode: 'dark', label: 'Dark', icon: 'Moon' },
    { mode: 'system', label: 'System', icon: 'Monitor' },
  ];

  const activeIndex = options.findIndex((opt) => opt.mode === themeMode);
  const effectiveIndex = activeIndex >= 0 ? activeIndex : 0;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    let targetIndex = effectiveIndex;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        targetIndex = (effectiveIndex + 1) % options.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        targetIndex = (effectiveIndex - 1 + options.length) % options.length;
        break;
      case 'Home':
        e.preventDefault();
        targetIndex = 0;
        break;
      case 'End':
        e.preventDefault();
        targetIndex = options.length - 1;
        break;
      default:
        return;
    }

    setThemeMode(options[targetIndex].mode);
    buttonRefs.current[targetIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Theme mode selector"
      className={`inline-flex items-center rounded-lg bg-gray-200/80 dark:bg-gray-800/80 p-1 border border-gray-300 dark:border-gray-700 ${className}`}
    >
      {options.map((opt, index) => {
        const isActive = index === effectiveIndex;
        return (
          <button
            key={opt.mode}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={themeMode === opt.mode}
            tabIndex={isActive ? 0 : -1}
            onClick={() => setThemeMode(opt.mode)}
            onKeyDown={handleKeyDown}
            title={`Switch to ${opt.label} theme`}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              isActive
                ? 'bg-white dark:bg-gray-700 text-primary dark:text-primary-text font-bold shadow-sm border border-gray-200/50 dark:border-gray-600/50'
                : 'text-gray-600 dark:text-gray-400 hover:text-primary dark:hover:text-primary-text'
            }`}
          >
            <Icon name={opt.icon} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
