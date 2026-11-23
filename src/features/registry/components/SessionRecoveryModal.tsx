'use client';

import React, { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, FormMessage } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { useGuestSession } from '../context/GuestSessionContext';

export interface SessionRecoveryModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onSuccess?: () => void;
}

interface SessionRecoveryFormProps {
  defaultCode: string;
  recoverSession: (code: string) => Promise<boolean>;
  onClose: () => void;
  onSuccess?: () => void;
}

const SessionRecoveryForm: React.FC<SessionRecoveryFormProps> = ({
  defaultCode,
  recoverSession,
  onClose,
  onSuccess,
}) => {
  const [draftCode, setDraftCode] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const code = draftCode ?? defaultCode;

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) {
      setErrorMessage('Please enter an invitation code.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const success = await recoverSession(cleanCode);
      if (success) {
        if (onSuccess) onSuccess();
        onClose();
      } else {
        setErrorMessage('Invalid invitation code. Please check and try again.');
      }
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'An error occurred during session recovery.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
      <FormGroup state={errorMessage ? 'error' : 'default'}>
        <Label htmlFor="recovery-invitation-code">
          Invitation Code <span className="text-red-500">*</span>
        </Label>
        <Input
          id="recovery-invitation-code"
          type="text"
          placeholder="e.g. ABCDEF12"
          value={code}
          onChange={(e) => {
            setDraftCode(e.target.value.toUpperCase());
            setErrorMessage(null);
          }}
          disabled={isSubmitting}
          autoFocus
        />
        {errorMessage && <FormMessage>{errorMessage}</FormMessage>}
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
          disabled={isSubmitting || !code.trim()}
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
        recoverSession={recoverSession}
        onClose={handleClose}
        onSuccess={onSuccess}
      />
    </Dialog>
  );
};
