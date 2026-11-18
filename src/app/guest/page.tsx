'use client';

import InteractiveTimeline from '@/components/schedule/InteractiveTimeline';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
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

  const { form, code, guestName, error, status } = state;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] px-4 py-12">
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

          {error && (
            <div
              role="alert"
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
              {status === 'error' && (
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
              )}
            </div>
          )}

          <form onSubmit={handleValidateCode} className="space-y-4">
            <FormGroup>
              <Label htmlFor="guest-invitation-code">Invitation Code</Label>
              <Input
                id="guest-invitation-code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. LOVE2026"
                className="uppercase font-mono tracking-wider"
                required
              />
            </FormGroup>

            <Button type="submit" className="w-full" disabled={isValidating}>
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
          {code && (
            <div className="inline-flex items-center gap-2 self-start sm:self-center rounded-xl bg-gray-100 dark:bg-zinc-700/80 px-3.5 py-2 text-xs font-semibold text-gray-700 dark:text-zinc-200 border border-gray-200 dark:border-zinc-600">
              <span>Invite Code:</span>
              <span className="font-mono tracking-wider">{code}</span>
            </div>
          )}
        </header>

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
              role="alert"
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
            <FormGroup>
              <Label htmlFor="address-line1">Address Line 1</Label>
              <Input
                id="address-line1"
                type="text"
                value={form.addressLine1}
                onChange={(e) => setField('addressLine1', e.target.value)}
                placeholder="123 Main Street"
              />
            </FormGroup>

            <FormGroup>
              <Label htmlFor="address-line2">Address Line 2 (Optional)</Label>
              <Input
                id="address-line2"
                type="text"
                value={form.addressLine2}
                onChange={(e) => setField('addressLine2', e.target.value)}
                placeholder="Apt 4B, Suite 100"
              />
            </FormGroup>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormGroup>
                <Label htmlFor="address-city">City</Label>
                <Input
                  id="address-city"
                  type="text"
                  value={form.city}
                  onChange={(e) => setField('city', e.target.value)}
                  placeholder="San Francisco"
                />
              </FormGroup>

              <FormGroup>
                <Label htmlFor="address-state">State / Province / Region</Label>
                <Input
                  id="address-state"
                  type="text"
                  value={form.state}
                  onChange={(e) => setField('state', e.target.value)}
                  placeholder="CA"
                />
              </FormGroup>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormGroup>
                <Label htmlFor="address-zip">ZIP / Postal Code</Label>
                <Input
                  id="address-zip"
                  type="text"
                  value={form.zipCode}
                  onChange={(e) => setField('zipCode', e.target.value)}
                  placeholder="94102"
                />
              </FormGroup>

              <FormGroup>
                <Label htmlFor="address-country">Country</Label>
                <Input
                  id="address-country"
                  type="text"
                  value={form.country}
                  onChange={(e) => setField('country', e.target.value)}
                  placeholder="United States"
                />
              </FormGroup>
            </div>

            <div className="pt-4 flex items-center justify-end gap-3">
              <Button type="submit" disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save Mailing Address'}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
