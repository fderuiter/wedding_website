'use client';

import React, { useState } from 'react';
import { FormGroup, Label, Input, Textarea } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';

export default function GuestAddressCollectPage() {
  const [formData, setFormData] = useState({
    guestName: '',
    email: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    country: '',
    notes: '',
    website: '', // Honeypot field
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errorMessage) setErrorMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!formData.guestName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/guest/address/public', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          guestName: formData.guestName.trim(),
          email: formData.email.trim() || undefined,
          addressLine1: formData.addressLine1.trim() || undefined,
          addressLine2: formData.addressLine2.trim() || undefined,
          city: formData.city.trim() || undefined,
          state: formData.state.trim() || undefined,
          zipCode: formData.zipCode.trim() || undefined,
          country: formData.country.trim() || undefined,
          notes: formData.notes.trim() || undefined,
          website: formData.website, // Honeypot
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit address. Please try again.');
      }

      setSubmitted(true);
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setFormData({
      guestName: '',
      email: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      zipCode: '',
      country: '',
      notes: '',
      website: '',
    });
    setSubmitted(false);
    setErrorMessage(null);
  };

  if (submitted) {
    return (
      <main className="min-h-screen py-12 px-4 sm:px-6 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 border border-gray-100 dark:border-gray-700 text-center">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
            ✓
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 dark:text-white mb-2">
            Address Received!
          </h1>
          <p className="text-gray-600 dark:text-gray-300 text-sm mb-6">
            Thank you for providing your mailing details. The couple looks forward to sending your save-the-date or invitation!
          </p>
          <Button variant="primary" onClick={handleReset} className="w-full">
            Submit Another Address
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen py-12 px-4 sm:px-6 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="max-w-lg w-full bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8 border border-gray-100 dark:border-gray-700">
        <div className="text-center mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white">
            Mailing Address Form
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">
            Please share your physical postal address so the couple can send invitations and wedding updates.
          </p>
        </div>

        {errorMessage && (
          <div className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-medium">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Honeypot Field (Hidden from human users) */}
          <div className="hidden" aria-hidden="true" style={{ display: 'none' }}>
            <label htmlFor="website">Website</label>
            <input
              type="text"
              id="website"
              name="website"
              value={formData.website}
              onChange={handleChange}
              tabIndex={-1}
              autoComplete="off"
            />
          </div>

          <FormGroup>
            <Label>Full Name <span className="text-red-500">*</span></Label>
            <Input
              type="text"
              name="guestName"
              placeholder="e.g. Jane Doe"
              value={formData.guestName}
              onChange={handleChange}
              required
              maxLength={100}
            />
          </FormGroup>

          <FormGroup>
            <Label>Email Address (Optional)</Label>
            <Input
              type="email"
              name="email"
              placeholder="jane@example.com"
              value={formData.email}
              onChange={handleChange}
            />
          </FormGroup>

          <FormGroup>
            <Label>Street Address Line 1 (Optional)</Label>
            <Input
              type="text"
              name="addressLine1"
              placeholder="123 Main Street"
              value={formData.addressLine1}
              onChange={handleChange}
              maxLength={150}
            />
          </FormGroup>

          <FormGroup>
            <Label>Address Line 2 (Optional)</Label>
            <Input
              type="text"
              name="addressLine2"
              placeholder="Apt, Suite, Unit, etc."
              value={formData.addressLine2}
              onChange={handleChange}
              maxLength={150}
            />
          </FormGroup>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormGroup>
              <Label>City (Optional)</Label>
              <Input
                type="text"
                name="city"
                placeholder="San Francisco"
                value={formData.city}
                onChange={handleChange}
                maxLength={100}
              />
            </FormGroup>

            <FormGroup>
              <Label>State / Province (Optional)</Label>
              <Input
                type="text"
                name="state"
                placeholder="CA"
                value={formData.state}
                onChange={handleChange}
                maxLength={100}
              />
            </FormGroup>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormGroup>
              <Label>ZIP / Postal Code (Optional)</Label>
              <Input
                type="text"
                name="zipCode"
                placeholder="94102"
                value={formData.zipCode}
                onChange={handleChange}
                maxLength={20}
              />
            </FormGroup>

            <FormGroup>
              <Label>Country (Optional)</Label>
              <Input
                type="text"
                name="country"
                placeholder="United States"
                value={formData.country}
                onChange={handleChange}
                maxLength={100}
              />
            </FormGroup>
          </div>

          <FormGroup>
            <Label>Household Notes / Additional Info (Optional)</Label>
            <Textarea
              name="notes"
              rows={3}
              placeholder="Family of 4, children names, special mailing instructions, etc."
              value={formData.notes}
              onChange={handleChange}
              maxLength={1000}
            />
          </FormGroup>

          <Button
            type="submit"
            variant="primary"
            className="w-full mt-6 py-3 font-bold text-base"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Submitting Address...' : 'Submit Address'}
          </Button>
        </form>
      </div>
    </main>
  );
}
