import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { axe } from 'jest-axe';
import { GuestEditorModal } from '../GuestEditorModal';
import type { InvitationCodeDTO } from '@/features/registry';

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
