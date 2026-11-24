'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  RegistryItem,
  OrderTrackingDetails,
  ContributorAddressDetails,
  GuestClaimActions,
} from '../types';
import { ContributionSchema } from '../schemas';
import { apiClient } from '@/lib/apiClient';
import {
  findDemoGuestByCode,
  isDemoRuntimeActive,
} from '@/lib/demo/demoRuntimeBridge';
import { useGuestSession } from '../context/GuestSessionContext';
import { formatCurrency } from '@/utils/intl';
import { getItemRemainingAmount, getItemUnitCounts } from '../lib/registryStatusUtils';

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
  units?: string;
  message?: string;
  retailerOrderNumber?: string;
  carrier?: string;
  trackingNumber?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
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
    paymentIntentId?: string,
    orderDetails?: OrderTrackingDetails,
    addressDetails?: ContributorAddressDetails
  ) => Promise<unknown>;
  initialContributorName?: string;
  initialEmail?: string;
  initialAmount?: number | string;
  initialUnits?: number;
  initialMessage?: string;
  initialCoverFee?: boolean;
  initialInvitationCode?: string;
  initialRetailerOrderNumber?: string;
  initialCarrier?: string;
  initialTrackingNumber?: string;
  initialAddressLine1?: string;
  initialAddressLine2?: string;
  initialCity?: string;
  initialState?: string;
  initialZipCode?: string;
  initialCountry?: string;
}

interface VerifiedSubmissionIdentity {
  ok: boolean;
  code: string;
  contributorName: string;
  email: string;
}

export interface UseRegistryContributionMachineReturn {
  // Deterministic flags
  isValidatingCode: boolean;
  isCodeLocked: boolean;
  isSubmitting: boolean;
  isSuccess: boolean;
  isSubmitDisabled: boolean;
  invitationCodeInputRef: React.RefObject<HTMLInputElement | null>;

  // Form values
  contributorName: string;
  email: string;
  amount: number | string;
  selectedUnits: number;
  message: string;
  coverFee: boolean;
  invitationCode: string;
  retailerOrderNumber: string;
  carrier: string;
  trackingNumber: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;

  // Payment transaction reference & signed guest claim actions
  paymentTransactionId: string | null;
  claimActions: GuestClaimActions | null;

  // Field error partitions
  fieldErrors: ContributionFieldErrors;
  codeError: string | null;
  submissionError: string | null;

  // Setters
  setContributorName: (name: string) => void;
  setEmail: (email: string) => void;
  setAmount: (amount: number | string) => void;
  setSelectedUnits: (units: number) => void;
  setMessage: (message: string) => void;
  setCoverFee: (coverFee: boolean | ((prev: boolean) => boolean)) => void;
  setRetailerOrderNumber: (value: string) => void;
  setCarrier: (value: string) => void;
  setTrackingNumber: (value: string) => void;
  setAddressLine1: (value: string) => void;
  setAddressLine2: (value: string) => void;
  setCity: (value: string) => void;
  setState: (value: string) => void;
  setZipCode: (value: string) => void;
  setCountry: (value: string) => void;
  setPaymentTransactionId: (id: string | null) => void;
  setPhase: (phase: ContributionPhase) => void;
  setSubmissionError: (error: string | null) => void;

  // Actions
  validateContribution: (overrides?: {
    contributorName?: string;
    email?: string;
    code?: string;
  }) => boolean;
  ensureCodeVerifiedForSubmit: () => Promise<VerifiedSubmissionIdentity>;
  handleCodeChange: (e: React.ChangeEvent<HTMLInputElement> | string) => void;
  handleVerifyCode: () => Promise<boolean>;
  handleClearCode: () => Promise<void>;
  handleSubmit: (
    e?: React.SubmitEvent<HTMLFormElement>,
    paymentIntentId?: string,
    options?: {
      coverFeeOverride?: boolean;
      identityOverride?: Omit<VerifiedSubmissionIdentity, 'ok'>;
    }
  ) => Promise<void>;
  handlePresetClick: (presetValue: number) => void;
}

export function useRegistryContributionMachine({
  item,
  onContribute,
  initialContributorName = '',
  initialEmail = '',
  initialAmount = '',
  initialUnits = 1,
  initialMessage = '',
  initialCoverFee = false,
  initialInvitationCode = '',
  initialRetailerOrderNumber = '',
  initialCarrier = '',
  initialTrackingNumber = '',
  initialAddressLine1 = '',
  initialAddressLine2 = '',
  initialCity = '',
  initialState = '',
  initialZipCode = '',
  initialCountry = '',
}: UseRegistryContributionMachineOptions): UseRegistryContributionMachineReturn {
  const {
    invitationCode: sessionCode,
    guestName: sessionGuestName,
    email: sessionEmail,
    isVerified: isSessionVerified,
    setSession,
    clearSession,
  } = useGuestSession();

  const [phaseState, setPhase] = useState<ContributionPhase>('idle');

  // Form fields
  const [contributorNameState, setContributorNameState] = useState(initialContributorName);
  const [hasEditedContributorName, setHasEditedContributorName] = useState(false);
  const [emailState, setEmailState] = useState(initialEmail);
  const [hasEditedEmail, setHasEditedEmail] = useState(false);
  const [amount, setAmountState] = useState<number | string>(initialAmount);
  const [selectedUnitsState, setSelectedUnitsState] = useState<number>(initialUnits);
  const [message, setMessageState] = useState(initialMessage);
  const [coverFee, setCoverFeeState] = useState(initialCoverFee);
  const [invitationCodeState, setInvitationCodeState] = useState(initialInvitationCode);
  const [retailerOrderNumber, setRetailerOrderNumberState] = useState(initialRetailerOrderNumber);
  const [carrier, setCarrierState] = useState(initialCarrier);
  const [trackingNumber, setTrackingNumberState] = useState(initialTrackingNumber);
  const [addressLine1, setAddressLine1State] = useState(initialAddressLine1);
  const [addressLine2, setAddressLine2State] = useState(initialAddressLine2);
  const [city, setCityState] = useState(initialCity);
  const [state, setStateValue] = useState(initialState);
  const [zipCode, setZipCodeState] = useState(initialZipCode);
  const [country, setCountryState] = useState(initialCountry);
  const [dismissedSessionKey, setDismissedSessionKey] = useState<string | null>(null);

  // Partitioned error states
  const [trackedItemId, setTrackedItemId] = useState(item.id);
  const [fieldErrors, setFieldErrors] = useState<ContributionFieldErrors>({});
  const [codeErrorState, setCodeError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [paymentTransactionId, setPaymentTransactionId] = useState<string | null>(null);
  const [claimActions, setClaimActions] = useState<GuestClaimActions | null>(null);

  // AbortController for cancelling in-flight validation requests
  const abortControllerRef = useRef<AbortController | null>(null);
  const invitationCodeInputRef = useRef<HTMLInputElement | null>(null);
  const lockedCodeRef = useRef<string | null>(null);
  const [codeFailureCount, setCodeFailureCount] = useState(0);

  if (trackedItemId !== item.id) {
    setTrackedItemId(item.id);
    setSelectedUnitsState(initialUnits);
    setFieldErrors({});
    setCodeError(null);
    setSubmissionError(null);
    setPaymentTransactionId(null);
    setClaimActions(null);
    if (phaseState !== 'code_locked') {
      setPhase('idle');
      setInvitationCodeState(initialInvitationCode);
    }
  }

  const currentSessionKey =
    isSessionVerified && sessionCode ? `${sessionCode}:${sessionGuestName || ''}` : null;
  const isSessionSynced = Boolean(
    currentSessionKey && dismissedSessionKey !== currentSessionKey
  );

  const phase: ContributionPhase =
    isSessionSynced && (phaseState === 'idle' || phaseState === 'validating_code')
      ? 'code_locked'
      : phaseState;
  const invitationCode = isSessionSynced && sessionCode ? sessionCode : invitationCodeState;
  const contributorName = hasEditedContributorName
    ? contributorNameState
    : contributorNameState || (isSessionSynced ? sessionGuestName || '' : '');
  const email = hasEditedEmail
    ? emailState
    : emailState || (isSessionSynced ? sessionEmail || '' : '');
  const codeError = isSessionSynced ? null : codeErrorState;

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
    setHasEditedContributorName(true);
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
    setHasEditedEmail(true);
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

  const setSelectedUnits = useCallback((units: number) => {
    setSelectedUnitsState(units);
    setFieldErrors((prev) => {
      if (!prev.units && !prev.amount) return prev;
      const next = { ...prev };
      delete next.units;
      delete next.amount;
      return next;
    });
    setSubmissionError(null);
  }, []);

  const setRetailerOrderNumber = useCallback((val: string) => {
    setRetailerOrderNumberState(val);
    setFieldErrors((prev) => {
      if (!prev.retailerOrderNumber) return prev;
      const next = { ...prev };
      delete next.retailerOrderNumber;
      return next;
    });
    setSubmissionError(null);
  }, []);

  const setCarrier = useCallback((val: string) => {
    setCarrierState(val);
    setFieldErrors((prev) => {
      if (!prev.carrier) return prev;
      const next = { ...prev };
      delete next.carrier;
      return next;
    });
    setSubmissionError(null);
  }, []);

  const setTrackingNumber = useCallback((val: string) => {
    setTrackingNumberState(val);
    setFieldErrors((prev) => {
      if (!prev.trackingNumber) return prev;
      const next = { ...prev };
      delete next.trackingNumber;
      return next;
    });
    setSubmissionError(null);
  }, []);

  const setAddressLine1 = useCallback((val: string) => {
    setAddressLine1State(val);
    setFieldErrors((prev) => {
      if (!prev.addressLine1) return prev;
      const next = { ...prev };
      delete next.addressLine1;
      return next;
    });
    setSubmissionError(null);
  }, []);

  const setAddressLine2 = useCallback((val: string) => {
    setAddressLine2State(val);
    setFieldErrors((prev) => {
      if (!prev.addressLine2) return prev;
      const next = { ...prev };
      delete next.addressLine2;
      return next;
    });
    setSubmissionError(null);
  }, []);

  const setCity = useCallback((val: string) => {
    setCityState(val);
    setFieldErrors((prev) => {
      if (!prev.city) return prev;
      const next = { ...prev };
      delete next.city;
      return next;
    });
    setSubmissionError(null);
  }, []);

  const setState = useCallback((val: string) => {
    setStateValue(val);
    setFieldErrors((prev) => {
      if (!prev.state) return prev;
      const next = { ...prev };
      delete next.state;
      return next;
    });
    setSubmissionError(null);
  }, []);

  const setZipCode = useCallback((val: string) => {
    setZipCodeState(val);
    setFieldErrors((prev) => {
      if (!prev.zipCode) return prev;
      const next = { ...prev };
      delete next.zipCode;
      return next;
    });
    setSubmissionError(null);
  }, []);

  const setCountry = useCallback((val: string) => {
    setCountryState(val);
    setFieldErrors((prev) => {
      if (!prev.country) return prev;
      const next = { ...prev };
      delete next.country;
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
  const verifyCodeWithDetails = useCallback(
    async (
      codeToVerify: string
    ): Promise<{
      valid: boolean;
      code?: string;
      guestName?: string;
      email?: string | null;
    }> => {
      const code = codeToVerify.trim().toUpperCase();
      if (!code) {
        setCodeError('Please enter an invitation code.');
        setCodeFailureCount((count) => count + 1);
        return { valid: false };
      }

      if (isDemoRuntimeActive()) {
        const matched = findDemoGuestByCode(code);
        if (matched) {
          const resolvedEmail =
            typeof matched.email === 'string' && matched.email.trim().length > 0
              ? matched.email.trim()
              : null;
          lockedCodeRef.current = matched.code;
          setInvitationCodeState(matched.code);
          if (matched.guestName && (!hasEditedContributorName || !contributorNameState.trim())) {
            setContributorNameState(matched.guestName);
          }
          if (resolvedEmail && !hasEditedEmail && !emailState.trim()) {
            setEmailState(resolvedEmail);
          }
          setDismissedSessionKey(null);
          setPhase('code_locked');
          setCodeError(null);
          setSubmissionError(null);
          setSession({
            invitationCode: matched.code,
            guestName: matched.guestName,
            email: resolvedEmail,
            isVerified: true,
          });
          return {
            valid: true,
            code: matched.code,
            guestName: matched.guestName,
            email: resolvedEmail,
          };
        }
        lockedCodeRef.current = null;
        setPhase('idle');
        setCodeError('Invalid invitation code.');
        setCodeFailureCount((count) => count + 1);
        return { valid: false };
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
        const data = await apiClient.get<{
          valid?: boolean;
          code?: string;
          guestName?: string;
          email?: string | null;
        }>(`/api/registry/validate-code?code=${encodeURIComponent(code)}`, {
          signal: controller.signal,
        });

        if (controller.signal.aborted) {
          return { valid: false };
        }

        if (data && data.valid) {
          const verifiedCode = data.code || code;
          const resolvedEmail =
            typeof data.email === 'string' && data.email.trim().length > 0
              ? data.email.trim()
              : null;
          lockedCodeRef.current = verifiedCode;
          setInvitationCodeState(verifiedCode);
          if (data.guestName && (!hasEditedContributorName || !contributorNameState.trim())) {
            setContributorNameState(data.guestName);
          }
          if (resolvedEmail && !hasEditedEmail && !emailState.trim()) {
            setEmailState(resolvedEmail);
          }
          setDismissedSessionKey(null);
          setPhase('code_locked');
          setSession({
            invitationCode: verifiedCode,
            guestName: data.guestName || '',
            email: resolvedEmail,
            isVerified: true,
          });
          return {
            valid: true,
            code: verifiedCode,
            guestName: data.guestName || '',
            email: resolvedEmail,
          };
        } else {
          lockedCodeRef.current = null;
          setPhase('idle');
          setCodeError('Invalid invitation code.');
          setCodeFailureCount((count) => count + 1);
          return { valid: false };
        }
      } catch (err: unknown) {
        if (controller.signal.aborted || (err as Error)?.name === 'AbortError') {
          return { valid: false };
        }
        lockedCodeRef.current = null;
        setPhase('idle');
        const msg = err instanceof Error ? err.message : 'Invalid invitation code.';
        setCodeError(msg || 'Invalid invitation code.');
        setCodeFailureCount((count) => count + 1);
        return { valid: false };
      } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [
      contributorNameState,
      emailState,
      hasEditedContributorName,
      hasEditedEmail,
      setSession,
    ]
  );

  const verifyCode = useCallback(
    async (codeToVerify: string): Promise<boolean> => {
      const outcome = await verifyCodeWithDetails(codeToVerify);
      return outcome.valid;
    },
    [verifyCodeWithDetails]
  );

  // Action: Code change handler without automatic 8-character network checks
  const handleCodeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement> | string) => {
      const val = (typeof e === 'string' ? e : e.target.value).toUpperCase();

      // Immediately cancel any in-flight validation request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }

      lockedCodeRef.current = null;

      if (currentSessionKey && val !== sessionCode) {
        setDismissedSessionKey(currentSessionKey);
      }

      setInvitationCodeState(val);
      setCodeError(null);

      if (phase === 'code_locked' || phase === 'validating_code') {
        setPhase('idle');
      }
    },
    [currentSessionKey, sessionCode, phase]
  );

  // Action: Manual verification
  const handleVerifyCode = useCallback(async (): Promise<boolean> => {
    return verifyCode(invitationCode);
  }, [invitationCode, verifyCode]);

  // Action: Ensure unverified non-empty invitation code is verified at submit time
  const ensureCodeVerifiedForSubmit = useCallback(async (): Promise<VerifiedSubmissionIdentity> => {
    const trimmedCode = invitationCode.trim().toUpperCase();
    if (
      !trimmedCode ||
      phase === 'code_locked' ||
      (lockedCodeRef.current && lockedCodeRef.current === trimmedCode)
    ) {
      return {
        ok: true,
        code: trimmedCode,
        contributorName,
        email,
      };
    }

    const verification = await verifyCodeWithDetails(trimmedCode);
    if (!verification.valid) {
      return {
        ok: false,
        code: trimmedCode,
        contributorName,
        email,
      };
    }

    const resolvedCode = verification.code || trimmedCode;
    const resolvedName =
      (!hasEditedContributorName || !contributorNameState.trim()) && verification.guestName
        ? verification.guestName
        : contributorName;
    const resolvedEmail =
      !hasEditedEmail && !emailState.trim() && verification.email
        ? verification.email
        : email;

    return {
      ok: true,
      code: resolvedCode,
      contributorName: resolvedName,
      email: resolvedEmail,
    };
  }, [
    contributorName,
    contributorNameState,
    email,
    emailState,
    hasEditedContributorName,
    hasEditedEmail,
    invitationCode,
    phase,
    verifyCodeWithDetails,
  ]);

  // Action: Clear code & session
  const handleClearCode = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    lockedCodeRef.current = null;
    if (currentSessionKey) {
      setDismissedSessionKey(currentSessionKey);
    }
    await clearSession();
    setPhase('idle');
    setInvitationCodeState('');
    setHasEditedContributorName(false);
    setContributorNameState('');
    setHasEditedEmail(false);
    setEmailState('');
    setCodeError(null);
    setFieldErrors({});
    setSubmissionError(null);
  }, [clearSession, currentSessionKey]);

  const { requestedUnits, remainingUnits } = getItemUnitCounts(item);
  const selectedUnits = selectedUnitsState;

  const validateContribution = useCallback(
    (overrides?: { contributorName?: string; email?: string; code?: string }): boolean => {
      setFieldErrors({});
      setSubmissionError(null);

      if (!item.isGroupGift && requestedUnits > 1) {
        if (
          !Number.isInteger(selectedUnits) ||
          selectedUnits < 1 ||
          selectedUnits > remainingUnits
        ) {
          setFieldErrors({
            units:
              remainingUnits > 0
                ? `Please select between 1 and ${remainingUnits} available units.`
                : 'No units are currently available.',
          });
          setPhase('error');
          return false;
        }
      }

      const rawAmount = item.isGroupGift
        ? amount
        : requestedUnits > 1
          ? Math.round(item.price * selectedUnits * 100) / 100
          : item.price;

      const effectiveName = overrides?.contributorName ?? contributorName;
      const effectiveEmail = overrides?.email ?? email;
      const effectiveCode = overrides?.code ?? invitationCode;

      const result = ContributionSchema.safeParse({
        itemId: item.id,
        name: effectiveName,
        email: effectiveEmail || undefined,
        amount: rawAmount,
        code: effectiveCode || undefined,
        message: message || undefined,
        coverFee,
        retailerOrderNumber: retailerOrderNumber || undefined,
        carrier: carrier || undefined,
        trackingNumber: trackingNumber || undefined,
        addressLine1: addressLine1 || undefined,
        addressLine2: addressLine2 || undefined,
        city: city || undefined,
        state: state || undefined,
        zipCode: zipCode || undefined,
        country: country || undefined,
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
        return false;
      }

      if (item.isGroupGift) {
        const remainingAmount = getItemRemainingAmount(item);
        if (result.data.amount > remainingAmount) {
          const msg = `Amount cannot exceed the remaining ${formatCurrency(remainingAmount)}.`;
          setFieldErrors({ amount: msg });
          setPhase('error');
          return false;
        }
      }

      return true;
    },
    [
      item,
      requestedUnits,
      remainingUnits,
      selectedUnits,
      amount,
      contributorName,
      email,
      invitationCode,
      message,
      coverFee,
      retailerOrderNumber,
      carrier,
      trackingNumber,
      addressLine1,
      addressLine2,
      city,
      state,
      zipCode,
      country,
    ]
  );

  // Action: Submit contribution
  const handleSubmit = useCallback(
    async (
      e?: React.SubmitEvent<HTMLFormElement>,
      paymentIntentId?: string,
      options?: {
        coverFeeOverride?: boolean;
        identityOverride?: Omit<VerifiedSubmissionIdentity, 'ok'>;
      }
    ) => {
      if (e) {
        e.preventDefault();
      }

      // Prevent submission if validating code or already submitting
      if (phase === 'validating_code' || phase === 'submitting') {
        return;
      }

      setFieldErrors({});
      setSubmissionError(null);

      const trimmedCode = invitationCode.trim().toUpperCase();
      const needsAsyncCodeVerification =
        !options?.identityOverride &&
        Boolean(trimmedCode) &&
        phase !== 'code_locked' &&
        lockedCodeRef.current !== trimmedCode;

      let resolvedIdentity: Omit<VerifiedSubmissionIdentity, 'ok'>;
      if (options?.identityOverride) {
        resolvedIdentity = options.identityOverride;
      } else if (!needsAsyncCodeVerification) {
        resolvedIdentity = {
          code: trimmedCode,
          contributorName,
          email,
        };
      } else {
        const verified = await ensureCodeVerifiedForSubmit();
        if (!verified.ok) {
          return;
        }
        resolvedIdentity = verified;
      }

      if (!item.isGroupGift && requestedUnits > 1) {
        if (
          !Number.isInteger(selectedUnits) ||
          selectedUnits < 1 ||
          selectedUnits > remainingUnits
        ) {
          setFieldErrors({
            units:
              remainingUnits > 0
                ? `Please select between 1 and ${remainingUnits} available units.`
                : 'No units are currently available.',
          });
          setPhase('error');
          return;
        }
      }

      const rawAmount = item.isGroupGift
        ? amount
        : requestedUnits > 1
          ? Math.round(item.price * selectedUnits * 100) / 100
          : item.price;
      const effectiveCoverFee =
        options?.coverFeeOverride !== undefined ? options.coverFeeOverride : coverFee;

      const result = ContributionSchema.safeParse({
        itemId: item.id,
        name: resolvedIdentity.contributorName,
        email: resolvedIdentity.email || undefined,
        amount: rawAmount,
        code: resolvedIdentity.code || undefined,
        message: message || undefined,
        coverFee: effectiveCoverFee,
        paymentIntentId,
        retailerOrderNumber: retailerOrderNumber || undefined,
        carrier: carrier || undefined,
        trackingNumber: trackingNumber || undefined,
        addressLine1: addressLine1 || undefined,
        addressLine2: addressLine2 || undefined,
        city: city || undefined,
        state: state || undefined,
        zipCode: zipCode || undefined,
        country: country || undefined,
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
        const remainingAmount = getItemRemainingAmount(item);
        if (finalAmount > remainingAmount) {
          const msg = `Amount cannot exceed the remaining ${formatCurrency(remainingAmount)}.`;
          setFieldErrors({ amount: msg });
          setPhase('error');
          return;
        }
      }

      const hasOrderDetails = Boolean(
        validData.retailerOrderNumber || validData.carrier || validData.trackingNumber
      );
      const orderDetailsPayload: OrderTrackingDetails | undefined = hasOrderDetails
        ? {
          ...(validData.retailerOrderNumber
            ? { retailerOrderNumber: validData.retailerOrderNumber }
            : {}),
          ...(validData.carrier ? { carrier: validData.carrier } : {}),
          ...(validData.trackingNumber ? { trackingNumber: validData.trackingNumber } : {}),
        }
        : undefined;

      const hasAddressDetails = Boolean(
        validData.addressLine1 ||
          validData.addressLine2 ||
          validData.city ||
          validData.state ||
          validData.zipCode ||
          validData.country
      );
      const addressDetailsPayload: ContributorAddressDetails | undefined = hasAddressDetails
        ? {
          ...(validData.addressLine1 ? { addressLine1: validData.addressLine1 } : {}),
          ...(validData.addressLine2 ? { addressLine2: validData.addressLine2 } : {}),
          ...(validData.city ? { city: validData.city } : {}),
          ...(validData.state ? { state: validData.state } : {}),
          ...(validData.zipCode ? { zipCode: validData.zipCode } : {}),
          ...(validData.country ? { country: validData.country } : {}),
        }
        : undefined;

      setPhase('submitting');
      try {
        let contributeResult: unknown;
        if (addressDetailsPayload) {
          contributeResult = await onContribute(
            item.id,
            validData.name,
            finalAmount,
            validData.code || undefined,
            validData.message || undefined,
            validData.coverFee,
            validData.email || undefined,
            paymentIntentId,
            orderDetailsPayload,
            addressDetailsPayload
          );
        } else if (orderDetailsPayload) {
          contributeResult = await onContribute(
            item.id,
            validData.name,
            finalAmount,
            validData.code || undefined,
            validData.message || undefined,
            validData.coverFee,
            validData.email || undefined,
            paymentIntentId,
            orderDetailsPayload
          );
        } else if (paymentIntentId !== undefined && onContribute.length >= 8) {
          contributeResult = await onContribute(
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
          contributeResult = await onContribute(
            item.id,
            validData.name,
            finalAmount,
            validData.code || undefined,
            validData.message || undefined,
            validData.coverFee,
            validData.email || undefined
          );
        } else if (validData.code !== undefined || validData.message !== undefined) {
          contributeResult = await onContribute(
            item.id,
            validData.name,
            finalAmount,
            validData.code || undefined,
            validData.message || undefined
          );
        } else {
          contributeResult = await onContribute(item.id, validData.name, finalAmount);
        }
        if (
          !paymentIntentId &&
          contributeResult &&
          typeof contributeResult === 'object' &&
          'claimActions' in contributeResult &&
          (contributeResult as { claimActions?: GuestClaimActions }).claimActions
        ) {
          setClaimActions(
            (contributeResult as { claimActions?: GuestClaimActions }).claimActions ?? null
          );
        } else {
          setClaimActions(null);
        }
        setPaymentTransactionId(paymentIntentId ?? null);
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
      ensureCodeVerifiedForSubmit,
      item,
      requestedUnits,
      remainingUnits,
      selectedUnits,
      amount,
      contributorName,
      email,
      invitationCode,
      message,
      coverFee,
      retailerOrderNumber,
      carrier,
      trackingNumber,
      addressLine1,
      addressLine2,
      city,
      state,
      zipCode,
      country,
      onContribute,
    ]
  );

  useEffect(() => {
    if (codeFailureCount === 0 || phase !== 'idle' || !codeError) {
      return;
    }
    invitationCodeInputRef.current?.focus();
  }, [codeFailureCount, phase, codeError]);

  // Deterministic flags
  const isValidatingCode = phase === 'validating_code';
  const isCodeLocked = phase === 'code_locked';
  const isSubmitting = phase === 'submitting';
  const isSuccess = phase === 'success';
  const isSubmitDisabled = isValidatingCode || isSubmitting;

  return {
    isValidatingCode,
    isCodeLocked,
    isSubmitting,
    isSuccess,
    isSubmitDisabled,
    invitationCodeInputRef,

    contributorName,
    email,
    amount,
    selectedUnits,
    message,
    coverFee,
    invitationCode,
    retailerOrderNumber,
    carrier,
    trackingNumber,
    addressLine1,
    addressLine2,
    city,
    state,
    zipCode,
    country,

    paymentTransactionId,
    claimActions,

    fieldErrors,
    codeError,
    submissionError,

    setContributorName,
    setEmail,
    setAmount,
    setSelectedUnits,
    setMessage,
    setCoverFee,
    setRetailerOrderNumber,
    setCarrier,
    setTrackingNumber,
    setAddressLine1,
    setAddressLine2,
    setCity,
    setState,
    setZipCode,
    setCountry,
    setPaymentTransactionId,
    setPhase,
    setSubmissionError,

    validateContribution,
    ensureCodeVerifiedForSubmit,
    handleCodeChange,
    handleVerifyCode,
    handleClearCode,
    handleSubmit,
    handlePresetClick,
  };
}
