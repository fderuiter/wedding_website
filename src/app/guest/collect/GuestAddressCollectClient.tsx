'use client';

import React, { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import {
  FormGroup,
  Label,
  Input,
  Textarea,
  FormMessage,
  focusFirstInvalidControl,
} from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { Container } from '@/components/ui/Layout';
import { GuestHelpTrigger } from '@/components/guest/GuestHelpModal';
import { PublicAddressCollectSchema } from '@/features/registry';
import { withBasePath } from '@/lib/basePath';

type AddressFieldKey =
  | 'guestName'
  | 'householdName'
  | 'email'
  | 'phone'
  | 'dietaryNotes'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'state'
  | 'zipCode'
  | 'country'
  | 'notes';

interface ChildMemberFormItem {
  id: string;
  fullName: string;
  dietaryNotes: string;
}

const ADDRESS_FIELD_KEYS: ReadonlyArray<AddressFieldKey> = [
  'guestName',
  'householdName',
  'email',
  'phone',
  'dietaryNotes',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'zipCode',
  'country',
  'notes',
];

function extractFieldErrors(details: unknown): Partial<Record<AddressFieldKey, string>> {
  if (!details || typeof details !== 'object') return {};
  const record = details as Record<string, unknown>;
  const mapped: Partial<Record<AddressFieldKey, string>> = {};

  const assignIfValid = (key: AddressFieldKey, rawEntry: unknown) => {
    if (!rawEntry || mapped[key]) return;
    if (typeof rawEntry === 'string' && rawEntry.trim()) {
      mapped[key] = rawEntry;
      return;
    }
    if (Array.isArray(rawEntry) && typeof rawEntry[0] === 'string' && rawEntry[0].trim()) {
      mapped[key] = rawEntry[0];
      return;
    }
    if (typeof rawEntry === 'object') {
      const errs = (rawEntry as { _errors?: unknown })._errors;
      if (Array.isArray(errs) && typeof errs[0] === 'string' && errs[0].trim()) {
        mapped[key] = errs[0];
      }
    }
  };

  for (const field of ADDRESS_FIELD_KEYS) {
    assignIfValid(field, record[field]);
  }
  assignIfValid('phone', record.mobile);
  assignIfValid('phone', record.phoneNumber);

  return mapped;
}

export default function GuestAddressCollectPage() {
  const [formData, setFormData] = useState({
    guestName: '',
    householdName: '',
    email: '',
    phone: '',
    dietaryNotes: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    country: '',
    notes: '',
    website: '', // Honeypot field
  });
  const [showPartner, setShowPartner] = useState(false);
  const [partnerData, setPartnerData] = useState({
    fullName: '',
    email: '',
    phone: '',
    dietaryNotes: '',
  });
  const [childrenList, setChildrenList] = useState<ChildMemberFormItem[]>([]);
  const nextChildSeqRef = useRef(1);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<AddressFieldKey, string>>>({});
  const [invalidFocusTick, setInvalidFocusTick] = useState(0);
  const formRef = useRef<HTMLFormElement | null>(null);
  const isSubmittingRef = useRef(false);

  useEffect(() => {
    if (invalidFocusTick === 0) return;
    focusFirstInvalidControl(formRef.current);
  }, [invalidFocusTick]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (isSubmitting || isSubmittingRef.current) return;
    const { name, value } = e.target;
    const field = name as AddressFieldKey;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (fieldErrors[field]) {
      const nextFieldErrors = { ...fieldErrors };
      delete nextFieldErrors[field];
      setFieldErrors(nextFieldErrors);
      if (Object.keys(nextFieldErrors).length === 0 && errorMessage) {
        setErrorMessage(null);
      }
    } else if (errorMessage && Object.keys(fieldErrors).length === 0) {
      setErrorMessage(null);
    }
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting || isSubmittingRef.current) {
      return;
    }

    setErrorMessage(null);
    setFieldErrors({});

    const hasPartnerValues =
      showPartner &&
      Boolean(
        partnerData.fullName.trim() ||
          partnerData.email.trim() ||
          partnerData.phone.trim() ||
          partnerData.dietaryNotes.trim()
      );

    if (showPartner && hasPartnerValues && !partnerData.fullName.trim()) {
      setErrorMessage('Please enter your partner or spouse’s full name, or remove the partner section.');
      setInvalidFocusTick((prev) => prev + 1);
      return;
    }

    for (let idx = 0; idx < childrenList.length; idx++) {
      if (!childrenList[idx].fullName.trim()) {
        setErrorMessage(`Please enter a full name for Child #${idx + 1}, or remove the row.`);
        setInvalidFocusTick((prev) => prev + 1);
        return;
      }
    }

    const rawPayload = {
      guestName: formData.guestName.trim(),
      householdName: formData.householdName.trim() || undefined,
      email: formData.email.trim() || undefined,
      phone: formData.phone.trim() || undefined,
      dietaryNotes: formData.dietaryNotes.trim() || undefined,
      addressLine1: formData.addressLine1.trim() || undefined,
      addressLine2: formData.addressLine2.trim() || undefined,
      city: formData.city.trim() || undefined,
      state: formData.state.trim() || undefined,
      zipCode: formData.zipCode.trim() || undefined,
      country: formData.country.trim() || undefined,
      notes: formData.notes.trim() || undefined,
      ...(showPartner && partnerData.fullName.trim()
        ? {
          partner: {
            fullName: partnerData.fullName.trim(),
            email: partnerData.email.trim() || undefined,
            phone: partnerData.phone.trim() || undefined,
            dietaryNotes: partnerData.dietaryNotes.trim() || undefined,
          },
        }
        : {}),
      ...(childrenList.length > 0
        ? {
          children: childrenList.map((child) => ({
            fullName: child.fullName.trim(),
            dietaryNotes: child.dietaryNotes.trim() || undefined,
          })),
        }
        : {}),
      website: formData.website, // Honeypot
    };

    if (!formData.website.trim()) {
      const parseResult = PublicAddressCollectSchema.safeParse(rawPayload);
      if (!parseResult.success) {
        const mappedErrors = extractFieldErrors(z.formatError(parseResult.error));
        const errorEntries = Object.values(mappedErrors).filter(Boolean);
        setFieldErrors(mappedErrors);
        if (errorEntries.length > 1) {
          setErrorMessage('Please correct the highlighted fields before submitting.');
        } else if (errorEntries.length === 0) {
          setErrorMessage(
            parseResult.error.issues[0]?.message || 'Please check your address details.'
          );
        }
        setInvalidFocusTick((prev) => prev + 1);
        return;
      }
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);

    try {
      const response = await fetch(withBasePath('/api/guest/address/public'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rawPayload),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        const mappedErrors = extractFieldErrors(data?.details);
        const rootErrors = Array.isArray(data?.details?._errors)
          ? data.details._errors.filter((m: unknown): m is string => typeof m === 'string' && Boolean(m.trim()))
          : [];
        const mappedCount = Object.keys(mappedErrors).length;

        if (mappedCount > 0) {
          setFieldErrors(mappedErrors);
          const fieldMessages = new Set(Object.values(mappedErrors).filter(Boolean));
          if (rootErrors.length > 0) {
            setErrorMessage(rootErrors[0]);
          } else if (mappedCount > 1) {
            setErrorMessage(
              data?.error && !fieldMessages.has(data.error)
                ? data.error
                : 'Please correct the highlighted fields before submitting.'
            );
          }
          setInvalidFocusTick((prev) => prev + 1);
          return;
        }

        throw new Error(data.error || 'Failed to submit address. Please try again.');
      }

      setSubmitted(true);
    } catch (err: any) {
      setErrorMessage(err.message || 'An unexpected error occurred.');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleReset = () => {
    setFormData({
      guestName: '',
      householdName: '',
      email: '',
      phone: '',
      dietaryNotes: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      zipCode: '',
      country: '',
      notes: '',
      website: '',
    });
    setShowPartner(false);
    setPartnerData({
      fullName: '',
      email: '',
      phone: '',
      dietaryNotes: '',
    });
    setChildrenList([]);
    setSubmitted(false);
    setErrorMessage(null);
    setFieldErrors({});
  };

  if (submitted) {
    return (
      <Container className="max-w-none py-12 px-4 sm:px-6 bg-container">
        <div className="max-w-md w-full bg-card rounded-2xl shadow-card p-8 border border-card-border text-center">
          <div className="w-16 h-16 bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl">
            ✓
          </div>
          <h1 className="text-2xl font-extrabold text-heading mb-2">
            Address Received!
          </h1>
          <p className="text-muted text-sm mb-6">
            Thank you for providing your mailing details. The couple looks forward to sending your save-the-date or invitation!
          </p>
          <Button variant="primary" onClick={handleReset} className="w-full">
            Submit Another Address
          </Button>
          <div className="mt-4 flex justify-center">
            <GuestHelpTrigger defaultCategory="passcode" label="Need Help?" />
          </div>
        </div>
      </Container>
    );
  }

  return (
    <Container className="max-w-none py-12 px-4 sm:px-6 bg-container">
      <div className="max-w-lg w-full bg-card rounded-2xl shadow-card p-8 border border-card-border">
        <div className="text-center mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-heading">
            Mailing Address Form
          </h1>
          <p className="text-sm text-muted mt-2">
            Please share your physical postal address so the couple can send invitations and wedding updates.
          </p>
          <div className="mt-3 flex justify-center">
            <GuestHelpTrigger defaultCategory="passcode" label="Need Help?" />
          </div>
        </div>

        {errorMessage && (
          <div
            id="address-collect-error"
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="mb-6 p-4 rounded-xl bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-sm font-medium"
          >
            {errorMessage}
          </div>
        )}

        <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">
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

          <FormGroup
            required
            busy={isSubmitting}
            state={fieldErrors.guestName ? 'error' : 'default'}
          >
            <Label>Full Name</Label>
            <Input
              type="text"
              name="guestName"
              placeholder="e.g. Jane Doe"
              value={formData.guestName}
              onChange={handleChange}
              autoComplete="name"
              busy={isSubmitting}
              maxLength={100}
            />
            {fieldErrors.guestName && (
              <FormMessage
                id="guestName-error"
                role={errorMessage ? 'none' : undefined}
              >
                {fieldErrors.guestName}
              </FormMessage>
            )}
          </FormGroup>

          <FormGroup
            busy={isSubmitting}
            state={fieldErrors.householdName ? 'error' : 'default'}
          >
            <Label>Household Name (Optional)</Label>
            <Input
              type="text"
              name="householdName"
              placeholder="e.g. The Doe Family"
              value={formData.householdName}
              onChange={handleChange}
              autoComplete="organization"
              busy={isSubmitting}
              maxLength={100}
            />
            {fieldErrors.householdName && (
              <FormMessage
                id="householdName-error"
                role={errorMessage ? 'none' : undefined}
              >
                {fieldErrors.householdName}
              </FormMessage>
            )}
          </FormGroup>

          <FormGroup
            busy={isSubmitting}
            state={fieldErrors.email ? 'error' : 'default'}
          >
            <Label>Email Address (Optional)</Label>
            <Input
              type="email"
              name="email"
              placeholder="jane@example.com"
              value={formData.email}
              onChange={handleChange}
              autoComplete="email"
              busy={isSubmitting}
            />
            {fieldErrors.email && (
              <FormMessage
                id="email-error"
                role={errorMessage ? 'none' : undefined}
              >
                {fieldErrors.email}
              </FormMessage>
            )}
          </FormGroup>

          <FormGroup
            busy={isSubmitting}
            state={fieldErrors.phone ? 'error' : 'default'}
          >
            <Label>Phone Number (Optional)</Label>
            <Input
              type="tel"
              name="phone"
              placeholder="+1 (555) 123-4567"
              value={formData.phone}
              onChange={handleChange}
              autoComplete="tel"
              busy={isSubmitting}
              maxLength={30}
            />
            {fieldErrors.phone && (
              <FormMessage
                id="phone-error"
                role={errorMessage ? 'none' : undefined}
              >
                {fieldErrors.phone}
              </FormMessage>
            )}
          </FormGroup>

          <FormGroup
            busy={isSubmitting}
            state={fieldErrors.dietaryNotes ? 'error' : 'default'}
          >
            <Label>Standing Allergies / Dietary Restrictions (Optional)</Label>
            <Input
              type="text"
              name="dietaryNotes"
              placeholder="e.g. Nut allergy, Gluten-Free, Vegetarian"
              value={formData.dietaryNotes}
              onChange={handleChange}
              busy={isSubmitting}
              maxLength={500}
            />
            {fieldErrors.dietaryNotes && (
              <FormMessage
                id="dietaryNotes-error"
                role={errorMessage ? 'none' : undefined}
              >
                {fieldErrors.dietaryNotes}
              </FormMessage>
            )}
          </FormGroup>

          {/* Optional Partner / Spouse & Children Household Roster */}
          <div
            data-testid="collect-household-members-section"
            className="rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-900/50 p-4 space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-gray-900 dark:text-zinc-100">
                  Partner &amp; Children (Optional)
                </h2>
                <p className="text-xs text-gray-600 dark:text-zinc-300">
                  Include your spouse/partner or children living in your household.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!showPartner && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSubmitting}
                    data-testid="collect-add-partner-button"
                    onClick={() => setShowPartner(true)}
                  >
                    + Add Partner / Spouse
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSubmitting || childrenList.length >= 10}
                  data-testid="collect-add-child-button"
                  onClick={() => {
                    const id = `child-${nextChildSeqRef.current++}`;
                    setChildrenList((prev) => [...prev, { id, fullName: '', dietaryNotes: '' }]);
                  }}
                >
                  + Add Child
                </Button>
              </div>
            </div>

            {showPartner && (
              <div
                data-testid="collect-partner-section"
                className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-3.5 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-200">
                    Partner / Spouse Details
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isSubmitting}
                    onClick={() => {
                      setShowPartner(false);
                      setPartnerData({ fullName: '', email: '', phone: '', dietaryNotes: '' });
                    }}
                  >
                    Remove Partner
                  </Button>
                </div>

                <FormGroup busy={isSubmitting}>
                  <Label htmlFor="partner-fullName">Partner Full Name</Label>
                  <Input
                    id="partner-fullName"
                    type="text"
                    sizeVariant="compact"
                    placeholder="e.g. Alex Doe"
                    value={partnerData.fullName}
                    onChange={(e) =>
                      setPartnerData((prev) => ({ ...prev, fullName: e.target.value }))
                    }
                    busy={isSubmitting}
                    maxLength={100}
                  />
                </FormGroup>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <FormGroup busy={isSubmitting}>
                    <Label htmlFor="partner-email">Partner Email (Optional)</Label>
                    <Input
                      id="partner-email"
                      type="email"
                      sizeVariant="compact"
                      placeholder="alex@example.com"
                      value={partnerData.email}
                      onChange={(e) =>
                        setPartnerData((prev) => ({ ...prev, email: e.target.value }))
                      }
                      busy={isSubmitting}
                    />
                  </FormGroup>

                  <FormGroup busy={isSubmitting}>
                    <Label htmlFor="partner-phone">Partner Phone (Optional)</Label>
                    <Input
                      id="partner-phone"
                      type="tel"
                      sizeVariant="compact"
                      placeholder="+1 (555) 987-6543"
                      value={partnerData.phone}
                      onChange={(e) =>
                        setPartnerData((prev) => ({ ...prev, phone: e.target.value }))
                      }
                      busy={isSubmitting}
                      maxLength={30}
                    />
                  </FormGroup>
                </div>

                <FormGroup busy={isSubmitting}>
                  <Label htmlFor="partner-dietaryNotes">
                    Partner Standing Allergies (Optional)
                  </Label>
                  <Input
                    id="partner-dietaryNotes"
                    type="text"
                    sizeVariant="compact"
                    placeholder="e.g. Tree nut allergy"
                    value={partnerData.dietaryNotes}
                    onChange={(e) =>
                      setPartnerData((prev) => ({ ...prev, dietaryNotes: e.target.value }))
                    }
                    busy={isSubmitting}
                    maxLength={500}
                  />
                </FormGroup>
              </div>
            )}

            {childrenList.length > 0 && (
              <div className="space-y-3">
                {childrenList.map((child, idx) => (
                  <div
                    key={child.id}
                    data-testid={`collect-child-row-${idx}`}
                    className="rounded-lg border border-gray-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-3.5 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-200">
                        {`Child #${idx + 1}`}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove Child #${idx + 1}`}
                        disabled={isSubmitting}
                        onClick={() =>
                          setChildrenList((prev) => prev.filter((item) => item.id !== child.id))
                        }
                      >
                        Remove
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <FormGroup busy={isSubmitting}>
                        <Label htmlFor={`child-fullName-${child.id}`}>
                          {`Child #${idx + 1} Full Name`}
                        </Label>
                        <Input
                          id={`child-fullName-${child.id}`}
                          type="text"
                          sizeVariant="compact"
                          placeholder="e.g. Leo Doe"
                          value={child.fullName}
                          onChange={(e) =>
                            setChildrenList((prev) =>
                              prev.map((item) =>
                                item.id === child.id
                                  ? { ...item, fullName: e.target.value }
                                  : item
                              )
                            )
                          }
                          busy={isSubmitting}
                          maxLength={100}
                        />
                      </FormGroup>

                      <FormGroup busy={isSubmitting}>
                        <Label htmlFor={`child-dietary-${child.id}`}>
                          {`Child #${idx + 1} Standing Allergies (Optional)`}
                        </Label>
                        <Input
                          id={`child-dietary-${child.id}`}
                          type="text"
                          sizeVariant="compact"
                          placeholder="e.g. Dairy-Free, Kids meal"
                          value={child.dietaryNotes}
                          onChange={(e) =>
                            setChildrenList((prev) =>
                              prev.map((item) =>
                                item.id === child.id
                                  ? { ...item, dietaryNotes: e.target.value }
                                  : item
                              )
                            )
                          }
                          busy={isSubmitting}
                          maxLength={500}
                        />
                      </FormGroup>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <FormGroup
            required
            busy={isSubmitting}
            state={fieldErrors.addressLine1 ? 'error' : 'default'}
          >
            <Label>Street Address Line 1</Label>
            <Input
              type="text"
              name="addressLine1"
              placeholder="123 Main Street"
              value={formData.addressLine1}
              onChange={handleChange}
              autoComplete="address-line1"
              busy={isSubmitting}
              maxLength={150}
            />
            {fieldErrors.addressLine1 && (
              <FormMessage
                id="addressLine1-error"
                role={errorMessage ? 'none' : undefined}
              >
                {fieldErrors.addressLine1}
              </FormMessage>
            )}
          </FormGroup>

          <FormGroup
            busy={isSubmitting}
            state={fieldErrors.addressLine2 ? 'error' : 'default'}
          >
            <Label>Address Line 2 (Optional)</Label>
            <Input
              type="text"
              name="addressLine2"
              placeholder="Apt, Suite, Unit, etc."
              value={formData.addressLine2}
              onChange={handleChange}
              autoComplete="address-line2"
              busy={isSubmitting}
              maxLength={150}
            />
            {fieldErrors.addressLine2 && (
              <FormMessage
                id="addressLine2-error"
                role={errorMessage ? 'none' : undefined}
              >
                {fieldErrors.addressLine2}
              </FormMessage>
            )}
          </FormGroup>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormGroup
              required
              busy={isSubmitting}
              state={fieldErrors.city ? 'error' : 'default'}
            >
              <Label>City</Label>
              <Input
                type="text"
                name="city"
                placeholder="San Francisco"
                value={formData.city}
                onChange={handleChange}
                autoComplete="address-level2"
                busy={isSubmitting}
                maxLength={100}
              />
              {fieldErrors.city && (
                <FormMessage
                  id="city-error"
                  role={errorMessage ? 'none' : undefined}
                >
                  {fieldErrors.city}
                </FormMessage>
              )}
            </FormGroup>

            <FormGroup
              required
              busy={isSubmitting}
              state={fieldErrors.state ? 'error' : 'default'}
            >
              <Label>State / Province</Label>
              <Input
                type="text"
                name="state"
                placeholder="CA"
                value={formData.state}
                onChange={handleChange}
                autoComplete="address-level1"
                busy={isSubmitting}
                maxLength={100}
              />
              {fieldErrors.state && (
                <FormMessage
                  id="state-error"
                  role={errorMessage ? 'none' : undefined}
                >
                  {fieldErrors.state}
                </FormMessage>
              )}
            </FormGroup>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormGroup
              required
              busy={isSubmitting}
              state={fieldErrors.zipCode ? 'error' : 'default'}
            >
              <Label>ZIP / Postal Code</Label>
              <Input
                type="text"
                name="zipCode"
                placeholder="94102"
                value={formData.zipCode}
                onChange={handleChange}
                autoComplete="postal-code"
                busy={isSubmitting}
                maxLength={20}
              />
              {fieldErrors.zipCode && (
                <FormMessage
                  id="zipCode-error"
                  role={errorMessage ? 'none' : undefined}
                >
                  {fieldErrors.zipCode}
                </FormMessage>
              )}
            </FormGroup>

            <FormGroup
              busy={isSubmitting}
              state={fieldErrors.country ? 'error' : 'default'}
            >
              <Label>Country (Optional)</Label>
              <Input
                type="text"
                name="country"
                placeholder="United States"
                value={formData.country}
                onChange={handleChange}
                autoComplete="country-name"
                busy={isSubmitting}
                maxLength={100}
              />
              {fieldErrors.country && (
                <FormMessage
                  id="country-error"
                  role={errorMessage ? 'none' : undefined}
                >
                  {fieldErrors.country}
                </FormMessage>
              )}
            </FormGroup>
          </div>

          <FormGroup
            busy={isSubmitting}
            state={fieldErrors.notes ? 'error' : 'default'}
          >
            <Label>Household Notes (Optional)</Label>
            <Textarea
              name="notes"
              rows={3}
              placeholder="Family members, children names, or mailing instructions (please save dietary needs for your RSVP)"
              value={formData.notes}
              onChange={handleChange}
              busy={isSubmitting}
              maxLength={1000}
            />
            {fieldErrors.notes && (
              <FormMessage
                id="notes-error"
                role={errorMessage ? 'none' : undefined}
              >
                {fieldErrors.notes}
              </FormMessage>
            )}
          </FormGroup>

          <Button
            type="submit"
            variant="primary"
            className="w-full mt-6 py-3 font-bold text-base"
            busy={isSubmitting}
          >
            {isSubmitting ? 'Submitting Address...' : 'Submit Address'}
          </Button>
        </form>
      </div>
    </Container>
  );
}
