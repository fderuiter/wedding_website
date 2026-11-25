'use client';

import React, { useRef, useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, FormMessage } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { useGuestSession } from '../context/GuestSessionContext';

interface SessionRecoveryModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onSuccess?: () => void;
}

interface SessionRecoveryFormProps {
  defaultCode: string;
  lastErrorCode: string | null;
  recoverSession: (code: string) => Promise<boolean>;
  onClose: () => void;
  onSuccess?: () => void;
}

const INTERNAL_ERROR_CODES = new Set([
  'SESSION_EXPIRED',
  'MISSING_CODE',
  'INVALID_CODE',
  'NETWORK_ERROR',
  'RECOVERY_FAILED',
]);

const SessionRecoveryForm: React.FC<SessionRecoveryFormProps> = ({
  defaultCode,
  lastErrorCode,
  recoverSession,
  onClose,
  onSuccess,
}) => {
  const [draftCode, setDraftCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const code = draftCode ?? defaultCode;
  const contextualGuidance =
    errorMessage && lastErrorCode && !INTERNAL_ERROR_CODES.has(lastErrorCode)
      ? lastErrorCode
      : null;
  const displayedError = contextualGuidance || errorMessage;

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cleanCode = code.trim();
    if (!cleanCode) {
      setErrorMessage('Please enter an invitation code.');
      inputRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    let didSucceed = false;
    try {
      const success = await recoverSession(cleanCode);
      if (success) {
        didSucceed = true;
        if (onSuccess) onSuccess();
        onClose();
      } else {
        setErrorMessage('Invalid invitation code. Please check and try again.');
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred during session recovery.');
    } finally {
      setIsSubmitting(false);
      if (!didSucceed) {
        inputRef.current?.focus();
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
      <FormGroup required busy={isSubmitting} state={displayedError ? 'error' : 'default'}>
        <Label htmlFor="recovery-invitation-code">Invitation Code</Label>
        <Input
          ref={inputRef}
          id="recovery-invitation-code"
          type="text"
          placeholder="e.g. ABCDEF12"
          value={code}
          onChange={(e) => {
            setDraftCode(e.target.value);
            setErrorMessage(null);
          }}
          required
          busy={isSubmitting}
          autoFocus
        />
        {displayedError && <FormMessage>{displayedError}</FormMessage>}
      </FormGroup>

      <div className="flex justify-end gap-3 mt-6">
        <Button
          type="button"
          variant="outline"
          onClick={onClose}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          aria-disabled={isSubmitting || !code.trim()}
          aria-busy={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <Icon name="Loader2" className="animate-spin mr-2 h-4 w-4" aria-hidden="true" />
              Verifying...
            </>
          ) : (
            'Re-verify Code'
          )}
        </Button>
      </div>
    </form>
  );
};

export const SessionRecoveryModal: React.FC<SessionRecoveryModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const {
    isRecoveryModalOpen,
    closeRecoveryModal,
    draftInvitationCode,
    invitationCode,
    lastErrorCode,
    recoverSession,
  } = useGuestSession();

  const activeIsOpen = isOpen ?? isRecoveryModalOpen;

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      closeRecoveryModal();
    }
  };

  return (
    <Dialog
      isOpen={activeIsOpen}
      onClose={handleClose}
      title="Session Expired"
      description="Your guest session has expired or requires re-verification. Re-verify your invitation code to restore your session without losing form inputs."
    >
      <SessionRecoveryForm
        key={activeIsOpen ? 'open' : 'closed'}
        defaultCode={draftInvitationCode || invitationCode || ''}
        lastErrorCode={lastErrorCode}
        recoverSession={recoverSession}
        onClose={handleClose}
        onSuccess={onSuccess}
      />
    </Dialog>
  );
};
