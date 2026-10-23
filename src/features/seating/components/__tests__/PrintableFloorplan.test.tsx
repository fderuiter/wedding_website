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
    expect(rootContainer.style.backgroundColor).toBe('var(--print-bg)');
    expect(rootContainer.style.color).toBe('var(--print-text)');

    // Header border style
    const headerElement = rootContainer.querySelector('div.border-b-2') as HTMLElement;
    expect(headerElement.style.borderColor).toBe('var(--print-header-border)');

    // Table card style
    const tableCards = rootContainer.querySelectorAll('article.break-inside-avoid');
    expect(tableCards.length).toBe(2);
    const firstTableCard = tableCards[0] as HTMLElement;
    expect(firstTableCard.style.borderColor).toBe('var(--print-border)');
    expect(firstTableCard.style.backgroundColor).toBe('var(--print-bg)');

    // Badge style
    const badges = rootContainer.querySelectorAll('span.font-mono');
    const badgeElement = Array.from(badges).find((b) =>
      b.textContent?.includes('Shape:')
    ) as HTMLElement;
    expect(badgeElement).toBeDefined();
    expect(badgeElement.style.backgroundColor).toBe('var(--print-badge-bg)');
    expect(badgeElement.style.borderColor).toBe('var(--print-border)');
  });

  it('renders main, section, and article landmarks with correct ARIA labelling', () => {
    const { container } = render(
      <PrintableFloorplan tables={mockTables} unassignedGuests={mockUnassignedGuests} />
    );

    // Main landmark
    const mainLandmark = screen.getByRole('main');
    expect(mainLandmark).toHaveAttribute('aria-labelledby', 'printable-roster-title');
    const mainTitle = container.querySelector('#printable-roster-title');
    expect(mainTitle).toHaveTextContent('Reception Seating Roster & Floorplan');

    // Section landmarks
    const regionLandmarks = screen.getAllByRole('region');
    expect(regionLandmarks).toHaveLength(2);

    const tablesSection = screen.getByRole('region', { name: 'Seating Table Assignments' });
    expect(tablesSection).toHaveAttribute('aria-labelledby', 'tables-section-heading');

    const unassignedSection = screen.getByRole('region', { name: /Unassigned Guests/i });
    expect(unassignedSection).toHaveAttribute('aria-labelledby', 'unassigned-guests-heading');

    // Article landmarks
    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(2);
    expect(articles[0]).toHaveAttribute('aria-labelledby', 'table-heading-table-1');
    expect(articles[1]).toHaveAttribute('aria-labelledby', 'table-heading-table-2');
  });

  it('maintains a logical heading hierarchy (h1 -> h2 -> h3)', () => {
    render(<PrintableFloorplan tables={mockTables} unassignedGuests={mockUnassignedGuests} />);

    const h1Headings = screen.getAllByRole('heading', { level: 1 });
    expect(h1Headings).toHaveLength(1);
    expect(h1Headings[0]).toHaveTextContent('Reception Seating Roster & Floorplan');

    const h2Headings = screen.getAllByRole('heading', { level: 2 });
    expect(h2Headings).toHaveLength(2);
    expect(h2Headings[0]).toHaveTextContent('Seating Table Assignments');
    expect(h2Headings[1]).toHaveTextContent('Unassigned Guests (1)');

    const h3Headings = screen.getAllByRole('heading', { level: 3 });
    expect(h3Headings).toHaveLength(2);
    expect(h3Headings[0]).toHaveTextContent('Head Table');
    expect(h3Headings[1]).toHaveTextContent('Family Table');
  });

  it('omits unassigned guests section landmark when unassignedGuests is empty', () => {
    render(<PrintableFloorplan tables={mockTables} unassignedGuests={[]} />);

    expect(screen.queryByRole('region', { name: /Unassigned Guests/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Unassigned Guests/i)).not.toBeInTheDocument();
  });
});
