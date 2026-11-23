import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';
import { GuestEditorForm, GuestEditorModal } from '../GuestEditorModal';
import type { InvitationCodeDTO } from '@/features/registry';
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
} from '@/utils/invitationValidation';

const sampleGuest: InvitationCodeDTO = {
  id: 'guest-1',
  code: 'WEDDING100',
  guestName: 'Clara Oswald',
  email: 'clara@example.com',
  householdName: 'Oswald Household',
  partyGroup: 'Friends',
  partyTags: ['VIP', 'Out of Town'],
  plusOneAllocations: 1,
  plusOneFirstName: 'Danny',
  plusOneLastName: 'Pink',
  dietaryNotes: 'Vegetarian',
  addressLine1: '10 Downing St',
  addressLine2: 'Flat 2',
  city: 'London',
  state: 'LDN',
  zipCode: 'SW1A 2AA',
  country: 'UK',
  used: true,
  tableId: 'table-1',
  seatNumber: 3,
  isSample: false,
};

describe('GuestEditorModal', () => {
  it('passes automated jest-axe accessibility checks when open', async () => {
    const { baseElement } = render(
      <GuestEditorModal
        isOpen={true}
        onClose={jest.fn()}
        guest={sampleGuest}
        onSave={jest.fn().mockResolvedValue({})}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Edit Guest Details' })).toBeInTheDocument();
    const results = await axe(baseElement);
    expect(results).toHaveNoViolations();
  });

  it('normalizes deduplicated tags, cleared nullable fields, and surfaces server errors', async () => {
    const onSave = jest
      .fn()
      .mockRejectedValueOnce(new Error('Invitation code "TAKEN100" is already in use.'))
      .mockResolvedValueOnce({});
    const onClose = jest.fn();

    render(
      <GuestEditorModal
        isOpen={true}
        onClose={onClose}
        guest={sampleGuest}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText('Invitation Code *'), {
      target: { value: 'taken100' },
    });
    expect(screen.getByTestId('code-change-warning')).toHaveTextContent('WEDDING100');

    fireEvent.change(screen.getByLabelText('Party Tags (Comma-Separated)'), {
      target: { value: ' VIP , Bridal , VIP ' },
    });
    fireEvent.change(screen.getByLabelText('Address Line 2'), {
      target: { value: '   ' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Save Guest Changes' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Invitation code "TAKEN100" is already in use.'
      );
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Invitation Code *'), {
      target: { value: 'clara200' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Guest Changes' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenLastCalledWith(
        'guest-1',
        expect.objectContaining({
          code: 'CLARA200',
          addressLine2: null,
          partyTags: ['VIP', 'Bridal'],
        })
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('closes immediately when clean and prompts via alertdialog before discarding dirty edits', async () => {
    const onClose = jest.fn();

    render(
      <GuestEditorModal
        isOpen={true}
        onClose={onClose}
        guest={sampleGuest}
        onSave={jest.fn().mockResolvedValue({})}
      />
    );

    // Clean Escape closes immediately without confirmation
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    onClose.mockClear();

    // Make dirty edit
    const nameInput = screen.getByLabelText('Guest Name *') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Clara Oswald-Pink' } });

    // Escape on dirty modal opens confirmation alertdialog
    fireEvent.keyDown(document, { key: 'Escape' });
    const escapeAlert = await screen.findByRole('alertdialog');
    expect(onClose).not.toHaveBeenCalled();

    // Cancel keeps modal open and preserves draft
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Cancel' }).find((btn) => escapeAlert.contains(btn))!
    );
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(nameInput.value).toBe('Clara Oswald-Pink');
    expect(onClose).not.toHaveBeenCalled();

    // Outside mousedown also prompts and Cancel keeps draft
    fireEvent.mouseDown(document.body);
    const outsideAlert = await screen.findByRole('alertdialog');
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Cancel' }).find((btn) => outsideAlert.contains(btn))!
    );
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(onClose).not.toHaveBeenCalled();

    // Clicking modal Cancel button prompts and Confirm closes modal
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const cancelAlert = await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(cancelAlert).not.toBeInTheDocument();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('validates phone format and saves extraFields.phone while preserving custom CSV and RSVP extraFields keys', async () => {
    const onSave = jest.fn().mockResolvedValue({});
    const onClose = jest.fn();
    const guestWithExtra: InvitationCodeDTO = {
      ...sampleGuest,
      extraFields: {
        attendanceStatus: 'attending',
        mealChoice: 'salmon',
        csvSourceColumn: 'vip_import',
      },
    };

    render(
      <GuestEditorModal
        isOpen={true}
        onClose={onClose}
        guest={guestWithExtra}
        onSave={onSave}
      />
    );

    const phoneInput = screen.getByLabelText('Phone');
    fireEvent.change(phoneInput, { target: { value: 'invalid-phone!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Guest Changes' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Invalid phone number format.');
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.change(phoneInput, { target: { value: '+1 (555) 234-5678' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Guest Changes' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        'guest-1',
        expect.objectContaining({
          extraFields: {
            attendanceStatus: 'attending',
            mealChoice: 'salmon',
            csvSourceColumn: 'vip_import',
            phone: '+15552345678',
          },
        })
      );
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('loads admin RSVP details, saves per-event RSVP status, plus-ones, meal selections, and custom questions, supports Clear RSVP Responses, and passes jest-axe', async () => {
    const originalFetch = global.fetch;
    const onRsvpUpdated = jest.fn();

    const mockRsvpDetail = {
      invitationCode: sampleGuest,
      subEvents: [
        {
          id: 'se-rec',
          title: 'Reception Dinner',
          isPrivate: false,
          hasAccess: true,
          mealOptions: [
            { id: 'meal-veg', label: 'Wild Mushroom Risotto', dietaryTags: ['vegetarian'] },
            { id: 'meal-fish', label: 'Halibut', dietaryTags: [] },
          ],
          customQuestions: [
            {
              id: 'q-shuttle',
              prompt: 'Need hotel shuttle?',
              type: 'choice',
              required: true,
              options: ['Yes', 'No'],
            },
            {
              id: 'q-song',
              prompt: 'Favorite dance song',
              type: 'text',
              required: false,
              options: [],
            },
          ],
        },
      ],
      rsvps: [],
    };

    global.fetch = jest.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.startsWith('/api/admin/invitation-codes/rsvps') && (!init?.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: mockRsvpDetail }),
        } as Response);
      }
      if (url === '/api/admin/invitation-codes/rsvps' && init?.method === 'PUT') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: mockRsvpDetail,
            }),
        } as Response);
      }
      return Promise.resolve({ ok: false } as Response);
    }) as any;

    try {
      const { baseElement } = render(
        <GuestEditorModal
          isOpen={true}
          onClose={jest.fn()}
          guest={sampleGuest}
          onSave={jest.fn().mockResolvedValue({})}
          onRsvpUpdated={onRsvpUpdated}
        />
      );

      // Wait for RSVP override panel to finish loading
      const statusSelect = await screen.findByLabelText('RSVP status for Reception Dinner');
      fireEvent.change(statusSelect, { target: { value: 'attending' } });

      // Configure +1 attending count & companion name
      const plusOneCountInput = screen.getByLabelText('Attending plus-ones for Reception Dinner');
      fireEvent.change(plusOneCountInput, { target: { value: '1' } });

      const companionInput = screen.getByLabelText('Plus-one 1 name for Reception Dinner');
      fireEvent.change(companionInput, { target: { value: 'Danny Pink' } });

      // Select meals for primary guest and +1
      fireEvent.change(
        screen.getByLabelText('Meal selection for primary guest (Reception Dinner)'),
        { target: { value: 'meal-veg' } }
      );
      fireEvent.change(
        screen.getByLabelText('Meal selection for plus-one 1 (Reception Dinner)'),
        { target: { value: 'meal-fish' } }
      );

      // Answer custom questions
      fireEvent.change(screen.getByLabelText('Need hotel shuttle? (Reception Dinner)'), {
        target: { value: 'Yes' },
      });
      fireEvent.change(screen.getByLabelText('Favorite dance song (Reception Dinner)'), {
        target: { value: 'Do You Love Me' },
      });

      const axeResults = await axe(baseElement);
      expect(axeResults).toHaveNoViolations();

      fireEvent.click(screen.getByRole('button', { name: 'Save Guest Changes' }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/admin/invitation-codes/rsvps',
          expect.objectContaining({
            method: 'PUT',
            body: expect.stringContaining('"meal-veg"'),
          })
        );
        expect(onRsvpUpdated).toHaveBeenCalledTimes(1);
      });

      // Clear all RSVPs and submit
      fireEvent.click(screen.getByRole('button', { name: 'Clear RSVP Responses' }));
      expect(screen.getByTestId('rsvp-clear-pending-banner')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Save Guest Changes' }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          '/api/admin/invitation-codes/rsvps',
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({
              invitationCodeId: 'guest-1',
              clearAll: true,
            }),
          })
        );
        expect(onRsvpUpdated).toHaveBeenCalledTimes(2);
      });
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('GuestEditorForm', () => {
  const expectedMaxLengths: Array<[string, number]> = [
    ['Guest Name *', GUEST_NAME_MAX_LENGTH],
    ['Phone', PHONE_MAX_LENGTH],
    ['Plus-One First Name', PLUS_ONE_NAME_MAX_LENGTH],
    ['Plus-One Last Name', PLUS_ONE_NAME_MAX_LENGTH],
    ['Household Name', HOUSEHOLD_NAME_MAX_LENGTH],
    ['Party Group', PARTY_GROUP_MAX_LENGTH],
    ['Address Line 1', ADDRESS_LINE_MAX_LENGTH],
    ['Address Line 2', ADDRESS_LINE_MAX_LENGTH],
    ['City', CITY_MAX_LENGTH],
    ['State / Province', STATE_MAX_LENGTH],
    ['Zip / Postal Code', ZIP_CODE_MAX_LENGTH],
    ['Country', COUNTRY_MAX_LENGTH],
  ];

  it('enforces all 18 controls, all 14 maxLength attributes, and zero jest-axe violations in both create and edit modes', async () => {
    const { container: createContainer, unmount: unmountCreate } = render(
      <GuestEditorForm
        mode="create"
        actionsAlign="start"
        onClose={jest.fn()}
        onCreate={jest.fn().mockResolvedValue({})}
      />
    );

    expect(
      screen.getByLabelText('Invitation Code (Optional - auto-generated if blank)')
    ).toHaveAttribute('maxLength', String(INVITATION_CODE_MAX_LENGTH));
    expect(
      screen.getByLabelText('Invitation Code (Optional - auto-generated if blank)')
    ).not.toBeRequired();
    for (const [label, max] of expectedMaxLengths) {
      expect(screen.getByLabelText(label)).toHaveAttribute('maxLength', String(max));
    }
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Plus-One Allocations')).toBeInTheDocument();
    expect(screen.getByLabelText('Party Tags (Comma-Separated)')).toBeInTheDocument();
    expect(screen.getByLabelText('Dietary Notes')).toBeInTheDocument();
    expect(screen.getByLabelText('Household Notes')).toHaveAttribute('maxLength', '1000');
    expect(screen.queryByTestId('code-change-warning')).not.toBeInTheDocument();

    const createControls = createContainer.querySelectorAll('input, textarea');
    expect(createControls).toHaveLength(18);
    const createMaxLengthControls = createContainer.querySelectorAll('[maxlength]');
    expect(createMaxLengthControls).toHaveLength(14);

    const createAxe = await axe(createContainer);
    expect(createAxe).toHaveNoViolations();
    unmountCreate();

    const { container: editContainer } = render(
      <GuestEditorForm
        mode="edit"
        guest={sampleGuest}
        onClose={jest.fn()}
        onSave={jest.fn().mockResolvedValue({})}
      />
    );

    expect(screen.getByLabelText('Invitation Code *')).toHaveAttribute(
      'maxLength',
      String(INVITATION_CODE_MAX_LENGTH)
    );
    expect(screen.getByLabelText('Invitation Code *')).toBeRequired();
    for (const [label, max] of expectedMaxLengths) {
      expect(screen.getByLabelText(label)).toHaveAttribute('maxLength', String(max));
    }
    expect(editContainer.querySelectorAll('input, textarea')).toHaveLength(18);
    expect(editContainer.querySelectorAll('[maxlength]')).toHaveLength(14);

    const editAxe = await axe(editContainer);
    expect(editAxe).toHaveNoViolations();
  });

  it('displays role="alert" messages on row validation errors and omits blank code while deduplicating tags in create mode', async () => {
    const onCreate = jest
      .fn()
      .mockRejectedValueOnce(new Error('Invitation code collision.'))
      .mockResolvedValueOnce({});
    const onClose = jest.fn();

    render(
      <GuestEditorForm
        mode="create"
        onClose={onClose}
        onCreate={onCreate}
      />
    );

    // Blank guest name
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Guest name is required.');

    // Invalid plusOneAllocations
    fireEvent.change(screen.getByLabelText('Guest Name *'), {
      target: { value: 'Martha Jones' },
    });
    fireEvent.change(screen.getByLabelText('Plus-One Allocations'), {
      target: { value: '-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Plus-one allocations must be a non-negative whole number.'
    );

    // Invalid email via validateInvitationGuestFields in row mode
    fireEvent.change(screen.getByLabelText('Plus-One Allocations'), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email format.');
    expect(onCreate).not.toHaveBeenCalled();

    // Valid sparse submission with whitespace code and duplicate tags; first call rejects
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: '   ' },
    });
    fireEvent.change(
      screen.getByLabelText('Invitation Code (Optional - auto-generated if blank)'),
      { target: { value: '   ' } }
    );
    fireEvent.change(screen.getByLabelText('Party Tags (Comma-Separated)'), {
      target: { value: ' UNIT , Doctor , UNIT ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Invitation code collision.');
    });
    expect(onClose).not.toHaveBeenCalled();

    // Retry succeeds and closes
    fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await waitFor(() => {
      expect(onCreate).toHaveBeenLastCalledWith({
        guestName: 'Martha Jones',
        used: false,
        partyTags: ['UNIT', 'Doctor'],
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('guards dirty Cancel in standalone create mode via useDirtyConfirmClose', async () => {
    const onClose = jest.fn();

    render(
      <GuestEditorForm
        mode="create"
        onClose={onClose}
        onCreate={jest.fn().mockResolvedValue({})}
      />
    );

    // Clean Cancel closes immediately
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    onClose.mockClear();

    // Dirty Cancel opens confirmation dialog
    fireEvent.change(screen.getByLabelText('Guest Name *'), {
      target: { value: 'Donna Noble' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const confirmDialog = await screen.findByRole('alertdialog');
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(confirmDialog).not.toBeInTheDocument();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('loads and saves Household Notes in extraFields.householdNotes separately from dietaryNotes', async () => {
    const onSave = jest.fn().mockResolvedValue({});
    render(
      <GuestEditorForm
        mode="edit"
        guest={{
          ...sampleGuest,
          dietaryNotes: 'Nut allergy',
          extraFields: { phone: '+15551234567', householdNotes: 'Bringing infant stroller' },
        }}
        onClose={jest.fn()}
        onSave={onSave}
      />
    );

    const householdInput = screen.getByLabelText('Household Notes');
    expect(householdInput).toHaveValue('Bringing infant stroller');
    expect(screen.getByLabelText('Dietary Notes')).toHaveValue('Nut allergy');

    fireEvent.change(householdInput, {
      target: { value: 'Updated: arriving Friday evening' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Guest Changes' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        sampleGuest.id,
        expect.objectContaining({
          dietaryNotes: 'Nut allergy',
          extraFields: expect.objectContaining({
            phone: '+15551234567',
            householdNotes: 'Updated: arriving Friday evening',
          }),
        })
      );
    });
  });

  it('loads legacy phoneNumber and Phone Number extraFields keys and normalizes them into extraFields.phone on save', async () => {
    const onClose = jest.fn();
    const onSave = jest.fn().mockResolvedValue(undefined);

    const { unmount } = render(
      <GuestEditorModal
        isOpen={true}
        guest={{
          ...sampleGuest,
          extraFields: {
            'Phone Number': "'+15557654321",
            phoneNumber: '+15550000000',
            attendanceStatus: 'attending',
          },
        }}
        onClose={onClose}
        onSave={onSave}
      />
    );

    const phoneInput = screen.getByLabelText('Phone') as HTMLInputElement;
    expect(phoneInput.value).toBe('+15550000000');

    fireEvent.change(phoneInput, { target: { value: '+1 (555) 888-9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Guest Changes' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        'guest-1',
        expect.objectContaining({
          extraFields: {
            attendanceStatus: 'attending',
            phone: '+15558889999',
          },
        })
      );
    });

    unmount();
  });
});
