'use client';

import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input } from '@/components/ui/forms';
import { Icon } from '@/components/ui/Icon';
import { useGuestAddressPortal } from '@/hooks/useGuestAddressPortal';

export default function GuestAddressPage() {
  const {
    state,
    handleValidateCode,
    handleSaveAddress,
    setField,
    setCode,
    isLoading,
    isValidating,
    isSaving,
    isAuthenticated,
  } = useGuestAddressPortal();

  const { form, code, guestName } = state;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] px-4 py-12">
        <div className="flex flex-col items-center gap-3">
          <Icon name="Loader2" className="animate-spin h-8 w-8 text-primary" />
          <p className="text-sm font-medium text-gray-600 dark:text-zinc-300">Loading guest portal...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] px-4 py-12 text-[var(--color-foreground)]">
        <div className="w-full max-w-md bg-white dark:bg-zinc-800 rounded-3xl shadow-xl p-8 border border-gray-100 dark:border-zinc-700 space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-2xl font-bold text-primary">Guest Mailing Address Portal</h1>
            <p className="text-sm text-gray-500 dark:text-zinc-400">
              Please enter your invitation code to view or update your physical mailing address for paper invitations.
            </p>
          </div>

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
              {isValidating ? 'Verifying Code...' : 'Access Address Portal'}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)] px-4 py-12 text-[var(--color-foreground)] flex justify-center">
      <div className="w-full max-w-xl bg-white dark:bg-zinc-800 rounded-3xl shadow-xl p-8 border border-gray-100 dark:border-zinc-700 space-y-6">
        <div className="border-b pb-4 border-gray-100 dark:border-zinc-700">
          <h1 className="text-2xl font-bold text-primary">Mailing Address</h1>
          <p className="text-sm text-gray-500 dark:text-zinc-400 mt-1">
            Welcome, <strong>{guestName}</strong>! Please provide your physical postal address so we can send save-the-dates and official paper invitations.
          </p>
        </div>

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
      </div>
    </div>
  );
}
