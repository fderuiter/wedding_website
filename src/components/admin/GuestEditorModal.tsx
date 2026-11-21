'use client';

import React, { useMemo, useState } from 'react';
import { Dialog, useDirtyConfirmClose } from '@/components/ui/Dialog';
import { EnsureToastProvider } from '@/components/ui/ToastProvider';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Textarea } from '@/components/ui/forms';
import type { InvitationCodeDTO } from '@/features/registry';
import { cn } from '@/utils/cn';
import {
  ADDRESS_LINE_MAX_LENGTH,
  CITY_MAX_LENGTH,
  COUNTRY_MAX_LENGTH,
  GUEST_NAME_MAX_LENGTH,
  HOUSEHOLD_NAME_MAX_LENGTH,
  INVITATION_CODE_MAX_LENGTH,
  PARTY_GROUP_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  PLUS_ONE_NAME_MAX_LENGTH,
  STATE_MAX_LENGTH,
  ZIP_CODE_MAX_LENGTH,
  normalizeGuestPhone,
  normalizeInvitationCode,
  normalizeNullableString,
  normalizePartyTags,
  validateGuestPhone,
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
  phone: string;
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

function getInitialExtraFieldsObject(extraFields: unknown): Record<string, unknown> {
  if (!extraFields) return {};
  if (typeof extraFields === 'object' && !Array.isArray(extraFields)) {
    return { ...(extraFields as Record<string, unknown>) };
  }
  return {};
}

function getInitialGuestPhone(guest: InvitationCodeDTO): string {
  const extra = getInitialExtraFieldsObject(guest.extraFields);
  const rawPhone = extra.phone ?? extra.mobile;
  return typeof rawPhone === 'string' ? rawPhone : '';
}

function createInitialGuestFormState(guest?: InvitationCodeDTO | null): GuestFormState {
  if (!guest) {
    return {
      guestName: '',
      code: '',
      email: '',
      phone: '',
      householdName: '',
      partyGroup: '',
      partyTags: '',
      plusOneAllocations: '0',
      plusOneFirstName: '',
      plusOneLastName: '',
      dietaryNotes: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state: '',
      zipCode: '',
      country: '',
    };
  }

  return {
    guestName: guest.guestName ?? '',
    code: guest.code ?? '',
    email: guest.email ?? '',
    phone: getInitialGuestPhone(guest),
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

function isGuestFormDirty(current: GuestFormState, initial: GuestFormState): boolean {
  return (Object.keys(initial) as Array<keyof GuestFormState>).some(
    (key) => current[key] !== initial[key]
  );
}

interface GuestEditorFormBaseProps {
  onClose: () => void;
  onDirtyChange?: (_isDirty: boolean) => void;
  actionsAlign?: 'start' | 'end';
  className?: string;
}

type GuestEditorFormProps =
  | (GuestEditorFormBaseProps & {
    mode: 'create';
    onCreate: (_payload: Partial<InvitationCodeDTO>) => Promise<unknown>;
  })
  | (GuestEditorFormBaseProps & {
    mode: 'edit';
    guest: InvitationCodeDTO;
    onSave: (_id: string, _payload: Partial<InvitationCodeDTO>) => Promise<unknown>;
  });

const GuestEditorFormInner = React.forwardRef<HTMLFormElement, GuestEditorFormProps>(
  (props, ref) => {
    const { onClose, onDirtyChange, actionsAlign = 'end', className } = props;
    const isEditMode = props.mode === 'edit';
    const guest = isEditMode ? props.guest : null;

    const initialFormState = useMemo(() => createInitialGuestFormState(guest), [guest]);
    const [formState, setFormState] = useState<GuestFormState>(() => initialFormState);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const isDirty = isGuestFormDirty(formState, initialFormState);
    const handleRequestClose = useDirtyConfirmClose(isDirty, onClose);

    const originalCodeNormalized = guest ? normalizeInvitationCode(guest.code) : '';
    const enteredCodeNormalized = normalizeInvitationCode(formState.code);
    const hasCodeChanged =
      isEditMode && Boolean(originalCodeNormalized) && enteredCodeNormalized !== originalCodeNormalized;

    const updateField = <K extends keyof GuestFormState>(field: K, value: GuestFormState[K]) => {
      const next = { ...formState, [field]: value };
      setFormState(next);
      onDirtyChange?.(isGuestFormDirty(next, initialFormState));
      if (validationError) setValidationError(null);
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
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
      if (isEditMode && !trimmedCode) {
        setValidationError('Invitation code is required.');
        return;
      }
      if (trimmedCode && trimmedCode.length > INVITATION_CODE_MAX_LENGTH) {
        setValidationError(`Invitation code must be under ${INVITATION_CODE_MAX_LENGTH} characters.`);
        return;
      }

      const parsedAllocations =
        formState.plusOneAllocations.trim() === '' ? 0 : Number(formState.plusOneAllocations);
      if (!Number.isInteger(parsedAllocations) || parsedAllocations < 0) {
        setValidationError('Plus-one allocations must be a non-negative whole number.');
        return;
      }

      const phoneError = validateGuestPhone(formState.phone);
      if (phoneError) {
        setValidationError(phoneError);
        return;
      }

      const normalizedPhone = normalizeGuestPhone(formState.phone);
      const normalizedEmail = normalizeNullableString(formState.email);
      const normalizedHouseholdName = normalizeNullableString(formState.householdName);
      const normalizedPartyGroup = normalizeNullableString(formState.partyGroup);
      const normalizedPartyTags = normalizePartyTags(formState.partyTags, { dedupe: true });
      const normalizedPlusOneFirstName = normalizeNullableString(formState.plusOneFirstName);
      const normalizedPlusOneLastName = normalizeNullableString(formState.plusOneLastName);
      const normalizedDietaryNotes = normalizeNullableString(formState.dietaryNotes);
      const normalizedAddressLine1 = normalizeNullableString(formState.addressLine1);
      const normalizedAddressLine2 = normalizeNullableString(formState.addressLine2);
      const normalizedCity = normalizeNullableString(formState.city);
      const normalizedState = normalizeNullableString(formState.state);
      const normalizedZipCode = normalizeNullableString(formState.zipCode);
      const normalizedCountry = normalizeNullableString(formState.country);

      let payload: Partial<InvitationCodeDTO>;

      if (isEditMode && guest) {
        const originalPhone = normalizeGuestPhone(getInitialGuestPhone(guest));
        payload = {
          guestName: trimmedName,
          code: trimmedCode,
          email: normalizedEmail,
          householdName: normalizedHouseholdName,
          partyGroup: normalizedPartyGroup,
          partyTags: normalizedPartyTags,
          plusOneAllocations: parsedAllocations,
          plusOneFirstName: normalizedPlusOneFirstName,
          plusOneLastName: normalizedPlusOneLastName,
          dietaryNotes: normalizedDietaryNotes,
          addressLine1: normalizedAddressLine1,
          addressLine2: normalizedAddressLine2,
          city: normalizedCity,
          state: normalizedState,
          zipCode: normalizedZipCode,
          country: normalizedCountry,
        };

        if (normalizedPhone !== originalPhone) {
          const nextExtraFields = getInitialExtraFieldsObject(guest.extraFields);
          if (normalizedPhone) {
            nextExtraFields.phone = normalizedPhone;
          } else {
            delete nextExtraFields.phone;
            delete nextExtraFields.mobile;
          }
          payload.extraFields = nextExtraFields;
        }
      } else {
        payload = {
          guestName: trimmedName,
          used: false,
        };
        if (trimmedCode) payload.code = trimmedCode;
        if (normalizedEmail) payload.email = normalizedEmail;
        if (normalizedHouseholdName) payload.householdName = normalizedHouseholdName;
        if (normalizedPartyGroup) payload.partyGroup = normalizedPartyGroup;
        if (normalizedPartyTags.length > 0) payload.partyTags = normalizedPartyTags;
        if (parsedAllocations > 0) payload.plusOneAllocations = parsedAllocations;
        if (normalizedPlusOneFirstName) payload.plusOneFirstName = normalizedPlusOneFirstName;
        if (normalizedPlusOneLastName) payload.plusOneLastName = normalizedPlusOneLastName;
        if (normalizedDietaryNotes) payload.dietaryNotes = normalizedDietaryNotes;
        if (normalizedAddressLine1) payload.addressLine1 = normalizedAddressLine1;
        if (normalizedAddressLine2) payload.addressLine2 = normalizedAddressLine2;
        if (normalizedCity) payload.city = normalizedCity;
        if (normalizedState) payload.state = normalizedState;
        if (normalizedZipCode) payload.zipCode = normalizedZipCode;
        if (normalizedCountry) payload.country = normalizedCountry;
        if (normalizedPhone) payload.extraFields = { phone: normalizedPhone };
      }

      const fieldErrors = validateInvitationGuestFields(payload, { mode: 'row' });
      if (fieldErrors.length > 0) {
        setValidationError(fieldErrors[0]);
        return;
      }

      setIsSaving(true);
      try {
        if (props.mode === 'edit') {
          await props.onSave(props.guest.id, payload);
        } else {
          await props.onCreate(payload);
        }
        onClose();
      } catch (err: unknown) {
        setValidationError(
          err instanceof Error && err.message
            ? err.message
            : isEditMode
              ? 'Failed to update guest details.'
              : 'Failed to create invitation code.'
        );
      } finally {
        setIsSaving(false);
      }
    };

    const submitButtonLabel = isEditMode
      ? isSaving
        ? 'Saving...'
        : 'Save Guest Changes'
      : isSaving
        ? 'Generating...'
        : 'Generate';

    return (
      <form ref={ref} noValidate onSubmit={handleSubmit} className={cn('space-y-5', className)}>
        {validationError && (
          <div
            role="alert"
            className="rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/40 dark:border-red-800 px-3.5 py-2.5 text-sm text-red-700 dark:text-red-300 font-medium"
          >
            {validationError}
          </div>
        )}

        {hasCodeChanged && guest && (
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
                placeholder={isEditMode ? 'e.g. Alice Smith' : 'e.g. John Doe'}
              />
            </FormGroup>

            <FormGroup state={hasCodeChanged ? 'warning' : 'default'}>
              <Label>
                {isEditMode
                  ? 'Invitation Code *'
                  : 'Invitation Code (Optional - auto-generated if blank)'}
              </Label>
              <Input
                type="text"
                required={isEditMode}
                maxLength={INVITATION_CODE_MAX_LENGTH}
                value={formState.code}
                onChange={(e) => updateField('code', e.target.value)}
                className="font-mono uppercase"
                placeholder={isEditMode ? 'e.g. ALICE123' : 'e.g. JOHN123'}
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
              <Label>Phone</Label>
              <Input
                type="tel"
                maxLength={PHONE_MAX_LENGTH}
                value={formState.phone}
                onChange={(e) => updateField('phone', e.target.value)}
                placeholder="e.g. +15551234567"
              />
            </FormGroup>

            <FormGroup className="sm:col-span-2">
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

        {actionsAlign === 'start' ? (
          <div className="flex gap-4 pt-3 border-t border-gray-100 dark:border-zinc-800">
            <Button type="submit" variant="primary" disabled={isSaving}>
              {submitButtonLabel}
            </Button>
            <Button type="button" variant="secondary" onClick={handleRequestClose} disabled={isSaving}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-3 pt-3 border-t border-gray-100 dark:border-zinc-800">
            <Button type="button" variant="secondary" onClick={handleRequestClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isSaving}>
              {submitButtonLabel}
            </Button>
          </div>
        )}
      </form>
    );
  }
);
GuestEditorFormInner.displayName = 'GuestEditorFormInner';

export const GuestEditorForm = React.forwardRef<HTMLFormElement, GuestEditorFormProps>(
  (props, ref) => (
    <EnsureToastProvider>
      <GuestEditorFormInner {...props} ref={ref} />
    </EnsureToastProvider>
  )
);
GuestEditorForm.displayName = 'GuestEditorForm';

export const GuestEditorModal: React.FC<GuestEditorModalProps> = ({
  isOpen,
  onClose,
  guest,
  onSave,
}) => {
  const [dirtyEntry, setDirtyEntry] = useState<{ guestId: string; isDirty: boolean }>({
    guestId: '',
    isDirty: false,
  });

  if (!isOpen || !guest) return null;

  const isDirty = dirtyEntry.guestId === guest.id && dirtyEntry.isDirty;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      isDirty={isDirty}
      title="Edit Guest Details"
      description="Update guest profile, party grouping, dietary notes, or mailing address. Existing seating assignments and RSVP responses are preserved."
      className="max-w-2xl max-h-[90vh] flex flex-col"
      contentClassName="px-6 py-4 overflow-y-auto max-h-[75vh]"
    >
      <GuestEditorForm
        key={guest.id}
        mode="edit"
        guest={guest}
        onClose={onClose}
        onSave={onSave}
        onDirtyChange={(nextDirty) => setDirtyEntry({ guestId: guest.id, isDirty: nextDirty })}
      />
    </Dialog>
  );
};
