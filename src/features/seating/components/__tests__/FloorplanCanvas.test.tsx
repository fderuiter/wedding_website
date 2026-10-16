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
    onAddTable: jest.fn(),
  };

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
    const assignedSeat = screen.getByTitle(/Seat 1: John Doe/).closest('div') as HTMLElement;
    expect(assignedSeat.style.backgroundColor).toBe('var(--floorplan-seat-assigned-bg, var(--color-primary, #B91C1C))');
    expect(assignedSeat.style.color).toBe('var(--floorplan-seat-assigned-text, #ffffff)');

    // Unassigned seat circle for Seat 2 on Head Table
    const unassignedSeat = screen.getByTitle(/Seat 2: Empty/).closest('div') as HTMLElement;
    expect(unassignedSeat.style.backgroundColor).toBe('var(--floorplan-table-bg, #ffffff)');
    expect(unassignedSeat.className).toContain('hover:bg-[var(--floorplan-seat-unassigned-hover,#fef2f2)]');
  });

  it('applies ring-4 ring-primary and border-primary visual feedback when hovering dragged guest over a table', () => {
    render(<FloorplanCanvas {...defaultProps} />);

    const tableOuterDiv = screen.getByRole('button', { name: /Head Table/i });
    fireEvent.dragEnter(tableOuterDiv, {
      dataTransfer: { types: ['text/plain'] },
    });

    expect(tableOuterDiv.className).toContain('ring-4 ring-primary');
    expect(tableOuterDiv.className).toContain('border-primary');
  });

  it('applies scale-125 bg-primary/20 border-primary feedback when hovering dragged guest over an individual seat', () => {
    render(<FloorplanCanvas {...defaultProps} />);

    const unassignedSeat = screen.getByTitle(/Seat 2: Empty/).closest('div') as HTMLElement;
    fireEvent.dragEnter(unassignedSeat, {
      dataTransfer: { types: ['text/plain'] },
    });

    expect(unassignedSeat.className).toContain('scale-125');
    expect(unassignedSeat.className).toContain('bg-primary/20');
    expect(unassignedSeat.className).toContain('border-primary');
  });

  it('resets active drop target state when leaving or ending drag gesture', () => {
    render(<FloorplanCanvas {...defaultProps} />);

    const tableOuterDiv = screen.getByRole('button', { name: /Head Table/i });
    fireEvent.dragEnter(tableOuterDiv, {
      dataTransfer: { types: ['text/plain'] },
    });
    expect(tableOuterDiv.className).toContain('ring-4 ring-primary');

    fireEvent.dragLeave(tableOuterDiv, {
      relatedTarget: document.body,
    });
    expect(tableOuterDiv.className).not.toContain('border-primary shadow-xl shadow-primary/20');
  });

  it('displays zero-state UI containing empty floorplan icon, setup copy, and Add First Table button when tables is empty', () => {
    render(<FloorplanCanvas {...defaultProps} tables={[]} />);

    expect(screen.getByTestId('empty-floorplan-icon')).toBeInTheDocument();
    expect(screen.getByText('No Tables Created Yet')).toBeInTheDocument();
    expect(screen.getByText(/Get started by adding your first reception table/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add First Table/i })).toBeInTheDocument();
  });

  it('invokes onAddTable callback when clicking Add First Table button in zero state view', () => {
    const onAddTableMock = jest.fn();
    render(<FloorplanCanvas {...defaultProps} tables={[]} onAddTable={onAddTableMock} />);

    const addFirstTableBtn = screen.getByRole('button', { name: /Add First Table/i });
    fireEvent.click(addFirstTableBtn);

    expect(onAddTableMock).toHaveBeenCalledTimes(1);
  });

  describe('Keyboard accessibility', () => {
    it('includes focus ring classes on table containers and seat circles', () => {
      render(<FloorplanCanvas {...defaultProps} />);

      const headTableContainer = screen.getByLabelText(/Head Table/i);
      expect(headTableContainer.className).toContain('focus:outline-none');
      expect(headTableContainer.className).toContain('focus:ring-2');
      expect(headTableContainer.className).toContain('focus:ring-primary');

      const seat1 = screen.getByLabelText('Seat 1: John Doe');
      expect(seat1.className).toContain('focus:outline-none');
      expect(seat1.className).toContain('focus:ring-2');
      expect(seat1.className).toContain('focus:ring-primary');
    });

    it('selects a table when Enter or Space key is pressed', () => {
      const onSelectTable = jest.fn();
      render(<FloorplanCanvas {...defaultProps} onSelectTable={onSelectTable} />);

      const headTable = screen.getByLabelText(/Head Table/i);

      fireEvent.keyDown(headTable, { key: 'Enter' });
      expect(onSelectTable).toHaveBeenCalledWith('table-1');

      fireEvent.keyDown(headTable, { key: ' ' });
      expect(onSelectTable).toHaveBeenCalledWith('table-1');
    });

    it('moves table position in 10px steps on Arrow keys', () => {
      const onUpdateTablePosition = jest.fn();
      render(<FloorplanCanvas {...defaultProps} onUpdateTablePosition={onUpdateTablePosition} />);

      const headTable = screen.getByLabelText(/Head Table/i); // initial x: 100, y: 100

      fireEvent.keyDown(headTable, { key: 'ArrowRight' });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-1', 110, 100);

      fireEvent.keyDown(headTable, { key: 'ArrowLeft' });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-1', 90, 100);

      fireEvent.keyDown(headTable, { key: 'ArrowDown' });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-1', 100, 110);

      fireEvent.keyDown(headTable, { key: 'ArrowUp' });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-1', 100, 90);
    });

    it('moves table position in 50px steps when holding Shift with Arrow keys', () => {
      const onUpdateTablePosition = jest.fn();
      render(<FloorplanCanvas {...defaultProps} onUpdateTablePosition={onUpdateTablePosition} />);

      const headTable = screen.getByLabelText(/Head Table/i);

      fireEvent.keyDown(headTable, { key: 'ArrowRight', shiftKey: true });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-1', 150, 100);

      fireEvent.keyDown(headTable, { key: 'ArrowUp', shiftKey: true });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-1', 100, 50);
    });

    it('clamps table position within canvas boundaries when moving via Arrow keys', () => {
      const edgeTable: SeatingTableDTO = {
        id: 'table-edge',
        name: 'Edge Table',
        shape: 'rectangle',
        capacity: 2,
        x: 5,
        y: 5,
        width: 120,
        height: 120,
      };

      const onUpdateTablePosition = jest.fn();
      render(<FloorplanCanvas {...defaultProps} tables={[edgeTable]} onUpdateTablePosition={onUpdateTablePosition} />);

      const tableElement = screen.getByLabelText(/Edge Table/i);

      // Moving left by 10px from x=5 should clamp to 0
      fireEvent.keyDown(tableElement, { key: 'ArrowLeft' });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-edge', 0, 5);

      // Moving up by 10px from y=5 should clamp to 0
      fireEvent.keyDown(tableElement, { key: 'ArrowUp' });
      expect(onUpdateTablePosition).toHaveBeenCalledWith('table-edge', 5, 0);
    });

    it('renders seat elements with correct tabIndex, role, and aria-labels', () => {
      render(<FloorplanCanvas {...defaultProps} />);

      const assignedSeat = screen.getByLabelText('Seat 1: John Doe');
      expect(assignedSeat).toHaveAttribute('tabIndex', '0');
      expect(assignedSeat).toHaveAttribute('role', 'button');

      const emptySeat = screen.getByLabelText('Seat 2: Empty');
      expect(emptySeat).toHaveAttribute('tabIndex', '0');
      expect(emptySeat).toHaveAttribute('role', 'button');
    });

    it('unassigns guest when Delete or Backspace key is pressed on focused assigned seat', () => {
      const onUnassignGuest = jest.fn();
      render(<FloorplanCanvas {...defaultProps} onUnassignGuest={onUnassignGuest} />);

      const assignedSeat = screen.getByLabelText('Seat 1: John Doe');

      fireEvent.keyDown(assignedSeat, { key: 'Delete' });
      expect(onUnassignGuest).toHaveBeenCalledWith('guest-1');

      fireEvent.keyDown(assignedSeat, { key: 'Backspace' });
      expect(onUnassignGuest).toHaveBeenCalledWith('guest-1');
    });

    it('stops event propagation on seat keydown to prevent table handler trigger', () => {
      const onSelectTable = jest.fn();
      const onUnassignGuest = jest.fn();
      render(
        <FloorplanCanvas
          {...defaultProps}
          onSelectTable={onSelectTable}
          onUnassignGuest={onUnassignGuest}
        />
      );

      const assignedSeat = screen.getByLabelText('Seat 1: John Doe');
      fireEvent.keyDown(assignedSeat, { key: 'Enter' });

      expect(onSelectTable).not.toHaveBeenCalled();
    });
  });
});

