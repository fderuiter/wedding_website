export type ThemePreset = 'classic' | 'modern' | 'romantic' | 'minimal' | 'editorial';

export const THEME_PRESET_KEYS: ThemePreset[] = ['classic', 'modern', 'romantic', 'minimal', 'editorial'];

export interface ComponentTokens {
  '--font-heading': string;
  '--font-body': string;
  '--font-mono': string;

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

  '--brand-hero-image'?: string;
  '--brand-watermark-image'?: string;
  '--brand-badge-graphic'?: string;

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
  '--print-bg': '#ffffff',
  '--print-text': '#111827',
  '--print-border': '#374151',
  '--print-header-border': '#111827',
  '--print-badge-bg': '#f3f4f6',
};

export const THEME_PRESETS: Record<ThemePreset, ComponentTokens> = {
  classic: {
    '--font-heading': 'var(--font-playfair), Playfair Display, Georgia, serif',
    '--font-body': 'var(--font-geist-sans), Arial, Helvetica, sans-serif',
    '--font-mono': 'var(--font-geist-mono), monospace',
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

    '--brand-hero-image': 'none',
    '--brand-watermark-image': 'none',
    '--brand-badge-graphic': 'none',

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
      '--print-bg': '#ffffff',
      '--print-text': '#111827',
      '--print-border': '#374151',
      '--print-header-border': '#111827',
      '--print-badge-bg': '#f3f4f6',
    },
  },
  modern: {
    '--font-heading': 'var(--font-inter), Arial, Helvetica, sans-serif',
    '--font-body': 'var(--font-inter), Arial, Helvetica, sans-serif',
    '--font-mono': 'var(--font-geist-mono), monospace',
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

    '--brand-hero-image': 'none',
    '--brand-watermark-image': 'none',
    '--brand-badge-graphic': 'none',

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
      '--print-bg': '#ffffff',
      '--print-text': '#0f172a',
      '--print-border': '#334155',
      '--print-header-border': '#0f172a',
      '--print-badge-bg': '#f1f5f9',
    },
  },
  romantic: {
    '--font-heading': 'var(--font-cormorant), Cormorant Garamond, Georgia, serif',
    '--font-body': 'var(--font-lato), Arial, Helvetica, sans-serif',
    '--font-mono': 'var(--font-geist-mono), monospace',
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

    '--brand-hero-image': 'none',
    '--brand-watermark-image': 'none',
    '--brand-badge-graphic': 'none',

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
      '--print-bg': '#fffafb',
      '--print-text': '#831843',
      '--print-border': '#4a1d2f',
      '--print-header-border': '#831843',
      '--print-badge-bg': '#fce7f3',
    },
  },
  minimal: {
    '--font-heading': 'var(--font-geist-sans), Arial, Helvetica, sans-serif',
    '--font-body': 'var(--font-geist-sans), Arial, Helvetica, sans-serif',
    '--font-mono': 'var(--font-geist-mono), monospace',
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

    '--brand-hero-image': 'none',
    '--brand-watermark-image': 'none',
    '--brand-badge-graphic': 'none',

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
      '--print-bg': '#ffffff',
      '--print-text': '#09090b',
      '--print-border': '#27272a',
      '--print-header-border': '#09090b',
      '--print-badge-bg': '#f4f4f5',
    },
  },
  editorial: {
    '--font-heading': 'var(--font-cinzel), Cinzel, Georgia, serif',
    '--font-body': 'var(--font-lora), Lora, Georgia, serif',
    '--font-mono': 'var(--font-geist-mono), monospace',
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

    '--brand-hero-image': 'none',
    '--brand-watermark-image': 'none',
    '--brand-badge-graphic': 'none',

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
      '--print-bg': '#ffffff',
      '--print-text': '#000000',
      '--print-border': '#000000',
      '--print-header-border': '#000000',
      '--print-badge-bg': '#e4e4e7',
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
