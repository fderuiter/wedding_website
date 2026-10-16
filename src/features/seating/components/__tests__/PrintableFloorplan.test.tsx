import React from 'react';
import { render, screen } from '@testing-library/react';
import { PrintableFloorplan } from '../PrintableFloorplan';
import { SeatingTableDTO } from '../../schemas';
import { InvitationCodeDTO } from '@/features/registry/schemas';

describe('PrintableFloorplan component', () => {
  const mockTables: SeatingTableDTO[] = [
    {
      id: 'table-1',
      name: 'Head Table',
      shape: 'rectangle',
      capacity: 8,
      x: 100,
      y: 100,
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
      name: 'Family Table',
      shape: 'round',
      capacity: 10,
      x: 300,
      y: 100,
      invitationCodes: [],
    },
  ];

  const mockUnassignedGuests: InvitationCodeDTO[] = [
    {
      id: 'guest-2',
      code: 'CODE2',
      guestName: 'Jane Smith',
    } as InvitationCodeDTO,
  ];

  it('renders reception seating roster heading and table breakdown', () => {
    render(<PrintableFloorplan tables={mockTables} unassignedGuests={mockUnassignedGuests} />);

    expect(screen.getByText('Reception Seating Roster & Floorplan')).toBeInTheDocument();
    expect(screen.getByText('Head Table')).toBeInTheDocument();
    expect(screen.getByText('Family Table')).toBeInTheDocument();
    expect(screen.getByText(/John Doe/)).toBeInTheDocument();
    expect(screen.getByText('No guests assigned to this table.')).toBeInTheDocument();
    expect(screen.getByText(/Unassigned Guests \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('binds element inline styles to print CSS custom properties', () => {
    const { container } = render(
      <PrintableFloorplan tables={mockTables} unassignedGuests={mockUnassignedGuests} />
    );

    const rootContainer = container.firstElementChild as HTMLElement;
    expect(rootContainer.style.backgroundColor).toBe('var(--print-bg, #ffffff)');
    expect(rootContainer.style.color).toBe('var(--print-text, #111827)');

    // Header border style
    const headerElement = rootContainer.querySelector('div.border-b-2') as HTMLElement;
    expect(headerElement.style.borderColor).toBe('var(--print-header-border, #111827)');

    // Table card style
    const tableCards = rootContainer.querySelectorAll('div.break-inside-avoid');
    expect(tableCards.length).toBe(2);
    const firstTableCard = tableCards[0] as HTMLElement;
    expect(firstTableCard.style.borderColor).toBe('var(--print-border, #e5e7eb)');
    expect(firstTableCard.style.backgroundColor).toBe('var(--print-bg, #ffffff)');

    // Badge style
    const badges = rootContainer.querySelectorAll('span.font-mono');
    const badgeElement = Array.from(badges).find((b) =>
      b.textContent?.includes('Shape:')
    ) as HTMLElement;
    expect(badgeElement).toBeDefined();
    expect(badgeElement.style.backgroundColor).toBe('var(--print-badge-bg, #f3f4f6)');
    expect(badgeElement.style.borderColor).toBe('var(--print-border, #e5e7eb)');
  });
});
