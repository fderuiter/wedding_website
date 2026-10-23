export type ThemePreset = 'classic' | 'modern' | 'romantic' | 'minimal' | 'editorial';

export const THEME_PRESET_KEYS: ThemePreset[] = ['classic', 'modern', 'romantic', 'minimal', 'editorial'];

export interface ServerExportTokens {
  canvasBg: string;
  cardBg: string;
  colorPrimary: string;
  colorSecondary: string;
  textMuted: string;
  borderAccent: string;
  badgeBg: string;
  badgeText: string;
  fontHeading: string;
  fontBody: string;
  printBg: string;
  printText: string;
  printBorder: string;
  printHeaderBorder: string;
  printBadgeBg: string;
}

export interface ComponentTokens {
  '--font-heading': string;
  '--font-body': string;
  '--font-mono': string;
  '--font-size-display': string;
  '--font-size-h1': string;
  '--font-size-h2': string;
  '--font-size-h3': string;
  '--font-size-body': string;
  '--font-weight-heading': string;
  '--font-weight-body': string;
  '--line-height-heading': string;
  '--line-height-body': string;
  '--letter-spacing-heading': string;
  '--letter-spacing-body': string;

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

  '--toast-success-bg': string;
  '--toast-success-text': string;
  '--toast-error-bg': string;
  '--toast-error-text': string;
  '--toast-info-bg': string;
  '--toast-info-text': string;
  '--toast-confirm-bg': string;
  '--toast-confirm-text': string;
  '--toast-radius': string;
  '--toast-close-hover-bg': string;

  '--print-bg': string;
  '--print-text': string;
  '--print-border': string;
  '--print-header-border': string;
  '--print-badge-bg': string;

  '--canvas-bg': string;
  '--canvas-grid-dot': string;
  '--canvas-border': string;
  '--floorplan-table-bg': string;
  '--floorplan-table-border': string;
  '--floorplan-table-radius': string;
  '--floorplan-seat-assigned-bg': string;
  '--floorplan-seat-assigned-text': string;
  '--floorplan-seat-unassigned-hover': string;
  '--floorplan-status-overcapacity-bg': string;
  '--floorplan-status-overcapacity-border': string;

  '--glow-color': string;
  '--glow-gradient': string;
  '--particle-color': string;
  '--3d-metalness': string;
  '--3d-roughness': string;
  '--3d-env-map-intensity': string;
  '--3d-physics-accessibility-impulse': string;
  '--3d-physics-drag-velocity-multiplier': string;
  '--3d-physics-bump-impulse-y': string;
  '--3d-physics-bump-impulse-random-multiplier': string;
  '--3d-physics-break-force-threshold': string;
  '--3d-physics-explosion-impulse-left-x': string;
  '--3d-physics-explosion-impulse-left-y': string;
  '--3d-physics-explosion-impulse-left-z': string;
  '--3d-physics-explosion-impulse-right-x': string;
  '--3d-physics-explosion-impulse-right-y': string;
  '--3d-physics-explosion-impulse-right-z': string;
  '--3d-physics-explosion-torque-strength': string;
  '--3d-physics-return-force-multiplier': string;
  '--3d-physics-pulse-speed-dragging': string;
  '--3d-physics-pulse-speed-idle': string;
  '--3d-physics-pulse-scale-multiplier': string;
  '--3d-physics-idle-rotation-speed': string;
  '--3d-extrusion-depth': string;
  '--3d-extrusion-bevel-enabled': string;
  '--3d-extrusion-bevel-thickness': string;
  '--3d-extrusion-bevel-size': string;
  '--3d-extrusion-bevel-segments': string;
  '--3d-light-ambient-intensity': string;
  '--3d-light-directional-intensity': string;
  '--glow-filter': string;
  '--card-perspective': string;
  '--card-max-rotation': string;
  '--card-spring-stiffness': string;
  '--card-spring-damping': string;

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

  '--font-size-xs'?: string;
  '--font-size-sm'?: string;
  '--font-size-base'?: string;
  '--font-size-lg'?: string;
  '--font-size-xl'?: string;
  '--font-size-2xl'?: string;
  '--font-weight-normal'?: string;
  '--font-weight-medium'?: string;
  '--font-weight-bold'?: string;
  '--line-height-tight'?: string;
  '--line-height-normal'?: string;
  '--line-height-relaxed'?: string;

  '--spacing-xs'?: string;
  '--spacing-sm'?: string;
  '--spacing-md'?: string;
  '--spacing-lg'?: string;
  '--spacing-xl'?: string;
  '--spacing-2xl'?: string;

  '--border-radius-sm'?: string;
  '--border-radius-md'?: string;
  '--border-radius-lg'?: string;
  '--border-radius-full'?: string;
  '--border-width-thin'?: string;
  '--border-width-medium'?: string;
  '--border-width-thick'?: string;
  '--border-style-default'?: string;

  '--brand-logo-width'?: string;
  '--brand-logo-height'?: string;
  '--brand-hero-height'?: string;
  '--brand-watermark-width'?: string;
  '--brand-watermark-opacity'?: string;
  '--brand-badge-size'?: string;

  '--brand-hero-image'?: string;
  '--brand-watermark-image'?: string;
  '--brand-badge-graphic'?: string;

  serverExportTokens?: ServerExportTokens;
  darkTokens?: Partial<Omit<ComponentTokens, 'darkTokens'>>;
}

const DEFAULT_DARK_TOKENS: Partial<Omit<ComponentTokens, 'darkTokens'>> = {
  '--container-bg': '#111827',
  '--card-bg': '#1f2937',
  '--card-border': '#374151',
  '--heading-color': '#f9fafb',
  '--btn-outline-bg': 'transparent',
  '--btn-outline-text': '#f9fafb',
  '--btn-outline-border': '#9ca3af',
  '--btn-outline-hover-bg': 'rgba(255, 255, 255, 0.1)',
  '--btn-ghost-bg': 'transparent',
  '--btn-ghost-text': '#f9fafb',
  '--btn-ghost-hover-bg': 'rgba(255, 255, 255, 0.1)',
  '--btn-focus-ring': '#f9fafb',
  '--dialog-bg': '#18181b',
  '--dialog-border-color': '#27272a',
  '--dialog-title-color': '#f9fafb',
  '--dialog-desc-color': '#a1a1aa',
  '--dialog-shadow': '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
  '--dialog-backdrop': 'rgba(0, 0, 0, 0.75)',
  '--input-bg': '#18181b',
  '--input-border': '#3f3f46',
  '--input-focus-ring': '#f9fafb',
  '--form-label-text': '#f9fafb',
  '--form-message-text': '#a1a1aa',
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
  '--canvas-bg': '#111827',
  '--canvas-grid-dot': '#374151',
  '--canvas-border': '2px dashed #374151',
  '--floorplan-table-bg': '#1f2937',
  '--floorplan-table-border': '#374151',
  '--floorplan-seat-assigned-bg': 'var(--color-primary, #B91C1C)',
  '--floorplan-seat-assigned-text': '#ffffff',
  '--floorplan-seat-unassigned-hover': '#374151',
  '--floorplan-status-overcapacity-bg': '#450a0a',
  '--floorplan-status-overcapacity-border': '#dc2626',
};

export const THEME_PRESETS: Record<ThemePreset, ComponentTokens> = {
  classic: {
    '--font-heading': 'var(--font-playfair), Playfair Display, Georgia, serif',
    '--font-body': 'var(--font-geist-sans), Arial, Helvetica, sans-serif',
    '--font-mono': 'var(--font-geist-mono), monospace',
    '--font-size-display': '3.75rem',
    '--font-size-h1': '2.25rem',
    '--font-size-h2': '1.875rem',
    '--font-size-h3': '1.5rem',
    '--font-size-body': '1rem',
    '--font-weight-heading': '700',
    '--font-weight-body': '400',
    '--line-height-heading': '1.2',
    '--line-height-body': '1.625',
    '--letter-spacing-heading': '-0.01em',
    '--letter-spacing-body': '0em',
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

    '--toast-success-bg': '#15803d',
    '--toast-success-text': '#ffffff',
    '--toast-error-bg': '#b91c1c',
    '--toast-error-text': '#ffffff',
    '--toast-info-bg': '#1d4ed8',
    '--toast-info-text': '#ffffff',
    '--toast-confirm-bg': '#1f2937',
    '--toast-confirm-text': '#ffffff',
    '--toast-radius': '0.375rem',
    '--toast-close-hover-bg': 'rgba(255, 255, 255, 0.2)',

    '--print-bg': '#ffffff',
    '--print-text': '#111827',
    '--print-border': '#e5e7eb',
    '--print-header-border': '#111827',
    '--print-badge-bg': '#f3f4f6',

    '--canvas-bg': '#f8fafc',
    '--canvas-grid-dot': '#cbd5e1',
    '--canvas-border': '2px dashed #cbd5e1',
    '--floorplan-table-bg': '#ffffff',
    '--floorplan-table-border': '#d1d5db',
    '--floorplan-table-radius': '0.75rem',
    '--floorplan-seat-assigned-bg': 'var(--color-primary, #B91C1C)',
    '--floorplan-seat-assigned-text': '#ffffff',
    '--floorplan-seat-unassigned-hover': '#fef2f2',
    '--floorplan-status-overcapacity-bg': '#fef2f2',
    '--floorplan-status-overcapacity-border': '#ef4444',

    '--glow-color': 'color-mix(in srgb, var(--color-primary, #B91C1C) 6%, transparent)',
    '--glow-gradient': 'radial-gradient(800px circle at 50% 50%, color-mix(in srgb, var(--color-primary, #B91C1C) 6%, transparent), transparent)',
    '--particle-color': 'var(--color-accent, #D4AF37)',
    '--3d-metalness': '1',
    '--3d-roughness': '0.2',
    '--3d-env-map-intensity': '1.2',
    '--3d-physics-accessibility-impulse': '20',
    '--3d-physics-drag-velocity-multiplier': '20',
    '--3d-physics-bump-impulse-y': '10',
    '--3d-physics-bump-impulse-random-multiplier': '10',
    '--3d-physics-break-force-threshold': '200',
    '--3d-physics-explosion-impulse-left-x': '20',
    '--3d-physics-explosion-impulse-left-y': '15',
    '--3d-physics-explosion-impulse-left-z': '5',
    '--3d-physics-explosion-impulse-right-x': '-20',
    '--3d-physics-explosion-impulse-right-y': '15',
    '--3d-physics-explosion-impulse-right-z': '-5',
    '--3d-physics-explosion-torque-strength': '40',
    '--3d-physics-return-force-multiplier': '15',
    '--3d-physics-pulse-speed-dragging': '5',
    '--3d-physics-pulse-speed-idle': '1',
    '--3d-physics-pulse-scale-multiplier': '0.05',
    '--3d-physics-idle-rotation-speed': '0.002',
    '--3d-extrusion-depth': '1.3',
    '--3d-extrusion-bevel-enabled': 'true',
    '--3d-extrusion-bevel-thickness': '0.25',
    '--3d-extrusion-bevel-size': '0.18',
    '--3d-extrusion-bevel-segments': '4',
    '--3d-light-ambient-intensity': '0.8',
    '--3d-light-directional-intensity': '1.6',
    '--glow-filter': 'drop-shadow(0 0 10px var(--color-accent, #D4AF37))',
    '--card-perspective': '1000px',
    '--card-max-rotation': '10deg',
    '--card-spring-stiffness': '300',
    '--card-spring-damping': '20',

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

    '--font-size-xs': '0.75rem',
    '--font-size-sm': '0.875rem',
    '--font-size-base': '1rem',
    '--font-size-lg': '1.125rem',
    '--font-size-xl': '1.25rem',
    '--font-size-2xl': '1.5rem',
    '--font-weight-normal': '400',
    '--font-weight-medium': '500',
    '--font-weight-bold': '700',
    '--line-height-tight': '1.25',
    '--line-height-normal': '1.5',
    '--line-height-relaxed': '1.75',

    '--spacing-xs': '0.25rem',
    '--spacing-sm': '0.5rem',
    '--spacing-md': '1rem',
    '--spacing-lg': '1.5rem',
    '--spacing-xl': '2rem',
    '--spacing-2xl': '3rem',

    '--border-radius-sm': '0.25rem',
    '--border-radius-md': '0.375rem',
    '--border-radius-lg': '0.5rem',
    '--border-radius-full': '9999px',
    '--border-width-thin': '1px',
    '--border-width-medium': '2px',
    '--border-width-thick': '4px',
    '--border-style-default': 'solid',

    '--brand-logo-width': '120px',
    '--brand-logo-height': '40px',
    '--brand-hero-height': '400px',
    '--brand-watermark-width': '200px',
    '--brand-watermark-opacity': '0.1',
    '--brand-badge-size': '48px',

    '--brand-hero-image': 'none',
    '--brand-watermark-image': 'none',
    '--brand-badge-graphic': 'none',

    serverExportTokens: {
      canvasBg: '#fff1f2',
      cardBg: '#ffffff',
      colorPrimary: '#B91C1C',
      colorSecondary: '#B45309',
      textMuted: '#4b5563',
      borderAccent: '#B91C1C',
      badgeBg: '#f3f4f6',
      badgeText: '#B45309',
      fontHeading: 'Playfair Display, Georgia, serif',
      fontBody: 'Geist Sans, Arial, sans-serif',
      printBg: '#ffffff',
      printText: '#111827',
      printBorder: '#e5e7eb',
      printHeaderBorder: '#111827',
      printBadgeBg: '#f3f4f6',
    },

    darkTokens: {
      '--container-bg': '#111827',
      '--card-bg': '#1f2937',
      '--card-border': '#374151',
      '--heading-color': '#f9fafb',
      '--btn-outline-bg': 'transparent',
      '--btn-outline-text': '#f9fafb',
      '--btn-outline-border': '#9ca3af',
      '--btn-outline-hover-bg': 'rgba(255, 255, 255, 0.1)',
      '--btn-ghost-bg': 'transparent',
      '--btn-ghost-text': '#f9fafb',
      '--btn-ghost-hover-bg': 'rgba(255, 255, 255, 0.1)',
      '--btn-focus-ring': '#f9fafb',
      '--dialog-bg': '#1f2937',
      '--dialog-border-color': '#374151',
      '--dialog-title-color': '#f9fafb',
      '--dialog-desc-color': '#9ca3af',
      '--dialog-shadow': '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
      '--dialog-backdrop': 'rgba(0, 0, 0, 0.75)',
      '--input-bg': '#1f2937',
      '--input-border': '#4b5563',
      '--input-focus-ring': '#f9fafb',
      '--form-label-text': '#f9fafb',
      '--form-message-text': '#9ca3af',
      '--schedule-card-bg': '#1f2937',
      '--schedule-card-border': '#374151',
      '--schedule-filter-bg': '#374151',
      '--schedule-filter-text': '#f9fafb',
      '--schedule-filter-hover-bg': '#4b5563',
      '--schedule-tag-bg': '#374151',
      '--schedule-tag-text': '#f9fafb',
      '--canvas-bg': '#111827',
      '--canvas-grid-dot': '#374151',
      '--canvas-border': '2px dashed #374151',
      '--floorplan-table-bg': '#1f2937',
      '--floorplan-table-border': '#374151',
      '--floorplan-seat-assigned-bg': 'var(--color-primary, #B91C1C)',
      '--floorplan-seat-assigned-text': '#ffffff',
      '--floorplan-seat-unassigned-hover': '#374151',
      '--floorplan-status-overcapacity-bg': '#450a0a',
      '--floorplan-status-overcapacity-border': '#dc2626',
    },
  },
  modern: {
    '--font-heading': 'var(--font-inter), Arial, Helvetica, sans-serif',
    '--font-body': 'var(--font-inter), Arial, Helvetica, sans-serif',
    '--font-mono': 'var(--font-geist-mono), monospace',
    '--font-size-display': '4rem',
    '--font-size-h1': '2.5rem',
    '--font-size-h2': '2rem',
    '--font-size-h3': '1.5rem',
    '--font-size-body': '1rem',
    '--font-weight-heading': '800',
    '--font-weight-body': '400',
    '--line-height-heading': '1.15',
    '--line-height-body': '1.5',
    '--letter-spacing-heading': '-0.025em',
    '--letter-spacing-body': '0em',
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

    '--toast-success-bg': '#047857',
    '--toast-success-text': '#ffffff',
    '--toast-error-bg': '#b91c1c',
    '--toast-error-text': '#ffffff',
    '--toast-info-bg': '#0369a1',
    '--toast-info-text': '#ffffff',
    '--toast-confirm-bg': '#0f172a',
    '--toast-confirm-text': '#ffffff',
    '--toast-radius': '0.5rem',
    '--toast-close-hover-bg': 'rgba(255, 255, 255, 0.2)',

    '--print-bg': '#ffffff',
    '--print-text': '#0f172a',
    '--print-border': '#cbd5e1',
    '--print-header-border': '#0f172a',
    '--print-badge-bg': '#f1f5f9',

    '--canvas-bg': '#f8fafc',
    '--canvas-grid-dot': '#cbd5e1',
    '--canvas-border': '1px solid #cbd5e1',
    '--floorplan-table-bg': '#ffffff',
    '--floorplan-table-border': '#cbd5e1',
    '--floorplan-table-radius': '0.75rem',
    '--floorplan-seat-assigned-bg': 'var(--color-primary, #B91C1C)',
    '--floorplan-seat-assigned-text': '#ffffff',
    '--floorplan-seat-unassigned-hover': '#f1f5f9',
    '--floorplan-status-overcapacity-bg': '#fff1f2',
    '--floorplan-status-overcapacity-border': '#f43f5e',

    '--glow-color': 'color-mix(in srgb, var(--color-primary, #B91C1C) 8%, transparent)',
    '--glow-gradient': 'radial-gradient(800px circle at 50% 50%, color-mix(in srgb, var(--color-primary, #B91C1C) 8%, transparent), transparent)',
    '--particle-color': 'var(--color-accent, #3B82F6)',
    '--3d-metalness': '0.8',
    '--3d-roughness': '0.15',
    '--3d-env-map-intensity': '1.5',
    '--3d-physics-accessibility-impulse': '22',
    '--3d-physics-drag-velocity-multiplier': '25',
    '--3d-physics-bump-impulse-y': '12',
    '--3d-physics-bump-impulse-random-multiplier': '12',
    '--3d-physics-break-force-threshold': '180',
    '--3d-physics-explosion-impulse-left-x': '22',
    '--3d-physics-explosion-impulse-left-y': '16',
    '--3d-physics-explosion-impulse-left-z': '6',
    '--3d-physics-explosion-impulse-right-x': '-22',
    '--3d-physics-explosion-impulse-right-y': '16',
    '--3d-physics-explosion-impulse-right-z': '-6',
    '--3d-physics-explosion-torque-strength': '45',
    '--3d-physics-return-force-multiplier': '18',
    '--3d-physics-pulse-speed-dragging': '6',
    '--3d-physics-pulse-speed-idle': '1.2',
    '--3d-physics-pulse-scale-multiplier': '0.06',
    '--3d-physics-idle-rotation-speed': '0.003',
    '--3d-extrusion-depth': '1.1',
    '--3d-extrusion-bevel-enabled': 'true',
    '--3d-extrusion-bevel-thickness': '0.2',
    '--3d-extrusion-bevel-size': '0.15',
    '--3d-extrusion-bevel-segments': '5',
    '--3d-light-ambient-intensity': '0.9',
    '--3d-light-directional-intensity': '1.8',
    '--glow-filter': 'drop-shadow(0 0 12px var(--color-accent, #3B82F6))',
    '--card-perspective': '1200px',
    '--card-max-rotation': '12deg',
    '--card-spring-stiffness': '400',
    '--card-spring-damping': '25',

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

    '--font-size-xs': '0.75rem',
    '--font-size-sm': '0.875rem',
    '--font-size-base': '1rem',
    '--font-size-lg': '1.25rem',
    '--font-size-xl': '1.5rem',
    '--font-size-2xl': '1.75rem',
    '--font-weight-normal': '400',
    '--font-weight-medium': '600',
    '--font-weight-bold': '800',
    '--line-height-tight': '1.2',
    '--line-height-normal': '1.4',
    '--line-height-relaxed': '1.6',

    '--spacing-xs': '0.375rem',
    '--spacing-sm': '0.75rem',
    '--spacing-md': '1.25rem',
    '--spacing-lg': '1.75rem',
    '--spacing-xl': '2.5rem',
    '--spacing-2xl': '3.5rem',

    '--border-radius-sm': '0.375rem',
    '--border-radius-md': '0.5rem',
    '--border-radius-lg': '0.75rem',
    '--border-radius-full': '9999px',
    '--border-width-thin': '1px',
    '--border-width-medium': '2px',
    '--border-width-thick': '3px',
    '--border-style-default': 'solid',

    '--brand-logo-width': '140px',
    '--brand-logo-height': '45px',
    '--brand-hero-height': '450px',
    '--brand-watermark-width': '220px',
    '--brand-watermark-opacity': '0.08',
    '--brand-badge-size': '52px',

    '--brand-hero-image': 'none',
    '--brand-watermark-image': 'none',
    '--brand-badge-graphic': 'none',

    serverExportTokens: {
      canvasBg: '#f8fafc',
      cardBg: '#ffffff',
      colorPrimary: '#B91C1C',
      colorSecondary: '#B45309',
      textMuted: '#64748b',
      borderAccent: '#cbd5e1',
      badgeBg: '#f1f5f9',
      badgeText: '#0f172a',
      fontHeading: 'Inter, Arial, sans-serif',
      fontBody: 'Inter, Arial, sans-serif',
      printBg: '#ffffff',
      printText: '#0f172a',
      printBorder: '#cbd5e1',
      printHeaderBorder: '#0f172a',
      printBadgeBg: '#f1f5f9',
    },

    darkTokens: {
      '--container-bg': '#020617',
      '--card-bg': '#0f172a',
      '--card-border': '#1e293b',
      '--heading-color': '#f8fafc',
      '--btn-outline-bg': 'transparent',
      '--btn-outline-text': '#f8fafc',
      '--btn-outline-border': '#94a3b8',
      '--btn-outline-hover-bg': 'rgba(255, 255, 255, 0.1)',
      '--btn-ghost-bg': 'transparent',
      '--btn-ghost-text': '#f8fafc',
      '--btn-ghost-hover-bg': 'rgba(255, 255, 255, 0.1)',
      '--btn-focus-ring': '#38bdf8',
      '--dialog-bg': '#0f172a',
      '--dialog-border-color': '#1e293b',
      '--dialog-title-color': '#f8fafc',
      '--dialog-desc-color': '#94a3b8',
      '--dialog-shadow': '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
      '--dialog-backdrop': 'rgba(2, 6, 23, 0.8)',
      '--input-bg': '#0f172a',
      '--input-border': '#334155',
      '--input-focus-ring': '#38bdf8',
      '--form-label-text': '#f8fafc',
      '--form-message-text': '#94a3b8',
      '--schedule-card-bg': '#0f172a',
      '--schedule-card-border': '#1e293b',
      '--schedule-filter-bg': '#1e293b',
      '--schedule-filter-text': '#f8fafc',
      '--schedule-filter-hover-bg': '#334155',
      '--schedule-tag-bg': '#1e293b',
      '--schedule-tag-text': '#f8fafc',
      '--canvas-bg': '#0f172a',
      '--canvas-grid-dot': '#334155',
      '--canvas-border': '1px solid #1e293b',
      '--floorplan-table-bg': '#0f172a',
      '--floorplan-table-border': '#1e293b',
      '--floorplan-seat-assigned-bg': 'var(--color-primary, #B91C1C)',
      '--floorplan-seat-assigned-text': '#ffffff',
      '--floorplan-seat-unassigned-hover': '#1e293b',
      '--floorplan-status-overcapacity-bg': '#4c0519',
      '--floorplan-status-overcapacity-border': '#f43f5e',
    },
  },
  romantic: {
    '--font-heading': 'var(--font-cormorant), Cormorant Garamond, Georgia, serif',
    '--font-body': 'var(--font-lato), Arial, Helvetica, sans-serif',
    '--font-mono': 'var(--font-geist-mono), monospace',
    '--font-size-display': '4.25rem',
    '--font-size-h1': '2.5rem',
    '--font-size-h2': '2rem',
    '--font-size-h3': '1.5rem',
    '--font-size-body': '1.0625rem',
    '--font-weight-heading': '600',
    '--font-weight-body': '400',
    '--line-height-heading': '1.25',
    '--line-height-body': '1.7',
    '--letter-spacing-heading': '0.01em',
    '--letter-spacing-body': '0.01em',
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

    '--toast-success-bg': '#047857',
    '--toast-success-text': '#ffffff',
    '--toast-error-bg': '#be123c',
    '--toast-error-text': '#ffffff',
    '--toast-info-bg': '#1d4ed8',
    '--toast-info-text': '#ffffff',
    '--toast-confirm-bg': '#831843',
    '--toast-confirm-text': '#ffffff',
    '--toast-radius': '1rem',
    '--toast-close-hover-bg': 'rgba(255, 255, 255, 0.2)',

    '--print-bg': '#fffafb',
    '--print-text': '#831843',
    '--print-border': '#fbcfe8',
    '--print-header-border': '#9d174d',
    '--print-badge-bg': '#fce7f3',

    '--canvas-bg': '#fdf2f8',
    '--canvas-grid-dot': '#fbcfe8',
    '--canvas-border': '2px dashed #fce7f3',
    '--floorplan-table-bg': '#fffafb',
    '--floorplan-table-border': '#fce7f3',
    '--floorplan-table-radius': '1.25rem',
    '--floorplan-seat-assigned-bg': 'var(--color-primary, #B91C1C)',
    '--floorplan-seat-assigned-text': '#ffffff',
    '--floorplan-seat-unassigned-hover': '#fbcfe8',
    '--floorplan-status-overcapacity-bg': '#ffe4e6',
    '--floorplan-status-overcapacity-border': '#f43f5e',

    '--glow-color': 'color-mix(in srgb, var(--color-primary, #B91C1C) 10%, transparent)',
    '--glow-gradient': 'radial-gradient(800px circle at 50% 50%, color-mix(in srgb, var(--color-primary, #B91C1C) 10%, transparent), transparent)',
    '--particle-color': 'var(--color-accent, #F472B6)',
    '--3d-metalness': '0.9',
    '--3d-roughness': '0.3',
    '--3d-env-map-intensity': '1.0',
    '--3d-physics-accessibility-impulse': '18',
    '--3d-physics-drag-velocity-multiplier': '18',
    '--3d-physics-bump-impulse-y': '8',
    '--3d-physics-bump-impulse-random-multiplier': '8',
    '--3d-physics-break-force-threshold': '220',
    '--3d-physics-explosion-impulse-left-x': '18',
    '--3d-physics-explosion-impulse-left-y': '14',
    '--3d-physics-explosion-impulse-left-z': '4',
    '--3d-physics-explosion-impulse-right-x': '-18',
    '--3d-physics-explosion-impulse-right-y': '14',
    '--3d-physics-explosion-impulse-right-z': '-4',
    '--3d-physics-explosion-torque-strength': '35',
    '--3d-physics-return-force-multiplier': '12',
    '--3d-physics-pulse-speed-dragging': '4',
    '--3d-physics-pulse-speed-idle': '0.8',
    '--3d-physics-pulse-scale-multiplier': '0.04',
    '--3d-physics-idle-rotation-speed': '0.0015',
    '--3d-extrusion-depth': '1.4',
    '--3d-extrusion-bevel-enabled': 'true',
    '--3d-extrusion-bevel-thickness': '0.3',
    '--3d-extrusion-bevel-size': '0.22',
    '--3d-extrusion-bevel-segments': '6',
    '--3d-light-ambient-intensity': '0.7',
    '--3d-light-directional-intensity': '1.4',
    '--glow-filter': 'drop-shadow(0 0 14px var(--color-accent, #F472B6))',
    '--card-perspective': '900px',
    '--card-max-rotation': '8deg',
    '--card-spring-stiffness': '250',
    '--card-spring-damping': '18',

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

    '--font-size-xs': '0.75rem',
    '--font-size-sm': '0.875rem',
    '--font-size-base': '1.05rem',
    '--font-size-lg': '1.2rem',
    '--font-size-xl': '1.35rem',
    '--font-size-2xl': '1.65rem',
    '--font-weight-normal': '300',
    '--font-weight-medium': '500',
    '--font-weight-bold': '600',
    '--line-height-tight': '1.3',
    '--line-height-normal': '1.6',
    '--line-height-relaxed': '1.8',

    '--spacing-xs': '0.25rem',
    '--spacing-sm': '0.5rem',
    '--spacing-md': '1rem',
    '--spacing-lg': '1.5rem',
    '--spacing-xl': '2.25rem',
    '--spacing-2xl': '3.25rem',

    '--border-radius-sm': '0.5rem',
    '--border-radius-md': '0.75rem',
    '--border-radius-lg': '1.25rem',
    '--border-radius-full': '9999px',
    '--border-width-thin': '1px',
    '--border-width-medium': '2px',
    '--border-width-thick': '3px',
    '--border-style-default': 'solid',

    '--brand-logo-width': '130px',
    '--brand-logo-height': '42px',
    '--brand-hero-height': '420px',
    '--brand-watermark-width': '240px',
    '--brand-watermark-opacity': '0.12',
    '--brand-badge-size': '56px',

    '--brand-hero-image': 'none',
    '--brand-watermark-image': 'none',
    '--brand-badge-graphic': 'none',

    serverExportTokens: {
      canvasBg: '#fdf2f8',
      cardBg: '#fffafb',
      colorPrimary: '#B91C1C',
      colorSecondary: '#B45309',
      textMuted: '#9d174d',
      borderAccent: '#fce7f3',
      badgeBg: '#fce7f3',
      badgeText: '#831843',
      fontHeading: 'Cormorant Garamond, Georgia, serif',
      fontBody: 'Lato, Arial, sans-serif',
      printBg: '#fffafb',
      printText: '#831843',
      printBorder: '#fbcfe8',
      printHeaderBorder: '#9d174d',
      printBadgeBg: '#fce7f3',
    },

    darkTokens: {
      '--container-bg': '#180910',
      '--card-bg': '#231118',
      '--card-border': '#4a1d2f',
      '--heading-color': '#fdf2f8',
      '--btn-outline-bg': 'transparent',
      '--btn-outline-text': '#fdf2f8',
      '--btn-outline-border': '#f472b6',
      '--btn-outline-hover-bg': 'rgba(244, 114, 182, 0.15)',
      '--btn-ghost-bg': 'transparent',
      '--btn-ghost-text': '#fdf2f8',
      '--btn-ghost-hover-bg': 'rgba(244, 114, 182, 0.15)',
      '--btn-focus-ring': '#f472b6',
      '--dialog-bg': '#231118',
      '--dialog-border-color': '#4a1d2f',
      '--dialog-title-color': '#fdf2f8',
      '--dialog-desc-color': '#fbcfe8',
      '--dialog-shadow': '0 20px 30px -10px rgba(0, 0, 0, 0.6)',
      '--dialog-backdrop': 'rgba(20, 5, 12, 0.8)',
      '--input-bg': '#231118',
      '--input-border': '#4a1d2f',
      '--input-focus-ring': '#f472b6',
      '--form-label-text': '#fdf2f8',
      '--form-message-text': '#fbcfe8',
      '--schedule-card-bg': '#231118',
      '--schedule-card-border': '#4a1d2f',
      '--schedule-filter-bg': '#3b1827',
      '--schedule-filter-text': '#fdf2f8',
      '--schedule-filter-hover-bg': '#501d35',
      '--schedule-node-border': '#231118',
      '--schedule-tag-bg': '#3b1827',
      '--schedule-tag-text': '#fbcfe8',
      '--canvas-bg': '#231118',
      '--canvas-grid-dot': '#4a1d2f',
      '--canvas-border': '2px dashed #4a1d2f',
      '--floorplan-table-bg': '#231118',
      '--floorplan-table-border': '#4a1d2f',
      '--floorplan-seat-assigned-bg': 'var(--color-primary, #B91C1C)',
      '--floorplan-seat-assigned-text': '#ffffff',
      '--floorplan-seat-unassigned-hover': '#3b1827',
      '--floorplan-status-overcapacity-bg': '#4c0519',
      '--floorplan-status-overcapacity-border': '#f43f5e',
    },
  },
  minimal: {
    '--font-heading': 'var(--font-geist-sans), Arial, Helvetica, sans-serif',
    '--font-body': 'var(--font-geist-sans), Arial, Helvetica, sans-serif',
    '--font-mono': 'var(--font-geist-mono), monospace',
    '--font-size-display': '3.5rem',
    '--font-size-h1': '2.25rem',
    '--font-size-h2': '1.75rem',
    '--font-size-h3': '1.375rem',
    '--font-size-body': '0.9375rem',
    '--font-weight-heading': '500',
    '--font-weight-body': '400',
    '--line-height-heading': '1.2',
    '--line-height-body': '1.5',
    '--letter-spacing-heading': '-0.015em',
    '--letter-spacing-body': '0em',
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

    '--toast-success-bg': '#15803d',
    '--toast-success-text': '#ffffff',
    '--toast-error-bg': '#991b1b',
    '--toast-error-text': '#ffffff',
    '--toast-info-bg': '#1d4ed8',
    '--toast-info-text': '#ffffff',
    '--toast-confirm-bg': '#18181b',
    '--toast-confirm-text': '#ffffff',
    '--toast-radius': '0px',
    '--toast-close-hover-bg': 'rgba(255, 255, 255, 0.15)',

    '--print-bg': '#ffffff',
    '--print-text': '#18181b',
    '--print-border': '#e4e4e7',
    '--print-header-border': '#18181b',
    '--print-badge-bg': '#f4f4f5',

    '--canvas-bg': '#fafafa',
    '--canvas-grid-dot': '#d4d4d8',
    '--canvas-border': '1px solid #e4e4e7',
    '--floorplan-table-bg': '#ffffff',
    '--floorplan-table-border': '#e4e4e7',
    '--floorplan-table-radius': '0px',
    '--floorplan-seat-assigned-bg': 'var(--color-primary, #B91C1C)',
    '--floorplan-seat-assigned-text': '#ffffff',
    '--floorplan-seat-unassigned-hover': '#f4f4f5',
    '--floorplan-status-overcapacity-bg': '#fef2f2',
    '--floorplan-status-overcapacity-border': '#dc2626',

    '--glow-color': 'color-mix(in srgb, var(--color-primary, #B91C1C) 4%, transparent)',
    '--glow-gradient': 'radial-gradient(800px circle at 50% 50%, color-mix(in srgb, var(--color-primary, #B91C1C) 4%, transparent), transparent)',
    '--particle-color': 'var(--color-accent, #71717A)',
    '--3d-metalness': '0.5',
    '--3d-roughness': '0.4',
    '--3d-env-map-intensity': '0.8',
    '--3d-physics-accessibility-impulse': '20',
    '--3d-physics-drag-velocity-multiplier': '20',
    '--3d-physics-bump-impulse-y': '10',
    '--3d-physics-bump-impulse-random-multiplier': '10',
    '--3d-physics-break-force-threshold': '250',
    '--3d-physics-explosion-impulse-left-x': '15',
    '--3d-physics-explosion-impulse-left-y': '12',
    '--3d-physics-explosion-impulse-left-z': '3',
    '--3d-physics-explosion-impulse-right-x': '-15',
    '--3d-physics-explosion-impulse-right-y': '12',
    '--3d-physics-explosion-impulse-right-z': '-3',
    '--3d-physics-explosion-torque-strength': '30',
    '--3d-physics-return-force-multiplier': '20',
    '--3d-physics-pulse-speed-dragging': '3',
    '--3d-physics-pulse-speed-idle': '0.6',
    '--3d-physics-pulse-scale-multiplier': '0.02',
    '--3d-physics-idle-rotation-speed': '0.001',
    '--3d-extrusion-depth': '1.0',
    '--3d-extrusion-bevel-enabled': 'true',
    '--3d-extrusion-bevel-thickness': '0.15',
    '--3d-extrusion-bevel-size': '0.12',
    '--3d-extrusion-bevel-segments': '3',
    '--3d-light-ambient-intensity': '0.8',
    '--3d-light-directional-intensity': '1.2',
    '--glow-filter': 'drop-shadow(0 0 6px var(--color-accent, #71717A))',
    '--card-perspective': '800px',
    '--card-max-rotation': '6deg',
    '--card-spring-stiffness': '200',
    '--card-spring-damping': '30',

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

    '--font-size-xs': '0.7rem',
    '--font-size-sm': '0.8rem',
    '--font-size-base': '0.95rem',
    '--font-size-lg': '1.1rem',
    '--font-size-xl': '1.25rem',
    '--font-size-2xl': '1.4rem',
    '--font-weight-normal': '400',
    '--font-weight-medium': '500',
    '--font-weight-bold': '600',
    '--line-height-tight': '1.2',
    '--line-height-normal': '1.45',
    '--line-height-relaxed': '1.65',

    '--spacing-xs': '0.2rem',
    '--spacing-sm': '0.4rem',
    '--spacing-md': '0.8rem',
    '--spacing-lg': '1.2rem',
    '--spacing-xl': '1.8rem',
    '--spacing-2xl': '2.5rem',

    '--border-radius-sm': '0px',
    '--border-radius-md': '0px',
    '--border-radius-lg': '0px',
    '--border-radius-full': '0px',
    '--border-width-thin': '1px',
    '--border-width-medium': '1px',
    '--border-width-thick': '2px',
    '--border-style-default': 'solid',

    '--brand-logo-width': '100px',
    '--brand-logo-height': '32px',
    '--brand-hero-height': '360px',
    '--brand-watermark-width': '180px',
    '--brand-watermark-opacity': '0.05',
    '--brand-badge-size': '40px',

    '--brand-hero-image': 'none',
    '--brand-watermark-image': 'none',
    '--brand-badge-graphic': 'none',

    serverExportTokens: {
      canvasBg: '#fafafa',
      cardBg: '#ffffff',
      colorPrimary: '#B91C1C',
      colorSecondary: '#B45309',
      textMuted: '#71717a',
      borderAccent: '#e4e4e7',
      badgeBg: '#f4f4f5',
      badgeText: '#18181b',
      fontHeading: 'Geist Sans, Arial, sans-serif',
      fontBody: 'Geist Sans, Arial, sans-serif',
      printBg: '#ffffff',
      printText: '#18181b',
      printBorder: '#e4e4e7',
      printHeaderBorder: '#18181b',
      printBadgeBg: '#f4f4f5',
    },

    darkTokens: {
      '--container-bg': '#09090b',
      '--card-bg': '#18181b',
      '--card-border': '#27272a',
      '--heading-color': '#f4f4f5',
      '--btn-outline-bg': 'transparent',
      '--btn-outline-text': '#f4f4f5',
      '--btn-outline-border': '#a1a1aa',
      '--btn-outline-hover-bg': 'rgba(255, 255, 255, 0.08)',
      '--btn-ghost-bg': 'transparent',
      '--btn-ghost-text': '#f4f4f5',
      '--btn-ghost-hover-bg': 'rgba(255, 255, 255, 0.08)',
      '--btn-focus-ring': '#f4f4f5',
      '--dialog-bg': '#18181b',
      '--dialog-border-color': '#27272a',
      '--dialog-title-color': '#f4f4f5',
      '--dialog-desc-color': '#a1a1aa',
      '--dialog-shadow': '0 1px 3px 0 rgba(0, 0, 0, 0.5)',
      '--dialog-backdrop': 'rgba(0, 0, 0, 0.7)',
      '--input-bg': '#18181b',
      '--input-border': '#3f3f46',
      '--input-focus-ring': '#f4f4f5',
      '--form-label-text': '#f4f4f5',
      '--form-message-text': '#a1a1aa',
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
      '--canvas-bg': '#18181b',
      '--canvas-grid-dot': '#3f3f46',
      '--canvas-border': '1px solid #27272a',
      '--floorplan-table-bg': '#18181b',
      '--floorplan-table-border': '#27272a',
      '--floorplan-seat-assigned-bg': 'var(--color-primary, #B91C1C)',
      '--floorplan-seat-assigned-text': '#ffffff',
      '--floorplan-seat-unassigned-hover': '#27272a',
      '--floorplan-status-overcapacity-bg': '#450a0a',
      '--floorplan-status-overcapacity-border': '#dc2626',
    },
  },
  editorial: {
    '--font-heading': 'var(--font-cinzel), Cinzel, Georgia, serif',
    '--font-body': 'var(--font-lora), Lora, Georgia, serif',
    '--font-mono': 'var(--font-geist-mono), monospace',
    '--font-size-display': '4.5rem',
    '--font-size-h1': '2.75rem',
    '--font-size-h2': '2.25rem',
    '--font-size-h3': '1.625rem',
    '--font-size-body': '1.125rem',
    '--font-weight-heading': '700',
    '--font-weight-body': '400',
    '--line-height-heading': '1.1',
    '--line-height-body': '1.75',
    '--letter-spacing-heading': '0.05em',
    '--letter-spacing-body': '0.005em',
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
    '--btn-outline-bg': 'transparent',
    '--btn-outline-text': '#000000',
    '--btn-outline-border': '#000000',
    '--btn-outline-hover-bg': 'rgba(0, 0, 0, 0.06)',
    '--btn-ghost-bg': 'transparent',
    '--btn-ghost-text': '#000000',
    '--btn-ghost-hover-bg': 'rgba(0, 0, 0, 0.06)',
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
    '--dialog-desc-color': '#44403c',

    '--input-bg': '#fcfbf9',
    '--input-border': '#000000',
    '--input-focus-ring': '#000000',
    '--input-radius': '0.125rem',
    '--input-error-border': '#b91c1c',
    '--input-error-focus-ring': '#b91c1c',
    '--input-success-border': '#15803d',
    '--input-success-focus-ring': '#15803d',
    '--input-warning-border': '#b45309',
    '--input-warning-focus-ring': '#b45309',
    '--form-label-text': '#000000',
    '--form-message-text': '#44403c',
    '--form-error-text': '#b91c1c',
    '--form-success-text': '#15803d',
    '--form-warning-text': '#b45309',

    '--schedule-card-bg': '#fcfbf9',
    '--schedule-card-border': '#000000',
    '--schedule-card-radius': '0.125rem',
    '--schedule-filter-bg': '#e7e5e4',
    '--schedule-filter-text': '#000000',
    '--schedule-filter-hover-bg': '#d6d3d1',
    '--schedule-filter-active-bg': '#000000',
    '--schedule-filter-active-text': '#ffffff',
    '--schedule-node-bg': 'var(--color-primary, #B91C1C)',
    '--schedule-node-border': '#000000',
    '--schedule-tag-bg': '#e7e5e4',
    '--schedule-tag-text': '#000000',

    '--toast-success-bg': '#15803d',
    '--toast-success-text': '#ffffff',
    '--toast-error-bg': '#b91c1c',
    '--toast-error-text': '#ffffff',
    '--toast-info-bg': '#1d4ed8',
    '--toast-info-text': '#ffffff',
    '--toast-confirm-bg': '#000000',
    '--toast-confirm-text': '#ffffff',
    '--toast-radius': '0.125rem',
    '--toast-close-hover-bg': 'rgba(255, 255, 255, 0.2)',

    '--print-bg': '#fcfbf9',
    '--print-text': '#000000',
    '--print-border': '#000000',
    '--print-header-border': '#000000',
    '--print-badge-bg': '#e4e4e7',

    '--canvas-bg': '#f5f5f4',
    '--canvas-grid-dot': '#a1a1aa',
    '--canvas-border': '2px solid #000000',
    '--floorplan-table-bg': '#fcfbf9',
    '--floorplan-table-border': '#000000',
    '--floorplan-table-radius': '0.125rem',
    '--floorplan-seat-assigned-bg': 'var(--color-primary, #B91C1C)',
    '--floorplan-seat-assigned-text': '#ffffff',
    '--floorplan-seat-unassigned-hover': '#e4e4e7',
    '--floorplan-status-overcapacity-bg': '#fef2f2',
    '--floorplan-status-overcapacity-border': '#b91c1c',

    '--glow-color': 'color-mix(in srgb, var(--color-primary, #B91C1C) 12%, transparent)',
    '--glow-gradient': 'radial-gradient(800px circle at 50% 50%, color-mix(in srgb, var(--color-primary, #B91C1C) 12%, transparent), transparent)',
    '--particle-color': 'var(--color-accent, #000000)',
    '--3d-metalness': '1.0',
    '--3d-roughness': '0.1',
    '--3d-env-map-intensity': '1.8',
    '--3d-physics-accessibility-impulse': '25',
    '--3d-physics-drag-velocity-multiplier': '22',
    '--3d-physics-bump-impulse-y': '14',
    '--3d-physics-bump-impulse-random-multiplier': '14',
    '--3d-physics-break-force-threshold': '160',
    '--3d-physics-explosion-impulse-left-x': '25',
    '--3d-physics-explosion-impulse-left-y': '18',
    '--3d-physics-explosion-impulse-left-z': '8',
    '--3d-physics-explosion-impulse-right-x': '-25',
    '--3d-physics-explosion-impulse-right-y': '18',
    '--3d-physics-explosion-impulse-right-z': '-8',
    '--3d-physics-explosion-torque-strength': '50',
    '--3d-physics-return-force-multiplier': '16',
    '--3d-physics-pulse-speed-dragging': '5',
    '--3d-physics-pulse-speed-idle': '1',
    '--3d-physics-pulse-scale-multiplier': '0.05',
    '--3d-physics-idle-rotation-speed': '0.002',
    '--3d-extrusion-depth': '1.5',
    '--3d-extrusion-bevel-enabled': 'true',
    '--3d-extrusion-bevel-thickness': '0.35',
    '--3d-extrusion-bevel-size': '0.25',
    '--3d-extrusion-bevel-segments': '4',
    '--3d-light-ambient-intensity': '1.0',
    '--3d-light-directional-intensity': '2.0',
    '--glow-filter': 'drop-shadow(0 0 10px var(--color-accent, #000000))',
    '--card-perspective': '1500px',
    '--card-max-rotation': '15deg',
    '--card-spring-stiffness': '500',
    '--card-spring-damping': '15',

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

    '--font-size-xs': '0.75rem',
    '--font-size-sm': '0.875rem',
    '--font-size-base': '1rem',
    '--font-size-lg': '1.25rem',
    '--font-size-xl': '1.6rem',
    '--font-size-2xl': '2rem',
    '--font-weight-normal': '400',
    '--font-weight-medium': '600',
    '--font-weight-bold': '700',
    '--line-height-tight': '1.15',
    '--line-height-normal': '1.4',
    '--line-height-relaxed': '1.6',

    '--spacing-xs': '0.25rem',
    '--spacing-sm': '0.5rem',
    '--spacing-md': '1rem',
    '--spacing-lg': '1.5rem',
    '--spacing-xl': '2.25rem',
    '--spacing-2xl': '3.5rem',

    '--border-radius-sm': '0.125rem',
    '--border-radius-md': '0.125rem',
    '--border-radius-lg': '0.25rem',
    '--border-radius-full': '9999px',
    '--border-width-thin': '1px',
    '--border-width-medium': '2px',
    '--border-width-thick': '4px',
    '--border-style-default': 'solid',

    '--brand-logo-width': '150px',
    '--brand-logo-height': '50px',
    '--brand-hero-height': '480px',
    '--brand-watermark-width': '250px',
    '--brand-watermark-opacity': '0.15',
    '--brand-badge-size': '60px',

    '--brand-hero-image': 'none',
    '--brand-watermark-image': 'none',
    '--brand-badge-graphic': 'none',

    serverExportTokens: {
      canvasBg: '#f5f5f4',
      cardBg: '#fcfbf9',
      colorPrimary: '#B91C1C',
      colorSecondary: '#B45309',
      textMuted: '#44403c',
      borderAccent: '#000000',
      badgeBg: '#e4e4e7',
      badgeText: '#000000',
      fontHeading: 'Cinzel, Georgia, serif',
      fontBody: 'Lora, Georgia, serif',
      printBg: '#fcfbf9',
      printText: '#000000',
      printBorder: '#000000',
      printHeaderBorder: '#000000',
      printBadgeBg: '#e4e4e7',
    },

    darkTokens: {
      '--container-bg': '#0c0a09',
      '--card-bg': '#1c1917',
      '--card-border': '#ffffff',
      '--heading-color': '#ffffff',
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
      '--input-bg': '#1c1917',
      '--input-border': '#ffffff',
      '--input-focus-ring': '#ffffff',
      '--form-label-text': '#ffffff',
      '--form-message-text': '#d6d3d1',
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
      '--canvas-bg': '#1c1917',
      '--canvas-grid-dot': '#44403c',
      '--canvas-border': '2px solid #ffffff',
      '--floorplan-table-bg': '#1c1917',
      '--floorplan-table-border': '#ffffff',
      '--floorplan-seat-assigned-bg': 'var(--color-primary, #B91C1C)',
      '--floorplan-seat-assigned-text': '#ffffff',
      '--floorplan-seat-unassigned-hover': '#292524',
      '--floorplan-status-overcapacity-bg': '#450a0a',
      '--floorplan-status-overcapacity-border': '#ef4444',
    },
  },
};

export const DEFAULT_THEME_PRESET: ThemePreset = 'classic';

export function isThemePreset(value: unknown): value is ThemePreset {
  return typeof value === 'string' && THEME_PRESET_KEYS.includes(value as ThemePreset);
}

export function parseDurationSec(val?: string, fallback = 0.8): number {
  if (!val) return fallback;
  if (val.endsWith('ms')) {
    const num = parseFloat(val);
    return isNaN(num) ? fallback : num / 1000;
  }
  if (val.endsWith('s')) {
    const num = parseFloat(val);
    return isNaN(num) ? fallback : num;
  }
  const num = parseFloat(val);
  return isNaN(num) ? fallback : num;
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

function stripCssVar(val: unknown, fallback: string): string {
  if (typeof val !== 'string' || !val) return fallback;
  let str = val.trim();
  let depth = 0;
  const maxDepth = 10;

  while (str.startsWith('var(') && str.endsWith(')') && depth < maxDepth) {
    depth++;
    const commaIdx = str.indexOf(',');
    if (commaIdx === -1) {
      break;
    }
    str = str.slice(commaIdx + 1, str.length - 1).trim();
  }

  if (!str || str.startsWith('var(')) {
    return fallback;
  }

  return str;
}

export function getServerExportTokens(
  presetKey?: string | null,
  customTokens?: Record<string, any> | null,
  overrides?: Record<string, any> | null
): ServerExportTokens {
  const selectedPreset = presetKey && isThemePreset(presetKey) ? presetKey : DEFAULT_THEME_PRESET;
  const baseTokens = THEME_PRESETS[selectedPreset];
  const baseExport: ServerExportTokens = baseTokens.serverExportTokens || {
    canvasBg: '#fff1f2',
    cardBg: '#ffffff',
    colorPrimary: '#B91C1C',
    colorSecondary: '#B45309',
    textMuted: '#4b5563',
    borderAccent: '#B91C1C',
    badgeBg: '#f3f4f6',
    badgeText: '#B45309',
    fontHeading: 'Playfair Display, Georgia, serif',
    fontBody: 'Geist Sans, Arial, sans-serif',
    printBg: '#ffffff',
    printText: '#111827',
    printBorder: '#e5e7eb',
    printHeaderBorder: '#111827',
    printBadgeBg: '#f3f4f6',
  };

  const resolved: ServerExportTokens = { ...baseExport };

  if (customTokens && typeof customTokens === 'object') {
    if (customTokens.serverExportTokens && typeof customTokens.serverExportTokens === 'object') {
      Object.assign(resolved, customTokens.serverExportTokens);
    }
    if (customTokens['--color-primary']) resolved.colorPrimary = stripCssVar(customTokens['--color-primary'], resolved.colorPrimary);
    if (customTokens['--color-secondary']) resolved.colorSecondary = stripCssVar(customTokens['--color-secondary'], resolved.colorSecondary);
    if (customTokens['--container-bg']) resolved.canvasBg = stripCssVar(customTokens['--container-bg'], resolved.canvasBg);
    if (customTokens['--card-bg']) resolved.cardBg = stripCssVar(customTokens['--card-bg'], resolved.cardBg);
    if (customTokens['--heading-color']) resolved.colorPrimary = stripCssVar(customTokens['--heading-color'], resolved.colorPrimary);
    if (customTokens['--print-bg']) resolved.printBg = stripCssVar(customTokens['--print-bg'], resolved.printBg);
    if (customTokens['--print-text']) resolved.printText = stripCssVar(customTokens['--print-text'], resolved.printText);
    if (customTokens['--print-border']) resolved.printBorder = stripCssVar(customTokens['--print-border'], resolved.printBorder);
    if (customTokens['--print-header-border']) resolved.printHeaderBorder = stripCssVar(customTokens['--print-header-border'], resolved.printHeaderBorder);
    if (customTokens['--print-badge-bg']) resolved.printBadgeBg = stripCssVar(customTokens['--print-badge-bg'], resolved.printBadgeBg);
    if (customTokens['--font-heading']) resolved.fontHeading = stripCssVar(customTokens['--font-heading'], resolved.fontHeading);
    if (customTokens['--font-body']) resolved.fontBody = stripCssVar(customTokens['--font-body'], resolved.fontBody);
  }

  if (overrides && typeof overrides === 'object') {
    const primary = overrides.primary || overrides.colorPrimary;
    if (primary) resolved.colorPrimary = stripCssVar(primary, resolved.colorPrimary);

    const secondary = overrides.secondary || overrides.colorSecondary;
    if (secondary) resolved.colorSecondary = stripCssVar(secondary, resolved.colorSecondary);

    if (overrides.canvasBg) resolved.canvasBg = stripCssVar(overrides.canvasBg, resolved.canvasBg);
    if (overrides.cardBg) resolved.cardBg = stripCssVar(overrides.cardBg, resolved.cardBg);
    if (overrides.textMuted) resolved.textMuted = stripCssVar(overrides.textMuted, resolved.textMuted);
    if (overrides.borderAccent) resolved.borderAccent = stripCssVar(overrides.borderAccent, resolved.borderAccent);
    if (overrides.badgeBg) resolved.badgeBg = stripCssVar(overrides.badgeBg, resolved.badgeBg);
    if (overrides.badgeText) resolved.badgeText = stripCssVar(overrides.badgeText, resolved.badgeText);
    if (overrides.fontHeading) resolved.fontHeading = stripCssVar(overrides.fontHeading, resolved.fontHeading);
    if (overrides.fontBody) resolved.fontBody = stripCssVar(overrides.fontBody, resolved.fontBody);
    if (overrides.printBg) resolved.printBg = stripCssVar(overrides.printBg, resolved.printBg);
    if (overrides.printText) resolved.printText = stripCssVar(overrides.printText, resolved.printText);
    if (overrides.printBorder) resolved.printBorder = stripCssVar(overrides.printBorder, resolved.printBorder);
    if (overrides.printHeaderBorder) resolved.printHeaderBorder = stripCssVar(overrides.printHeaderBorder, resolved.printHeaderBorder);
    if (overrides.printBadgeBg) resolved.printBadgeBg = stripCssVar(overrides.printBadgeBg, resolved.printBadgeBg);
  }

  (Object.keys(resolved) as Array<keyof ServerExportTokens>).forEach((key) => {
    resolved[key] = stripCssVar(resolved[key], baseExport[key]);
  });

  return resolved;
}
