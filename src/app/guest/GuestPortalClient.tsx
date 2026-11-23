'use client';

import { useMemo, useState } from 'react';
import InteractiveTimeline, {
  type ScheduleRsvpStatusInfo,
} from '@/components/schedule/InteractiveTimeline';
import { Button } from '@/components/ui/Button';
import { FormGroup, FormMessage, Input, Label } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/ToastProvider';
import {
  GuestHelpTrigger,
  getSafeHostEmailLink,
  getSafeHostPhoneLink,
} from '@/components/guest/GuestHelpModal';
import { useTheme } from '@/components/ThemeProvider';
import { useGuestAddressPortal } from '@/hooks/useGuestAddressPortal';

export default function GuestAddressPage() {
  const {
    state,
    handleValidateCode,
    handleSaveAddress,
    handleRetry,
    setField,
    setCode,
    isLoading,
    isValidating,
    isSaving,
    isAuthenticated,
  } = useGuestAddressPortal();
  const theme = useTheme();
  const toastContext = useToast();
  const [rsvpStatus, setRsvpStatus] = useState<ScheduleRsvpStatusInfo | null>(null);

  const emailContact = useMemo(
    () => getSafeHostEmailLink(theme.contactEmail),
    [theme.contactEmail]
  );
  const phoneContact = useMemo(
    () => getSafeHostPhoneLink(theme.contactPhone),
    [theme.contactPhone]
  );

  const { form, code, guestName, error, status } = state;
  const hasActiveErrorToast = Boolean(
    error &&
      Array.isArray(toastContext?.toasts) &&
      toastContext.toasts.some((toast) => toast.type === 'error' && toast.message === error)
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] px-4 py-12">
        <h1 className="sr-only">Guest RSVP &amp; Address Portal</h1>
        <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
          <Icon name="Loader2" className="animate-spin h-8 w-8 text-[var(--color-primary-text)] dark:text-red-300" />
          <p className="text-sm font-medium text-gray-600 dark:text-zinc-300">
            Loading guest portal...
          </p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] px-4 py-12 text-[var(--color-foreground)]">
        <div className="w-full max-w-md bg-white dark:bg-zinc-800 rounded-3xl shadow-xl p-8 border border-gray-100 dark:border-zinc-700 space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold text-[var(--color-primary-text)] dark:text-red-300">Guest RSVP &amp; Address Portal</h1>
            <p className="text-sm text-gray-600 dark:text-zinc-300">
              Enter your personal invitation code to RSVP to your wedding events and share or update
              your postal mailing address.
            </p>
          </div>

          {error && status === 'error' && (
            <div
              id="guest-portal-error-alert"
              role={hasActiveErrorToast ? undefined : 'alert'}
              data-testid="guest-portal-error-alert"
              className="rounded-2xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 p-4 text-sm text-rose-800 dark:text-rose-200 space-y-3"
            >
              <div className="flex items-start gap-2.5">
                <Icon
                  name="AlertTriangle"
                  className="h-5 w-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5"
                />
                <p className="font-medium leading-snug">{error}</p>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleRetry}
                  disabled={isValidating}
                >
                  Retry
                </Button>
              </div>
            </div>
          )}

          <form onSubmit={handleValidateCode} noValidate className="space-y-4">
            <FormGroup state={error ? 'error' : 'default'} busy={isValidating}>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="guest-invitation-code" className="mb-0">
                  Invitation Code
                </Label>
                <GuestHelpTrigger defaultCategory="passcode" label="Need Help?" />
              </div>
              <Input
                id="guest-invitation-code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. LOVE2026"
                className="uppercase font-mono tracking-wider"
                busy={isValidating}
                aria-describedby={
                  error && status === 'error' ? 'guest-portal-error-alert' : undefined
                }
                required
              />
              {error && status !== 'error' && (
                <FormMessage
                  id="guest-invitation-code-error"
                  role={hasActiveErrorToast ? 'none' : undefined}
                >
                  {error}
                </FormMessage>
              )}
            </FormGroup>

            <Button type="submit" className="w-full" disabled={isValidating} aria-busy={isValidating}>
              {isValidating ? 'Verifying Code...' : 'Access Guest Portal'}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)] px-4 py-10 sm:py-12 text-[var(--color-foreground)]">
      <div className="mx-auto w-full max-w-4xl space-y-10">
        {/* Welcome Banner */}
        <header className="bg-white dark:bg-zinc-800 rounded-3xl shadow-md p-6 sm:p-8 border border-gray-100 dark:border-zinc-700 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-primary-text)] dark:text-red-300">
              Guest RSVP &amp; Address Portal
            </h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-zinc-300">
              Welcome, <strong>{guestName || 'Guest'}</strong>! Review your personalized schedule
              below to submit your RSVPs, and optionally share your postal mailing address.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 self-start sm:self-center">
            {code && (
              <div className="inline-flex items-center gap-2 rounded-xl bg-gray-100 dark:bg-zinc-700/80 px-3.5 py-2 text-xs font-semibold text-gray-700 dark:text-zinc-200 border border-gray-200 dark:border-zinc-600">
                <span>Invite Code:</span>
                <span className="font-mono tracking-wider">{code}</span>
              </div>
            )}
            <GuestHelpTrigger
              defaultCategory="dietary"
              label="Need Help?"
              config={
                rsvpStatus
                  ? {
                    rsvpOpen: rsvpStatus.rsvpOpen,
                    isRsvpOpen: rsvpStatus.rsvpOpen,
                    rsvpDeadlineDate: rsvpStatus.rsvpDeadlineDate,
                    rsvpClosedMessage: rsvpStatus.rsvpClosedMessage,
                    timezone: rsvpStatus.timezone,
                  }
                  : undefined
              }
            />
          </div>
        </header>

        {/* RSVP Deadline or Closed Status Banner */}
        {rsvpStatus && rsvpStatus.rsvpOpen && rsvpStatus.rsvpFormattedDeadline && (
          <section
            aria-label="RSVP deadline notice"
            data-testid="guest-rsvp-deadline-banner"
            className="rounded-3xl border border-amber-200 dark:border-amber-800/80 bg-amber-50/90 dark:bg-amber-950/30 p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          >
            <div className="flex items-start gap-3">
              <Icon
                name="Calendar"
                className="h-5 w-5 text-amber-800 dark:text-amber-300 shrink-0 mt-0.5"
              />
              <div className="text-sm text-amber-950 dark:text-amber-100 space-y-0.5">
                <p className="font-bold">
                  RSVP Deadline: {rsvpStatus.rsvpFormattedDeadline}
                </p>
                <p>
                  Online RSVPs remain open through midnight on{' '}
                  <strong>{rsvpStatus.rsvpFormattedDeadline}</strong> ({rsvpStatus.timezone}).
                </p>
              </div>
            </div>
          </section>
        )}

        {rsvpStatus && !rsvpStatus.rsvpOpen && (
          <section
            aria-label="Online RSVPs closed"
            data-testid="guest-rsvp-closed-banner"
            className="rounded-3xl border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-6 shadow-md space-y-4"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Icon
                  name="Calendar"
                  className="h-5 w-5 text-[var(--color-primary-text)] dark:text-red-300 shrink-0"
                />
                <h2 className="text-lg font-bold text-gray-900 dark:text-zinc-100">
                  Online RSVPs Are Closed
                </h2>
              </div>
              <p className="text-sm text-gray-700 dark:text-zinc-200 leading-relaxed">
                {rsvpStatus.rsvpClosedMessage}
              </p>
              <p className="text-xs sm:text-sm text-gray-600 dark:text-zinc-300">
                Your saved responses remain visible below in read-only mode, and you can still
                update your mailing address below.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              {emailContact && (
                <a
                  href={emailContact.href}
                  className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold bg-[var(--btn-primary-bg,var(--color-primary,#B91C1C))] text-[var(--btn-primary-text,#ffffff)] shadow-sm hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary,#B91C1C)]"
                >
                  <Icon name="Mail" className="h-4 w-4 shrink-0" />
                  <span>Email {emailContact.email}</span>
                </a>
              )}
              {phoneContact && (
                <a
                  href={phoneContact.href}
                  className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-gray-800 dark:text-zinc-100 hover:bg-gray-100 dark:hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary,#B91C1C)]"
                >
                  <Icon name="Phone" className="h-4 w-4 shrink-0" />
                  <span>Call {phoneContact.displayPhone}</span>
                </a>
              )}
              <GuestHelpTrigger
                defaultCategory="dietary"
                label="Host Contact Details & Help"
                config={{
                  rsvpOpen: false,
                  isRsvpOpen: false,
                  rsvpClosedMessage: rsvpStatus.rsvpClosedMessage,
                  timezone: rsvpStatus.timezone,
                }}
              />
            </div>
          </section>
        )}

        {/* Primary Section: Personalized Event Schedule & RSVPs */}
        <div
          data-testid="guest-rsvp-primary-section"
          className="bg-white dark:bg-zinc-800 rounded-3xl shadow-xl p-6 sm:p-8 border border-gray-100 dark:border-zinc-700"
        >
          <InteractiveTimeline
            events={[]}
            title="Your Wedding Schedule & RSVPs"
            className="!px-0 !py-2"
            emptyStateMessage="Wedding schedule events will appear here as soon as they are published."
            hideStatusBanner
            onRsvpStatusChange={setRsvpStatus}
          />
        </div>

        {/* Secondary Section: Optional Postal Mailing Address */}
        <section
          aria-labelledby="guest-mailing-address-heading"
          data-testid="guest-address-secondary-section"
          className="bg-white dark:bg-zinc-800 rounded-3xl shadow-md p-6 sm:p-8 border border-gray-100 dark:border-zinc-700 space-y-6"
        >
          <div className="border-b pb-4 border-gray-100 dark:border-zinc-700 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2
                id="guest-mailing-address-heading"
                className="text-xl sm:text-2xl font-bold text-[var(--color-primary-text)] dark:text-red-300"
              >
                Mailing Address
              </h2>
              <p className="text-sm text-gray-600 dark:text-zinc-300 mt-1">
                Optional: provide your physical postal address so we can send save-the-dates,
                official paper invitations, and thank-you cards.
              </p>
            </div>
            <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-zinc-700 px-3 py-1 text-xs font-medium text-gray-700 dark:text-zinc-200">
              Optional
            </span>
          </div>

          {error && (
            <div
              role={hasActiveErrorToast ? undefined : 'alert'}
              data-testid="guest-address-save-error-alert"
              className="rounded-2xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 p-4 text-sm text-rose-800 dark:text-rose-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <span>{error}</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleSaveAddress()}
                disabled={isSaving}
              >
                Retry Save
              </Button>
            </div>
          )}

          <form onSubmit={handleSaveAddress} className="space-y-4">
            <FormGroup busy={isSaving}>
              <Label htmlFor="address-line1">Address Line 1</Label>
              <Input
                id="address-line1"
                name="addressLine1"
                type="text"
                autoComplete="address-line1"
                busy={isSaving}
                value={form.addressLine1}
                onChange={(e) => setField('addressLine1', e.target.value)}
                placeholder="123 Main Street"
              />
            </FormGroup>

            <FormGroup busy={isSaving}>
              <Label htmlFor="address-line2">Address Line 2 (Optional)</Label>
              <Input
                id="address-line2"
                name="addressLine2"
                type="text"
                autoComplete="address-line2"
                busy={isSaving}
                value={form.addressLine2}
                onChange={(e) => setField('addressLine2', e.target.value)}
                placeholder="Apt 4B, Suite 100"
              />
            </FormGroup>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormGroup busy={isSaving}>
                <Label htmlFor="address-city">City</Label>
                <Input
                  id="address-city"
                  name="city"
                  type="text"
                  autoComplete="address-level2"
                  busy={isSaving}
                  value={form.city}
                  onChange={(e) => setField('city', e.target.value)}
                  placeholder="San Francisco"
                />
              </FormGroup>

              <FormGroup busy={isSaving}>
                <Label htmlFor="address-state">State / Province / Region</Label>
                <Input
                  id="address-state"
                  name="state"
                  type="text"
                  autoComplete="address-level1"
                  busy={isSaving}
                  value={form.state}
                  onChange={(e) => setField('state', e.target.value)}
                  placeholder="CA"
                />
              </FormGroup>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormGroup busy={isSaving}>
                <Label htmlFor="address-zip">ZIP / Postal Code</Label>
                <Input
                  id="address-zip"
                  name="zipCode"
                  type="text"
                  autoComplete="postal-code"
                  busy={isSaving}
                  value={form.zipCode}
                  onChange={(e) => setField('zipCode', e.target.value)}
                  placeholder="94102"
                />
              </FormGroup>

              <FormGroup busy={isSaving}>
                <Label htmlFor="address-country">Country</Label>
                <Input
                  id="address-country"
                  name="country"
                  type="text"
                  autoComplete="country-name"
                  busy={isSaving}
                  value={form.country}
                  onChange={(e) => setField('country', e.target.value)}
                  placeholder="United States"
                />
              </FormGroup>
            </div>

            <div className="pt-4 flex items-center justify-end gap-3">
              <Button type="submit" disabled={isSaving} aria-busy={isSaving}>
                {isSaving ? 'Saving...' : 'Save Mailing Address'}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
