'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { RegistryItem } from '../types';
import { ContributionSchema } from '../schemas';
import { apiClient } from '@/lib/apiClient';
import { useGuestSession } from '../context/GuestSessionContext';
import { formatCurrency } from '@/utils/intl';

export type ContributionPhase =
  | 'idle'
  | 'validating_code'
  | 'code_locked'
  | 'submitting'
  | 'success'
  | 'error';

export interface ContributionFieldErrors {
  name?: string;
  email?: string;
  amount?: string;
  message?: string;
}

export interface UseRegistryContributionMachineOptions {
  item: RegistryItem;
  onContribute: (
    itemId: string,
    contributorName: string,
    amount: number,
    code?: string,
    message?: string,
    coverFee?: boolean,
    email?: string,
    paymentIntentId?: string
  ) => Promise<void>;
  initialContributorName?: string;
  initialEmail?: string;
  initialAmount?: number | string;
  initialMessage?: string;
  initialCoverFee?: boolean;
  initialInvitationCode?: string;
}

export interface UseRegistryContributionMachineReturn {
  // Phase and deterministic flags
  phase: ContributionPhase;
  isValidatingCode: boolean;
  isCodeLocked: boolean;
  isSubmitting: boolean;
  isSuccess: boolean;
  isError: boolean;
  isSubmitDisabled: boolean;

  // Form values
  contributorName: string;
  email: string;
  amount: number | string;
  message: string;
  coverFee: boolean;
  invitationCode: string;

  // Payment transaction reference
  paymentTransactionId: string | null;

  // Field error partitions
  fieldErrors: ContributionFieldErrors;
  codeError: string | null;
  submissionError: string | null;
  error: string | null;

  // Setters
  setContributorName: (name: string) => void;
  setEmail: (email: string) => void;
  setAmount: (amount: number | string) => void;
  setMessage: (message: string) => void;
  setCoverFee: (coverFee: boolean | ((prev: boolean) => boolean)) => void;
  setInvitationCode: (code: string) => void;
  setPaymentTransactionId: (id: string | null) => void;
  setPhase: (phase: ContributionPhase) => void;
  setSubmissionError: (error: string | null) => void;

  // Actions
  handleCodeChange: (e: React.ChangeEvent<HTMLInputElement> | string) => void;
  handleVerifyCode: () => Promise<boolean>;
  handleClearCode: () => Promise<void>;
  handleSubmit: (e?: React.FormEvent, paymentIntentId?: string) => Promise<void>;
  handlePresetClick: (presetValue: number) => void;
}

export function useRegistryContributionMachine({
  item,
  onContribute,
  initialContributorName = '',
  initialEmail = '',
  initialAmount = '',
  initialMessage = '',
  initialCoverFee = false,
  initialInvitationCode = '',
}: UseRegistryContributionMachineOptions): UseRegistryContributionMachineReturn {
  const {
    invitationCode: sessionCode,
    guestName: sessionGuestName,
    isVerified: isSessionVerified,
    setSession,
    clearSession,
  } = useGuestSession();

  const [phase, setPhase] = useState<ContributionPhase>('idle');

  // Form fields
  const [contributorName, setContributorNameState] = useState(initialContributorName);
  const [email, setEmailState] = useState(initialEmail);
  const [amount, setAmountState] = useState<number | string>(initialAmount);
  const [message, setMessageState] = useState(initialMessage);
  const [coverFee, setCoverFeeState] = useState(initialCoverFee);
  const [invitationCode, setInvitationCodeState] = useState(initialInvitationCode);

  // Partitioned error states
  const [fieldErrors, setFieldErrors] = useState<ContributionFieldErrors>({});
  const [codeError, setCodeError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [paymentTransactionId, setPaymentTransactionId] = useState<string | null>(null);

  // AbortController for cancelling in-flight validation requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Synchronize session state from GuestSessionContext
  useEffect(() => {
    if (isSessionVerified && sessionCode) {
      setInvitationCodeState(sessionCode);
      setContributorNameState((prev) => prev || sessionGuestName || '');
      setPhase('code_locked');
      setCodeError(null);
    }
  }, [isSessionVerified, sessionCode, sessionGuestName]);

  // Clean up any pending validation request on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // Setters with error clearing
  const setContributorName = useCallback((name: string) => {
    setContributorNameState(name);
    setFieldErrors((prev) => {
      if (!prev.name) return prev;
      const next = { ...prev };
      delete next.name;
      return next;
    });
    setSubmissionError(null);
  }, []);

  const setEmail = useCallback((val: string) => {
    setEmailState(val);
    setFieldErrors((prev) => {
      if (!prev.email) return prev;
      const next = { ...prev };
      delete next.email;
      return next;
    });
    setSubmissionError(null);
  }, []);

  const setAmount = useCallback((val: number | string) => {
    setAmountState(val);
    setFieldErrors((prev) => {
      if (!prev.amount) return prev;
      const next = { ...prev };
      delete next.amount;
      return next;
    });
    setSubmissionError(null);
  }, []);

  const setMessage = useCallback((val: string) => {
    setMessageState(val);
    setFieldErrors((prev) => {
      if (!prev.message) return prev;
      const next = { ...prev };
      delete next.message;
      return next;
    });
    setSubmissionError(null);
  }, []);

  const setCoverFee = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    setCoverFeeState(val);
  }, []);

  const setInvitationCode = useCallback((code: string) => {
    setInvitationCodeState(code);
  }, []);

  const handlePresetClick = useCallback((presetValue: number) => {
    setAmountState(presetValue);
    setFieldErrors((prev) => {
      if (!prev.amount) return prev;
      const next = { ...prev };
      delete next.amount;
      return next;
    });
    setSubmissionError(null);
  }, []);

  // Internal unified verification helper
  const verifyCode = useCallback(
    async (codeToVerify: string): Promise<boolean> => {
      const code = codeToVerify.trim().toUpperCase();
      if (!code) {
        setCodeError('Please enter an invitation code.');
        return false;
      }

      // Abort previous in-flight validation requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      setPhase('validating_code');
      setCodeError(null);
      setSubmissionError(null);

      try {
        const data = await apiClient.get(
          `/api/registry/validate-code?code=${encodeURIComponent(code)}`,
          { signal: controller.signal }
        );

        if (controller.signal.aborted) {
          return false;
        }

        if (data && data.valid) {
          if (data.guestName) {
            setContributorNameState(data.guestName);
          }
          setPhase('code_locked');
          setSession({
            invitationCode: data.code || code,
            guestName: data.guestName || '',
            isVerified: true,
          });
          return true;
        } else {
          setPhase('idle');
          setCodeError('Invalid invitation code.');
          return false;
        }
      } catch (err: unknown) {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') {
          return false;
        }
        setPhase('idle');
        const msg = err instanceof Error ? err.message : 'Invalid invitation code.';
        setCodeError(msg || 'Invalid invitation code.');
        return false;
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [setSession]
  );

  // Action: Code change handler with automatic 8-character validation & immediate cancellation
  const handleCodeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement> | string) => {
      const val = (typeof e === 'string' ? e : e.target.value).toUpperCase();

      // Immediately cancel any in-flight validation request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      setInvitationCodeState(val);
      setCodeError(null);

      if (val === '') {
        if (phase === 'code_locked' || phase === 'validating_code') {
          setPhase('idle');
        }
        return;
      }

      if (val.length === 8) {
        void verifyCode(val);
      } else if (phase === 'validating_code') {
        setPhase('idle');
      }
    },
    [phase, verifyCode]
  );

  // Action: Manual verification
  const handleVerifyCode = useCallback(async (): Promise<boolean> => {
    return verifyCode(invitationCode);
  }, [invitationCode, verifyCode]);

  // Action: Clear code & session
  const handleClearCode = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    await clearSession();
    setPhase('idle');
    setInvitationCodeState('');
    setContributorNameState('');
    setCodeError(null);
    setFieldErrors({});
    setSubmissionError(null);
  }, [clearSession]);

  // Action: Submit contribution
  const handleSubmit = useCallback(
    async (e?: React.FormEvent, paymentIntentId?: string) => {
      if (e) {
        e.preventDefault();
      }

      // Prevent submission if validating code or already submitting
      if (phase === 'validating_code' || phase === 'submitting') {
        return;
      }

      setFieldErrors({});
      setSubmissionError(null);

      const rawAmount = item.isGroupGift ? amount : item.price;

      const result = ContributionSchema.safeParse({
        itemId: item.id,
        name: contributorName,
        email: email || undefined,
        amount: rawAmount,
        code: invitationCode || undefined,
        message: message || undefined,
        coverFee,
        paymentIntentId,
      });

      if (!result.success) {
        const errors: ContributionFieldErrors = {};
        for (const issue of result.error.issues) {
          const field = issue.path[0] as keyof ContributionFieldErrors;
          if (field && !errors[field]) {
            errors[field] = issue.message;
          }
        }
        setFieldErrors(errors);
        setPhase('error');
        return;
      }

      const validData = result.data;
      const finalAmount = validData.amount;

      if (item.isGroupGift) {
        const remainingAmount = item.price - item.amountContributed;
        if (finalAmount > remainingAmount) {
          const msg = `Amount cannot exceed the remaining ${formatCurrency(remainingAmount)}.`;
          setFieldErrors({ amount: msg });
          setPhase('error');
          return;
        }
      }

      setPhase('submitting');
      try {
        if (paymentIntentId !== undefined && onContribute.length >= 8) {
          await onContribute(
            item.id,
            validData.name,
            finalAmount,
            validData.code || undefined,
            validData.message || undefined,
            validData.coverFee,
            validData.email || undefined,
            paymentIntentId
          );
        } else if (validData.email !== undefined || validData.coverFee) {
          await onContribute(
            item.id,
            validData.name,
            finalAmount,
            validData.code || undefined,
            validData.message || undefined,
            validData.coverFee,
            validData.email || undefined
          );
        } else if (validData.code !== undefined || validData.message !== undefined) {
          await onContribute(
            item.id,
            validData.name,
            finalAmount,
            validData.code || undefined,
            validData.message || undefined
          );
        } else {
          await onContribute(item.id, validData.name, finalAmount);
        }
        if (paymentIntentId) {
          setPaymentTransactionId(paymentIntentId);
        }
        setPhase('success');
      } catch (err: unknown) {
        setPhase('error');
        if (err instanceof Error) {
          setSubmissionError(err.message || 'Failed to process contribution. Please try again.');
        } else {
          setSubmissionError('An unknown error occurred during contribution.');
        }
      }
    },
    [
      phase,
      item.isGroupGift,
      item.price,
      item.amountContributed,
      item.id,
      amount,
      contributorName,
      email,
      invitationCode,
      message,
      coverFee,
      onContribute,
    ]
  );

  // Deterministic flags
  const isValidatingCode = phase === 'validating_code';
  const isCodeLocked = phase === 'code_locked';
  const isSubmitting = phase === 'submitting';
  const isSuccess = phase === 'success';
  const isError = phase === 'error';
  const isSubmitDisabled = isValidatingCode || isSubmitting;

  // Composite primary error string for backwards compatibility / global message
  const primaryFieldError =
    fieldErrors.name || fieldErrors.amount || fieldErrors.email || fieldErrors.message || null;
  const error = submissionError || primaryFieldError;

  return {
    phase,
    isValidatingCode,
    isCodeLocked,
    isSubmitting,
    isSuccess,
    isError,
    isSubmitDisabled,

    contributorName,
    email,
    amount,
    message,
    coverFee,
    invitationCode,

    paymentTransactionId,

    fieldErrors,
    codeError,
    submissionError,
    error,

    setContributorName,
    setEmail,
    setAmount,
    setMessage,
    setCoverFee,
    setInvitationCode,
    setPaymentTransactionId,
    setPhase,
    setSubmissionError,

    handleCodeChange,
    handleVerifyCode,
    handleClearCode,
    handleSubmit,
    handlePresetClick,
  };
}
