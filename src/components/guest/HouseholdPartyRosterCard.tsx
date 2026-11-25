'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { FormGroup, Input, Label } from '@/components/ui/forms';
import type {
  GuestHouseholdMemberItem,
  GuestPartyRosterMemberInput,
} from '@/hooks/useGuestAddressPortal';

function deriveMemberDietaryBadges(
  tags: string[] | undefined,
  dietaryNotes: string | null | undefined,
  role: GuestHouseholdMemberItem['role']
): string[] {
  const badges: string[] = [];
  const seen = new Set<string>();
  const addBadge = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (key === 'other') return;
    if (role === 'CHILD' && (key === 'kids meal' || key === 'kids-meal')) return;
    if (!seen.has(key)) {
      seen.add(key);
      badges.push(trimmed);
    }
  };

  if (Array.isArray(tags)) {
    for (const tag of tags) {
      if (typeof tag === 'string') {
        addBadge(tag);
      }
    }
  }

  const notes = (dietaryNotes || '').toLowerCase();
  if (notes) {
    if (/\b(peanut|tree\s*nut|nut[- ]?free|nut\s+allergy|nuts?)\b/.test(notes)) {
      addBadge('Nut-Free');
    }
    if (/\b(dairy[- ]?free|lactose|dairy\s+allergy)\b/.test(notes)) {
      addBadge('Dairy-Free');
    }
    if (/\b(gluten[- ]?free|celiac|coeliac)\b/.test(notes)) {
      addBadge('Gluten-Free');
    }
    if (/\bvegan\b/.test(notes)) {
      addBadge('Vegan');
    } else if (/\bvegetarian\b/.test(notes)) {
      addBadge('Vegetarian');
    }
    if (/\bshellfish\b/.test(notes)) {
      addBadge('Shellfish-Free');
    }
  }

  return badges;
}

interface HouseholdPartyRosterCardProps {
  members: GuestHouseholdMemberItem[];
  householdName?: string;
  isSaving?: boolean;
  onSaveRoster: (_members: GuestPartyRosterMemberInput[]) => Promise<boolean>;
}

interface MemberDraft {
  id: string;
  role: GuestHouseholdMemberItem['role'];
  fullName: string;
  email: string;
  phone: string;
  dietaryNotes: string;
}

function formatRoleLabel(role: GuestHouseholdMemberItem['role']): string {
  switch (role) {
    case 'PRIMARY':
      return 'Primary Adult';
    case 'PARTNER':
      return 'Partner';
    case 'CHILD':
      return 'Child';
    case 'PLUS_ONE':
    default:
      return 'Plus-One';
  }
}

function buildDrafts(members: GuestHouseholdMemberItem[]): MemberDraft[] {
  return members.map((member) => ({
    id: member.id,
    role: member.role,
    fullName: member.fullName || '',
    email: member.email || '',
    phone: member.phone || '',
    dietaryNotes: member.dietaryNotes || '',
  }));
}

export function HouseholdPartyRosterCard({
  members,
  householdName,
  isSaving = false,
  onSaveRoster,
}: HouseholdPartyRosterCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [drafts, setDrafts] = useState<MemberDraft[]>(() => buildDrafts(members));
  const [validationError, setValidationError] = useState<string | null>(null);

  if (members.length === 0) {
    return null;
  }

  const handleStartEdit = () => {
    setDrafts(buildDrafts(members));
    setValidationError(null);
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setValidationError(null);
    setIsEditing(false);
  };

  const updateDraftField = (
    memberId: string,
    field: keyof Omit<MemberDraft, 'id' | 'role'>,
    value: string
  ) => {
    setDrafts((prev) =>
      prev.map((d) => (d.id === memberId ? { ...d, [field]: value } : d))
    );
    if (validationError) {
      setValidationError(null);
    }
  };

  const handleSubmit = async (e: React.SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    for (const draft of drafts) {
      if (!draft.fullName.trim()) {
        setValidationError('Please enter a full name for every household member.');
        return;
      }
    }

    const payload: GuestPartyRosterMemberInput[] = drafts.map((draft) => ({
      id: draft.id,
      fullName: draft.fullName.trim(),
      email: draft.role === 'CHILD' ? null : draft.email.trim() || null,
      phone: draft.role === 'CHILD' ? null : draft.phone.trim() || null,
      dietaryNotes: draft.dietaryNotes.trim() || null,
    }));

    const ok = await onSaveRoster(payload);
    if (ok) {
      setIsEditing(false);
    }
  };

  return (
    <section
      aria-labelledby="household-party-roster-heading"
      data-testid="household-party-roster-card"
      className="bg-white dark:bg-zinc-800 rounded-3xl shadow-md p-6 sm:p-8 border border-gray-100 dark:border-zinc-700 space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-100 dark:border-zinc-700 pb-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2
              id="household-party-roster-heading"
              className="text-xl sm:text-2xl font-bold text-[var(--color-primary-text)] dark:text-red-300"
            >
              Household Party &amp; Standing Allergies
            </h2>
            {householdName && (
              <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-zinc-700 px-3 py-0.5 text-xs font-semibold text-gray-800 dark:text-zinc-100 border border-gray-200 dark:border-zinc-600">
                {householdName}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-600 dark:text-zinc-300">
            Permanent dietary profiles and roles automatically reflected across all wedding events.
          </p>
        </div>

        {!isEditing && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleStartEdit}
            data-testid="edit-party-roster-button"
            className="self-start sm:self-center shrink-0"
          >
            Edit Party Roster
          </Button>
        )}
      </div>

      {isEditing ? (
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {validationError && (
            <div
              role="alert"
              className="rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 p-3.5 text-sm font-medium text-rose-800 dark:text-rose-200"
            >
              {validationError}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {drafts.map((draft, idx) => (
              <div
                key={draft.id}
                data-testid={`household-member-edit-${draft.id}`}
                className="rounded-2xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-900/60 p-4 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-zinc-200">
                    Member #{idx + 1}
                  </span>
                  <span className="inline-flex items-center rounded-md bg-gray-200/80 dark:bg-zinc-700 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-gray-800 dark:text-zinc-100">
                    {formatRoleLabel(draft.role)}
                  </span>
                </div>

                <FormGroup busy={isSaving}>
                  <Label htmlFor={`roster-member-name-${draft.id}`}>Full Name</Label>
                  <Input
                    id={`roster-member-name-${draft.id}`}
                    type="text"
                    sizeVariant="compact"
                    required
                    maxLength={120}
                    busy={isSaving}
                    value={draft.fullName}
                    onChange={(e) => updateDraftField(draft.id, 'fullName', e.target.value)}
                    placeholder="e.g. Jordan Taylor"
                  />
                </FormGroup>

                {draft.role !== 'CHILD' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <FormGroup busy={isSaving}>
                      <Label htmlFor={`roster-member-email-${draft.id}`}>Email (Optional)</Label>
                      <Input
                        id={`roster-member-email-${draft.id}`}
                        type="email"
                        sizeVariant="compact"
                        busy={isSaving}
                        value={draft.email}
                        onChange={(e) => updateDraftField(draft.id, 'email', e.target.value)}
                        placeholder="guest@example.com"
                      />
                    </FormGroup>

                    <FormGroup busy={isSaving}>
                      <Label htmlFor={`roster-member-phone-${draft.id}`}>Phone (Optional)</Label>
                      <Input
                        id={`roster-member-phone-${draft.id}`}
                        type="tel"
                        sizeVariant="compact"
                        maxLength={30}
                        busy={isSaving}
                        value={draft.phone}
                        onChange={(e) => updateDraftField(draft.id, 'phone', e.target.value)}
                        placeholder="+1 555-0100"
                      />
                    </FormGroup>
                  </div>
                )}

                <FormGroup busy={isSaving}>
                  <Label htmlFor={`roster-member-dietary-${draft.id}`}>
                    Standing Allergies &amp; Dietary Notes
                  </Label>
                  <Input
                    id={`roster-member-dietary-${draft.id}`}
                    type="text"
                    sizeVariant="compact"
                    maxLength={500}
                    busy={isSaving}
                    value={draft.dietaryNotes}
                    onChange={(e) => updateDraftField(draft.id, 'dietaryNotes', e.target.value)}
                    placeholder="e.g. Severe tree nut allergy, Gluten-Free"
                  />
                </FormGroup>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCancelEdit}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              busy={isSaving}
              data-testid="save-party-roster-button"
            >
              {isSaving ? 'Saving Roster...' : 'Save Party Roster'}
            </Button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {members.map((member) => {
            const dietaryBadges = deriveMemberDietaryBadges(
              member.tags,
              member.dietaryNotes,
              member.role
            );
            const subtitle =
              member.role === 'CHILD'
                ? 'Household Dependent'
                : member.email || member.phone || 'Household Member';
            const hasStandingNote = Boolean(member.dietaryNotes && member.dietaryNotes.trim());

            return (
              <div
                key={member.id}
                data-testid={`household-member-card-${member.id}`}
                className="rounded-2xl border border-gray-200 dark:border-zinc-700 bg-gray-50 dark:bg-zinc-900/60 p-4 flex flex-col justify-between gap-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 dark:text-zinc-100 truncate">
                      {member.fullName}
                    </p>
                    <p className="text-xs text-gray-600 dark:text-zinc-300 mt-0.5 truncate">
                      {subtitle}
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
                    <span className="inline-flex items-center rounded-md bg-gray-100 dark:bg-zinc-700 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-gray-800 dark:text-zinc-100 border border-gray-200 dark:border-zinc-600">
                      {formatRoleLabel(member.role)}
                    </span>
                    {member.role === 'CHILD' && (
                      <span className="inline-flex items-center rounded-md bg-amber-100 dark:bg-amber-950/60 px-2 py-0.5 text-[11px] font-semibold text-amber-900 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                        Kids Meal
                      </span>
                    )}
                    {dietaryBadges.map((badge) => (
                      <span
                        key={badge}
                        className="inline-flex items-center rounded-md bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 text-[11px] font-semibold text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800"
                      >
                        {badge}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="border-t border-gray-200/80 dark:border-zinc-700/80 pt-2.5 text-xs">
                  <span className="font-semibold text-gray-700 dark:text-zinc-200">
                    Standing Note:{' '}
                  </span>
                  <span
                    className={
                      hasStandingNote
                        ? 'font-medium text-rose-800 dark:text-rose-200'
                        : 'text-gray-600 dark:text-zinc-300'
                    }
                  >
                    {hasStandingNote ? member.dietaryNotes : 'No dietary restrictions'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
