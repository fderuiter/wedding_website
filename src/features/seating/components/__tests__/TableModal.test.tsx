import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
  };

  const defaultProps = {
    isOpen: true,
    table: mockTable,
    onClose: jest.fn(),
    onSave: jest.fn(),
    onDelete: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders X Position and Y Position inputs with initial coordinates', () => {
    render(<TableModal {...defaultProps} />);

    const xInput = screen.getByLabelText(/X Position \(px\)/i) as HTMLInputElement;
    const yInput = screen.getByLabelText(/Y Position \(px\)/i) as HTMLInputElement;

    expect(xInput).toBeInTheDocument();
    expect(yInput).toBeInTheDocument();
    expect(xInput.value).toBe('150');
    expect(yInput.value).toBe('250');
  });

  it('submits updated X and Y coordinate values on save', () => {
    render(<TableModal {...defaultProps} />);

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
});
