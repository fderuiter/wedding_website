import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { FloorplanCanvas } from '../FloorplanCanvas';
import { SeatingTableDTO } from '../../schemas';
import { InvitationCodeDTO } from '@/features/registry';

describe('FloorplanCanvas component', () => {
  const mockTables: SeatingTableDTO[] = [
    {
      id: 'table-1',
      name: 'Head Table',
      shape: 'rectangle',
      capacity: 2,
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      invitationCodes: [
        {
          id: 'guest-1',
          code: 'CODE1',
          guestName: 'John Doe',
          tableId: 'table-1',
          seatNumber: 1,
        } as InvitationCodeDTO,
      ],
    },
    {
      id: 'table-2',
      name: 'Overcapacity Table',
      shape: 'round',
      capacity: 1,
      x: 300,
      y: 100,
      invitationCodes: [
        {
          id: 'guest-2',
          code: 'CODE2',
          guestName: 'Alice Smith',
          tableId: 'table-2',
          seatNumber: 1,
        } as InvitationCodeDTO,
        {
          id: 'guest-3',
          code: 'CODE3',
          guestName: 'Bob Jones',
          tableId: 'table-2',
          seatNumber: 2,
        } as InvitationCodeDTO,
      ],
    },
  ];

  const defaultProps = {
    tables: mockTables,
    selectedTableId: null,
    onSelectTable: jest.fn(),
    onUpdateTablePosition: jest.fn(),
    onDropGuestOnTable: jest.fn(),
    onUnassignGuest: jest.fn(),
    onOpenSeatAssignModal: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders canvas container with theme preset background, border, and grid dot variables', () => {
    const { container } = render(<FloorplanCanvas {...defaultProps} />);
    const canvasElement = container.firstElementChild as HTMLElement;

    expect(canvasElement).toBeInTheDocument();
    expect(canvasElement.style.backgroundColor).toBe('var(--canvas-bg, #f8fafc)');
    expect(canvasElement.style.border).toBe('var(--canvas-border, 2px dashed #cbd5e1)');
    expect(canvasElement.style.backgroundImage).toBe('radial-gradient(circle, var(--canvas-grid-dot, #cbd5e1) 1px, transparent 1px)');
  });

  it('binds table surface container styles to floorplan table tokens', () => {
    render(<FloorplanCanvas {...defaultProps} />);

    const headTableElement = screen.getByText('Head Table').closest('div') as HTMLElement;
    expect(headTableElement.style.backgroundColor).toBe('var(--floorplan-table-bg, #ffffff)');
    expect(headTableElement.style.borderColor).toBe('var(--floorplan-table-border, #d1d5db)');
    expect(headTableElement.style.borderRadius).toBe('var(--floorplan-table-radius, 0.75rem)');
  });

  it('binds overcapacity table surface styles to status alert tokens', () => {
    render(<FloorplanCanvas {...defaultProps} />);

    const overcapacityTableElement = screen.getByText('Overcapacity Table').closest('div') as HTMLElement;
    expect(overcapacityTableElement.style.backgroundColor).toBe('var(--floorplan-status-overcapacity-bg, #fef2f2)');
    expect(overcapacityTableElement.style.borderColor).toBe('var(--floorplan-status-overcapacity-border, #ef4444)');
    expect(screen.getByText('Over capacity!')).toBeInTheDocument();
  });

  it('binds assigned and unassigned seats to theme preset variables', () => {
    render(<FloorplanCanvas {...defaultProps} />);

    // Assigned seat circle for Seat 1 on Head Table
    const assignedSeat = screen.getByTitle(/Seat 1: John Doe/).closest('button, div') as HTMLElement;
    expect(assignedSeat.style.backgroundColor).toBe('var(--floorplan-seat-assigned-bg, var(--color-primary, #B91C1C))');
    expect(assignedSeat.style.color).toBe('var(--floorplan-seat-assigned-text, #ffffff)');

    // Unassigned seat circle for Seat 2 on Head Table
    const unassignedSeat = screen.getByTitle(/Seat 2: Empty/).closest('button, div') as HTMLElement;
    expect(unassignedSeat.style.backgroundColor).toBe('var(--floorplan-table-bg, #ffffff)');
    expect(unassignedSeat.className).toContain('hover:bg-[var(--floorplan-seat-unassigned-hover,#fef2f2)]');
  });

  it('repositions table when arrow keys are pressed', () => {
    render(<FloorplanCanvas {...defaultProps} />);

    const headTableContainer = screen.getByRole('button', { name: /^Head Table,/i });
    headTableContainer.focus();

    // ArrowRight without shift -> moves +2px
    fireEvent.keyDown(headTableContainer, { key: 'ArrowRight' });
    expect(defaultProps.onUpdateTablePosition).toHaveBeenCalledWith('table-1', 102, 100);

    // ArrowRight with shift -> moves +10px
    fireEvent.keyDown(headTableContainer, { key: 'ArrowRight', shiftKey: true });
    expect(defaultProps.onUpdateTablePosition).toHaveBeenCalledWith('table-1', 110, 100);

    // ArrowDown without shift -> moves +2px in Y
    fireEvent.keyDown(headTableContainer, { key: 'ArrowDown' });
    expect(defaultProps.onUpdateTablePosition).toHaveBeenCalledWith('table-1', 100, 102);

    // ArrowUp -> moves -2px in Y
    fireEvent.keyDown(headTableContainer, { key: 'ArrowUp' });
    expect(defaultProps.onUpdateTablePosition).toHaveBeenCalledWith('table-1', 100, 98);
  });

  it('selects table on Enter or Space keypress', () => {
    render(<FloorplanCanvas {...defaultProps} />);

    const headTableContainer = screen.getByRole('button', { name: /^Head Table,/i });
    fireEvent.keyDown(headTableContainer, { key: 'Enter' });
    expect(defaultProps.onSelectTable).toHaveBeenCalledWith('table-1');

    fireEvent.keyDown(headTableContainer, { key: ' ' });
    expect(defaultProps.onSelectTable).toHaveBeenCalledWith('table-1');
  });

  it('renders seat buttons with descriptive aria-label and handles keydown unassignment / assignment', () => {
    render(<FloorplanCanvas {...defaultProps} />);

    const occupiedSeat = screen.getByLabelText(/Seat 1 of Head Table: John Doe/i);
    expect(occupiedSeat.tagName.toLowerCase()).toBe('button');
    expect(occupiedSeat).toHaveAttribute('tabIndex', '0');

    // Pressing Enter or Delete on occupied seat triggers unassign
    fireEvent.keyDown(occupiedSeat, { key: 'Enter' });
    expect(defaultProps.onUnassignGuest).toHaveBeenCalledWith('guest-1');

    fireEvent.keyDown(occupiedSeat, { key: 'Delete' });
    expect(defaultProps.onUnassignGuest).toHaveBeenCalledWith('guest-1');

    const emptySeat = screen.getByLabelText(/Seat 2 of Head Table: Empty/i);
    expect(emptySeat.tagName.toLowerCase()).toBe('button');

    // Pressing Enter on empty seat triggers open seat assign modal
    fireEvent.keyDown(emptySeat, { key: 'Enter' });
    expect(defaultProps.onOpenSeatAssignModal).toHaveBeenCalledWith('table-1', 2);
  });
});
