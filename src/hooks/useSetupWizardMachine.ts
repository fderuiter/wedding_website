'use client';

import { useReducer, useEffect, useCallback, useRef } from 'react';
import { checkAdminClient } from '@/core/auth/auth.client';
import {
  DEFAULT_MODULE_CONFIG,
  resolveModuleConfig,
  type ModuleConfig,
} from '@/lib/modules';
import { ArchetypeId } from '@/lib/sampleData/archetypes';
import {
  DEFAULT_THEME_PRESET,
  isThemePreset,
  type ThemePreset,
} from '@/lib/theme/presets';

export const SETUP_WIZARD_STORAGE_KEY = 'setup_wizard_draft';

export type SetupWizardModal = 'weddingParty' | 'attractions' | 'csv' | null;

export function isValidIanaTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string') return false;
  const trimmed = tz.trim();
  if (!trimmed) return false;
  if (trimmed === 'UTC' || trimmed === 'GMT') return true;
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone').includes(trimmed);
    }
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

export function detectBrowserTimezone(fallback = 'America/Chicago'): string {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
      const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (isValidIanaTimezone(resolved)) {
        return resolved.trim();
      }
    }
  } catch {
    // Fall back to default timezone when Intl fails or is unavailable
  }
  return fallback;
}

export interface SetupWizardPersistedState {
  step: number;
  partner1Name: string;
  partner2Name: string;
  weddingDate: string;
  baseUrl: string;
  contactEmail?: string;
  venueName: string;
  venueAddress?: string;
  venueCity: string;
  venueState: string;
  venueZip?: string;
  latitude?: number;
  longitude?: number;
  timezone: string;
  themePreset: ThemePreset;
  colorPrimary: string;
  colorSecondary: string;
  enabledFeatures: ModuleConfig;
  sampleArchetype: ArchetypeId;
  selectedModules: string[];
  importedGuestCount?: number;
}

export const initialSetupWizardState: SetupWizardPersistedState = {
  step: 1,
  partner1Name: '',
  partner2Name: '',
  weddingDate: '',
  baseUrl: '',
  contactEmail: '',
  venueName: '',
  venueAddress: '',
  venueCity: '',
  venueState: '',
  venueZip: '',
  latitude: 0,
  longitude: 0,
  timezone: 'America/Chicago',
  themePreset: DEFAULT_THEME_PRESET,
  colorPrimary: '#4A5568',
  colorSecondary: '#2D3748',
  enabledFeatures: { ...DEFAULT_MODULE_CONFIG },
  sampleArchetype: 'classic',
  selectedModules: ['registry', 'guests', 'seating', 'weddingParty', 'attractions', 'faqs'],
  importedGuestCount: 0,
};

export interface SetupWizardMachineState extends SetupWizardPersistedState {
  contactEmail: string;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  activeModal: SetupWizardModal;
  persistedDraftStep: number;
  importedGuestCount: number;
}

export type SetupWizardAction =
  | { type: 'SESSION_VERIFIED'; isAuthenticated: boolean }
  | { type: 'LOGIN_SUCCESS' }
  | { type: 'SUBMIT_START' }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'SET_STEP'; step: number }
  | { type: 'UPDATE_DRAFT'; payload: Partial<SetupWizardPersistedState> }
  | { type: 'TOGGLE_MODULE'; moduleKey: string }
  | { type: 'OPEN_MODAL'; modal: Exclude<SetupWizardModal, null> }
  | { type: 'CLOSE_MODAL' }
  | { type: 'RESET' };

export function createInitialMachineState(
  initialDraft?: Partial<SetupWizardPersistedState>
): SetupWizardMachineState {
  const mergedDraft: SetupWizardPersistedState = {
    ...initialSetupWizardState,
    ...initialDraft,
  };
  const resolvedThemePreset: ThemePreset = isThemePreset(initialDraft?.themePreset)
    ? initialDraft.themePreset
    : initialSetupWizardState.themePreset;
  const resolvedColorPrimary =
    typeof initialDraft?.colorPrimary === 'string' && initialDraft.colorPrimary.length > 0
      ? initialDraft.colorPrimary
      : initialSetupWizardState.colorPrimary;
  const resolvedColorSecondary =
    typeof initialDraft?.colorSecondary === 'string' && initialDraft.colorSecondary.length > 0
      ? initialDraft.colorSecondary
      : initialSetupWizardState.colorSecondary;
  const resolvedEnabledFeatures = resolveModuleConfig(initialDraft?.enabledFeatures);
  const rawSelectedModules = Array.isArray(mergedDraft.selectedModules)
    ? mergedDraft.selectedModules
    : initialSetupWizardState.selectedModules;
  const resolvedSelectedModules = resolvedEnabledFeatures.registry
    ? rawSelectedModules
    : rawSelectedModules.filter((m) => m !== 'registry');

  const validDraftStep =
    typeof mergedDraft.step === 'number' && mergedDraft.step >= 1 && mergedDraft.step <= 5
      ? mergedDraft.step
      : 1;

  return {
    ...mergedDraft,
    themePreset: resolvedThemePreset,
    colorPrimary: resolvedColorPrimary,
    colorSecondary: resolvedColorSecondary,
    enabledFeatures: resolvedEnabledFeatures,
    selectedModules: resolvedSelectedModules,
    contactEmail: mergedDraft.contactEmail ?? '',
    step: 1,
    persistedDraftStep: validDraftStep,
    isAuthenticated: false,
    isLoading: false,
    error: null,
    activeModal: null,
    importedGuestCount: mergedDraft.importedGuestCount ?? 0,
  };
}

/**
 * Pure state reducer governing all setup wizard transitions,
 * enforcing mutual exclusion on modals, auto-clearing errors on step transitions,
 * and guarding against unauthenticated or out-of-range transitions.
 */
export function setupWizardReducer(
  state: SetupWizardMachineState,
  action: SetupWizardAction
): SetupWizardMachineState {
  switch (action.type) {
    case 'SESSION_VERIFIED': {
      // If already authenticated by direct user login, do not overwrite
      if (state.isAuthenticated) {
        return state;
      }
      if (!action.isAuthenticated) {
        if (!state.isAuthenticated && state.step === 1 && !state.isLoading) {
          return state;
        }
        return {
          ...state,
          isAuthenticated: false,
          step: 1,
          isLoading: false,
          error: state.error,
        };
      }
      // If admin session cookie exists on mount, transition directly to the restored draft step (min step 2)
      const restoredStep = state.persistedDraftStep >= 2 ? state.persistedDraftStep : 2;
      return {
        ...state,
        isAuthenticated: true,
        step: restoredStep,
        persistedDraftStep: restoredStep,
        isLoading: false,
        error: null,
      };
    }

    case 'LOGIN_SUCCESS': {
      // Credential authentication preserves any saved draft step greater than step 2
      const targetStep = state.persistedDraftStep > 2 ? state.persistedDraftStep : 2;
      return {
        ...state,
        isAuthenticated: true,
        step: targetStep,
        persistedDraftStep: targetStep,
        isLoading: false,
        error: null,
      };
    }

    case 'SUBMIT_START': {
      return {
        ...state,
        isLoading: true,
        error: null, // Error messages clear automatically upon form submissions
      };
    }

    case 'SET_ERROR': {
      return {
        ...state,
        isLoading: false,
        error: action.error,
      };
    }

    case 'SET_STEP': {
      const { step } = action;
      // Guard: Step out of bounds (1..5)
      if (typeof step !== 'number' || step < 1 || step > 5) {
        return state;
      }
      // Guard: Unauthenticated users cannot navigate beyond step 1
      if (!state.isAuthenticated && step > 1) {
        return state;
      }
      return {
        ...state,
        step,
        persistedDraftStep: step,
        isLoading: false,
        error: null, // Error messages clear automatically upon step transitions
        activeModal: null, // Ensure modals close on step transitions
      };
    }

    case 'UPDATE_DRAFT': {
      const nextStep =
        typeof action.payload.step === 'number' && state.isAuthenticated
          ? action.payload.step >= 1 && action.payload.step <= 5
            ? action.payload.step
            : state.step
          : state.step;
      const nextPersistedDraftStep =
        typeof action.payload.step === 'number'
          ? action.payload.step >= 1 && action.payload.step <= 5
            ? action.payload.step
            : state.persistedDraftStep
          : state.persistedDraftStep;
      const nextThemePreset =
        action.payload.themePreset !== undefined
          ? isThemePreset(action.payload.themePreset)
            ? action.payload.themePreset
            : state.themePreset
          : state.themePreset;
      const nextEnabledFeatures =
        action.payload.enabledFeatures !== undefined
          ? resolveModuleConfig(action.payload.enabledFeatures)
          : state.enabledFeatures;
      const baseSelectedModules =
        action.payload.selectedModules !== undefined
          ? action.payload.selectedModules
          : state.selectedModules;
      const nextSelectedModules = nextEnabledFeatures.registry
        ? baseSelectedModules
        : baseSelectedModules.filter((m) => m !== 'registry');

      return {
        ...state,
        ...action.payload,
        themePreset: nextThemePreset,
        enabledFeatures: nextEnabledFeatures,
        selectedModules: nextSelectedModules,
        contactEmail:
          action.payload.contactEmail !== undefined
            ? action.payload.contactEmail
            : state.contactEmail,
        step: nextStep,
        persistedDraftStep: nextPersistedDraftStep,
        importedGuestCount:
          action.payload.importedGuestCount !== undefined
            ? action.payload.importedGuestCount
            : state.importedGuestCount,
      };
    }

    case 'TOGGLE_MODULE': {
      const current = state.selectedModules || [];
      const updated = current.includes(action.moduleKey)
        ? current.filter((m) => m !== action.moduleKey)
        : [...current, action.moduleKey];
      return {
        ...state,
        selectedModules: updated,
      };
    }

    case 'OPEN_MODAL': {
      // Guard: Unauthenticated users cannot open content modals
      if (!state.isAuthenticated) {
        return state;
      }
      // Enforces mutual exclusion across all modals
      return {
        ...state,
        activeModal: action.modal,
      };
    }

    case 'CLOSE_MODAL': {
      return {
        ...state,
        activeModal: null,
      };
    }

    case 'RESET': {
      return createInitialMachineState();
    }

    default:
      return state;
  }
}

/**
 * Hook coordinating setup wizard state machine, admin session revalidation,
 * and sessionStorage draft persistence.
 */
export function useSetupWizardMachine(initialValues?: Partial<SetupWizardPersistedState>) {
  const [state, dispatch] = useReducer(
    setupWizardReducer,
    initialValues,
    (customInit) => {
      let savedDraft: Partial<SetupWizardPersistedState> = {};
      let hasSessionDraft = false;
      if (typeof window !== 'undefined') {
        try {
          const item = window.sessionStorage.getItem(SETUP_WIZARD_STORAGE_KEY);
          if (item) {
            savedDraft = JSON.parse(item);
            hasSessionDraft = true;
          }
        } catch (err) {
          console.warn(`useSetupWizardMachine: Failed to read "${SETUP_WIZARD_STORAGE_KEY}":`, err);
        }
      }
      const mergedInit = hasSessionDraft
        ? { ...customInit, ...savedDraft }
        : { ...savedDraft, ...customInit };
      return createInitialMachineState(mergedInit);
    }
  );

  // Requirement 2: Verify admin session status on mount using checkAdminClient
  useEffect(() => {
    let isCancelled = false;
    checkAdminClient()
      .then((isAdmin) => {
        if (!isCancelled && isAdmin) {
          dispatch({ type: 'SESSION_VERIFIED', isAuthenticated: true });
        }
      })
      .catch(() => {});

    return () => {
      isCancelled = true;
    };
  }, []);

  const isClearedRef = useRef(false);

  // Synchronize draft state to browser sessionStorage preserving backwards compatibility
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isClearedRef.current) return;
    try {
      const persistedData: SetupWizardPersistedState = {
        // While unauthenticated, preserve the saved draft step rather than overwriting with 1
        step: state.isAuthenticated ? state.step : state.persistedDraftStep,
        partner1Name: state.partner1Name,
        partner2Name: state.partner2Name,
        weddingDate: state.weddingDate,
        baseUrl: state.baseUrl,
        contactEmail: state.contactEmail,
        venueName: state.venueName,
        venueAddress: state.venueAddress ?? '',
        venueCity: state.venueCity,
        venueState: state.venueState,
        venueZip: state.venueZip ?? '',
        latitude: state.latitude ?? 0,
        longitude: state.longitude ?? 0,
        timezone: state.timezone,
        themePreset: state.themePreset,
        colorPrimary: state.colorPrimary,
        colorSecondary: state.colorSecondary,
        enabledFeatures: state.enabledFeatures,
        sampleArchetype: state.sampleArchetype,
        selectedModules: state.selectedModules,
        importedGuestCount: state.importedGuestCount,
      };
      window.sessionStorage.setItem(SETUP_WIZARD_STORAGE_KEY, JSON.stringify(persistedData));
    } catch (err) {
      console.warn(`useSetupWizardMachine: Failed to write "${SETUP_WIZARD_STORAGE_KEY}":`, err);
    }
  }, [
    state.isAuthenticated,
    state.step,
    state.persistedDraftStep,
    state.partner1Name,
    state.partner2Name,
    state.weddingDate,
    state.baseUrl,
    state.contactEmail,
    state.venueName,
    state.venueAddress,
    state.venueCity,
    state.venueState,
    state.venueZip,
    state.latitude,
    state.longitude,
    state.timezone,
    state.themePreset,
    state.colorPrimary,
    state.colorSecondary,
    state.enabledFeatures,
    state.sampleArchetype,
    state.selectedModules,
    state.importedGuestCount,
  ]);

  const clearPersistedState = useCallback(() => {
    isClearedRef.current = true;
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem(SETUP_WIZARD_STORAGE_KEY);
      } catch (err) {
        console.warn(`useSetupWizardMachine: Failed to remove "${SETUP_WIZARD_STORAGE_KEY}":`, err);
      }
    }
    dispatch({ type: 'RESET' });
  }, []);

  const updateDraft = useCallback((payload: Partial<SetupWizardPersistedState>) => {
    isClearedRef.current = false;
    dispatch({ type: 'UPDATE_DRAFT', payload });
  }, []);

  const setStep = useCallback((step: number) => {
    isClearedRef.current = false;
    dispatch({ type: 'SET_STEP', step });
  }, []);

  return {
    state,
    setStep,
    updateDraft,
    toggleModule: (moduleKey: string) => {
      isClearedRef.current = false;
      dispatch({ type: 'TOGGLE_MODULE', moduleKey });
    },
    openModal: (modal: Exclude<SetupWizardModal, null>) => dispatch({ type: 'OPEN_MODAL', modal }),
    closeModal: () => dispatch({ type: 'CLOSE_MODAL' }),
    setError: (error: string) => dispatch({ type: 'SET_ERROR', error }),
    startSubmit: () => dispatch({ type: 'SUBMIT_START' }),
    loginSuccess: () => {
      isClearedRef.current = false;
      dispatch({ type: 'LOGIN_SUCCESS' });
    },
    clearPersistedState,
  };
}
