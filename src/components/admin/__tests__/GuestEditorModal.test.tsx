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

  it('enforces all 17 controls, all 13 maxLength attributes, and zero jest-axe violations in both create and edit modes', async () => {
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
    expect(screen.queryByTestId('code-change-warning')).not.toBeInTheDocument();

    const createControls = createContainer.querySelectorAll('input, textarea');
    expect(createControls).toHaveLength(17);
    const createMaxLengthControls = createContainer.querySelectorAll('[maxlength]');
    expect(createMaxLengthControls).toHaveLength(13);

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
    expect(editContainer.querySelectorAll('input, textarea')).toHaveLength(17);
    expect(editContainer.querySelectorAll('[maxlength]')).toHaveLength(13);

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
});
