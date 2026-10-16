'use client';

import React, { useState, useEffect } from 'react';
import { Dialog } from '@/components/ui/Dialog';
import { FormGroup, Label, Input, Textarea } from '@/components/ui/forms';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { apiClient } from '@/lib/apiClient';
import { useToast } from '@/components/ui/ToastProvider';
import { useGuestSession } from '@/features/registry/context/GuestSessionContext';

interface PlusOneState {
  name: string;
  attending: boolean;
  mealSelection: string;
  dietaryNotes: string;
}

interface GuestRsvpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialCode?: string;
  initialGuestName?: string;
  initialRsvpStatus?: 'attending' | 'declined' | 'pending';
  initialMealSelection?: string;
  initialDietaryNotes?: string;
  plusOneAllocations?: number;
  initialPlusOneResponses?: PlusOneState[];
  menuOptions?: string[];
}

export const GuestRsvpModal: React.FC<GuestRsvpModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialCode,
  initialGuestName,
  initialRsvpStatus = 'pending',
  initialMealSelection = '',
  initialDietaryNotes = '',
  plusOneAllocations = 0,
  initialPlusOneResponses = [],
  menuOptions = ['Beef', 'Chicken', 'Vegetarian', 'Vegan'],
}) => {
  const { addToast } = useToast();
  const session = useGuestSession();

  const code = initialCode || session.invitationCode || session.draftInvitationCode;
  const guestName = initialGuestName || session.guestName || 'Valued Guest';

  const [rsvpStatus, setRsvpStatus] = useState<'attending' | 'declined' | 'pending'>(initialRsvpStatus);
  const [mealSelection, setMealSelection] = useState<string>(initialMealSelection);
  const [dietaryNotes, setDietaryNotes] = useState<string>(initialDietaryNotes);
  const [plusOnes, setPlusOnes] = useState<PlusOneState[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setRsvpStatus(initialRsvpStatus === 'pending' ? 'attending' : initialRsvpStatus);
    setMealSelection(initialMealSelection || (menuOptions.length > 0 ? menuOptions[0] : ''));
    setDietaryNotes(initialDietaryNotes || '');

    const initializedPlusOnes: PlusOneState[] = [];
    for (let i = 0; i < plusOneAllocations; i++) {
      const existing = initialPlusOneResponses[i];
      initializedPlusOnes.push({
        name: existing?.name || `Guest ${i + 1}`,
        attending: existing?.attending ?? true,
        mealSelection: existing?.mealSelection || (menuOptions.length > 0 ? menuOptions[0] : ''),
        dietaryNotes: existing?.dietaryNotes || '',
      });
    }
    setPlusOnes(initializedPlusOnes);
  }, [isOpen, initialRsvpStatus, initialMealSelection, initialDietaryNotes, plusOneAllocations, initialPlusOneResponses, menuOptions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code) {
      setErrorMessage('Invitation code is missing.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const payload = {
        code,
        rsvpStatus,
        mealSelection: rsvpStatus === 'attending' ? mealSelection : '',
        dietaryNotes,
        plusOneResponses: rsvpStatus === 'attending' ? plusOnes.map(p => ({
          name: p.name,
          attending: p.attending,
          mealSelection: p.attending ? p.mealSelection : '',
          dietaryNotes: p.dietaryNotes,
        })) : [],
      };

      const res = await apiClient.post<{ success: boolean }>('/api/guest/rsvp', payload);

      if (res && res.success) {
        addToast('Your RSVP and meal selection have been saved!', 'success');
        if (onSuccess) onSuccess();
        onClose();
      } else {
        setErrorMessage('Failed to save RSVP. Please try again.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'An error occurred while submitting your RSVP.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={`RSVP & Meal Selection: ${guestName}`}
      description="Please confirm your attendance, select your entree, and list any food allergies or dietary notes."
    >
      <form onSubmit={handleSubmit} className="space-y-6 pt-2">
        {errorMessage && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-lg text-sm">
            {errorMessage}
          </div>
        )}

        {/* Primary Guest RSVP Section */}
        <div className="bg-gray-50 dark:bg-gray-800/60 p-4 rounded-xl space-y-4 border border-gray-100 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-gray-900 dark:text-white text-base">{guestName}</h3>
            <span className="text-xs px-2.5 py-1 bg-primary/10 text-primary font-medium rounded-full">
              Code: {code}
            </span>
          </div>

          <FormGroup>
            <Label>Will you be attending?</Label>
            <div className="grid grid-cols-2 gap-3 mt-1">
              <button
                type="button"
                onClick={() => setRsvpStatus('attending')}
                className={`p-3 rounded-xl border text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
                  rsvpStatus === 'attending'
                    ? 'border-green-500 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 shadow-sm'
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                <Icon name="Check" className={`w-4 h-4 ${rsvpStatus === 'attending' ? 'text-green-600' : 'text-gray-400'}`} />
                Joyfully Accepts
              </button>
              <button
                type="button"
                onClick={() => setRsvpStatus('declined')}
                className={`p-3 rounded-xl border text-sm font-semibold flex items-center justify-center gap-2 transition-all ${
                  rsvpStatus === 'declined'
                    ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 shadow-sm'
                    : 'border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                <Icon name="X" className={`w-4 h-4 ${rsvpStatus === 'declined' ? 'text-rose-600' : 'text-gray-400'}`} />
                Regretfully Declines
              </button>
            </div>
          </FormGroup>

          {rsvpStatus === 'attending' && (
            <>
              <FormGroup>
                <Label htmlFor="primary-meal-selection">Entrée Selection</Label>
                <select
                  id="primary-meal-selection"
                  value={mealSelection}
                  onChange={(e) => setMealSelection(e.target.value)}
                  className="w-full border border-gray-300 dark:border-gray-700 rounded-xl p-3 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-primary focus:outline-none"
                  required
                >
                  {menuOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </FormGroup>

              <FormGroup>
                <Label htmlFor="primary-dietary-notes">Dietary Restrictions & Food Allergies</Label>
                <Textarea
                  id="primary-dietary-notes"
                  placeholder="e.g. Peanut allergy, gluten-free, dairy allergy..."
                  value={dietaryNotes}
                  onChange={(e) => setDietaryNotes(e.target.value)}
                  rows={2}
                />
              </FormGroup>
            </>
          )}
        </div>

        {/* Plus-One RSVP Section */}
        {rsvpStatus === 'attending' && plusOnes.map((plusOne, idx) => (
          <div key={idx} className="bg-gray-50 dark:bg-gray-800/60 p-4 rounded-xl space-y-4 border border-gray-100 dark:border-gray-700">
            <h4 className="font-semibold text-gray-800 dark:text-gray-200 text-sm flex items-center gap-2">
              <Icon name="Users" className="w-4 h-4 text-primary" />
              Plus-One Guest {plusOnes.length > 1 ? `#${idx + 1}` : ''}
            </h4>

            <FormGroup>
              <Label htmlFor={`plusone-name-${idx}`}>Plus-One Name</Label>
              <Input
                id={`plusone-name-${idx}`}
                type="text"
                placeholder="Guest Name"
                value={plusOne.name}
                onChange={(e) => {
                  const updated = [...plusOnes];
                  updated[idx].name = e.target.value;
                  setPlusOnes(updated);
                }}
              />
            </FormGroup>

            <FormGroup>
              <Label>Attendance</Label>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    const updated = [...plusOnes];
                    updated[idx].attending = true;
                    setPlusOnes(updated);
                  }}
                  className={`p-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                    plusOne.attending
                      ? 'border-green-500 bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  <Icon name="Check" className="w-3.5 h-3.5" />
                  Attending
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const updated = [...plusOnes];
                    updated[idx].attending = false;
                    setPlusOnes(updated);
                  }}
                  className={`p-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                    !plusOne.attending
                      ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  <Icon name="X" className="w-3.5 h-3.5" />
                  Not Attending
                </button>
              </div>
            </FormGroup>

            {plusOne.attending && (
              <>
                <FormGroup>
                  <Label htmlFor={`plusone-meal-${idx}`}>Entrée Selection</Label>
                  <select
                    id={`plusone-meal-${idx}`}
                    value={plusOne.mealSelection}
                    onChange={(e) => {
                      const updated = [...plusOnes];
                      updated[idx].mealSelection = e.target.value;
                      setPlusOnes(updated);
                    }}
                    className="w-full border border-gray-300 dark:border-gray-700 rounded-xl p-2.5 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                  >
                    {menuOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </FormGroup>

                <FormGroup>
                  <Label htmlFor={`plusone-notes-${idx}`}>Dietary Restrictions & Allergies</Label>
                  <Input
                    id={`plusone-notes-${idx}`}
                    type="text"
                    placeholder="e.g. Vegetarian, nut allergy..."
                    value={plusOne.dietaryNotes}
                    onChange={(e) => {
                      const updated = [...plusOnes];
                      updated[idx].dietaryNotes = e.target.value;
                      setPlusOnes(updated);
                    }}
                  />
                </FormGroup>
              </>
            )}
          </div>
        ))}

        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Submitting...' : 'Confirm RSVP & Meal Choice'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
