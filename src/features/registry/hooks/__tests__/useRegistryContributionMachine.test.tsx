import { renderHook, act } from '@testing-library/react';
import React from 'react';
import {
  useRegistryContributionMachine,
  VERIFIED_CODE_REQUIRED_MESSAGE,
} from '../useRegistryContributionMachine';
import { RegistryItem } from '../../types';
import { apiClient, ApiError } from '@/lib/apiClient';
import { GuestSessionContext, GuestSessionContextType } from '../../context/GuestSessionContext';
import { createMockRegistryItem } from '@/testing/factories/registryFactory';

jest.mock('@/lib/apiClient', () => ({
  ...jest.requireActual('@/lib/apiClient'),
  apiClient: {
    get: jest.fn(),
    delete: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
  },
}));

const mockSingleItem: RegistryItem = createMockRegistryItem({
  id: 'item-machine-1',
  name: 'Machine Test Item',
  description: 'Item for testing contribution machine hook',
  price: 150,
  quantity: 1,
  category: 'Home',
  isGroupGift: false,
  purchased: false,
  amountContributed: 0,
  contributors: [],
});

const mockGroupItem: RegistryItem = createMockRegistryItem({
  id: 'item-machine-group-1',
  name: 'Group Fund Item',
  description: 'Group item for testing contribution machine hook',
  price: 200,
  quantity: 1,
  category: 'Home',
  isGroupGift: true,
  purchased: false,
  amountContributed: 50,
  contributors: [],
});

describe('useRegistryContributionMachine Hook', () => {
  const mockOnContribute = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockOnContribute.mockResolvedValue(undefined);
  });

  describe('Initial State & Deterministic Flags (Criterion 1)', () => {
    it('initializes in idle state with clean field and deterministic flags', () => {
      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: mockOnContribute,
        })
      );

      expect(result.current.isValidatingCode).toBe(false);
      expect(result.current.isCodeLocked).toBe(false);
      expect(result.current.isSubmitting).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.isSubmitDisabled).toBe(false);

      expect(result.current.contributorName).toBe('');
      expect(result.current.email).toBe('');
      expect(result.current.amount).toBe('');
      expect(result.current.message).toBe('');
      expect(result.current.coverFee).toBe(false);
      expect(result.current.invitationCode).toBe('');

      expect(result.current.fieldErrors).toEqual({});
      expect(result.current.codeError).toBeNull();
      expect(result.current.submissionError).toBeNull();
    });

    it('respects optional initial values provided in options', () => {
      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: mockOnContribute,
          initialContributorName: 'Initial Name',
          initialEmail: 'init@example.com',
          initialAmount: 75,
          initialMessage: 'Warm wishes!',
          initialCoverFee: true,
          initialInvitationCode: 'INITCODE',
        })
      );

      expect(result.current.contributorName).toBe('Initial Name');
      expect(result.current.email).toBe('init@example.com');
      expect(result.current.amount).toBe(75);
      expect(result.current.message).toBe('Warm wishes!');
      expect(result.current.coverFee).toBe(true);
      expect(result.current.invitationCode).toBe('INITCODE');
    });
  });

  describe('Session Synchronization Effect (Requirement 7 & User Scenario 3)', () => {
    it('synchronizes verified session from GuestSessionContext and transitions to code_locked', () => {
      const mockSessionValue: GuestSessionContextType = {
        invitationCode: 'SESSION123',
        guestName: 'Verified Guest',
        email: 'verified.session@example.com',
        isVerified: true,
        isLoading: false,
        status: 'authenticated',
        lastErrorCode: null,
        draftInvitationCode: 'SESSION123',
        isRecoveryModalOpen: false,
        setSession: jest.fn(),
        clearSession: jest.fn(),
        refreshSession: jest.fn(),
        openRecoveryModal: jest.fn(),
        closeRecoveryModal: jest.fn(),
        recoverSession: jest.fn(),
      };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <GuestSessionContext.Provider value={mockSessionValue}>
          {children}
        </GuestSessionContext.Provider>
      );

      const { result } = renderHook(
        () =>
          useRegistryContributionMachine({
            item: mockSingleItem,
            onContribute: mockOnContribute,
          }),
        { wrapper }
      );

      expect(result.current.isCodeLocked).toBe(true);
      expect(result.current.invitationCode).toBe('SESSION123');
      expect(result.current.contributorName).toBe('Verified Guest');
      expect(result.current.email).toBe('verified.session@example.com');
      expect(result.current.codeError).toBeNull();

      // Guest can edit or clear pre-filled email without session overwrite
      act(() => {
        result.current.setEmail('');
      });
      expect(result.current.email).toBe('');
    });

    it('clears session context and resets form values when handleClearCode is called', async () => {
      const clearSessionMock = jest.fn().mockResolvedValue(undefined);
      const mockSessionValue: GuestSessionContextType = {
        invitationCode: 'SESSION123',
        guestName: 'Verified Guest',
        email: 'verified.session@example.com',
        isVerified: true,
        isLoading: false,
        status: 'authenticated',
        lastErrorCode: null,
        draftInvitationCode: 'SESSION123',
        isRecoveryModalOpen: false,
        setSession: jest.fn(),
        clearSession: clearSessionMock,
        refreshSession: jest.fn(),
        openRecoveryModal: jest.fn(),
        closeRecoveryModal: jest.fn(),
        recoverSession: jest.fn(),
      };

      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <GuestSessionContext.Provider value={mockSessionValue}>
          {children}
        </GuestSessionContext.Provider>
      );

      const { result } = renderHook(
        () =>
          useRegistryContributionMachine({
            item: mockSingleItem,
            onContribute: mockOnContribute,
          }),
        { wrapper }
      );

      expect(result.current.isCodeLocked).toBe(true);

      await act(async () => {
        await result.current.handleClearCode();
      });

      expect(clearSessionMock).toHaveBeenCalledTimes(1);
      expect(result.current.isCodeLocked).toBe(false);
      expect(result.current.invitationCode).toBe('');
      expect(result.current.contributorName).toBe('');
      expect(result.current.email).toBe('');
      expect(result.current.codeError).toBeNull();
      expect(result.current.fieldErrors).toEqual({});
    });
  });

  describe('Explicit Code Verification & Zero Auto-Check on Edit', () => {
    it('triggers zero network requests across 6+ edits of an 8-character code and verifies explicitly on Verify or submit while hydrating email from /api/registry/session', async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({
        valid: true,
        guestName: 'Jane Smith',
        code: 'VALDCODE',
      });
      (apiClient.get as jest.Mock).mockResolvedValue({
        isVerified: true,
        guestName: 'Jane Smith',
        code: 'VALDCODE',
        email: 'jane.smith@example.com',
      });

      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: mockOnContribute,
        })
      );

      const eightCharEdits = [
        'ABCDEF11',
        'ABCDEF12',
        'ABCDEF13',
        'ABCDEF14',
        'ABCDEF15',
        'ABCDEF16',
        'VALDCODE',
      ];
      for (const draft of eightCharEdits) {
        act(() => {
          result.current.handleCodeChange(draft);
        });
      }

      expect(apiClient.get).not.toHaveBeenCalled();
      expect(apiClient.post).not.toHaveBeenCalled();
      expect(result.current.isValidatingCode).toBe(false);
      expect(result.current.isCodeLocked).toBe(false);

      let verifyPromise!: Promise<boolean>;
      act(() => {
        verifyPromise = result.current.handleVerifyCode();
      });

      expect(result.current.isValidatingCode).toBe(true);
      expect(result.current.isSubmitDisabled).toBe(true);

      await act(async () => {
        await verifyPromise;
      });

      expect(result.current.isCodeLocked).toBe(true);
      expect(result.current.contributorName).toBe('Jane Smith');
      expect(result.current.email).toBe('jane.smith@example.com');
      expect(result.current.codeError).toBeNull();
      expect(apiClient.post).toHaveBeenCalledTimes(1);
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/registry/validate-code',
        { code: 'VALDCODE' },
        expect.objectContaining({ signal: expect.any(Object) })
      );
      expect(apiClient.get).toHaveBeenCalledWith(
        '/api/registry/session',
        expect.objectContaining({ signal: expect.any(Object) })
      );
    });

    it('sets code error when explicit verification returns valid=false and blocks unverified submit', async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({ valid: false });

      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: mockOnContribute,
          initialContributorName: 'Typed Guest',
        })
      );

      act(() => {
        result.current.handleCodeChange('INVALID8');
      });
      expect(apiClient.get).not.toHaveBeenCalled();
      expect(apiClient.post).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.isValidatingCode).toBe(false);
      expect(result.current.codeError).toBe('Invalid invitation code.');
      expect(result.current.isCodeLocked).toBe(false);
      expect(mockOnContribute).not.toHaveBeenCalled();
    });

    it('handles manual verification via handleVerifyCode', async () => {
      (apiClient.post as jest.Mock).mockResolvedValue({
        valid: true,
        guestName: 'Manual Guest',
        code: 'MANUAL1',
      });

      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: mockOnContribute,
        })
      );

      act(() => {
        result.current.handleCodeChange('MANUAL1');
      });

      let verifySuccess: boolean | undefined;
      await act(async () => {
        verifySuccess = await result.current.handleVerifyCode();
      });

      expect(verifySuccess).toBe(true);
      expect(result.current.isCodeLocked).toBe(true);
      expect(result.current.contributorName).toBe('Manual Guest');
    });

    it('sets error when handleVerifyCode is called with empty invitation code', async () => {
      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: mockOnContribute,
        })
      );

      let verifySuccess: boolean | undefined;
      await act(async () => {
        verifySuccess = await result.current.handleVerifyCode();
      });

      expect(verifySuccess).toBe(false);
      expect(result.current.codeError).toBe('Please enter an invitation code.');
    });
  });

  describe('Request Cancellation with AbortController (Criterion 2, 5 & User Scenario 1)', () => {
    it('aborts obsolete in-flight validation requests immediately when guest types new characters', async () => {
      const capturedSignals: AbortSignal[] = [];

      (apiClient.post as jest.Mock).mockImplementation((_url, _body, options) => {
        if (options?.signal) {
          capturedSignals.push(options.signal);
        }
        // Return a promise that does not resolve immediately
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({ valid: true, guestName: 'Late Guest', code: 'CODE1111' });
          }, 100);
        });
      });

      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: mockOnContribute,
        })
      );

      // 1. Guest enters first code and starts explicit verification
      act(() => {
        result.current.handleCodeChange('CODE1111');
      });
      act(() => {
        void result.current.handleVerifyCode();
      });

      expect(capturedSignals).toHaveLength(1);
      expect(capturedSignals[0].aborted).toBe(false);

      // 2. Guest edits code before first request completes -> aborts in-flight verification without auto-firing
      act(() => {
        result.current.handleCodeChange('CODE2222');
      });

      expect(capturedSignals[0].aborted).toBe(true);
      expect(capturedSignals).toHaveLength(1);

      // 3. Explicit verification on updated code starts a fresh signal
      act(() => {
        void result.current.handleVerifyCode();
      });
      expect(capturedSignals).toHaveLength(2);
      expect(capturedSignals[1].aborted).toBe(false);
    });

    it('ignores aborted responses so stale validation data never overwrites user input', async () => {
      let lateResolver: (val: any) => void;
      const latePromise = new Promise((resolve) => {
        lateResolver = resolve;
      });

      (apiClient.post as jest.Mock).mockReturnValueOnce(latePromise);

      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: mockOnContribute,
        })
      );

      // First explicit validation starts
      act(() => {
        result.current.handleCodeChange('STALECD1');
      });
      act(() => {
        void result.current.handleVerifyCode();
      });

      expect(result.current.isValidatingCode).toBe(true);

      // Guest changes code to empty before resolve
      act(() => {
        result.current.handleCodeChange('');
      });

      // User manually enters their own name
      act(() => {
        result.current.setContributorName('My Manual Name');
      });

      // Now stale request resolves
      await act(async () => {
        lateResolver!({ valid: true, guestName: 'Overwriting Stale Name', code: 'STALECD1' });
      });

      // Verify stale response did NOT overwrite user input
      expect(result.current.contributorName).toBe('My Manual Name');
      expect(result.current.isValidatingCode).toBe(false);
      expect(result.current.isCodeLocked).toBe(false);
    });
  });

  describe('Form Validation & Error Partitioning (Requirement 5 & Criterion 4)', () => {
    it('isolates missing name validation error exclusively to fieldErrors.name', async () => {
      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: mockOnContribute,
        })
      );

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.fieldErrors.name).toBe('Name is required and must be under 100 characters.');
      expect(result.current.fieldErrors.email).toBeUndefined();
      expect(result.current.fieldErrors.amount).toBeUndefined();
      expect(result.current.fieldErrors.message).toBeUndefined();

      expect(mockOnContribute).not.toHaveBeenCalled();
    });

    it('clears name field error when contributorName is edited', async () => {
      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: mockOnContribute,
        })
      );

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.fieldErrors.name).toBeDefined();

      act(() => {
        result.current.setContributorName('Jane');
      });

      expect(result.current.fieldErrors.name).toBeUndefined();
    });

    it('isolates invalid email format exclusively to fieldErrors.email', async () => {
      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: mockOnContribute,
          initialContributorName: 'Jane Contributor',
          initialEmail: 'not-an-email',
        })
      );

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.fieldErrors.email).toBe('Invalid email address.');
      expect(result.current.fieldErrors.name).toBeUndefined();
      expect(result.current.fieldErrors.amount).toBeUndefined();
    });

    it('isolates invalid group gift amount exclusively to fieldErrors.amount', async () => {
      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockGroupItem,
          onContribute: mockOnContribute,
          initialContributorName: 'Jane Contributor',
          initialAmount: 0,
        })
      );

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.fieldErrors.amount).toBe('Contribution amount must be a positive number.');
      expect(result.current.fieldErrors.name).toBeUndefined();
      expect(result.current.fieldErrors.email).toBeUndefined();
    });

    it('enforces remaining amount bound for group gift items', async () => {
      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockGroupItem, // price 200, contributed 50 -> remaining 150
          onContribute: mockOnContribute,
          initialContributorName: 'Jane Contributor',
          initialAmount: 180,
        })
      );

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.fieldErrors.amount).toBe('Amount cannot exceed the remaining $150.00.');
      expect(result.current.fieldErrors.name).toBeUndefined();
      expect(mockOnContribute).not.toHaveBeenCalled();
    });

    it('handlePresetClick sets amount and clears amount field error', async () => {
      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockGroupItem,
          onContribute: mockOnContribute,
          initialContributorName: 'Jane Contributor',
          initialAmount: 0,
        })
      );

      await act(async () => {
        await result.current.handleSubmit();
      });
      expect(result.current.fieldErrors.amount).toBeDefined();

      act(() => {
        result.current.handlePresetClick(100);
      });

      expect(result.current.amount).toBe(100);
      expect(result.current.fieldErrors.amount).toBeUndefined();
    });
  });

  describe('Submission Lifecycle & Race Prevention (Requirement 2 & Criterion 3)', () => {
    it('prevents submission while code validation is actively in flight', async () => {
      let pendingValidationResolve: (val: any) => void;
      (apiClient.post as jest.Mock).mockReturnValue(
        new Promise((resolve) => {
          pendingValidationResolve = resolve;
        })
      );

      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: mockOnContribute,
          initialContributorName: 'Jane',
        })
      );

      // Trigger explicit validation
      act(() => {
        result.current.handleCodeChange('INFLIGHT');
      });
      act(() => {
        void result.current.handleVerifyCode();
      });

      expect(result.current.isValidatingCode).toBe(true);
      expect(result.current.isSubmitDisabled).toBe(true);

      // Attempt submit while validating
      await act(async () => {
        await result.current.handleSubmit();
      });

      // Must NOT submit while code is validating
      expect(mockOnContribute).not.toHaveBeenCalled();

      // Resolve validation
      await act(async () => {
        pendingValidationResolve!({ valid: true, guestName: 'Jane' });
      });

      expect(result.current.isValidatingCode).toBe(false);
      expect(result.current.isSubmitDisabled).toBe(false);
    });

    it('successfully completes contribution submission and transitions to success phase', async () => {
      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: mockOnContribute,
          initialContributorName: 'Generous Contributor',
          initialEmail: 'generous@example.com',
          initialMessage: 'Congratulations!',
          initialCoverFee: true,
        })
      );

      let submitPromise: Promise<void>;
      await act(async () => {
        submitPromise = result.current.handleSubmit();
      });

      await act(async () => {
        await submitPromise!;
      });

      expect(mockOnContribute).toHaveBeenCalledWith(
        'item-machine-1',
        'Generous Contributor',
        150,
        undefined,
        'Congratulations!',
        true,
        'generous@example.com'
      );
      expect(result.current.isSuccess).toBe(true);
      expect(result.current.isSubmitting).toBe(false);
    });

    it('transitions to error phase and records submissionError when onContribute fails', async () => {
      mockOnContribute.mockRejectedValueOnce(new Error('Payment gateway timeout'));

      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: mockOnContribute,
          initialContributorName: 'Generous Contributor',
        })
      );

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.submissionError).toBe('Payment gateway timeout');
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.isSubmitting).toBe(false);
    });

    it('keeps focus on invitationCodeInputRef when explicit code verification fails', async () => {
      (apiClient.post as jest.Mock).mockResolvedValueOnce({ valid: false });

      const codeEl = document.createElement('input');
      document.body.appendChild(codeEl);

      try {
        const { result } = renderHook(() =>
          useRegistryContributionMachine({
            item: mockSingleItem,
            onContribute: mockOnContribute,
          })
        );
        result.current.invitationCodeInputRef.current = codeEl;

        act(() => {
          result.current.handleCodeChange('BADCODE8');
        });
        await act(async () => {
          await result.current.handleVerifyCode();
        });

        expect(result.current.isValidatingCode).toBe(false);
        expect(result.current.codeError).toBe('Invalid invitation code.');
        expect(document.activeElement).toBe(codeEl);
      } finally {
        codeEl.remove();
      }
    });

    it('blocks unverified zero-Stripe submit when requireVerifiedCode is true while allowing Stripe paymentIntentId submit', async () => {
      const eightArgContribute = (
        a: string,
        b: string,
        c: number,
        d?: string,
        e?: string,
        f?: boolean,
        g?: string,
        h?: string
      ) => mockOnContribute(a, b, c, d, e, f, g, h);

      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: eightArgContribute,
          initialContributorName: 'Jane',
          requireVerifiedCode: true,
        })
      );

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(mockOnContribute).not.toHaveBeenCalled();
      expect(result.current.codeError).toBe(VERIFIED_CODE_REQUIRED_MESSAGE);

      await act(async () => {
        await result.current.handleSubmit(undefined, 'pi_card_123');
      });

      expect(mockOnContribute).toHaveBeenCalledWith(
        'item-machine-1',
        'Jane',
        150,
        undefined,
        undefined,
        false,
        undefined,
        'pi_card_123'
      );
      expect(result.current.isSuccess).toBe(true);
    });

    it('surfaces server-provided shared_passcode error text on HTTP 401 ApiError and omits unverified code from onContribute', async () => {
      (apiClient.post as jest.Mock).mockRejectedValueOnce(
        new ApiError(
          401,
          'Please enter the personal 8-character invitation code from your envelope rather than the site-wide password.',
          {
            success: false,
            valid: false,
            reason: 'shared_passcode',
            error:
              'Please enter the personal 8-character invitation code from your envelope rather than the site-wide password.',
          }
        )
      );

      const eightArgContribute = (
        a: string,
        b: string,
        c: number,
        d?: string,
        e?: string,
        f?: boolean,
        g?: string,
        h?: string
      ) => mockOnContribute(a, b, c, d, e, f, g, h);

      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockGroupItem,
          onContribute: eightArgContribute,
          initialContributorName: 'Jane',
          initialAmount: 50,
          requireVerifiedCode: false,
        })
      );

      act(() => {
        result.current.handleCodeChange('WEDD2026');
      });
      await act(async () => {
        await result.current.handleVerifyCode();
      });

      expect(result.current.codeError).toBe(
        'Please enter the personal 8-character invitation code from your envelope rather than the site-wide password.'
      );

      // Even if an unverified draft code is passed via identityOverride on card submit, unverified code is omitted
      await act(async () => {
        await result.current.handleSubmit(undefined, 'pi_card_456', {
          identityOverride: {
            code: 'DRAFT123',
            contributorName: 'Jane',
            email: '',
          },
        });
      });

      expect(mockOnContribute).toHaveBeenCalledWith(
        mockGroupItem.id,
        'Jane',
        50,
        undefined,
        undefined,
        false,
        undefined,
        'pi_card_456'
      );
    });

    it('retains isCodeLocked across transient onContribute submission error', async () => {
      (apiClient.post as jest.Mock).mockResolvedValueOnce({
        valid: true,
        code: 'LOCKED88',
        guestName: 'Locked Guest',
      });
      mockOnContribute.mockRejectedValueOnce(new Error('Network hiccup'));

      const { result } = renderHook(() =>
        useRegistryContributionMachine({
          item: mockSingleItem,
          onContribute: mockOnContribute,
          requireVerifiedCode: true,
        })
      );

      act(() => {
        result.current.handleCodeChange('LOCKED88');
      });
      await act(async () => {
        await result.current.handleVerifyCode();
      });

      expect(result.current.isCodeLocked).toBe(true);

      await act(async () => {
        await result.current.handleSubmit();
      });

      expect(result.current.submissionError).toBe('Network hiccup');
      expect(result.current.isCodeLocked).toBe(true);
      expect(result.current.invitationCode).toBe('LOCKED88');
    });
  });
});
