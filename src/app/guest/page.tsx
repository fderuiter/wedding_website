'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input } from '@/components/ui/forms';
import { useToast } from '@/components/ui/ToastProvider';
import { Icon } from '@/components/ui/Icon';

export default function GuestAddressPage() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [sessionActive, setSessionActive] = useState<boolean>(false);
  const [code, setCode] = useState<string>('');
  const [guestName, setGuestName] = useState<string>('');

  // Address state
  const [addressLine1, setAddressLine1] = useState<string>('');
  const [addressLine2, setAddressLine2] = useState<string>('');
  const [city, setCity] = useState<string>('');
  const [state, setState] = useState<string>('');
  const [zipCode, setZipCode] = useState<string>('');
  const [country, setCountry] = useState<string>('');

  const fetchAddress = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/guest/address');
      const data = await res.json();
      if (res.ok && data.success && data.data) {
        setSessionActive(true);
        setGuestName(data.data.guestName || '');
        setCode(data.data.code || '');
        setAddressLine1(data.data.addressLine1 || '');
        setAddressLine2(data.data.addressLine2 || '');
        setCity(data.data.city || '');
        setState(data.data.state || '');
        setZipCode(data.data.zipCode || '');
        setCountry(data.data.country || '');
      } else {
        setSessionActive(false);
      }
    } catch {
      setSessionActive(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAddress();
  }, []);

  const handleValidateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      addToast('Please enter your invitation code.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/registry/validate-code?code=${encodeURIComponent(code.trim())}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        addToast(data.error || 'Invalid or expired invitation code.', 'error');
        return;
      }
      await fetchAddress();
      addToast(`Welcome ${data.data?.guestName || ''}!`, 'success');
    } catch (err: any) {
      addToast(err.message || 'Error validating code.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch('/api/guest/address', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addressLine1,
          addressLine2,
          city,
          state,
          zipCode,
          country,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to update address.');
      }

      addToast('Your mailing address has been updated successfully!', 'success');
    } catch (err: any) {
      addToast(err.message || 'An error occurred while saving address.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)] px-4 py-12">
        <div className="flex flex-col items-center gap-3">
          <Icon name="Loader2" className="animate-spin h-8 w-8 text-primary" />
          <p className="text-sm font-medium text-gray-600 dark:text-zinc-300">Loading guest portal...</p>
        </div>
      </div>
    );
  }

  if (!sessionActive) {
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

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Verifying Code...' : 'Access Address Portal'}
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
              value={addressLine1}
              onChange={(e) => setAddressLine1(e.target.value)}
              placeholder="123 Main Street"
            />
          </FormGroup>

          <FormGroup>
            <Label htmlFor="address-line2">Address Line 2 (Optional)</Label>
            <Input
              id="address-line2"
              type="text"
              value={addressLine2}
              onChange={(e) => setAddressLine2(e.target.value)}
              placeholder="Apt 4B, Suite 100"
            />
          </FormGroup>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormGroup>
              <Label htmlFor="address-city">City</Label>
              <Input
                id="address-city"
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="San Francisco"
              />
            </FormGroup>

            <FormGroup>
              <Label htmlFor="address-state">State / Province / Region</Label>
              <Input
                id="address-state"
                type="text"
                value={state}
                onChange={(e) => setState(e.target.value)}
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
                value={zipCode}
                onChange={(e) => setZipCode(e.target.value)}
                placeholder="94102"
              />
            </FormGroup>

            <FormGroup>
              <Label htmlFor="address-country">Country</Label>
              <Input
                id="address-country"
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="United States"
              />
            </FormGroup>
          </div>

          <div className="pt-4 flex items-center justify-end gap-3">
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Mailing Address'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
