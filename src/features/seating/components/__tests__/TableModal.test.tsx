import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { TableModal } from '../TableModal';
import { SeatingTableDTO } from '../../schemas';

describe('TableModal component', () => {
  const mockTable: SeatingTableDTO = {
    id: 'table-1',
    name: 'Table 1 - Family',
    shape: 'round',
    capacity: 8,
    x: 100,
    y: 100,
    width: 120,
    height: 120,
    rotation: 0,
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
    });
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  test('calls onDelete when delete button is clicked and confirmed', () => {
    jest.spyOn(window, 'confirm').mockReturnValue(true);

    render(<TableModal {...defaultProps} table={mockTable} />);

    const deleteBtn = screen.getByRole('button', { name: /delete table/i });
    fireEvent.click(deleteBtn);

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining('Table 1 - Family')
    );
    expect(defaultProps.onDelete).toHaveBeenCalledWith('table-1');
    expect(defaultProps.onClose).toHaveBeenCalled();
  });
});
