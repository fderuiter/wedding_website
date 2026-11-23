import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TableModal } from '../TableModal';
import { SeatingTableDTO } from '../../schemas';

describe('TableModal component', () => {
  const mockTable: SeatingTableDTO = {
    id: 'table-1',
    name: 'Table 1 - VIP',
    shape: 'round',
    capacity: 8,
    x: 150,
    y: 250,
    width: 120,
    height: 120,
    rotation: 0,
    isSample: false,
  };

  const defaultProps = {
    isOpen: true,
    table: null,
    onClose: jest.fn(),
    onSave: jest.fn(),
    onDelete: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders using Dialog with role="dialog", aria-modal="true", and matching aria-labelledby', () => {
    render(<TableModal {...defaultProps} />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();

    const heading = screen.getByText('Create New Table');
    expect(heading).toHaveAttribute('id', labelledBy);
  });

  test('renders edit title when table prop is provided', () => {
    render(<TableModal {...defaultProps} table={mockTable} />);

    expect(screen.getByText('Edit Reception Table')).toBeInTheDocument();
  });

  test('places initial focus on the Table Name input when opened', () => {
    render(<TableModal {...defaultProps} />);

    const tableNameInput = screen.getByLabelText(/table name/i);
    expect(tableNameInput).toHaveFocus();
  });

  test('closes active modal when pressing Escape key', () => {
    render(<TableModal {...defaultProps} />);

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  test('restores focus to trigger element upon modal closure', () => {
    const triggerBtn = document.createElement('button');
    triggerBtn.textContent = 'Open Modal';
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();

    expect(document.activeElement).toBe(triggerBtn);

    const { rerender } = render(<TableModal {...defaultProps} isOpen={true} />);
    expect(screen.getByLabelText(/table name/i)).toHaveFocus();

    rerender(<TableModal {...defaultProps} isOpen={false} />);
    expect(document.activeElement).toBe(triggerBtn);

    document.body.removeChild(triggerBtn);
  });

  test('renders X Position and Y Position inputs with initial coordinates', () => {
    render(<TableModal {...defaultProps} table={mockTable} />);

    const xInput = screen.getByLabelText(/X Position \(px\)/i) as HTMLInputElement;
    const yInput = screen.getByLabelText(/Y Position \(px\)/i) as HTMLInputElement;

    expect(xInput).toBeInTheDocument();
    expect(yInput).toBeInTheDocument();
    expect(xInput.value).toBe('150');
    expect(yInput.value).toBe('250');
  });

  test('submits form with table data onSave and calls onClose', () => {
    render(<TableModal {...defaultProps} />);

    const nameInput = screen.getByLabelText(/table name/i);
    fireEvent.change(nameInput, { target: { value: 'VIP Table' } });

    const submitBtn = screen.getByRole('button', { name: /create table/i });
    fireEvent.click(submitBtn);

    expect(defaultProps.onSave).toHaveBeenCalledWith({
      name: 'VIP Table',
      shape: 'round',
      capacity: 8,
      width: 120,
      height: 120,
      rotation: 0,
      x: 0,
      y: 0,
    });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  test('submits updated X and Y coordinate values on save', () => {
    render(<TableModal {...defaultProps} table={mockTable} />);

    const xInput = screen.getByLabelText(/X Position \(px\)/i);
    const yInput = screen.getByLabelText(/Y Position \(px\)/i);

    fireEvent.change(xInput, { target: { value: '300' } });
    fireEvent.change(yInput, { target: { value: '450' } });

    const saveButton = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(saveButton);

    expect(defaultProps.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'table-1',
        name: 'Table 1 - VIP',
        x: 300,
        y: 450,
      })
    );
  });

  test('calls onDelete when delete button is clicked and confirmed via alertdialog without window.confirm', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm');

    render(<TableModal {...defaultProps} table={mockTable} />);

    const deleteBtn = screen.getByRole('button', { name: /delete table/i });
    fireEvent.click(deleteBtn);

    const alertDialog = await screen.findByRole('alertdialog');
    expect(alertDialog).toHaveTextContent('Table 1 - VIP');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(defaultProps.onDelete).not.toHaveBeenCalled();

    // Cancel keeps table and modal open
    fireEvent.click(within(alertDialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(defaultProps.onDelete).not.toHaveBeenCalled();
    expect(defaultProps.onClose).not.toHaveBeenCalled();

    // Click Delete again and Confirm
    fireEvent.click(deleteBtn);
    const secondAlert = await screen.findByRole('alertdialog');
    fireEvent.click(within(secondAlert).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(defaultProps.onDelete).toHaveBeenCalledWith('table-1');
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    confirmSpy.mockRestore();
  });

  test('prompts via alertdialog when reducing table capacity below seated count and when dismissing dirty edits', async () => {
    const confirmSpy = jest.spyOn(window, 'confirm');
    const tableWithGuests = {
      ...mockTable,
      invitationCodes: [{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }, { id: 'g4' }, { id: 'g5' }, { id: 'g6' }],
    } as SeatingTableDTO & { invitationCodes: Array<{ id: string }> };

    render(<TableModal {...defaultProps} table={tableWithGuests} />);

    const capacityInput = screen.getByLabelText(/Seating Capacity/i);
    fireEvent.change(capacityInput, { target: { value: '4' } });

    // Dirty Escape prompts before discarding edits
    fireEvent.keyDown(document, { key: 'Escape' });
    const dirtyAlert = await screen.findByRole('alertdialog');
    expect(defaultProps.onClose).not.toHaveBeenCalled();
    fireEvent.click(within(dirtyAlert).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    // Submitting capacity drop below seated count prompts via alertdialog
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    const capAlert = await screen.findByRole('alertdialog');
    expect(capAlert).toHaveTextContent(/currently has 6 seated guests, which exceeds the new capacity of 4/i);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(defaultProps.onSave).not.toHaveBeenCalled();

    // Cancel aborts save
    fireEvent.click(within(capAlert).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(defaultProps.onSave).not.toHaveBeenCalled();

    // Submit again and confirm
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    const confirmCapAlert = await screen.findByRole('alertdialog');
    fireEvent.click(within(confirmCapAlert).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'table-1', capacity: 4 })
      );
      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });

    confirmSpy.mockRestore();
  });

  test('supports selecting 1-sided head and sweetheart table shapes and tracks dirty shape edits', async () => {
    const { unmount } = render(<TableModal {...defaultProps} />);

    const nameInput = screen.getByLabelText(/table name/i);
    fireEvent.change(nameInput, { target: { value: 'Sweetheart Table' } });

    const shapeSelect = screen.getByLabelText(/shape/i);
    expect(screen.getByRole('option', { name: /Head Table \(1-Sided\)/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Sweetheart \(1-Sided\)/i })).toBeInTheDocument();

    fireEvent.change(shapeSelect, { target: { value: 'sweetheart' } });
    fireEvent.click(screen.getByRole('button', { name: /create table/i }));

    expect(defaultProps.onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Sweetheart Table',
        shape: 'sweetheart',
      })
    );

    unmount();
    jest.clearAllMocks();

    render(<TableModal {...defaultProps} table={mockTable} />);
    fireEvent.change(screen.getByLabelText(/shape/i), { target: { value: 'head' } });
    fireEvent.keyDown(document, { key: 'Escape' });

    const dirtyAlert = await screen.findByRole('alertdialog');
    expect(defaultProps.onClose).not.toHaveBeenCalled();
    fireEvent.click(within(dirtyAlert).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    await waitFor(() => {
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'table-1',
          shape: 'head',
        })
      );
    });
  });

  test('warns and prompts via alertdialog when shrinking capacity from 8 to 6 repacks a guest at Seat 8 or falls below party headcount', async () => {
    const tableWithSeat8Guest: SeatingTableDTO = {
      ...mockTable,
      capacity: 8,
      invitationCodes: [
        {
          id: 'g-seat-8',
          code: 'S8',
          guestName: 'Octavia Eight',
          tableId: 'table-1',
          seatNumber: 8,
          plusOneAllocations: 0,
        } as unknown as NonNullable<SeatingTableDTO['invitationCodes']>[number],
      ],
    };

    const { unmount } = render(<TableModal {...defaultProps} table={tableWithSeat8Guest} />);

    // Lower capacity from 8 to 6 (headcount is 1 <= 6, but Seat 8 > 6 will be repacked)
    const capInput = screen.getByLabelText(/Seating Capacity/i);
    fireEvent.change(capInput, { target: { value: '6' } });

    const warning = screen.getByTestId('capacity-warning');
    expect(warning).toHaveTextContent(/repack Seat 8 into seats 1–6/i);

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    const repackDialog = await screen.findByRole('alertdialog');
    expect(repackDialog).toHaveTextContent(/repack Seat 8 into seats 1–6/i);

    fireEvent.click(within(repackDialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'table-1', capacity: 6 })
      );
    });

    unmount();
    jest.clearAllMocks();

    // Party headcount check: 3 couples = 6 attendees on an 8-seat table lowered to capacity 4
    const tableWithThreeCouples: SeatingTableDTO = {
      ...mockTable,
      capacity: 8,
      invitationCodes: [1, 2, 3].map((idx) => ({
        id: `couple-${idx}`,
        code: `CPL-${idx}`,
        guestName: `Couple ${idx}`,
        tableId: 'table-1',
        seatNumber: idx * 2 - 1,
        plusOneAllocations: 1,
      })) as unknown as NonNullable<SeatingTableDTO['invitationCodes']>,
    };

    render(<TableModal {...defaultProps} table={tableWithThreeCouples} />);
    fireEvent.change(screen.getByLabelText(/Seating Capacity/i), { target: { value: '4' } });
    expect(screen.getByTestId('capacity-warning')).toHaveTextContent(/Table has 6 seated guests/i);
  });
});
