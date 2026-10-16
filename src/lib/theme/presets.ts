export type ThemePreset = 'classic' | 'modern' | 'romantic' | 'minimal' | 'editorial';

export const THEME_PRESET_KEYS: ThemePreset[] = ['classic', 'modern', 'romantic', 'minimal', 'editorial'];

export interface ComponentTokens {
  '--container-bg': string;
  '--card-bg': string;
  '--card-border': string;
  '--card-shadow': string;
  '--heading-color': string;

  '--btn-radius': string;
  '--btn-font-weight': string;
  '--btn-primary-bg': string;
  '--btn-primary-text': string;
  '--btn-primary-hover-bg': string;
  '--btn-primary-border': string;
  '--btn-secondary-bg': string;
  '--btn-secondary-text': string;
  '--btn-secondary-hover-bg': string;
  '--btn-secondary-border': string;
  '--btn-outline-bg': string;
  '--btn-outline-text': string;
  '--btn-outline-border': string;
  '--btn-outline-hover-bg': string;
  '--btn-ghost-bg': string;
  '--btn-ghost-text': string;
  '--btn-ghost-hover-bg': string;
  '--btn-danger-bg': string;
  '--btn-danger-text': string;
  '--btn-danger-hover-bg': string;
  '--btn-focus-ring': string;
  '--dialog-bg': string;
  '--dialog-border-radius': string;
  '--dialog-shadow': string;
  '--dialog-backdrop': string;
  '--dialog-border-color': string;
  '--dialog-title-color': string;
  '--dialog-desc-color': string;

  '--input-bg': string;
  '--input-border': string;
  '--input-focus-ring': string;
  '--input-radius': string;
  '--input-error-border': string;
  '--input-error-focus-ring': string;
  '--input-success-border': string;
  '--input-success-focus-ring': string;
  '--input-warning-border': string;
  '--input-warning-focus-ring': string;
  '--form-label-text': string;
  '--form-message-text': string;
  '--form-error-text': string;
  '--form-success-text': string;
  '--form-warning-text': string;

  '--schedule-card-bg': string;
  '--schedule-card-border': string;
  '--schedule-card-radius': string;
  '--schedule-filter-bg': string;
  '--schedule-filter-text': string;
  '--schedule-filter-hover-bg': string;
  '--schedule-filter-active-bg': string;
  '--schedule-filter-active-text': string;
  '--schedule-node-bg': string;
  '--schedule-node-border': string;
  '--schedule-tag-bg': string;
  '--schedule-tag-text': string;

  '--print-bg': string;
  '--print-text': string;
  '--print-border': string;
  '--print-header-border': string;
  '--print-badge-bg': string;

  '--motion-duration-fast': string;
  '--motion-duration-normal': string;
  '--motion-duration-slow': string;
  '--motion-ease-default': string;
  '--motion-spring-stiffness': string;
  '--motion-spring-damping': string;
  '--motion-tilt-max-deg': string;

  '--shadow-sm': string;
  '--shadow-md': string;
  '--shadow-lg': string;
  '--shadow-overlay': string;

  darkTokens?: Partial<Omit<ComponentTokens, 'darkTokens'>>;
}

const DEFAULT_DARK_TOKENS: Partial<Omit<ComponentTokens, 'darkTokens'>> = {
  '--btn-outline-bg': 'transparent',
  '--btn-outline-text': '#f9fafb',
  '--btn-outline-border': '#4b5563',
  '--btn-outline-hover-bg': 'rgba(255, 255, 255, 0.1)',
  '--btn-ghost-bg': 'transparent',
  '--btn-ghost-text': '#f9fafb',
  '--btn-ghost-hover-bg': 'rgba(255, 255, 255, 0.1)',
  '--dialog-bg': '#18181b',
  '--dialog-border-color': '#27272a',
  '--dialog-title-color': '#f9fafb',
  '--dialog-desc-color': '#a1a1aa',
  '--dialog-shadow': '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
  '--dialog-backdrop': 'rgba(0, 0, 0, 0.75)',
  '--schedule-card-bg': '#18181b',
  '--schedule-card-border': '#27272a',
  '--schedule-filter-bg': '#27272a',
  '--schedule-filter-text': '#e4e4e7',
  '--schedule-filter-hover-bg': '#3f3f46',
  '--schedule-tag-bg': '#27272a',
  '--schedule-tag-text': '#e4e4e7',
  '--shadow-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.4)',
  '--shadow-md': '0 4px 6px -1px rgba(0, 0, 0, 0.5), 0 2px 4px -2px rgba(0, 0, 0, 0.5)',
  '--shadow-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.5), 0 4px 6px -4px rgba(0, 0, 0, 0.5)',
  '--shadow-overlay': '0 20px 25px -5px rgba(0, 0, 0, 0.6), 0 8px 10px -6px rgba(0, 0, 0, 0.6)',
};

export const THEME_PRESETS: Record<ThemePreset, ComponentTokens> = {
  classic: {
    '--container-bg': 'var(--color-background, #fff1f2)',
    '--card-bg': '#ffffff',
    '--card-border': '#e5e7eb',
    '--card-shadow': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
    '--heading-color': 'var(--color-primary, #b91c1c)',

    '--btn-radius': '0.375rem',
    '--btn-font-weight': '500',
    '--btn-primary-bg': 'var(--color-primary, #B91C1C)',
    '--btn-primary-text': '#ffffff',
    '--btn-primary-hover-bg': 'color-mix(in srgb, var(--color-primary, #B91C1C) 90%, #000000)',
    '--btn-primary-border': 'transparent',
    '--btn-secondary-bg': 'var(--color-secondary, #B45309)',
    '--btn-secondary-text': '#ffffff',
    '--btn-secondary-hover-bg': 'color-mix(in srgb, var(--color-secondary, #B45309) 90%, #000000)',
    '--btn-secondary-border': 'transparent',
    '--btn-outline-bg': 'transparent',
    '--btn-outline-text': 'inherit',
    '--btn-outline-border': '#d1d5db',
    '--btn-outline-hover-bg': 'rgba(0, 0, 0, 0.05)',
    '--btn-ghost-bg': 'transparent',
    '--btn-ghost-text': 'inherit',
    '--btn-ghost-hover-bg': 'rgba(0, 0, 0, 0.05)',
    '--btn-danger-bg': '#b91c1c',
    '--btn-danger-text': '#ffffff',
    '--btn-danger-hover-bg': '#991b1b',
    '--btn-focus-ring': 'var(--color-primary, #B91C1C)',
    '--dialog-bg': '#ffffff',
    '--dialog-border-radius': '0.5rem',
    '--dialog-shadow': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
    '--dialog-backdrop': 'rgba(0, 0, 0, 0.6)',
    '--dialog-border-color': '#e5e7eb',
    '--dialog-title-color': 'inherit',
    '--dialog-desc-color': '#6b7280',

    '--input-bg': '#ffffff',
    '--input-border': '#d1d5db',
    '--input-focus-ring': 'var(--color-primary, #B91C1C)',
    '--input-radius': '0.375rem',
    '--input-error-border': '#ef4444',
    '--input-error-focus-ring': '#ef4444',
    '--input-success-border': '#22c55e',
    '--input-success-focus-ring': '#22c55e',
    '--input-warning-border': '#f59e0b',
    '--input-warning-focus-ring': '#f59e0b',
    '--form-label-text': '#111827',
    '--form-message-text': '#6b7280',
    '--form-error-text': '#dc2626',
    '--form-success-text': '#16a34a',
    '--form-warning-text': '#ca8a04',

    '--schedule-card-bg': '#ffffff',
    '--schedule-card-border': '#e5e7eb',
    '--schedule-card-radius': '1rem',
    '--schedule-filter-bg': '#f3f4f6',
    '--schedule-filter-text': '#374151',
    '--schedule-filter-hover-bg': '#e5e7eb',
    '--schedule-filter-active-bg': 'var(--color-primary, #B91C1C)',
    '--schedule-filter-active-text': '#ffffff',
    '--schedule-node-bg': 'var(--color-primary, #B91C1C)',
    '--schedule-node-border': '#ffffff',
    '--schedule-tag-bg': '#f3f4f6',
    '--schedule-tag-text': '#374151',

    '--print-bg': '#ffffff',
    '--print-text': '#111827',
    '--print-border': '#e5e7eb',
    '--print-header-border': '#111827',
    '--print-badge-bg': '#f3f4f6',

    '--motion-duration-fast': '0.15s',
    '--motion-duration-normal': '0.2s',
    '--motion-duration-slow': '0.8s',
    '--motion-ease-default': 'cubic-bezier(0.4, 0, 0.2, 1)',
    '--motion-spring-stiffness': '300',
    '--motion-spring-damping': '20',
    '--motion-tilt-max-deg': '10deg',

    '--shadow-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
    '--shadow-md': '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1)',
    '--shadow-lg': '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)',
    '--shadow-overlay': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',

    darkTokens: {
      '--btn-outline-bg': 'transparent',
      '--btn-outline-text': '#f9fafb',
      '--btn-outline-border': '#4b5563',
      '--btn-outline-hover-bg': 'rgba(255, 255, 255, 0.1)',
      '--btn-ghost-bg': 'transparent',
      '--btn-ghost-text': '#f9fafb',
      '--btn-ghost-hover-bg': 'rgba(255, 255, 255, 0.1)',
      '--dialog-bg': '#1f2937',
      '--dialog-border-color': '#374151',
      '--dialog-title-color': '#f9fafb',
      '--dialog-desc-color': '#9ca3af',
      '--dialog-shadow': '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
      '--dialog-backdrop': 'rgba(0, 0, 0, 0.75)',
      '--schedule-card-bg': '#1f2937',
      '--schedule-card-border': '#374151',
      '--schedule-filter-bg': '#374151',
      '--schedule-filter-text': '#f9fafb',
      '--schedule-filter-hover-bg': '#4b5563',
      '--schedule-tag-bg': '#374151',
      '--schedule-tag-text': '#f9fafb',
    },
  },
  modern: {
    '--container-bg': '#f8fafc',
    '--card-bg': '#ffffff',
    '--card-border': '#f1f5f9',
    '--card-shadow': '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
    '--heading-color': 'var(--color-primary, #B91C1C)',

    '--btn-radius': '0.5rem',
    '--btn-font-weight': '600',
    '--btn-primary-bg': 'var(--color-primary, #B91C1C)',
    '--btn-primary-text': '#ffffff',
    '--btn-primary-hover-bg': 'color-mix(in srgb, var(--color-primary, #B91C1C) 85%, #000000)',
    '--btn-primary-border': 'transparent',
    '--btn-secondary-bg': 'var(--color-secondary, #B45309)',
    '--btn-secondary-text': '#ffffff',
    '--btn-secondary-hover-bg': 'color-mix(in srgb, var(--color-secondary, #B45309) 85%, #000000)',
    '--btn-secondary-border': 'transparent',
    '--btn-outline-bg': 'transparent',
    '--btn-outline-text': 'var(--color-primary, #B91C1C)',
    '--btn-outline-border': 'var(--color-primary, #B91C1C)',
    '--btn-outline-hover-bg': 'color-mix(in srgb, var(--color-primary, #B91C1C) 10%, transparent)',
    '--btn-ghost-bg': 'transparent',
    '--btn-ghost-text': 'inherit',
    '--btn-ghost-hover-bg': 'rgba(0, 0, 0, 0.08)',
    '--btn-danger-bg': '#dc2626',
    '--btn-danger-text': '#ffffff',
    '--btn-danger-hover-bg': '#b91c1c',
    '--btn-focus-ring': 'var(--color-primary, #B91C1C)',
    '--dialog-bg': '#ffffff',
    '--dialog-border-radius': '0.75rem',
    '--dialog-shadow': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
    '--dialog-backdrop': 'rgba(15, 23, 42, 0.75)',
    '--dialog-border-color': '#f1f5f9',
    '--dialog-title-color': 'inherit',
    '--dialog-desc-color': '#64748b',

    '--input-bg': '#ffffff',
    '--input-border': '#cbd5e1',
    '--input-focus-ring': 'var(--color-primary, #B91C1C)',
    '--input-radius': '0.5rem',
    '--input-error-border': '#f87171',
    '--input-error-focus-ring': '#ef4444',
    '--input-success-border': '#4ade80',
    '--input-success-focus-ring': '#22c55e',
    '--input-warning-border': '#fbbf24',
    '--input-warning-focus-ring': '#f59e0b',
    '--form-label-text': '#0f172a',
    '--form-message-text': '#64748b',
    '--form-error-text': '#e11d48',
    '--form-success-text': '#059669',
    '--form-warning-text': '#d97706',

    '--schedule-card-bg': '#ffffff',
    '--schedule-card-border': '#f1f5f9',
    '--schedule-card-radius': '0.75rem',
    '--schedule-filter-bg': '#f8fafc',
    '--schedule-filter-text': '#334155',
    '--schedule-filter-hover-bg': '#f1f5f9',
    '--schedule-filter-active-bg': 'var(--color-primary, #B91C1C)',
    '--schedule-filter-active-text': '#ffffff',
    '--schedule-node-bg': 'var(--color-primary, #B91C1C)',
    '--schedule-node-border': '#ffffff',
    '--schedule-tag-bg': '#f1f5f9',
    '--schedule-tag-text': '#0f172a',

    '--print-bg': '#ffffff',
    '--print-text': '#0f172a',
    '--print-border': '#cbd5e1',
    '--print-header-border': '#0f172a',
    '--print-badge-bg': '#f1f5f9',

    '--motion-duration-fast': '0.1s',
    '--motion-duration-normal': '0.15s',
    '--motion-duration-slow': '0.5s',
    '--motion-ease-default': 'cubic-bezier(0.16, 1, 0.3, 1)',
    '--motion-spring-stiffness': '400',
    '--motion-spring-damping': '25',
    '--motion-tilt-max-deg': '12deg',

    '--shadow-sm': '0 1px 3px 0 rgba(0, 0, 0, 0.08)',
    '--shadow-md': '0 10px 15px -3px rgba(0, 0, 0, 0.12), 0 4px 6px -4px rgba(0, 0, 0, 0.08)',
    '--shadow-lg': '0 20px 25px -5px rgba(0, 0, 0, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.08)',
    '--shadow-overlay': '0 25px 50px -12px rgba(0, 0, 0, 0.25)',

    darkTokens: {
      '--btn-outline-bg': 'transparent',
      '--btn-outline-text': 'var(--color-primary, #B91C1C)',
      '--btn-outline-border': 'var(--color-primary, #B91C1C)',
      '--btn-outline-hover-bg': 'color-mix(in srgb, var(--color-primary, #B91C1C) 20%, transparent)',
      '--btn-ghost-bg': 'transparent',
      '--btn-ghost-text': '#f8fafc',
      '--btn-ghost-hover-bg': 'rgba(255, 255, 255, 0.1)',
      '--dialog-bg': '#0f172a',
      '--dialog-border-color': '#1e293b',
      '--dialog-title-color': '#f8fafc',
      '--dialog-desc-color': '#94a3b8',
      '--dialog-shadow': '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
      '--dialog-backdrop': 'rgba(2, 6, 23, 0.8)',
      '--schedule-card-bg': '#0f172a',
      '--schedule-card-border': '#1e293b',
      '--schedule-filter-bg': '#1e293b',
      '--schedule-filter-text': '#f8fafc',
      '--schedule-filter-hover-bg': '#334155',
      '--schedule-tag-bg': '#1e293b',
      '--schedule-tag-text': '#f8fafc',
    },
  },
  romantic: {
    '--container-bg': '#fdf2f8',
    '--card-bg': '#fffafb',
    '--card-border': '#fce7f3',
    '--card-shadow': '0 20px 30px -10px rgba(225, 175, 185, 0.35)',
    '--heading-color': 'var(--color-primary, #B91C1C)',

    '--btn-radius': '9999px',
    '--btn-font-weight': '500',
    '--btn-primary-bg': 'var(--color-primary, #B91C1C)',
    '--btn-primary-text': '#ffffff',
    '--btn-primary-hover-bg': 'color-mix(in srgb, var(--color-primary, #B91C1C) 88%, #ffffff)',
    '--btn-primary-border': 'transparent',
    '--btn-secondary-bg': 'var(--color-secondary, #B45309)',
    '--btn-secondary-text': '#ffffff',
    '--btn-secondary-hover-bg': 'color-mix(in srgb, var(--color-secondary, #B45309) 88%, #ffffff)',
    '--btn-secondary-border': 'transparent',
    '--btn-outline-bg': 'transparent',
    '--btn-outline-text': 'var(--color-primary, #B91C1C)',
    '--btn-outline-border': 'color-mix(in srgb, var(--color-primary, #B91C1C) 40%, #e5e7eb)',
    '--btn-outline-hover-bg': 'color-mix(in srgb, var(--color-primary, #B91C1C) 8%, transparent)',
    '--btn-ghost-bg': 'transparent',
    '--btn-ghost-text': 'inherit',
    '--btn-ghost-hover-bg': 'rgba(244, 114, 182, 0.1)',
    '--btn-danger-bg': '#e11d48',
    '--btn-danger-text': '#ffffff',
    '--btn-danger-hover-bg': '#be123c',
    '--btn-focus-ring': 'var(--color-primary, #B91C1C)',
    '--dialog-bg': '#fffafb',
    '--dialog-border-radius': '1.25rem',
    '--dialog-shadow': '0 20px 30px -10px rgba(225, 175, 185, 0.35)',
    '--dialog-backdrop': 'rgba(45, 20, 30, 0.6)',
    '--dialog-border-color': '#fce7f3',
    '--dialog-title-color': 'inherit',
    '--dialog-desc-color': '#9d174d',

    '--input-bg': '#fffafb',
    '--input-border': '#fce7f3',
    '--input-focus-ring': 'var(--color-primary, #B91C1C)',
    '--input-radius': '0.75rem',
    '--input-error-border': '#f43f5e',
    '--input-error-focus-ring': '#f43f5e',
    '--input-success-border': '#10b981',
    '--input-success-focus-ring': '#10b981',
    '--input-warning-border': '#f59e0b',
    '--input-warning-focus-ring': '#f59e0b',
    '--form-label-text': '#831843',
    '--form-message-text': '#9d174d',
    '--form-error-text': '#be123c',
    '--form-success-text': '#047857',
    '--form-warning-text': '#b45309',

    '--schedule-card-bg': '#fffafb',
    '--schedule-card-border': '#fce7f3',
    '--schedule-card-radius': '1.25rem',
    '--schedule-filter-bg': '#fdf2f8',
    '--schedule-filter-text': '#831843',
    '--schedule-filter-hover-bg': '#fbcfe8',
    '--schedule-filter-active-bg': 'var(--color-primary, #B91C1C)',
    '--schedule-filter-active-text': '#ffffff',
    '--schedule-node-bg': 'var(--color-primary, #B91C1C)',
    '--schedule-node-border': '#fffafb',
    '--schedule-tag-bg': '#fce7f3',
    '--schedule-tag-text': '#9d174d',

    '--print-bg': '#fffafb',
    '--print-text': '#831843',
    '--print-border': '#fbcfe8',
    '--print-header-border': '#9d174d',
    '--print-badge-bg': '#fce7f3',

    '--motion-duration-fast': '0.25s',
    '--motion-duration-normal': '0.35s',
    '--motion-duration-slow': '1.0s',
    '--motion-ease-default': 'cubic-bezier(0.25, 1, 0.5, 1)',
    '--motion-spring-stiffness': '180',
    '--motion-spring-damping': '14',
    '--motion-tilt-max-deg': '8deg',

    '--shadow-sm': '0 2px 8px -2px rgba(225, 175, 185, 0.3)',
    '--shadow-md': '0 8px 20px -4px rgba(225, 175, 185, 0.35)',
    '--shadow-lg': '0 20px 30px -10px rgba(225, 175, 185, 0.35)',
    '--shadow-overlay': '0 25px 35px -10px rgba(225, 175, 185, 0.45)',

    darkTokens: {
      '--btn-outline-bg': 'transparent',
      '--btn-outline-text': 'var(--color-primary, #B91C1C)',
      '--btn-outline-border': 'color-mix(in srgb, var(--color-primary, #B91C1C) 50%, #fce7f3)',
      '--btn-outline-hover-bg': 'color-mix(in srgb, var(--color-primary, #B91C1C) 18%, transparent)',
      '--btn-ghost-bg': 'transparent',
      '--btn-ghost-text': '#fdf2f8',
      '--btn-ghost-hover-bg': 'rgba(244, 114, 182, 0.15)',
      '--dialog-bg': '#231118',
      '--dialog-border-color': '#4a1d2f',
      '--dialog-title-color': '#fdf2f8',
      '--dialog-desc-color': '#fbcfe8',
      '--dialog-shadow': '0 20px 30px -10px rgba(0, 0, 0, 0.6)',
      '--dialog-backdrop': 'rgba(20, 5, 12, 0.8)',
      '--schedule-card-bg': '#231118',
      '--schedule-card-border': '#4a1d2f',
      '--schedule-filter-bg': '#3b1827',
      '--schedule-filter-text': '#fdf2f8',
      '--schedule-filter-hover-bg': '#501d35',
      '--schedule-node-border': '#231118',
      '--schedule-tag-bg': '#3b1827',
      '--schedule-tag-text': '#fbcfe8',
    },
  },
  minimal: {
    '--container-bg': '#fafafa',
    '--card-bg': '#ffffff',
    '--card-border': '#e4e4e7',
    '--card-shadow': '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
    '--heading-color': '#18181b',

    '--btn-radius': '0px',
    '--btn-font-weight': '500',
    '--btn-primary-bg': 'var(--color-primary, #B91C1C)',
    '--btn-primary-text': '#ffffff',
    '--btn-primary-hover-bg': 'color-mix(in srgb, var(--color-primary, #B91C1C) 80%, #000000)',
    '--btn-primary-border': 'transparent',
    '--btn-secondary-bg': 'var(--color-secondary, #B45309)',
    '--btn-secondary-text': '#ffffff',
    '--btn-secondary-hover-bg': 'color-mix(in srgb, var(--color-secondary, #B45309) 80%, #000000)',
    '--btn-secondary-border': 'transparent',
    '--btn-outline-bg': 'transparent',
    '--btn-outline-text': 'inherit',
    '--btn-outline-border': '#27272a',
    '--btn-outline-hover-bg': 'rgba(0, 0, 0, 0.04)',
    '--btn-ghost-bg': 'transparent',
    '--btn-ghost-text': 'inherit',
    '--btn-ghost-hover-bg': 'rgba(0, 0, 0, 0.04)',
    '--btn-danger-bg': '#991b1b',
    '--btn-danger-text': '#ffffff',
    '--btn-danger-hover-bg': '#7f1d1d',
    '--btn-focus-ring': 'var(--color-primary, #B91C1C)',
    '--dialog-bg': '#ffffff',
    '--dialog-border-radius': '0px',
    '--dialog-shadow': '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
    '--dialog-backdrop': 'rgba(0, 0, 0, 0.4)',
    '--dialog-border-color': '#e4e4e7',
    '--dialog-title-color': 'inherit',
    '--dialog-desc-color': '#71717a',

    '--input-bg': '#ffffff',
    '--input-border': '#e4e4e7',
    '--input-focus-ring': 'var(--color-primary, #B91C1C)',
    '--input-radius': '0px',
    '--input-error-border': '#991b1b',
    '--input-error-focus-ring': '#991b1b',
    '--input-success-border': '#166534',
    '--input-success-focus-ring': '#166534',
    '--input-warning-border': '#854d0e',
    '--input-warning-focus-ring': '#854d0e',
    '--form-label-text': '#18181b',
    '--form-message-text': '#71717a',
    '--form-error-text': '#991b1b',
    '--form-success-text': '#166534',
    '--form-warning-text': '#854d0e',

    '--schedule-card-bg': '#ffffff',
    '--schedule-card-border': '#e4e4e7',
    '--schedule-card-radius': '0px',
    '--schedule-filter-bg': '#f4f4f5',
    '--schedule-filter-text': '#18181b',
    '--schedule-filter-hover-bg': '#e4e4e7',
    '--schedule-filter-active-bg': '#18181b',
    '--schedule-filter-active-text': '#ffffff',
    '--schedule-node-bg': 'var(--color-primary, #B91C1C)',
    '--schedule-node-border': '#ffffff',
    '--schedule-tag-bg': '#f4f4f5',
    '--schedule-tag-text': '#18181b',

    '--print-bg': '#ffffff',
    '--print-text': '#18181b',
    '--print-border': '#e4e4e7',
    '--print-header-border': '#18181b',
    '--print-badge-bg': '#f4f4f5',

    '--motion-duration-fast': '0.08s',
    '--motion-duration-normal': '0.12s',
    '--motion-duration-slow': '0.3s',
    '--motion-ease-default': 'linear',
    '--motion-spring-stiffness': '500',
    '--motion-spring-damping': '35',
    '--motion-tilt-max-deg': '4deg',

    '--shadow-sm': '0 1px 2px 0 rgba(0, 0, 0, 0.04)',
    '--shadow-md': '0 1px 3px 0 rgba(0, 0, 0, 0.1)',
    '--shadow-lg': '0 2px 5px 0 rgba(0, 0, 0, 0.1)',
    '--shadow-overlay': '0 4px 12px 0 rgba(0, 0, 0, 0.15)',

    darkTokens: {
      '--btn-outline-bg': 'transparent',
      '--btn-outline-text': '#f4f4f5',
      '--btn-outline-border': '#52525b',
      '--btn-outline-hover-bg': 'rgba(255, 255, 255, 0.08)',
      '--btn-ghost-bg': 'transparent',
      '--btn-ghost-text': '#f4f4f5',
      '--btn-ghost-hover-bg': 'rgba(255, 255, 255, 0.08)',
      '--dialog-bg': '#18181b',
      '--dialog-border-color': '#27272a',
      '--dialog-title-color': '#f4f4f5',
      '--dialog-desc-color': '#a1a1aa',
      '--dialog-shadow': '0 1px 3px 0 rgba(0, 0, 0, 0.5)',
      '--dialog-backdrop': 'rgba(0, 0, 0, 0.7)',
      '--schedule-card-bg': '#18181b',
      '--schedule-card-border': '#27272a',
      '--schedule-filter-bg': '#27272a',
      '--schedule-filter-text': '#f4f4f5',
      '--schedule-filter-hover-bg': '#3f3f46',
      '--schedule-filter-active-bg': '#f4f4f5',
      '--schedule-filter-active-text': '#18181b',
      '--schedule-node-border': '#18181b',
      '--schedule-tag-bg': '#27272a',
      '--schedule-tag-text': '#f4f4f5',
    },
  },
  editorial: {
    '--container-bg': '#f5f5f4',
    '--card-bg': '#fcfbf9',
    '--card-border': '#000000',
    '--card-shadow': '4px 4px 0px 0px rgba(0,0,0,0.9)',
    '--heading-color': '#000000',

    '--btn-radius': '0.125rem',
    '--btn-font-weight': '700',
    '--btn-primary-bg': 'var(--color-primary, #B91C1C)',
    '--btn-primary-text': '#ffffff',
    '--btn-primary-hover-bg': 'color-mix(in srgb, var(--color-primary, #B91C1C) 92%, #000000)',
    '--btn-primary-border': '#000000',
    '--btn-secondary-bg': 'var(--color-secondary, #B45309)',
    '--btn-secondary-text': '#ffffff',
    '--btn-secondary-hover-bg': 'color-mix(in srgb, var(--color-secondary, #B45309) 92%, #000000)',
    '--btn-secondary-border': '#000000',
    '--btn-outline-bg': '#ffffff',
    '--btn-outline-text': '#000000',
    '--btn-outline-border': '#000000',
    '--btn-outline-hover-bg': '#f4f4f5',
    '--btn-ghost-bg': 'transparent',
    '--btn-ghost-text': '#000000',
    '--btn-ghost-hover-bg': '#f4f4f5',
    '--btn-danger-bg': '#b91c1c',
    '--btn-danger-text': '#ffffff',
    '--btn-danger-hover-bg': '#991b1b',
    '--btn-focus-ring': '#000000',
    '--dialog-bg': '#fcfbf9',
    '--dialog-border-radius': '0.125rem',
    '--dialog-shadow': '4px 4px 0px 0px rgba(0,0,0,0.9)',
    '--dialog-backdrop': 'rgba(0, 0, 0, 0.7)',
    '--dialog-border-color': '#000000',
    '--dialog-title-color': '#000000',
    '--dialog-desc-color': '#3f3f46',

    '--input-bg': '#fcfbf9',
    '--input-border': '#000000',
    '--input-focus-ring': '#000000',
    '--input-radius': '0.125rem',
    '--input-error-border': '#b91c1c',
    '--input-error-focus-ring': '#000000',
    '--input-success-border': '#15803d',
    '--input-success-focus-ring': '#000000',
    '--input-warning-border': '#a16207',
    '--input-warning-focus-ring': '#000000',
    '--form-label-text': '#000000',
    '--form-message-text': '#3f3f46',
    '--form-error-text': '#b91c1c',
    '--form-success-text': '#15803d',
    '--form-warning-text': '#a16207',

    '--schedule-card-bg': '#fcfbf9',
    '--schedule-card-border': '#000000',
    '--schedule-card-radius': '0.125rem',
    '--schedule-filter-bg': '#f4f4f5',
    '--schedule-filter-text': '#000000',
    '--schedule-filter-hover-bg': '#e4e4e7',
    '--schedule-filter-active-bg': '#000000',
    '--schedule-filter-active-text': '#ffffff',
    '--schedule-node-bg': 'var(--color-primary, #B91C1C)',
    '--schedule-node-border': '#000000',
    '--schedule-tag-bg': '#e4e4e7',
    '--schedule-tag-text': '#000000',

    '--print-bg': '#fcfbf9',
    '--print-text': '#000000',
    '--print-border': '#000000',
    '--print-header-border': '#000000',
    '--print-badge-bg': '#e4e4e7',

    '--motion-duration-fast': '0.12s',
    '--motion-duration-normal': '0.22s',
    '--motion-duration-slow': '0.6s',
    '--motion-ease-default': 'cubic-bezier(0.2, 0, 0, 1)',
    '--motion-spring-stiffness': '350',
    '--motion-spring-damping': '22',
    '--motion-tilt-max-deg': '15deg',

    '--shadow-sm': '2px 2px 0px 0px rgba(0,0,0,0.9)',
    '--shadow-md': '3px 3px 0px 0px rgba(0,0,0,0.9)',
    '--shadow-lg': '4px 4px 0px 0px rgba(0,0,0,0.9)',
    '--shadow-overlay': '6px 6px 0px 0px rgba(0,0,0,0.9)',

    darkTokens: {
      '--btn-primary-border': '#ffffff',
      '--btn-secondary-border': '#ffffff',
      '--btn-outline-bg': '#1c1917',
      '--btn-outline-text': '#ffffff',
      '--btn-outline-border': '#ffffff',
      '--btn-outline-hover-bg': '#292524',
      '--btn-ghost-bg': 'transparent',
      '--btn-ghost-text': '#ffffff',
      '--btn-ghost-hover-bg': '#292524',
      '--btn-focus-ring': '#ffffff',
      '--dialog-bg': '#1c1917',
      '--dialog-border-color': '#ffffff',
      '--dialog-title-color': '#ffffff',
      '--dialog-desc-color': '#d6d3d1',
      '--dialog-shadow': '4px 4px 0px 0px rgba(255,255,255,0.9)',
      '--dialog-backdrop': 'rgba(0, 0, 0, 0.85)',
      '--schedule-card-bg': '#1c1917',
      '--schedule-card-border': '#ffffff',
      '--schedule-filter-bg': '#292524',
      '--schedule-filter-text': '#ffffff',
      '--schedule-filter-hover-bg': '#44403c',
      '--schedule-filter-active-bg': '#ffffff',
      '--schedule-filter-active-text': '#1c1917',
      '--schedule-node-border': '#ffffff',
      '--schedule-tag-bg': '#292524',
      '--schedule-tag-text': '#ffffff',
      '--shadow-sm': '2px 2px 0px 0px rgba(255,255,255,0.9)',
      '--shadow-md': '3px 3px 0px 0px rgba(255,255,255,0.9)',
      '--shadow-lg': '4px 4px 0px 0px rgba(255,255,255,0.9)',
      '--shadow-overlay': '6px 6px 0px 0px rgba(255,255,255,0.9)',
    },
  },
};

export const DEFAULT_THEME_PRESET: ThemePreset = 'classic';

export function isThemePreset(value: unknown): value is ThemePreset {
  return typeof value === 'string' && THEME_PRESET_KEYS.includes(value as ThemePreset);
}

export function parseMotionEasing(easing?: string): any {
  if (!easing) return 'easeInOut';
  if (easing === 'ease-in-out') return 'easeInOut';
  if (easing === 'ease-in') return 'easeIn';
  if (easing === 'ease-out') return 'easeOut';

  const cubicMatch = easing.match(/cubic-bezier\(\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*,\s*([\d.-]+)\s*\)/i);
  if (cubicMatch) {
    return [
      parseFloat(cubicMatch[1]),
      parseFloat(cubicMatch[2]),
      parseFloat(cubicMatch[3]),
      parseFloat(cubicMatch[4]),
    ];
  }
  return easing;
}

export function getPresetTokens(
  preset?: string | null,
  mode: 'light' | 'dark' = 'light'
): ComponentTokens {
  const selectedPreset = preset && isThemePreset(preset) ? preset : DEFAULT_THEME_PRESET;
  const baseTokens = THEME_PRESETS[selectedPreset];

  if (mode === 'dark') {
    return {
      ...baseTokens,
      ...DEFAULT_DARK_TOKENS,
      ...(baseTokens.darkTokens || {}),
    };
  }

  return baseTokens;
}
