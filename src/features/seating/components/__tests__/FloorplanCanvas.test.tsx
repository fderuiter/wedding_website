import React from 'react';
import { render, screen } from '@testing-library/react';
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
});
