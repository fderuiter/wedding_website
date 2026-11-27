'use client';

import React, { useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FormGroup, FormMessage, Input, Label } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { withBasePath } from '@/lib/basePath';
import { cn } from '@/utils/cn';
import {
  RECOVERY_CONFIRMATION_MESSAGE,
  parseRecoveryIdentifier,
} from '@/utils/guestSignInRecovery';

export interface GuestSignInLinkRecoveryProps {
  className?: string;
  headingLevel?: 'h2' | 'h3' | 'h4';
}

export function GuestSignInLinkRecovery({
  className,
  headingLevel = 'h3',
}: GuestSignInLinkRecoveryProps) {
  const uid = useId();
  const inputId = `guest-recovery-identifier-${uid}`;
  const errorId = `guest-recovery-error-${uid}`;
  const privacyId = `guest-recovery-privacy-${uid}`;

  const [identifier, setIdentifier] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationMessage, setConfirmationMessage] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const HeadingTag = headingLevel;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    setError(null);

    if (!honeypot.trim()) {
      const parsed = parseRecoveryIdentifier({ identifier });
      if (!parsed.ok) {
        setError(parsed.error);
        inputRef.current?.focus();
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(withBasePath('/api/guest/recover'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          identifier: identifier.trim(),
          ...(honeypot ? { website: honeypot } : {}),
        }),
      });

      const payload = await response
        .json()
        .catch(() => null as Record<string, unknown> | null);

      if (!response.ok) {
        const apiError =
          (typeof payload?.error === 'string' && payload.error) ||
          (typeof payload?.message === 'string' && payload.message) ||
          'Unable to process your sign-in link request right now. Please try again.';
        setError(apiError);
        return;
      }

      const dataObj =
        payload?.data && typeof payload.data === 'object'
          ? (payload.data as Record<string, unknown>)
          : null;
      const message =
        (typeof payload?.message === 'string' && payload.message) ||
        (typeof dataObj?.message === 'string' && dataObj.message) ||
        RECOVERY_CONFIRMATION_MESSAGE;

      setConfirmationMessage(message);
      setIdentifier('');
    } catch {
      setError('Network error while requesting your sign-in link. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setConfirmationMessage(null);
    setError(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  return (
    <div
      data-purpose="self-service-recovery-panel"
      data-testid="guest-signin-link-recovery"
      className={cn(
        'bg-gray-50/90 dark:bg-zinc-800/70 p-4 sm:p-5 rounded-2xl border border-gray-200/80 dark:border-zinc-700 space-y-3.5 text-left',
        className
      )}
    >
      <div className="space-y-1">
        <HeadingTag className="text-sm font-bold text-gray-900 dark:text-zinc-100">
          Email or Text Me My Sign-In Link
        </HeadingTag>
        <p className="text-xs leading-relaxed text-gray-600 dark:text-zinc-300">
          Enter the email address or full guest name on your invitation to receive a personal
          one-click RSVP link.
        </p>
      </div>

      {confirmationMessage ? (
        <div
          role="status"
          aria-live="polite"
          data-testid="guest-recovery-confirmation"
          className="rounded-xl border border-emerald-200 dark:border-emerald-800/70 bg-emerald-50/90 dark:bg-emerald-950/35 p-3.5 space-y-2.5 text-xs sm:text-sm text-emerald-950 dark:text-emerald-100"
        >
          <div className="flex items-start gap-2.5">
            <Icon
              name="Check"
              className="h-4 w-4 text-emerald-700 dark:text-emerald-300 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="font-medium leading-relaxed">{confirmationMessage}</p>
          </div>
          <div>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs font-semibold underline underline-offset-2 text-emerald-900 dark:text-emerald-200 hover:opacity-80 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary,#B91C1C)]"
            >
              Try another email or guest name
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-3">
          <FormGroup state={error ? 'error' : 'default'} busy={isSubmitting} className="space-y-1.5">
            <Label
              htmlFor={inputId}
              className="block text-xs font-semibold text-gray-800 dark:text-zinc-200 mb-0"
            >
              Email Address or Full Guest Name
            </Label>
            <Input
              ref={inputRef}
              id={inputId}
              name="identifier"
              type="text"
              value={identifier}
              onChange={(e) => {
                setIdentifier(e.target.value);
                if (error) setError(null);
              }}
              placeholder="eleanor.vance@example.org or Eleanor Vance"
              autoComplete="email"
              busy={isSubmitting}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? `${errorId} ${privacyId}` : privacyId}
              required
              className="w-full bg-white dark:bg-zinc-900 text-sm"
            />
            {error && (
              <FormMessage id={errorId} className="text-xs">
                {error}
              </FormMessage>
            )}
          </FormGroup>

          <div aria-hidden="true" className="hidden">
            <label htmlFor={`${inputId}-website`}>Website</label>
            <input
              id={`${inputId}-website`}
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          <Button
            type="submit"
            busy={isSubmitting}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-bold rounded-xl"
          >
            {isSubmitting ? (
              <>
                <Icon name="Loader2" className="animate-spin h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Sending Sign-In Link...</span>
              </>
            ) : (
              <>
                <span>Send Sign-In Link</span>
                <Icon name="ArrowRight" className="h-4 w-4 shrink-0" aria-hidden="true" />
              </>
            )}
          </Button>
        </form>
      )}

      <p
        id={privacyId}
        className="text-[11px] leading-snug text-gray-600 dark:text-zinc-300 text-center"
      >
        For guest privacy, we send links only to the contact details saved on your household
        invitation.
      </p>
    </div>
  );
}
