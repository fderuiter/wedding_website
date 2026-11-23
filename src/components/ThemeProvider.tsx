'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ThemePreset,
  THEME_PRESETS,
  getPresetTokens,
  DEFAULT_THEME_PRESET,
} from '@/lib/theme/presets';
import { PHYSICS_CONSTANTS } from '@/app/heart/constants';
import {
  sanitizeColor,
  sanitizePreset,
  sanitizeLayoutToken,
  sanitizeFontToken,
  sanitizeTokenValue,
  generateThemeStylesheet,
} from '@/lib/theme/stylesheet';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export type ThemePhysics = {
  accessibilityImpulse: number;
  dragVelocityMultiplier: number;
  bumpImpulseY: number;
  bumpImpulseRandomMultiplier: number;
  breakForceThreshold: number;
  explosionImpulseLeft: { x: number; y: number; z: number };
  explosionImpulseRight: { x: number; y: number; z: number };
  explosionTorqueStrength: number;
  returnForceMultiplier: number;
  pulseSpeedDragging: number;
  pulseSpeedIdle: number;
  pulseScaleMultiplier: number;
  idleRotationSpeed: number;
};

export type ThemeExtrusion = {
  depth: number;
  bevelEnabled: boolean;
  bevelThickness: number;
  bevelSize: number;
  bevelSegments: number;
};

export type ThemeLighting = {
  ambientIntensity: number;
  directionalIntensity: number;
};

type ThemeContextType = {
  timezone: string;
  contactEmail: string;
  contactPhone: string;
  themePrimary: string;
  themeSecondary: string;
  themeAccent: string;
  themeOutline: string;
  themePreset: ThemePreset;
  fontHeading: string;
  fontBody: string;
  fontMono: string;
  themeMode: ThemeMode;
  mode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  resolvedTheme: ResolvedTheme;
  layoutContainerMaxWidth: string;
  layoutGridGap: string;
  layoutCardPadding: string;
  layoutBorderRadius: string;
  metalness: number;
  roughness: number;
  envMapIntensity: number;
  cardPerspective: number;
  cardMaxRotation: number;
  cardSpringStiffness: number;
  cardSpringDamping: number;
  physics: ThemePhysics;
  extrusion: ThemeExtrusion;
  lighting: ThemeLighting;
  glowFilter: string;
  hasThemeProvider?: boolean;
  setPreviewConfig?: (_preview: Partial<NonNullable<ThemeProviderProps['config']>> | null) => void;
};

const ThemeContext = createContext<ThemeContextType>({
  timezone: '',
  contactEmail: '',
  contactPhone: '',
  themePrimary: '#B91C1C',
  themeSecondary: '#B45309',
  themeAccent: '#D4AF37',
  themeOutline: '#000000',
  themePreset: DEFAULT_THEME_PRESET,
  fontHeading: THEME_PRESETS[DEFAULT_THEME_PRESET]['--font-heading'],
  fontBody: THEME_PRESETS[DEFAULT_THEME_PRESET]['--font-body'],
  fontMono: THEME_PRESETS[DEFAULT_THEME_PRESET]['--font-mono'],
  themeMode: 'system',
  mode: 'system',
  setThemeMode: () => {},
  resolvedTheme: 'light',
  layoutContainerMaxWidth: '64rem',
  layoutGridGap: '1.5rem',
  layoutCardPadding: '2rem',
  layoutBorderRadius: '1rem',
  metalness: 1,
  roughness: 0.2,
  envMapIntensity: 1.2,
  cardPerspective: 1000,
  cardMaxRotation: 10,
  cardSpringStiffness: 300,
  cardSpringDamping: 20,
  physics: {
    accessibilityImpulse: PHYSICS_CONSTANTS.ACCESSIBILITY_IMPULSE,
    dragVelocityMultiplier: PHYSICS_CONSTANTS.DRAG_VELOCITY_MULTIPLIER,
    bumpImpulseY: PHYSICS_CONSTANTS.BUMP_IMPULSE_Y,
    bumpImpulseRandomMultiplier: PHYSICS_CONSTANTS.BUMP_IMPULSE_RANDOM_MULTIPLIER,
    breakForceThreshold: PHYSICS_CONSTANTS.BREAK_FORCE_THRESHOLD,
    explosionImpulseLeft: PHYSICS_CONSTANTS.EXPLOSION_IMPULSE_LEFT,
    explosionImpulseRight: PHYSICS_CONSTANTS.EXPLOSION_IMPULSE_RIGHT,
    explosionTorqueStrength: PHYSICS_CONSTANTS.EXPLOSION_TORQUE_STRENGTH,
    returnForceMultiplier: PHYSICS_CONSTANTS.RETURN_FORCE_MULTIPLIER,
    pulseSpeedDragging: PHYSICS_CONSTANTS.PULSE_SPEED_DRAGGING,
    pulseSpeedIdle: PHYSICS_CONSTANTS.PULSE_SPEED_IDLE,
    pulseScaleMultiplier: PHYSICS_CONSTANTS.PULSE_SCALE_MULTIPLIER,
    idleRotationSpeed: PHYSICS_CONSTANTS.IDLE_ROTATION_SPEED,
  },
  extrusion: {
    depth: 1.3,
    bevelEnabled: true,
    bevelThickness: 0.25,
    bevelSize: 0.18,
    bevelSegments: 4,
  },
  lighting: {
    ambientIntensity: 0.8,
    directionalIntensity: 1.6,
  },
  glowFilter: 'drop-shadow(0 0 10px var(--color-accent, #D4AF37))',
  hasThemeProvider: false,
  setPreviewConfig: () => {},
});

export const useTheme = () => useContext(ThemeContext);

const emptySubscribe = () => () => {};

function readDocumentThemeClass(): ResolvedTheme | null {
  if (typeof document === 'undefined' || !document.documentElement?.classList) {
    return null;
  }
  if (document.documentElement.classList.contains('dark')) {
    return 'dark';
  }
  if (document.documentElement.classList.contains('light')) {
    return 'light';
  }
  return null;
}

function readCookieThemeMode(): ThemeMode | null {
  if (typeof document === 'undefined' || typeof document.cookie !== 'string') {
    return null;
  }
  const match = document.cookie.match(/(?:^|;\s*)theme_mode=(dark|light|system)(?:;|$)/);
  return match ? (match[1] as ThemeMode) : null;
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    if (mql && typeof mql.matches === 'boolean') {
      return mql.matches ? 'dark' : 'light';
    }
  }
  const docTheme = readDocumentThemeClass();
  if (docTheme) {
    return docTheme;
  }
  return 'light';
}

function applyResolvedTheme(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (resolved === 'dark') {
    if (!root.classList.contains('dark')) {
      root.classList.add('dark');
    }
    if (root.classList.contains('light')) {
      root.classList.remove('light');
    }
  } else {
    if (!root.classList.contains('light')) {
      root.classList.add('light');
    }
    if (root.classList.contains('dark')) {
      root.classList.remove('dark');
    }
  }
}

type ThemeProviderProps = {
  children: React.ReactNode;
  config?: {
    timezone?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
    twilioFromNumber?: string | null;
    colorPrimary?: string | null;
    colorSecondary?: string | null;
    themePreset?: ThemePreset | string | null;
    themeTokens?: Record<string, string>;
    typographyScale?: Record<string, string> | null;
    spacingScale?: Record<string, string> | null;
    borderTreatment?: Record<string, string> | null;
    brandDimensions?: Record<string, string> | null;
    brandLogoWidth?: string | null;
    brandLogoHeight?: string | null;
    brandHeroHeight?: string | null;
    brandWatermarkWidth?: string | null;
    brandWatermarkOpacity?: string | null;
    brandBadgeSize?: string | null;
    layoutContainerMaxWidth?: string | null;
    layoutGridGap?: string | null;
    layoutCardPadding?: string | null;
    layoutBorderRadius?: string | null;
    fontHeading?: string | null;
    fontBody?: string | null;
    fontMono?: string | null;
  };
  initialThemeMode?: ThemeMode;
  hasServerStylesheet?: boolean;
};

function normalizeThemeConfig(propConfig?: ThemeProviderProps['config']) {
  return {
    timezone: typeof propConfig?.timezone === 'string' ? propConfig.timezone.trim() : '',
    contactEmail: propConfig?.contactEmail || '',
    contactPhone: propConfig?.contactPhone || propConfig?.twilioFromNumber || '',
    colorPrimary: sanitizeColor(propConfig?.colorPrimary, '#B91C1C'),
    colorSecondary: sanitizeColor(propConfig?.colorSecondary, '#B45309'),
    themePreset: sanitizePreset(propConfig?.themePreset, DEFAULT_THEME_PRESET),
    themeTokens: propConfig?.themeTokens || {},
    typographyScale: propConfig?.typographyScale || {},
    spacingScale: propConfig?.spacingScale || {},
    borderTreatment: propConfig?.borderTreatment || {},
    brandDimensions: propConfig?.brandDimensions || {},
    brandLogoWidth: propConfig?.brandLogoWidth || null,
    brandLogoHeight: propConfig?.brandLogoHeight || null,
    brandHeroHeight: propConfig?.brandHeroHeight || null,
    brandWatermarkWidth: propConfig?.brandWatermarkWidth || null,
    brandWatermarkOpacity: propConfig?.brandWatermarkOpacity || null,
    brandBadgeSize: propConfig?.brandBadgeSize || null,
    layoutContainerMaxWidth: sanitizeLayoutToken(propConfig?.layoutContainerMaxWidth, '64rem'),
    layoutGridGap: sanitizeLayoutToken(propConfig?.layoutGridGap, '1.5rem'),
    layoutCardPadding: sanitizeLayoutToken(propConfig?.layoutCardPadding, '2rem'),
    layoutBorderRadius: sanitizeLayoutToken(propConfig?.layoutBorderRadius, '1rem'),
    fontHeading: propConfig?.fontHeading,
    fontBody: propConfig?.fontBody,
    fontMono: propConfig?.fontMono,
  };
}

type NormalizedThemeConfig = ReturnType<typeof normalizeThemeConfig>;

export function ThemeProvider({ 
  children,
  config: propConfig,
  initialThemeMode = 'system',
  hasServerStylesheet = false,
}: ThemeProviderProps) {
  const baseConfig = useMemo(() => normalizeThemeConfig(propConfig), [propConfig]);
  const [draftConfigOverride, setDraftConfigOverride] = useState<{
    base: NormalizedThemeConfig;
    value: NormalizedThemeConfig;
  } | null>(null);

  const setPreviewConfig = useCallback(
    (preview: Partial<NonNullable<ThemeProviderProps['config']>> | null) => {
      if (preview === null) {
        setDraftConfigOverride(null);
        return;
      }
      setDraftConfigOverride((prev) => {
        const current = prev && prev.base === baseConfig ? prev.value : baseConfig;
        return {
          base: baseConfig,
          value: normalizeThemeConfig({
            ...current,
            ...preview,
          }),
        };
      });
    },
    [baseConfig]
  );

  const config =
    draftConfigOverride && draftConfigOverride.base === baseConfig
      ? draftConfigOverride.value
      : baseConfig;

  const stylesString = useMemo(() => {
    return generateThemeStylesheet(config);
  }, [config]);

  const isHydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const [userThemeMode, setUserThemeMode] = useState<ThemeMode | null>(null);
  const [systemThemeOverride, setSystemThemeOverride] = useState<ResolvedTheme | null>(null);

  const themeMode = useMemo<ThemeMode>(() => {
    if (userThemeMode !== null) {
      return userThemeMode;
    }
    if (typeof window === 'undefined') {
      return initialThemeMode;
    }
    if (!initialThemeMode || initialThemeMode === 'system') {
      try {
        const saved = localStorage.getItem('theme_mode');
        if (saved === 'light' || saved === 'dark' || saved === 'system') {
          return saved;
        }
      } catch {}
      const cookieMode = readCookieThemeMode();
      if (cookieMode) {
        return cookieMode;
      }
    }
    return initialThemeMode;
  }, [userThemeMode, initialThemeMode]);

  const resolvedTheme = useMemo<ResolvedTheme>(() => {
    if (themeMode === 'light') return 'light';
    if (themeMode === 'dark') return 'dark';
    if (typeof document === 'undefined') {
      return 'light';
    }
    if (systemThemeOverride !== null) {
      return systemThemeOverride;
    }
    const docTheme = readDocumentThemeClass();
    if (docTheme) {
      return docTheme;
    }
    if (!isHydrated) {
      return getSystemTheme();
    }
    return getSystemTheme();
  }, [themeMode, isHydrated, systemThemeOverride]);

  useEffect(() => {
    applyResolvedTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Reconcile and synchronize existing stylesheet on client hydration and dynamic updates
  useEffect(() => {
    if (hasServerStylesheet) {
      const el = document.getElementById('dynamic-theme-style');
      if (el && el.textContent !== stylesString) {
        el.textContent = stylesString;
      }
    }
    const serverStyle = document.getElementById('server-theme-styles');
    if (serverStyle) {
      serverStyle.remove();
    }
  }, [hasServerStylesheet, stylesString]);

  // System preference change listener when mode is 'system'
  useEffect(() => {
    if (themeMode !== 'system') return;
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    if (!mediaQuery?.addEventListener) return;

    const handleChange = (e: MediaQueryListEvent) => {
      const newResolved: ResolvedTheme = e.matches ? 'dark' : 'light';
      setSystemThemeOverride(newResolved);
      applyResolvedTheme(newResolved);
    };

    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener?.('change', handleChange);
    };
  }, [themeMode]);

  const setThemeMode = (newMode: ThemeMode) => {
    setUserThemeMode(newMode);
    setSystemThemeOverride(newMode === 'system' ? getSystemTheme() : null);

    try {
      localStorage.setItem('theme_mode', newMode);
    } catch {}

    try {
      document.cookie = `theme_mode=${newMode}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {}

    let resolved: ResolvedTheme = 'dark';
    if (newMode === 'light') {
      resolved = 'light';
    } else if (newMode === 'dark') {
      resolved = 'dark';
    } else {
      resolved = getSystemTheme();
    }

    applyResolvedTheme(resolved);
  };

  useEffect(() => {
    // Only listen for messages if inside an iframe
    if (typeof window !== 'undefined' && window !== window.parent) {
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'DRAFT_UPDATE' && event.data.draftType === 'config') {
          const draftData = event.data.draftData || {};
          setDraftConfigOverride((prev) => {
            const current = prev && prev.base === baseConfig ? prev.value : baseConfig;
            const next = { ...current, ...draftData };
            return {
              base: baseConfig,
              value: {
                ...next,
                colorPrimary: sanitizeColor(next.colorPrimary, '#B91C1C'),
                colorSecondary: sanitizeColor(next.colorSecondary, '#B45309'),
                themePreset: sanitizePreset(next.themePreset, DEFAULT_THEME_PRESET),
                themeTokens: next.themeTokens || {},
                layoutContainerMaxWidth: sanitizeLayoutToken(next.layoutContainerMaxWidth, '64rem'),
                layoutGridGap: sanitizeLayoutToken(next.layoutGridGap, '1.5rem'),
                layoutCardPadding: sanitizeLayoutToken(next.layoutCardPadding, '2rem'),
                layoutBorderRadius: sanitizeLayoutToken(next.layoutBorderRadius, '1rem'),
              },
            };
          });
        }
      };
      window.addEventListener('message', handleMessage);
      return () => window.removeEventListener('message', handleMessage);
    }
  }, [baseConfig]);

  const theme = useMemo(() => {
    let primary = '#B91C1C';
    let secondary = '#B45309';
    let accent = '#D4AF37';
    let outline = '#000000';
    let containerMaxWidth = '64rem';
    let gridGap = '1.5rem';
    let cardPadding = '2rem';
    let borderRadius = '1rem';

    try {
      if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
        const rootElement = typeof document !== 'undefined' ? document.documentElement : null;
        if (rootElement) {
          const styles = window.getComputedStyle(rootElement);
          if (styles && typeof styles.getPropertyValue === 'function') {
            primary = styles.getPropertyValue('--color-primary').trim() || '#B91C1C';
            secondary = styles.getPropertyValue('--color-secondary').trim() || '#B45309';
            accent = styles.getPropertyValue('--color-accent').trim() || '#D4AF37';
            outline = styles.getPropertyValue('--color-outline').trim() || '#000000';
            containerMaxWidth = styles.getPropertyValue('--container-max-w').trim() || '64rem';
            gridGap = styles.getPropertyValue('--grid-gap').trim() || '1.5rem';
            cardPadding = styles.getPropertyValue('--card-padding').trim() || '2rem';
            borderRadius = styles.getPropertyValue('--radius-card').trim() || '1rem';
          }
        }
      }
    } catch {
      // Gracefully recover from unreadable styling contexts or missing layout capabilities
    }

    return {
      themePrimary: sanitizeColor(config?.colorPrimary, sanitizeColor(primary, '#B91C1C')),
      themeSecondary: sanitizeColor(config?.colorSecondary, sanitizeColor(secondary, '#B45309')),
      themeAccent: sanitizeColor(accent, '#D4AF37'),
      themeOutline: sanitizeColor(outline, '#000000'),
      themePreset: config.themePreset,
      layoutContainerMaxWidth: sanitizeLayoutToken(config?.layoutContainerMaxWidth, sanitizeLayoutToken(containerMaxWidth, '64rem')),
      layoutGridGap: sanitizeLayoutToken(config?.layoutGridGap, sanitizeLayoutToken(gridGap, '1.5rem')),
      layoutCardPadding: sanitizeLayoutToken(config?.layoutCardPadding, sanitizeLayoutToken(cardPadding, '2rem')),
      layoutBorderRadius: sanitizeLayoutToken(config?.layoutBorderRadius, sanitizeLayoutToken(borderRadius, '1rem')),
    };
  }, [config]);

  const themePreset = config?.themePreset;
  const themeTokens = config?.themeTokens;

  const activePresetTokens = useMemo(() => {
    const base = getPresetTokens(themePreset);
    if (themeTokens && typeof themeTokens === 'object') {
      return { ...base, ...themeTokens };
    }
    return base;
  }, [themePreset, themeTokens]);

  const fontHeading = sanitizeFontToken(config?.fontHeading, activePresetTokens['--font-heading']);
  const fontBody = sanitizeFontToken(config?.fontBody, activePresetTokens['--font-body']);
  const fontMono = sanitizeFontToken(config?.fontMono, activePresetTokens['--font-mono']);

  const parseTokenNum = (val: string | undefined, fallback: number): number => {
    if (!val) return fallback;
    const parsed = parseFloat(val);
    return Number.isNaN(parsed) ? fallback : parsed;
  };

  const parseTokenBool = (val: string | undefined, fallback: boolean): boolean => {
    if (!val) return fallback;
    const clean = val.trim().toLowerCase();
    if (clean === 'true') return true;
    if (clean === 'false') return false;
    return fallback;
  };

  const metalness = parseTokenNum(activePresetTokens['--3d-metalness'], 1);
  const roughness = parseTokenNum(activePresetTokens['--3d-roughness'], 0.2);
  const envMapIntensity = parseTokenNum(activePresetTokens['--3d-env-map-intensity'], 1.2);
  const cardPerspective = parseTokenNum(activePresetTokens['--card-perspective'], 1000);
  const cardMaxRotation = parseTokenNum(activePresetTokens['--card-max-rotation'], 10);
  const cardSpringStiffness = parseTokenNum(activePresetTokens['--card-spring-stiffness'], 300);
  const cardSpringDamping = parseTokenNum(activePresetTokens['--card-spring-damping'], 20);

  const physics = useMemo<ThemePhysics>(() => ({
    accessibilityImpulse: parseTokenNum(activePresetTokens['--3d-physics-accessibility-impulse'], PHYSICS_CONSTANTS.ACCESSIBILITY_IMPULSE),
    dragVelocityMultiplier: parseTokenNum(activePresetTokens['--3d-physics-drag-velocity-multiplier'], PHYSICS_CONSTANTS.DRAG_VELOCITY_MULTIPLIER),
    bumpImpulseY: parseTokenNum(activePresetTokens['--3d-physics-bump-impulse-y'], PHYSICS_CONSTANTS.BUMP_IMPULSE_Y),
    bumpImpulseRandomMultiplier: parseTokenNum(activePresetTokens['--3d-physics-bump-impulse-random-multiplier'], PHYSICS_CONSTANTS.BUMP_IMPULSE_RANDOM_MULTIPLIER),
    breakForceThreshold: parseTokenNum(activePresetTokens['--3d-physics-break-force-threshold'], PHYSICS_CONSTANTS.BREAK_FORCE_THRESHOLD),
    explosionImpulseLeft: {
      x: parseTokenNum(activePresetTokens['--3d-physics-explosion-impulse-left-x'], PHYSICS_CONSTANTS.EXPLOSION_IMPULSE_LEFT.x),
      y: parseTokenNum(activePresetTokens['--3d-physics-explosion-impulse-left-y'], PHYSICS_CONSTANTS.EXPLOSION_IMPULSE_LEFT.y),
      z: parseTokenNum(activePresetTokens['--3d-physics-explosion-impulse-left-z'], PHYSICS_CONSTANTS.EXPLOSION_IMPULSE_LEFT.z),
    },
    explosionImpulseRight: {
      x: parseTokenNum(activePresetTokens['--3d-physics-explosion-impulse-right-x'], PHYSICS_CONSTANTS.EXPLOSION_IMPULSE_RIGHT.x),
      y: parseTokenNum(activePresetTokens['--3d-physics-explosion-impulse-right-y'], PHYSICS_CONSTANTS.EXPLOSION_IMPULSE_RIGHT.y),
      z: parseTokenNum(activePresetTokens['--3d-physics-explosion-impulse-right-z'], PHYSICS_CONSTANTS.EXPLOSION_IMPULSE_RIGHT.z),
    },
    explosionTorqueStrength: parseTokenNum(activePresetTokens['--3d-physics-explosion-torque-strength'], PHYSICS_CONSTANTS.EXPLOSION_TORQUE_STRENGTH),
    returnForceMultiplier: parseTokenNum(activePresetTokens['--3d-physics-return-force-multiplier'], PHYSICS_CONSTANTS.RETURN_FORCE_MULTIPLIER),
    pulseSpeedDragging: parseTokenNum(activePresetTokens['--3d-physics-pulse-speed-dragging'], PHYSICS_CONSTANTS.PULSE_SPEED_DRAGGING),
    pulseSpeedIdle: parseTokenNum(activePresetTokens['--3d-physics-pulse-speed-idle'], PHYSICS_CONSTANTS.PULSE_SPEED_IDLE),
    pulseScaleMultiplier: parseTokenNum(activePresetTokens['--3d-physics-pulse-scale-multiplier'], PHYSICS_CONSTANTS.PULSE_SCALE_MULTIPLIER),
    idleRotationSpeed: parseTokenNum(activePresetTokens['--3d-physics-idle-rotation-speed'], PHYSICS_CONSTANTS.IDLE_ROTATION_SPEED),
  }), [activePresetTokens]);

  const extrusion = useMemo<ThemeExtrusion>(() => ({
    depth: parseTokenNum(activePresetTokens['--3d-extrusion-depth'], 1.3),
    bevelEnabled: parseTokenBool(activePresetTokens['--3d-extrusion-bevel-enabled'], true),
    bevelThickness: parseTokenNum(activePresetTokens['--3d-extrusion-bevel-thickness'], 0.25),
    bevelSize: parseTokenNum(activePresetTokens['--3d-extrusion-bevel-size'], 0.18),
    bevelSegments: parseTokenNum(activePresetTokens['--3d-extrusion-bevel-segments'], 4),
  }), [activePresetTokens]);

  const lighting = useMemo<ThemeLighting>(() => ({
    ambientIntensity: parseTokenNum(activePresetTokens['--3d-light-ambient-intensity'], 0.8),
    directionalIntensity: parseTokenNum(activePresetTokens['--3d-light-directional-intensity'], 1.6),
  }), [activePresetTokens]);

  const glowFilter = useMemo<string>(() => {
    return sanitizeTokenValue(activePresetTokens['--glow-filter']) || 'drop-shadow(0 0 10px var(--color-accent, #D4AF37))';
  }, [activePresetTokens]);

  const contextValue: ThemeContextType = {
    timezone: config.timezone || '',
    contactEmail: config.contactEmail || '',
    contactPhone: config.contactPhone || '',
    ...theme,
    fontHeading,
    fontBody,
    fontMono,
    metalness,
    roughness,
    envMapIntensity,
    cardPerspective,
    cardMaxRotation,
    cardSpringStiffness,
    cardSpringDamping,
    physics,
    extrusion,
    lighting,
    glowFilter,
    themeMode,
    mode: themeMode,
    setThemeMode,
    resolvedTheme,
    hasThemeProvider: true,
    setPreviewConfig,
  };

  return (
    <ThemeContext.Provider value={contextValue}>
      {!hasServerStylesheet && <style id="dynamic-theme-style">{stylesString}</style>}
      {children}
    </ThemeContext.Provider>
  );
}
