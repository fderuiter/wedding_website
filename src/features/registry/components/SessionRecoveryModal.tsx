'use client';

import React, { useState, useEffect } from 'react';
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

  const [code, setCode] = useState(draftInvitationCode || invitationCode || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (activeIsOpen) {
      setCode(draftInvitationCode || invitationCode || '');
      setErrorMessage(null);
    }
  }, [activeIsOpen, draftInvitationCode, invitationCode]);

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      closeRecoveryModal();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
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
        handleClose();
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
    <Dialog
      isOpen={activeIsOpen}
      onClose={handleClose}
      title="Session Expired"
      description="Your guest session has expired or requires re-verification. Re-verify your invitation code to restore your session without losing form inputs."
    >
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
              setCode(e.target.value.toUpperCase());
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
            onClick={handleClose}
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
    </Dialog>
  );
};
