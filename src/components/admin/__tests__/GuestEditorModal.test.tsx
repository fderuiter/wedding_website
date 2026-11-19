import React from 'react';
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
});
