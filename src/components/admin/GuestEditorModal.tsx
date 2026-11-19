'use client';

import React, { useState } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Textarea } from '@/components/ui/forms';
import type { InvitationCodeDTO } from '@/features/registry';
import {
  ADDRESS_LINE_MAX_LENGTH,
  CITY_MAX_LENGTH,
  COUNTRY_MAX_LENGTH,
  GUEST_NAME_MAX_LENGTH,
  HOUSEHOLD_NAME_MAX_LENGTH,
  INVITATION_CODE_MAX_LENGTH,
  PARTY_GROUP_MAX_LENGTH,
  PLUS_ONE_NAME_MAX_LENGTH,
  STATE_MAX_LENGTH,
  ZIP_CODE_MAX_LENGTH,
  normalizeInvitationCode,
  normalizeNullableString,
  normalizePartyTags,
  validateInvitationGuestFields,
} from '@/utils/invitationValidation';

interface GuestEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  guest: InvitationCodeDTO | null;
  onSave: (_id: string, _payload: Partial<InvitationCodeDTO>) => Promise<unknown>;
}

interface GuestFormState {
  guestName: string;
  code: string;
  email: string;
  householdName: string;
  partyGroup: string;
  partyTags: string;
  plusOneAllocations: string;
  plusOneFirstName: string;
  plusOneLastName: string;
  dietaryNotes: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

function createInitialGuestFormState(guest: InvitationCodeDTO): GuestFormState {
  return {
    guestName: guest.guestName ?? '',
    code: guest.code ?? '',
    email: guest.email ?? '',
    householdName: guest.householdName ?? '',
    partyGroup: guest.partyGroup ?? '',
    partyTags: Array.isArray(guest.partyTags) ? guest.partyTags.join(', ') : '',
    plusOneAllocations: String(guest.plusOneAllocations ?? 0),
    plusOneFirstName: guest.plusOneFirstName ?? '',
    plusOneLastName: guest.plusOneLastName ?? '',
    dietaryNotes: guest.dietaryNotes ?? '',
    addressLine1: guest.addressLine1 ?? '',
    addressLine2: guest.addressLine2 ?? '',
    city: guest.city ?? '',
    state: guest.state ?? '',
    zipCode: guest.zipCode ?? '',
    country: guest.country ?? '',
  };
}

interface GuestEditorFormProps {
  guest: InvitationCodeDTO;
  onClose: () => void;
  onSave: (_id: string, _payload: Partial<InvitationCodeDTO>) => Promise<unknown>;
}

const GuestEditorForm: React.FC<GuestEditorFormProps> = ({ guest, onClose, onSave }) => {
  const [formState, setFormState] = useState<GuestFormState>(() =>
    createInitialGuestFormState(guest)
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const originalCodeNormalized = normalizeInvitationCode(guest.code);
  const enteredCodeNormalized = normalizeInvitationCode(formState.code);
  const hasCodeChanged =
    Boolean(originalCodeNormalized) && enteredCodeNormalized !== originalCodeNormalized;

  const updateField = <K extends keyof GuestFormState>(field: K, value: GuestFormState[K]) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
    if (validationError) setValidationError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmedName = formState.guestName.trim();
    if (!trimmedName) {
      setValidationError('Guest name is required.');
      return;
    }
    if (trimmedName.length > GUEST_NAME_MAX_LENGTH) {
      setValidationError(`Guest name must be under ${GUEST_NAME_MAX_LENGTH} characters.`);
      return;
    }

    const trimmedCode = normalizeInvitationCode(formState.code);
    if (!trimmedCode) {
      setValidationError('Invitation code is required.');
      return;
    }
    if (trimmedCode.length > INVITATION_CODE_MAX_LENGTH) {
      setValidationError(`Invitation code must be under ${INVITATION_CODE_MAX_LENGTH} characters.`);
      return;
    }

    const parsedAllocations =
      formState.plusOneAllocations.trim() === '' ? 0 : Number(formState.plusOneAllocations);
    if (!Number.isInteger(parsedAllocations) || parsedAllocations < 0) {
      setValidationError('Plus-one allocations must be a non-negative whole number.');
      return;
    }

    const payload: Partial<InvitationCodeDTO> = {
      guestName: trimmedName,
      code: trimmedCode,
      email: normalizeNullableString(formState.email),
      householdName: normalizeNullableString(formState.householdName),
      partyGroup: normalizeNullableString(formState.partyGroup),
      partyTags: normalizePartyTags(formState.partyTags, { dedupe: true }),
      plusOneAllocations: parsedAllocations,
      plusOneFirstName: normalizeNullableString(formState.plusOneFirstName),
      plusOneLastName: normalizeNullableString(formState.plusOneLastName),
      dietaryNotes: normalizeNullableString(formState.dietaryNotes),
      addressLine1: normalizeNullableString(formState.addressLine1),
      addressLine2: normalizeNullableString(formState.addressLine2),
      city: normalizeNullableString(formState.city),
      state: normalizeNullableString(formState.state),
      zipCode: normalizeNullableString(formState.zipCode),
      country: normalizeNullableString(formState.country),
    };

    const fieldErrors = validateInvitationGuestFields(payload, { mode: 'row' });
    if (fieldErrors.length > 0) {
      setValidationError(fieldErrors[0]);
      return;
    }

    setIsSaving(true);
    try {
      await onSave(guest.id, payload);
      onClose();
    } catch (err: unknown) {
      setValidationError(
        err instanceof Error && err.message ? err.message : 'Failed to update guest details.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {validationError && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-800 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300 font-medium"
        >
          {validationError}
        </div>
      )}

      {hasCodeChanged && (
        <div
          role="status"
          data-testid="code-change-warning"
          className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-700 px-3.5 py-2.5 text-sm text-amber-900 dark:text-amber-200"
        >
          <strong className="font-semibold">Warning:</strong> Changing the invitation code means
          printed QR links and previously shared URLs will stop matching the old code (
          <code className="font-mono font-bold">{guest.code}</code>).
        </div>
      )}

      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
          Guest Profile &amp; Invitation
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormGroup>
            <Label>Guest Name *</Label>
            <Input
              type="text"
              required
              maxLength={GUEST_NAME_MAX_LENGTH}
              value={formState.guestName}
              onChange={(e) => updateField('guestName', e.target.value)}
              placeholder="e.g. Alice Smith"
            />
          </FormGroup>

          <FormGroup state={hasCodeChanged ? 'warning' : 'default'}>
            <Label>Invitation Code *</Label>
            <Input
              type="text"
              required
              maxLength={INVITATION_CODE_MAX_LENGTH}
              value={formState.code}
              onChange={(e) => updateField('code', e.target.value)}
              className="font-mono uppercase"
              placeholder="e.g. ALICE123"
            />
          </FormGroup>

          <FormGroup>
            <Label>Email</Label>
            <Input
              type="email"
              value={formState.email}
              onChange={(e) => updateField('email', e.target.value)}
              placeholder="guest@example.com"
            />
          </FormGroup>

          <FormGroup>
            <Label>Plus-One Allocations</Label>
            <Input
              type="number"
              min={0}
              step={1}
              value={formState.plusOneAllocations}
              onChange={(e) => updateField('plusOneAllocations', e.target.value)}
            />
          </FormGroup>

          <FormGroup>
            <Label>Plus-One First Name</Label>
            <Input
              type="text"
              maxLength={PLUS_ONE_NAME_MAX_LENGTH}
              value={formState.plusOneFirstName}
              onChange={(e) => updateField('plusOneFirstName', e.target.value)}
              placeholder="e.g. Jordan"
            />
          </FormGroup>

          <FormGroup>
            <Label>Plus-One Last Name</Label>
            <Input
              type="text"
              maxLength={PLUS_ONE_NAME_MAX_LENGTH}
              value={formState.plusOneLastName}
              onChange={(e) => updateField('plusOneLastName', e.target.value)}
              placeholder="e.g. Smith"
            />
          </FormGroup>
        </div>
      </div>

      <div className="border-t border-gray-100 dark:border-zinc-800 pt-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
          Household, Party &amp; Dietary Notes
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormGroup>
            <Label>Household Name</Label>
            <Input
              type="text"
              maxLength={HOUSEHOLD_NAME_MAX_LENGTH}
              value={formState.householdName}
              onChange={(e) => updateField('householdName', e.target.value)}
              placeholder="e.g. The Smith Family"
            />
          </FormGroup>

          <FormGroup>
            <Label>Party Group</Label>
            <Input
              type="text"
              maxLength={PARTY_GROUP_MAX_LENGTH}
              value={formState.partyGroup}
              onChange={(e) => updateField('partyGroup', e.target.value)}
              placeholder="e.g. Bridal Party"
            />
          </FormGroup>

          <FormGroup className="sm:col-span-2">
            <Label>Party Tags (Comma-Separated)</Label>
            <Input
              type="text"
              value={formState.partyTags}
              onChange={(e) => updateField('partyTags', e.target.value)}
              placeholder="e.g. VIP, Out of Town"
            />
          </FormGroup>

          <FormGroup className="sm:col-span-2">
            <Label>Dietary Notes</Label>
            <Textarea
              rows={2}
              value={formState.dietaryNotes}
              onChange={(e) => updateField('dietaryNotes', e.target.value)}
              placeholder="e.g. Gluten-free, nut allergy"
            />
          </FormGroup>
        </div>
      </div>

      <div className="border-t border-gray-100 dark:border-zinc-800 pt-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3">
          Mailing Address
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormGroup className="sm:col-span-2">
            <Label>Address Line 1</Label>
            <Input
              type="text"
              maxLength={ADDRESS_LINE_MAX_LENGTH}
              value={formState.addressLine1}
              onChange={(e) => updateField('addressLine1', e.target.value)}
              placeholder="123 Main St"
            />
          </FormGroup>

          <FormGroup className="sm:col-span-2">
            <Label>Address Line 2</Label>
            <Input
              type="text"
              maxLength={ADDRESS_LINE_MAX_LENGTH}
              value={formState.addressLine2}
              onChange={(e) => updateField('addressLine2', e.target.value)}
              placeholder="Apt 4B"
            />
          </FormGroup>

          <FormGroup>
            <Label>City</Label>
            <Input
              type="text"
              maxLength={CITY_MAX_LENGTH}
              value={formState.city}
              onChange={(e) => updateField('city', e.target.value)}
              placeholder="Seattle"
            />
          </FormGroup>

          <FormGroup>
            <Label>State / Province</Label>
            <Input
              type="text"
              maxLength={STATE_MAX_LENGTH}
              value={formState.state}
              onChange={(e) => updateField('state', e.target.value)}
              placeholder="WA"
            />
          </FormGroup>

          <FormGroup>
            <Label>Zip / Postal Code</Label>
            <Input
              type="text"
              maxLength={ZIP_CODE_MAX_LENGTH}
              value={formState.zipCode}
              onChange={(e) => updateField('zipCode', e.target.value)}
              placeholder="98101"
            />
          </FormGroup>

          <FormGroup>
            <Label>Country</Label>
            <Input
              type="text"
              maxLength={COUNTRY_MAX_LENGTH}
              value={formState.country}
              onChange={(e) => updateField('country', e.target.value)}
              placeholder="USA"
            />
          </FormGroup>
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-3 border-t border-gray-100 dark:border-zinc-800">
        <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Guest Changes'}
        </Button>
      </div>
    </form>
  );
};

export const GuestEditorModal: React.FC<GuestEditorModalProps> = ({
  isOpen,
  onClose,
  guest,
  onSave,
}) => {
  if (!isOpen || !guest) return null;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Guest Details"
      description="Update guest profile, party grouping, dietary notes, or mailing address. Existing seating assignments and RSVP responses are preserved."
      className="max-w-2xl max-h-[90vh] flex flex-col"
      contentClassName="px-6 py-4 overflow-y-auto max-h-[75vh]"
    >
      <GuestEditorForm key={guest.id} guest={guest} onClose={onClose} onSave={onSave} />
    </Dialog>
  );
};
