'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Dialog, useDirtyConfirmClose } from '@/components/ui/Dialog';
import { EnsureToastProvider } from '@/components/ui/ToastProvider';
import { Button } from '@/components/ui/Button';
import { FormGroup, Label, Input, Textarea } from '@/components/ui/forms';
import {
  getAttendanceStatus,
  formatGuestPlusOneNames,
  type InvitationCodeDTO,
} from '@/features/registry';
import type {
  AdminInvitationRsvpsDetail,
  AdminSubEventRsvpOverrideItemDTO,
} from '@/features/sub-events';
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
  onRsvpUpdated?: () => void;
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
    rsvpOverrideSlot?: React.ReactNode;
    rsvpDirty?: boolean;
    onSaveRsvpOverrides?: (_profileContext?: {
      guestName: string;
      plusOneFirstName: string | null;
      plusOneLastName: string | null;
    }) => Promise<void>;
    onProfileCompanionChange?: (_firstName: string, _lastName: string) => void;
  });

const GuestEditorFormInner = React.forwardRef<HTMLFormElement, GuestEditorFormProps>(
  (props, ref) => {
    const { onClose, onDirtyChange, actionsAlign = 'end', className } = props;
    const isEditMode = props.mode === 'edit';
    const guest = isEditMode ? props.guest : null;
    const rsvpDirty = isEditMode ? Boolean(props.rsvpDirty) : false;

    const initialFormState = useMemo(() => createInitialGuestFormState(guest), [guest]);
    const [formState, setFormState] = useState<GuestFormState>(() => initialFormState);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    const isProfileDirty = isGuestFormDirty(formState, initialFormState);
    const isDirty = isProfileDirty || rsvpDirty;
    const handleRequestClose = useDirtyConfirmClose(isDirty, onClose);

    const originalCodeNormalized = guest ? normalizeInvitationCode(guest.code) : '';
    const enteredCodeNormalized = normalizeInvitationCode(formState.code);
    const hasCodeChanged =
      isEditMode && Boolean(originalCodeNormalized) && enteredCodeNormalized !== originalCodeNormalized;

    const updateField = <K extends keyof GuestFormState>(field: K, value: GuestFormState[K]) => {
      const next = { ...formState, [field]: value };
      setFormState(next);
      onDirtyChange?.(isGuestFormDirty(next, initialFormState) || rsvpDirty);
      if (
        props.mode === 'edit' &&
        (field === 'plusOneFirstName' || field === 'plusOneLastName')
      ) {
        props.onProfileCompanionChange?.(next.plusOneFirstName, next.plusOneLastName);
      }
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
          if (props.rsvpDirty && props.onSaveRsvpOverrides) {
            await props.onSaveRsvpOverrides({
              guestName: trimmedName,
              plusOneFirstName: normalizedPlusOneFirstName,
              plusOneLastName: normalizedPlusOneLastName,
            });
          }
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

        {isEditMode && props.rsvpOverrideSlot}

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

interface EventRsvpDraft {
  status: 'unresponded' | 'attending' | 'declined' | 'pending' | 'clear';
  plusOneCount: number;
  plusOneNames: string[];
  mealSelections: string[];
  dietaryNotes: string;
  customAnswers: Record<string, string>;
}

const selectControlClassName =
  'w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary/30';

interface GuestEditorModalBodyProps {
  guest: InvitationCodeDTO;
  onClose: () => void;
  onSave: (_id: string, _payload: Partial<InvitationCodeDTO>) => Promise<unknown>;
  onRsvpUpdated?: () => void;
  onCombinedDirtyChange: (_dirty: boolean) => void;
}

const GuestEditorModalBody: React.FC<GuestEditorModalBodyProps> = ({
  guest,
  onClose,
  onSave,
  onRsvpUpdated,
  onCombinedDirtyChange,
}) => {
  const initialExtra = useMemo(() => getInitialExtraFieldsObject(guest.extraFields), [guest]);
  const [profileDirty, setProfileDirty] = useState(false);
  const [rsvpDirty, setRsvpDirty] = useState(false);
  const [clearAllPending, setClearAllPending] = useState(false);
  const [overallStatus, setOverallStatus] = useState<'attending' | 'declined' | 'pending'>(() =>
    getAttendanceStatus(guest)
  );
  const [directPlusOneCount, setDirectPlusOneCount] = useState<string>(() => {
    if (typeof initialExtra.plusOneCount === 'number' && initialExtra.plusOneCount >= 0) {
      return String(Math.floor(initialExtra.plusOneCount));
    }
    if (guest.plusOneFirstName || guest.plusOneLastName) {
      return '1';
    }
    return '0';
  });
  const [directPlusOneNames, setDirectPlusOneNames] = useState<string>(() =>
    formatGuestPlusOneNames(guest)
  );
  const [sharedCompanionNames, setSharedCompanionNames] = useState<string[]>(() => {
    const formatted = formatGuestPlusOneNames(guest);
    return formatted
      ? formatted
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean)
      : [];
  });
  const [subEvents, setSubEvents] = useState<AdminInvitationRsvpsDetail['subEvents']>([]);
  const [eventDrafts, setEventDrafts] = useState<Record<string, EventRsvpDraft>>({});

  useEffect(() => {
    let cancelled = false;
    if (typeof fetch !== 'function') return;

    void fetch(`/api/admin/invitation-codes/rsvps?invitationCodeId=${encodeURIComponent(guest.id)}`)
      .then(async (res) => {
        if (!res || !res.ok) return null;
        const json = await res.json().catch(() => null);
        return (json?.data ?? json) as AdminInvitationRsvpsDetail | null;
      })
      .then((detail) => {
        if (cancelled || !detail || !Array.isArray(detail.subEvents)) return;
        const rsvpList = Array.isArray(detail.rsvps) ? detail.rsvps : [];
        const rsvpMap = new Map(rsvpList.map((r) => [r.subEventId, r]));

        const discoveredNames: string[] = [];
        for (const r of rsvpList) {
          if (Array.isArray(r.plusOneNames)) {
            r.plusOneNames.forEach((rawName, idx) => {
              const trimmed = typeof rawName === 'string' ? rawName.trim() : '';
              if (trimmed && !discoveredNames[idx]) {
                discoveredNames[idx] = trimmed;
              }
            });
          }
        }
        const detailGuestFallback = detail.invitationCode
          ? formatGuestPlusOneNames(detail.invitationCode)
          : formatGuestPlusOneNames(guest);
        if (detailGuestFallback) {
          detailGuestFallback
            .split(',')
            .map((n) => n.trim())
            .filter(Boolean)
            .forEach((n, idx) => {
              if (!discoveredNames[idx]) {
                discoveredNames[idx] = n;
              }
            });
        }

        const initialDrafts: Record<string, EventRsvpDraft> = {};
        for (const se of detail.subEvents) {
          const existing = rsvpMap.get(se.id);
          if (existing) {
            const poCount = existing.plusOneCount ?? 0;
            const rawExistingNames = Array.isArray(existing.plusOneNames)
              ? [...existing.plusOneNames]
              : [];
            if (existing.status === 'attending' && poCount > 0) {
              for (let i = 0; i < poCount; i++) {
                if (!rawExistingNames[i]?.trim() && discoveredNames[i]) {
                  rawExistingNames[i] = discoveredNames[i];
                }
              }
            }
            initialDrafts[se.id] = {
              status: existing.status,
              plusOneCount: poCount,
              plusOneNames: rawExistingNames,
              mealSelections: Array.isArray(existing.mealSelections) ? existing.mealSelections : [],
              dietaryNotes: existing.dietaryNotes ?? '',
              customAnswers: existing.customAnswers ? { ...existing.customAnswers } : {},
            };
          } else {
            initialDrafts[se.id] = {
              status: 'unresponded',
              plusOneCount: 0,
              plusOneNames: [],
              mealSelections: [],
              dietaryNotes: '',
              customAnswers: {},
            };
          }
        }
        if (discoveredNames.some(Boolean)) {
          setSharedCompanionNames(discoveredNames);
        }
        setSubEvents(detail.subEvents);
        setEventDrafts(initialDrafts);
      })
      .catch(() => {
        // Ignore unmocked fetch in isolated unit tests
      });

    return () => {
      cancelled = true;
    };
  }, [guest]);

  const markRsvpDirty = (nextRsvpDirty: boolean) => {
    setRsvpDirty(nextRsvpDirty);
    onCombinedDirtyChange(profileDirty || nextRsvpDirty);
  };

  const handleProfileDirtyChange = (nextProfileDirty: boolean) => {
    setProfileDirty(nextProfileDirty);
    onCombinedDirtyChange(nextProfileDirty || rsvpDirty);
  };

  const handleProfileCompanionChange = (firstName: string, lastName: string) => {
    const nextSlot0 = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ').trim();
    const prevSlot0 = sharedCompanionNames[0] ?? '';

    setSharedCompanionNames((prev) => {
      const next = [...prev];
      next[0] = nextSlot0;
      return next;
    });

    setDirectPlusOneNames((prev) => {
      const parts = prev
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean);
      if (parts.length === 0 || parts[0] === prevSlot0) {
        if (nextSlot0) {
          parts[0] = nextSlot0;
        } else {
          parts.shift();
        }
        return parts.join(', ');
      }
      return prev;
    });

    setEventDrafts((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, draft] of Object.entries(prev)) {
        if (draft.status === 'attending' && draft.plusOneCount > 0) {
          const cur0 = (draft.plusOneNames[0] ?? '').trim();
          if (!cur0 || cur0 === prevSlot0) {
            const nextNames = [...draft.plusOneNames];
            nextNames[0] = nextSlot0;
            next[id] = { ...draft, plusOneNames: nextNames };
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  };

  const updateEventDraft = (
    subEventId: string,
    updater: (_prev: EventRsvpDraft) => EventRsvpDraft,
    editedPlusOneSlot?: { index: number; value: string }
  ) => {
    const prevSharedValue =
      editedPlusOneSlot !== undefined
        ? (sharedCompanionNames[editedPlusOneSlot.index] ?? '')
        : '';

    if (editedPlusOneSlot !== undefined) {
      setSharedCompanionNames((prev) => {
        const next = [...prev];
        next[editedPlusOneSlot.index] = editedPlusOneSlot.value;
        return next;
      });
    }

    setEventDrafts((prev) => {
      const current = prev[subEventId] ?? {
        status: 'unresponded',
        plusOneCount: 0,
        plusOneNames: [],
        mealSelections: [],
        dietaryNotes: '',
        customAnswers: {},
      };
      const updated = updater(current);
      if (updated.status === 'attending' && updated.plusOneCount > 0 && !editedPlusOneSlot) {
        const prefilledNames = [...updated.plusOneNames];
        let prefilled = false;
        for (let idx = 0; idx < updated.plusOneCount; idx++) {
          if (!prefilledNames[idx]?.trim() && sharedCompanionNames[idx]?.trim()) {
            prefilledNames[idx] = sharedCompanionNames[idx];
            prefilled = true;
          }
        }
        if (prefilled) {
          updated.plusOneNames = prefilledNames;
        }
      }

      const nextMap: Record<string, EventRsvpDraft> = {
        ...prev,
        [subEventId]: updated,
      };

      if (editedPlusOneSlot !== undefined) {
        const { index, value } = editedPlusOneSlot;
        for (const [otherId, otherDraft] of Object.entries(prev)) {
          if (otherId === subEventId) continue;
          if (otherDraft.status !== 'declined' && otherDraft.plusOneCount > index) {
            const existingSlot = otherDraft.plusOneNames[index] ?? '';
            if (!existingSlot.trim() || existingSlot === prevSharedValue) {
              const syncedNames = [...otherDraft.plusOneNames];
              syncedNames[index] = value;
              nextMap[otherId] = {
                ...otherDraft,
                plusOneNames: syncedNames,
              };
            }
          }
        }
      }

      return nextMap;
    });
    setClearAllPending(false);
    markRsvpDirty(true);
  };

  const handleSaveRsvpOverrides = async (profileContext?: {
    guestName: string;
    plusOneFirstName: string | null;
    plusOneLastName: string | null;
  }) => {
    if (!rsvpDirty) return;

    const profileSlot0 = profileContext
      ? [profileContext.plusOneFirstName, profileContext.plusOneLastName]
        .filter(Boolean)
        .join(' ')
        .trim()
      : '';

    let bodyPayload: Record<string, unknown>;
    if (clearAllPending) {
      bodyPayload = {
        invitationCodeId: guest.id,
        clearAll: true,
      };
    } else if (subEvents.length > 0) {
      const rsvpsPayload: AdminSubEventRsvpOverrideItemDTO[] = [];
      for (const se of subEvents) {
        const draft = eventDrafts[se.id];
        if (!draft || draft.status === 'unresponded') continue;
        const poCount = draft.status === 'attending' ? Math.max(0, draft.plusOneCount) : 0;
        const resolvedPoNames =
          draft.status === 'attending' ? draft.plusOneNames.slice(0, poCount) : [];
        if (draft.status === 'attending' && poCount > 0 && !resolvedPoNames[0]?.trim() && profileSlot0) {
          resolvedPoNames[0] = profileSlot0;
        }
        rsvpsPayload.push({
          subEventId: se.id,
          status: draft.status,
          plusOneCount: poCount,
          plusOneNames: resolvedPoNames,
          mealSelections:
            draft.status === 'attending'
              ? draft.mealSelections.slice(0, 1 + poCount)
              : [],
          dietaryNotes: draft.dietaryNotes.trim() || null,
          customAnswers: draft.status !== 'declined' ? draft.customAnswers : {},
        });
      }
      bodyPayload = {
        invitationCodeId: guest.id,
        overallAttendanceStatus: overallStatus,
        rsvps: rsvpsPayload,
      };
    } else {
      const parsedPlusOnes = Math.max(0, parseInt(directPlusOneCount, 10) || 0);
      const parsedNames = directPlusOneNames
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean)
        .slice(0, parsedPlusOnes);
      if (overallStatus === 'attending' && parsedPlusOnes > 0 && !parsedNames[0] && profileSlot0) {
        parsedNames[0] = profileSlot0;
      }
      bodyPayload = {
        invitationCodeId: guest.id,
        overallAttendanceStatus: overallStatus,
        plusOneCount: overallStatus === 'attending' ? parsedPlusOnes : 0,
        plusOneNames: overallStatus === 'attending' ? parsedNames : [],
      };
    }

    const res = await fetch('/api/admin/invitation-codes/rsvps', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyPayload),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody?.error || 'Failed to save RSVP overrides.');
    }

    onRsvpUpdated?.();
  };

  const rsvpOverrideSection = (
    <div
      className="pt-3 border-t border-gray-100 dark:border-zinc-800 space-y-4"
      data-testid="guest-rsvp-overrides-section"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-zinc-400">
            RSVP &amp; Meal Overrides (Admin)
          </h3>
          <p className="text-xs text-gray-500 dark:text-zinc-400 mt-0.5">
            Record or adjust RSVPs, plus-ones, meal choices, and custom answers even after the public deadline.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            setClearAllPending(true);
            markRsvpDirty(true);
          }}
        >
          Clear RSVP Responses
        </Button>
      </div>

      {clearAllPending ? (
        <div
          className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-950 dark:border-amber-700/60 dark:bg-amber-950/50 dark:text-amber-200 flex items-center justify-between gap-3"
          data-testid="rsvp-clear-pending-banner"
        >
          <span>
            All RSVP responses and meal selections for this guest will be cleared when you save.
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setClearAllPending(false);
            }}
          >
            Undo Clear
          </Button>
        </div>
      ) : subEvents.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FormGroup>
            <Label htmlFor="guest-overall-rsvp-status">Overall RSVP Status</Label>
            <select
              id="guest-overall-rsvp-status"
              aria-label="Overall RSVP Status"
              value={overallStatus}
              onChange={(e) => {
                setOverallStatus(e.target.value as 'attending' | 'declined' | 'pending');
                markRsvpDirty(true);
              }}
              className={selectControlClassName}
            >
              <option value="pending">Pending</option>
              <option value="attending">Attending</option>
              <option value="declined">Declined</option>
            </select>
          </FormGroup>

          {overallStatus === 'attending' && (
            <>
              <FormGroup>
                <Label htmlFor="guest-attending-plus-one-count">Attending Plus-One Count</Label>
                <Input
                  id="guest-attending-plus-one-count"
                  aria-label="Attending Plus-One Count"
                  type="number"
                  min={0}
                  max={20}
                  value={directPlusOneCount}
                  onChange={(e) => {
                    setDirectPlusOneCount(e.target.value);
                    markRsvpDirty(true);
                  }}
                />
              </FormGroup>
              <FormGroup>
                <Label htmlFor="guest-attending-plus-one-names">Attending Plus-One Names</Label>
                <Input
                  id="guest-attending-plus-one-names"
                  aria-label="Attending Plus-One Names"
                  type="text"
                  value={directPlusOneNames}
                  onChange={(e) => {
                    setDirectPlusOneNames(e.target.value);
                    markRsvpDirty(true);
                  }}
                  placeholder="Jordan Smith, Casey Smith"
                />
              </FormGroup>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {subEvents.map((se) => {
            const draft = eventDrafts[se.id] ?? {
              status: 'unresponded',
              plusOneCount: 0,
              plusOneNames: [],
              mealSelections: [],
              dietaryNotes: '',
              customAnswers: {},
            };
            const partySize = 1 + Math.max(0, draft.plusOneCount);

            return (
              <div
                key={se.id}
                data-testid={`rsvp-override-event-${se.id}`}
                className="p-3.5 rounded-xl border border-gray-200 dark:border-zinc-700 bg-gray-50/70 dark:bg-zinc-900/60 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">
                      {se.title}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded uppercase font-bold',
                        se.isPrivate
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200'
                          : 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200'
                      )}
                    >
                      {se.isPrivate ? 'Private' : 'Public'}
                    </span>
                  </div>

                  <div className="w-48">
                    <select
                      aria-label={`RSVP status for ${se.title}`}
                      value={draft.status}
                      onChange={(e) => {
                        const nextStatus = e.target.value as EventRsvpDraft['status'];
                        updateEventDraft(se.id, (prev) => ({
                          ...prev,
                          status: nextStatus,
                        }));
                      }}
                      className={selectControlClassName}
                    >
                      <option value="unresponded">No Response</option>
                      <option value="attending">Attending</option>
                      <option value="declined">Declined</option>
                      <option value="pending">Pending</option>
                      <option value="clear">Clear Response</option>
                    </select>
                  </div>
                </div>

                {draft.status === 'attending' && (
                  <div className="space-y-3 pt-1">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <FormGroup>
                        <Label htmlFor={`rsvp-plus-ones-${se.id}`}>Attending Plus-Ones</Label>
                        <Input
                          id={`rsvp-plus-ones-${se.id}`}
                          aria-label={`Attending plus-ones for ${se.title}`}
                          type="number"
                          min={0}
                          max={20}
                          value={String(draft.plusOneCount)}
                          onChange={(e) => {
                            const count = Math.max(0, Math.min(20, parseInt(e.target.value, 10) || 0));
                            updateEventDraft(se.id, (prev) => ({
                              ...prev,
                              plusOneCount: count,
                            }));
                          }}
                        />
                      </FormGroup>

                      <FormGroup className="sm:col-span-2">
                        <Label htmlFor={`rsvp-dietary-${se.id}`}>Event Dietary Notes</Label>
                        <Input
                          id={`rsvp-dietary-${se.id}`}
                          aria-label={`Event dietary notes for ${se.title}`}
                          type="text"
                          maxLength={500}
                          value={draft.dietaryNotes}
                          onChange={(e) =>
                            updateEventDraft(se.id, (prev) => ({
                              ...prev,
                              dietaryNotes: e.target.value,
                            }))
                          }
                          placeholder="e.g. No shellfish"
                        />
                      </FormGroup>
                    </div>

                    {draft.plusOneCount > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {Array.from({ length: draft.plusOneCount }, (_, idx) => (
                          <FormGroup key={`po-name-${se.id}-${idx}`}>
                            <Label htmlFor={`rsvp-po-name-${se.id}-${idx}`}>
                              Plus-One #{idx + 1} Name
                            </Label>
                            <Input
                              id={`rsvp-po-name-${se.id}-${idx}`}
                              aria-label={`Plus-one ${idx + 1} name for ${se.title}`}
                              type="text"
                              maxLength={120}
                              value={draft.plusOneNames[idx] ?? ''}
                              onChange={(e) =>
                                updateEventDraft(
                                  se.id,
                                  (prev) => {
                                    const nextNames = [...prev.plusOneNames];
                                    nextNames[idx] = e.target.value;
                                    return { ...prev, plusOneNames: nextNames };
                                  },
                                  { index: idx, value: e.target.value }
                                )
                              }
                              placeholder={`Plus-One #${idx + 1} full name`}
                            />
                          </FormGroup>
                        ))}
                      </div>
                    )}

                    {se.mealOptions.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {Array.from({ length: partySize }, (_, attendeeIdx) => {
                          const attendeeLabel =
                            attendeeIdx === 0
                              ? `${guest.guestName || 'Primary Guest'} Meal`
                              : `${draft.plusOneNames[attendeeIdx - 1]?.trim() || `Plus-One #${attendeeIdx}`} Meal`;
                          const selectAriaLabel =
                            attendeeIdx === 0
                              ? `Meal selection for primary guest (${se.title})`
                              : `Meal selection for plus-one ${attendeeIdx} (${se.title})`;
                          const fieldId = `rsvp-meal-${se.id}-${attendeeIdx}`;

                          return (
                            <FormGroup key={fieldId}>
                              <Label htmlFor={fieldId}>{attendeeLabel}</Label>
                              <select
                                id={fieldId}
                                aria-label={selectAriaLabel}
                                value={draft.mealSelections[attendeeIdx] ?? ''}
                                onChange={(e) =>
                                  updateEventDraft(se.id, (prev) => {
                                    const nextMeals = [...prev.mealSelections];
                                    nextMeals[attendeeIdx] = e.target.value;
                                    return { ...prev, mealSelections: nextMeals };
                                  })
                                }
                                className={selectControlClassName}
                              >
                                <option value="">-- Select meal --</option>
                                {draft.mealSelections[attendeeIdx] &&
                                  !se.mealOptions.some(
                                    (opt) => opt.id === draft.mealSelections[attendeeIdx]
                                  ) && (
                                  <option value={draft.mealSelections[attendeeIdx]}>
                                    {`${draft.mealSelections[attendeeIdx]} (Unavailable — previously selected)`}
                                  </option>
                                )}
                                {se.mealOptions.map((opt) => (
                                  <option key={opt.id} value={opt.id}>
                                    {opt.label}
                                    {opt.dietaryTags.length > 0
                                      ? ` (${opt.dietaryTags.join(', ')})`
                                      : ''}
                                  </option>
                                ))}
                              </select>
                            </FormGroup>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {(draft.status === 'attending' || draft.status === 'pending') &&
                  se.customQuestions.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {se.customQuestions.map((q) => {
                      const qFieldId = `rsvp-question-${se.id}-${q.id}`;
                      const qAriaLabel = `${q.prompt} (${se.title})`;
                      const currentVal = draft.customAnswers[q.id] ?? '';

                      return (
                        <FormGroup key={qFieldId}>
                          <Label htmlFor={qFieldId}>{q.prompt}</Label>
                          {q.type === 'choice' ? (
                            <select
                              id={qFieldId}
                              aria-label={qAriaLabel}
                              value={currentVal}
                              onChange={(e) =>
                                updateEventDraft(se.id, (prev) => ({
                                  ...prev,
                                  customAnswers: {
                                    ...prev.customAnswers,
                                    [q.id]: e.target.value,
                                  },
                                }))
                              }
                              className={selectControlClassName}
                            >
                              <option value="">-- Select response --</option>
                              {currentVal && !q.options.includes(currentVal) && (
                                <option value={currentVal}>
                                  {`${currentVal} (Unavailable — previously selected)`}
                                </option>
                              )}
                              {q.options.map((opt) => (
                                <option key={opt} value={opt}>
                                  {opt}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <Input
                              id={qFieldId}
                              aria-label={qAriaLabel}
                              type="text"
                              maxLength={500}
                              value={currentVal}
                              onChange={(e) =>
                                updateEventDraft(se.id, (prev) => ({
                                  ...prev,
                                  customAnswers: {
                                    ...prev.customAnswers,
                                    [q.id]: e.target.value,
                                  },
                                }))
                              }
                              placeholder="Enter response"
                            />
                          )}
                        </FormGroup>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <GuestEditorForm
      mode="edit"
      guest={guest}
      onClose={onClose}
      onSave={onSave}
      rsvpOverrideSlot={rsvpOverrideSection}
      rsvpDirty={rsvpDirty}
      onSaveRsvpOverrides={handleSaveRsvpOverrides}
      onProfileCompanionChange={handleProfileCompanionChange}
      onDirtyChange={handleProfileDirtyChange}
    />
  );
};

export const GuestEditorModal: React.FC<GuestEditorModalProps> = ({
  isOpen,
  onClose,
  guest,
  onSave,
  onRsvpUpdated,
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
      description="Update guest profile, party grouping, dietary notes, mailing address, or admin RSVP and meal overrides. Existing seating assignments are preserved."
      className="max-w-2xl max-h-[90vh] flex flex-col"
      contentClassName="px-6 py-4 overflow-y-auto max-h-[75vh]"
    >
      <GuestEditorModalBody
        key={guest.id}
        guest={guest}
        onClose={onClose}
        onSave={onSave}
        onRsvpUpdated={onRsvpUpdated}
        onCombinedDirtyChange={(nextDirty) => setDirtyEntry({ guestId: guest.id, isDirty: nextDirty })}
      />
    </Dialog>
  );
};
