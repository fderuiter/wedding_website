import { renderHook, act, waitFor } from '@testing-library/react';
import {
  setupWizardReducer,
  createInitialMachineState,
  useSetupWizardMachine,
  SETUP_WIZARD_STORAGE_KEY,
  SetupWizardMachineState,
  initialSetupWizardState,
} from '../useSetupWizardMachine';
import * as authClient from '@/core/auth/auth.client';

jest.mock('@/core/auth/auth.client', () => ({
  checkAdminClient: jest.fn(),
}));

describe('Setup Wizard State Machine Reducer', () => {
  it('creates default initial state starting on step 1 with authentication false', () => {
    expect(initialSetupWizardState.step).toBe(1);
    const state = createInitialMachineState();
    expect(state.step).toBe(1);
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.activeModal).toBeNull();
    expect(state.persistedDraftStep).toBe(1);
    expect(state.importedGuestCount).toBe(0);
  });

  it('restores draft values and sets persistedDraftStep when provided in initializer', () => {
    const state = createInitialMachineState({
      step: 3,
      partner1Name: 'Taylor',
      partner2Name: 'Jordan',
    });
    expect(state.step).toBe(1); // unauthenticated starts at step 1
    expect(state.persistedDraftStep).toBe(3);
    expect(state.partner1Name).toBe('Taylor');
    expect(state.partner2Name).toBe('Jordan');
  });

  describe('SESSION_VERIFIED', () => {
    it('restores directly to persisted draft step when authenticated and savedStep >= 2', () => {
      const initial = createInitialMachineState({ step: 4 });
      const state = setupWizardReducer(initial, {
        type: 'SESSION_VERIFIED',
        isAuthenticated: true,
      });

      expect(state.isAuthenticated).toBe(true);
      expect(state.step).toBe(4);
      expect(state.persistedDraftStep).toBe(4);
      expect(state.error).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it('defaults to step 2 if draftStep was 1 when authenticated session is verified', () => {
      const initial = createInitialMachineState({ step: 1 });
      const state = setupWizardReducer(initial, {
        type: 'SESSION_VERIFIED',
        isAuthenticated: true,
      });

      expect(state.isAuthenticated).toBe(true);
      expect(state.step).toBe(2);
      expect(state.persistedDraftStep).toBe(2);
    });

    it('keeps user at step 1 with isAuthenticated false when unauthenticated', () => {
      const initial = createInitialMachineState({ step: 3 });
      const state = setupWizardReducer(initial, {
        type: 'SESSION_VERIFIED',
        isAuthenticated: false,
      });

      expect(state.isAuthenticated).toBe(false);
      expect(state.step).toBe(1);
      expect(state.persistedDraftStep).toBe(3); // preserves draft step for when login occurs
    });
  });

  describe('LOGIN_SUCCESS', () => {
    it('advances to step 2 when saved draft step is <= 2', () => {
      const initial = createInitialMachineState({ step: 1 });
      const state = setupWizardReducer(initial, { type: 'LOGIN_SUCCESS' });

      expect(state.isAuthenticated).toBe(true);
      expect(state.step).toBe(2);
      expect(state.persistedDraftStep).toBe(2);
      expect(state.error).toBeNull();
      expect(state.isLoading).toBe(false);
    });

    it('preserves saved draft step greater than step 2 upon successful authentication', () => {
      const initial = createInitialMachineState({ step: 3 });
      const state = setupWizardReducer(initial, { type: 'LOGIN_SUCCESS' });

      expect(state.isAuthenticated).toBe(true);
      expect(state.step).toBe(3);
      expect(state.persistedDraftStep).toBe(3);
      expect(state.error).toBeNull();

      const initialStep4 = createInitialMachineState({ step: 4 });
      const state4 = setupWizardReducer(initialStep4, { type: 'LOGIN_SUCCESS' });
      expect(state4.step).toBe(4);

      const initialStep5 = createInitialMachineState({ step: 5 });
      const state5 = setupWizardReducer(initialStep5, { type: 'LOGIN_SUCCESS' });
      expect(state5.step).toBe(5);
    });
  });

  describe('Guard against invalid state transitions', () => {
    it('prevents unauthenticated user from advancing beyond step 1', () => {
      const initial = createInitialMachineState();
      const state = setupWizardReducer(initial, { type: 'SET_STEP', step: 2 });
      expect(state.step).toBe(1);

      const state3 = setupWizardReducer(initial, { type: 'SET_STEP', step: 3 });
      expect(state3.step).toBe(1);
    });

    it('prevents transitioning to invalid step numbers (< 1 or > 5)', () => {
      const authState: SetupWizardMachineState = {
        ...createInitialMachineState(),
        isAuthenticated: true,
        step: 2,
      };

      const belowMin = setupWizardReducer(authState, { type: 'SET_STEP', step: 0 });
      expect(belowMin.step).toBe(2);

      const aboveMax = setupWizardReducer(authState, { type: 'SET_STEP', step: 6 });
      expect(aboveMax.step).toBe(2);

      const negative = setupWizardReducer(authState, { type: 'SET_STEP', step: -1 });
      expect(negative.step).toBe(2);
    });

    it('prevents opening modal overlays when unauthenticated', () => {
      const unauthState = createInitialMachineState();
      const state = setupWizardReducer(unauthState, {
        type: 'OPEN_MODAL',
        modal: 'weddingParty',
      });
      expect(state.activeModal).toBeNull();
    });
  });

  describe('Error auto-clearing and modal mutual exclusion', () => {
    it('clears error automatically on form submission start', () => {
      const stateWithError: SetupWizardMachineState = {
        ...createInitialMachineState(),
        error: 'Previous error message',
      };

      const nextState = setupWizardReducer(stateWithError, { type: 'SUBMIT_START' });
      expect(nextState.isLoading).toBe(true);
      expect(nextState.error).toBeNull();
    });

    it('clears error automatically on step transitions', () => {
      const authStateWithError: SetupWizardMachineState = {
        ...createInitialMachineState(),
        isAuthenticated: true,
        step: 2,
        error: 'Validation failed on step 2',
      };

      const nextState = setupWizardReducer(authStateWithError, {
        type: 'SET_STEP',
        step: 3,
      });

      expect(nextState.step).toBe(3);
      expect(nextState.error).toBeNull();
    });

    it('enforces mutual exclusion across modal overlays', () => {
      const authState: SetupWizardMachineState = {
        ...createInitialMachineState(),
        isAuthenticated: true,
        step: 5,
      };

      // Open weddingParty modal
      const state1 = setupWizardReducer(authState, {
        type: 'OPEN_MODAL',
        modal: 'weddingParty',
      });
      expect(state1.activeModal).toBe('weddingParty');

      // Switch to attractions modal directly
      const state2 = setupWizardReducer(state1, {
        type: 'OPEN_MODAL',
        modal: 'attractions',
      });
      expect(state2.activeModal).toBe('attractions');

      // Switch to csv modal
      const state3 = setupWizardReducer(state2, {
        type: 'OPEN_MODAL',
        modal: 'csv',
      });
      expect(state3.activeModal).toBe('csv');

      // Close modal
      const stateClosed = setupWizardReducer(state3, { type: 'CLOSE_MODAL' });
      expect(stateClosed.activeModal).toBeNull();
    });

    it('automatically closes any open modal when changing steps', () => {
      const stateWithModal: SetupWizardMachineState = {
        ...createInitialMachineState(),
        isAuthenticated: true,
        step: 4,
        activeModal: 'csv',
      };

      const nextState = setupWizardReducer(stateWithModal, { type: 'SET_STEP', step: 5 });
      expect(nextState.step).toBe(5);
      expect(nextState.activeModal).toBeNull();
    });
  });

  describe('Draft updates and toggles', () => {
    it('updates draft fields correctly', () => {
      const initial = createInitialMachineState();
      const updated = setupWizardReducer(initial, {
        type: 'UPDATE_DRAFT',
        payload: {
          partner1Name: 'Alex',
          weddingDate: '2026-10-10',
          timezone: 'America/New_York',
          contactEmail: 'hosts@alexandsam.com',
        },
      });

      expect(updated.partner1Name).toBe('Alex');
      expect(updated.weddingDate).toBe('2026-10-10');
      expect(updated.timezone).toBe('America/New_York');
      expect(updated.contactEmail).toBe('hosts@alexandsam.com');
    });

    it('toggles sample data modules', () => {
      const initial = createInitialMachineState();
      expect(initial.selectedModules).toContain('registry');

      // Toggle registry off
      const stateWithout = setupWizardReducer(initial, {
        type: 'TOGGLE_MODULE',
        moduleKey: 'registry',
      });
      expect(stateWithout.selectedModules).not.toContain('registry');

      // Toggle registry back on
      const stateWith = setupWizardReducer(stateWithout, {
        type: 'TOGGLE_MODULE',
        moduleKey: 'registry',
      });
      expect(stateWith.selectedModules).toContain('registry');
    });

    it('resets state to initial machine state', () => {
      const modified: SetupWizardMachineState = {
        ...createInitialMachineState(),
        isAuthenticated: true,
        step: 5,
        partner1Name: 'Alex',
        activeModal: 'weddingParty',
      };

      const resetState = setupWizardReducer(modified, { type: 'RESET' });
      expect(resetState.step).toBe(1);
      expect(resetState.isAuthenticated).toBe(false);
      expect(resetState.partner1Name).toBe('');
      expect(resetState.activeModal).toBeNull();
    });
  });
});

describe('useSetupWizardMachine Hook', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    jest.clearAllMocks();
  });

  it('verifies admin session on mount and restores to draft step when valid cookie exists', async () => {
    (authClient.checkAdminClient as jest.Mock).mockResolvedValue(true);
    window.sessionStorage.setItem(
      SETUP_WIZARD_STORAGE_KEY,
      JSON.stringify({ step: 3, partner1Name: 'Sam' })
    );

    const { result } = renderHook(() => useSetupWizardMachine());

    // Initially synchronous render is step 1
    expect(result.current.state.step).toBe(1);

    await waitFor(() => {
      expect(result.current.state.isAuthenticated).toBe(true);
      expect(result.current.state.step).toBe(3);
    });

    expect(result.current.state.partner1Name).toBe('Sam');
  });

  it('stays unauthenticated on step 1 when admin session check fails or returns false', async () => {
    (authClient.checkAdminClient as jest.Mock).mockResolvedValue(false);
    window.sessionStorage.setItem(
      SETUP_WIZARD_STORAGE_KEY,
      JSON.stringify({ step: 3, partner1Name: 'Sam' })
    );

    const { result } = renderHook(() => useSetupWizardMachine());

    await waitFor(() => {
      expect(authClient.checkAdminClient).toHaveBeenCalled();
    });

    expect(result.current.state.isAuthenticated).toBe(false);
    expect(result.current.state.step).toBe(1);
    expect(result.current.state.partner1Name).toBe('Sam');

    // When admin logs in, draft step 3 is preserved!
    act(() => {
      result.current.loginSuccess();
    });

    expect(result.current.state.isAuthenticated).toBe(true);
    expect(result.current.state.step).toBe(3);
  });

  it('persists changes to sessionStorage in compatible format', async () => {
    (authClient.checkAdminClient as jest.Mock).mockResolvedValue(false);
    const { result } = renderHook(() => useSetupWizardMachine());

    await waitFor(() => {
      expect(authClient.checkAdminClient).toHaveBeenCalled();
    });

    act(() => {
      result.current.loginSuccess();
      result.current.updateDraft({ partner1Name: 'Riley', partner2Name: 'Casey' });
      result.current.setStep(2);
    });

    const stored = window.sessionStorage.getItem(SETUP_WIZARD_STORAGE_KEY);
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.step).toBe(2);
    expect(parsed.partner1Name).toBe('Riley');
    expect(parsed.partner2Name).toBe('Casey');
  });

  it('clears sessionStorage and resets state when clearPersistedState is called', async () => {
    (authClient.checkAdminClient as jest.Mock).mockResolvedValue(false);
    window.sessionStorage.setItem(
      SETUP_WIZARD_STORAGE_KEY,
      JSON.stringify({ step: 2, partner1Name: 'Riley' })
    );

    const { result } = renderHook(() => useSetupWizardMachine());

    await waitFor(() => {
      expect(authClient.checkAdminClient).toHaveBeenCalled();
    });

    act(() => {
      result.current.clearPersistedState();
    });

    expect(window.sessionStorage.getItem(SETUP_WIZARD_STORAGE_KEY)).toBeNull();
    expect(result.current.state.partner1Name).toBe('');
    expect(result.current.state.step).toBe(1);
  });
});
