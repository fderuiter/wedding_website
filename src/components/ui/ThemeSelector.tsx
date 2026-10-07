'use client';

import { useTheme, ThemeMode } from '@/components/ThemeProvider';
import { Icon } from '@/components/ui/Icon';

interface ThemeSelectorProps {
  className?: string;
}

export function ThemeSelector({ className = '' }: ThemeSelectorProps) {
  const { themeMode, setThemeMode } = useTheme();

  const options: { mode: ThemeMode; label: string; icon: 'Sun' | 'Moon' | 'Monitor' }[] = [
    { mode: 'light', label: 'Light', icon: 'Sun' },
    { mode: 'dark', label: 'Dark', icon: 'Moon' },
    { mode: 'system', label: 'System', icon: 'Monitor' },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Theme mode selector"
      className={`inline-flex items-center rounded-lg bg-gray-200/80 dark:bg-gray-800/80 p-1 border border-gray-300 dark:border-gray-700 ${className}`}
    >
      {options.map((opt) => {
        const isActive = themeMode === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => setThemeMode(opt.mode)}
            title={`Switch to ${opt.label} theme`}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              isActive
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
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
