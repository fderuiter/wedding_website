import { render, screen } from '@testing-library/react';
import { PrintableFloorplan } from '../PrintableFloorplan';
import * as seatLayout from '../../seatLayout';
import * as seatingHelpers from '../../utils/seatingHelpers';
import { SeatingTableDTO } from '../../schemas';
import { InvitationCodeDTO } from '@/features/registry';
import { createMockInvitationCode } from '@/testing/factories/registryFactory';

jest.mock('../../seatLayout', () => {
  const actual = jest.requireActual('../../seatLayout');
  return {
    ...actual,
    resolveDetailedSeatAssignments: jest.fn(actual.resolveDetailedSeatAssignments),
  };
});

jest.mock('../../utils/seatingHelpers', () => {
  const actual = jest.requireActual('../../utils/seatingHelpers');
  return {
    ...actual,
    getInvitationPartyMembers: jest.fn(actual.getInvitationPartyMembers),
    summarizeAttendeeMeals: jest.fn(actual.summarizeAttendeeMeals),
  };
});

describe('PrintableFloorplan component', () => {
  const mockTables: SeatingTableDTO[] = [
    {
      id: 'table-1',
      name: 'Head Table',
      shape: 'rectangular',
      capacity: 8,
      x: 100,
      y: 100,
      width: 120,
      height: 120,
      rotation: 0,
      isSample: false,
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
      width: 120,
      height: 120,
      rotation: 0,
      isSample: false,
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

  it('renders named region, section, and article landmarks with correct ARIA labelling and zero nested main', () => {
    const { container } = render(
      <PrintableFloorplan tables={mockTables} unassignedGuests={mockUnassignedGuests} />
    );

    expect(screen.queryByRole('main')).not.toBeInTheDocument();

    // Outer printable roster region landmark
    const rosterRegion = screen.getByRole('region', {
      name: 'Reception Seating Roster & Floorplan',
    });
    expect(rosterRegion).toHaveAttribute('aria-labelledby', 'printable-roster-title');
    expect(rosterRegion).toHaveClass('hidden', 'print:block', 'print:p-6', 'font-sans');
    const mainTitle = container.querySelector('#printable-roster-title');
    expect(mainTitle).toHaveTextContent('Reception Seating Roster & Floorplan');

    // Region landmarks (outer roster + tables section + unassigned guests section)
    const regionLandmarks = screen.getAllByRole('region');
    expect(regionLandmarks).toHaveLength(3);

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

  it('applies custom preset print tokens to element inline styles', () => {
    const { container } = render(
      <PrintableFloorplan tables={mockTables} unassignedGuests={mockUnassignedGuests} preset="romantic" />
    );

    const rootContainer = container.firstElementChild as HTMLElement;
    expect(rootContainer.style.backgroundColor).toBe('var(--print-bg)');
    expect(rootContainer.style.color).toBe('var(--print-text)');

    const headerElement = rootContainer.querySelector('div.border-b-2') as HTMLElement;
    expect(headerElement.style.borderColor).toBe('var(--print-header-border)');
  });

  it('excludes declined RSVPs and address-collection rows and renders dietary badges', () => {
    const tablesWithMixedRsvp: SeatingTableDTO[] = [
      {
        ...mockTables[0],
        invitationCodes: [
          createMockInvitationCode({
            id: 'g-ok',
            code: 'OK1',
            guestName: 'Confirmed Guest',
            seatNumber: 1,
            used: true,
            extraFields: { attending: true },
            dietaryNotes: 'Dairy-Free',
          }),
          createMockInvitationCode({
            id: 'g-declined',
            code: 'DEC1',
            guestName: 'Declined Seated Guest',
            seatNumber: 2,
            used: true,
            extraFields: { attending: false },
          }),
        ],
      },
    ];

    const unassignedMixed: InvitationCodeDTO[] = [
      createMockInvitationCode({
        id: 'u-ok',
        code: 'UOK1',
        guestName: 'Unassigned Vegan',
        used: false,
        dietaryNotes: 'Vegan',
      }),
      createMockInvitationCode({
        id: 'u-addr',
        code: 'ADDR1',
        guestName: 'Address Collector',
        used: false,
        partyTags: ['address-collection'],
      }),
    ];

    render(<PrintableFloorplan tables={tablesWithMixedRsvp} unassignedGuests={unassignedMixed} />);

    expect(screen.getByText(/Confirmed Guest/)).toBeInTheDocument();
    expect(screen.getByText('Unassigned Vegan')).toBeInTheDocument();
    expect(screen.queryByText(/Declined Seated Guest/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Address Collector/)).not.toBeInTheDocument();

    const badges = screen.getAllByTestId('printable-dietary-badge');
    expect(badges.map((b) => b.textContent).join(' ')).toContain('Dairy-Free');
    expect(badges.map((b) => b.textContent).join(' ')).toContain('VG');
  });

  it('resolves unnumbered guest seat numbers into open seats without colliding with explicit seatNumber occupants', () => {
    const sparseTables: SeatingTableDTO[] = [
      {
        ...mockTables[0],
        capacity: 6,
        invitationCodes: [
          createMockInvitationCode({
            id: 'g-unnum',
            code: 'UN1',
            guestName: 'Unnumbered Guest',
            seatNumber: null,
          }),
          createMockInvitationCode({
            id: 'g-exp-1',
            code: 'EX1',
            guestName: 'Explicit Seat One',
            seatNumber: 1,
          }),
        ],
      },
    ];

    render(<PrintableFloorplan tables={sparseTables} unassignedGuests={[]} />);

    expect(screen.getByText('Seat 1: Explicit Seat One')).toBeInTheDocument();
    expect(screen.getByText('Seat 2: Unnumbered Guest')).toBeInTheDocument();
  });

  it('strips secret guest.code values from browser print view while showing plus-one seats, per-table meal counts, and landmarks summary', () => {
    const tablesWithMealsAndLandmark: SeatingTableDTO[] = [
      {
        ...mockTables[0],
        capacity: 6,
        invitationCodes: [
          createMockInvitationCode({
            id: 'g-print-party',
            code: 'SECRET-PRINT-CODE-1',
            guestName: 'Meredith Grey',
            seatNumber: 1,
            plusOneSeatNumbers: [2],
            used: true,
            dietaryNotes: 'Gluten-Free',
            extraFields: {
              attending: true,
              plusOneNames: ['Derek Shepherd'],
              mealSelections: [
                { attendeeName: 'Meredith Grey', mealOptionLabel: 'Herb Salmon' },
                { attendeeName: 'Derek Shepherd', mealOptionLabel: 'Filet Mignon' },
              ],
            },
          }),
        ],
      },
      {
        id: 'lm-buffet',
        name: 'Grand Buffet Station',
        shape: 'buffet',
        capacity: 0,
        x: 400,
        y: 100,
        width: 190,
        height: 80,
        rotation: 0,
        isSample: false,
        invitationCodes: [],
      },
    ];

    const unassignedSecret: InvitationCodeDTO[] = [
      createMockInvitationCode({
        id: 'g-unassigned-print',
        code: 'SECRET-PRINT-CODE-2',
        guestName: 'Cristina Yang',
      }),
    ];

    const { container } = render(
      <PrintableFloorplan tables={tablesWithMealsAndLandmark} unassignedGuests={unassignedSecret} />
    );

    expect(screen.getByText('Seat 1: Meredith Grey')).toBeInTheDocument();
    expect(screen.getByText('Seat 2: Derek Shepherd (Meredith Grey +1)')).toBeInTheDocument();
    expect(screen.getByTestId('printable-table-meal-summary')).toHaveTextContent(
      'Filet Mignon: 1, Herb Salmon: 1'
    );
    expect(screen.getByTestId('printable-landmarks-summary')).toHaveTextContent(
      'Grand Buffet Station'
    );

    // Zero secret invitation codes exposed anywhere in printable DOM
    expect(container.textContent).not.toContain('SECRET-PRINT-CODE-1');
    expect(container.textContent).not.toContain('SECRET-PRINT-CODE-2');
  });

  it('renders companion names, entrée selections, Kids Meal badges, and custom answers for seated and unassigned guests', () => {
    const tablesWithDetails: SeatingTableDTO[] = [
      {
        ...mockTables[0],
        invitationCodes: [
          createMockInvitationCode({
            id: 'g-rich',
            code: 'RICH1',
            guestName: 'Elena Gilbert',
            seatNumber: 1,
            used: true,
            extraFields: {
              attendanceStatus: 'attending',
              plusOneNames: ['Damon Salvatore', 'Bonnie Bennett'],
              dietaryTags: ['kids'],
              mealSummary: 'Reception - Elena Gilbert: Herb Salmon; Bonnie Bennett: Kids Pasta (kids)',
              customAnswersSummary: 'Reception - Shuttle?: Yes',
            },
          }),
        ],
      },
    ];

    const unassignedWithDetails: InvitationCodeDTO[] = [
      createMockInvitationCode({
        id: 'u-rich',
        code: 'URICH1',
        guestName: 'Caroline Forbes',
        used: true,
        plusOneFirstName: 'Klaus',
        plusOneLastName: 'Mikaelson',
        extraFields: {
          attendanceStatus: 'attending',
          mealSummary: 'Reception - Caroline Forbes: Truffle Risotto',
          customAnswersSummary: 'Reception - Song?: Halo',
        },
      }),
    ];

    const { container } = render(
      <PrintableFloorplan tables={tablesWithDetails} unassignedGuests={unassignedWithDetails} />
    );

    expect(screen.getByText('Seat 1: Elena Gilbert')).toBeInTheDocument();
    expect(screen.getByText('Seat 2: Damon Salvatore (Elena Gilbert +1)')).toBeInTheDocument();
    expect(screen.getByText('Seat 3: Bonnie Bennett (Elena Gilbert +2)')).toBeInTheDocument();
    expect(screen.getByText('Caroline Forbes (+1: Klaus Mikaelson)')).toBeInTheDocument();

    const mealEls = screen.getAllByTestId('printable-meal-selections');
    expect(mealEls.map((el) => el.textContent).join(' ')).toContain('Herb Salmon');
    expect(mealEls.map((el) => el.textContent).join(' ')).toContain('Truffle Risotto');

    const answerEls = screen.getAllByTestId('printable-custom-answers');
    expect(answerEls.map((el) => el.textContent).join(' ')).toContain('Shuttle?: Yes');
    expect(answerEls.map((el) => el.textContent).join(' ')).toContain('Song?: Halo');

    const badges = screen.getAllByTestId('printable-dietary-badge');
    expect(badges.map((b) => b.textContent).join(' ')).toContain('Kids Meal');

    expect(container.textContent).not.toContain('RICH1');
    expect(container.textContent).not.toContain('URICH1');
  });

  it('expands multi-person InvitationCode parties into companion seat rows and reports total attendee headcounts', () => {
    const coupleTables: SeatingTableDTO[] = [
      {
        ...mockTables[0],
        capacity: 4,
        invitationCodes: [
          createMockInvitationCode({
            id: 'g-couple',
            code: 'CPL99',
            guestName: 'Jordan Taylor',
            seatNumber: 1,
            used: true,
            plusOneAllocations: 1,
            extraFields: {
              attending: true,
              plusOneCount: 1,
              plusOneNames: ['Morgan Taylor'],
            },
          }),
        ],
      },
    ];

    const unassignedTrio: InvitationCodeDTO[] = [
      createMockInvitationCode({
        id: 'u-trio',
        code: 'TRIO1',
        guestName: 'Alex Rivera',
        used: false,
        plusOneAllocations: 2,
      }),
    ];

    render(<PrintableFloorplan tables={coupleTables} unassignedGuests={unassignedTrio} />);

    expect(screen.getByText(/Seated: 2/)).toBeInTheDocument();
    expect(screen.getByText('Seat 1: Jordan Taylor')).toBeInTheDocument();
    expect(screen.getByText('Seat 2: Morgan Taylor (Jordan Taylor +1)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Unassigned Guests (3)' })).toBeInTheDocument();
    expect(screen.getByText('Alex Rivera (+2)')).toBeInTheDocument();
  });

  describe('Roster-scoped memoization and single-pass party resolution', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('parses each seated party once on mount and re-renders 0 table cards when x, y, width, height, or rotation change across 50 tables', () => {
      const resolveSeatsSpy = seatLayout.resolveDetailedSeatAssignments as jest.Mock;
      const partyMembersSpy = seatingHelpers.getInvitationPartyMembers as jest.Mock;
      const summarizeMealsSpy = seatingHelpers.summarizeAttendeeMeals as jest.Mock;

      const fiftyTables: SeatingTableDTO[] = Array.from({ length: 50 }, (_, index) => {
        const tableNum = index + 1;
        return {
          id: `print-tbl-${tableNum}`,
          name: `Print Table ${tableNum}`,
          shape: 'round',
          capacity: 8,
          x: 100 + index * 20,
          y: 120,
          width: 120,
          height: 120,
          rotation: 0,
          isSample: false,
          invitationCodes: [
            createMockInvitationCode({
              id: `print-guest-${tableNum}`,
              code: `SECRET-${tableNum}`,
              guestName: `Seated Host ${tableNum}`,
              seatNumber: 1,
              plusOneSeatNumbers: [2],
              used: true,
              extraFields: {
                attending: true,
                plusOneNames: [`Companion ${tableNum}`],
                mealSelections: [
                  { attendeeName: `Seated Host ${tableNum}`, mealOptionLabel: 'Herb Salmon' },
                  { attendeeName: `Companion ${tableNum}`, mealOptionLabel: 'Filet Mignon' },
                ],
              },
            }),
          ],
        };
      });

      const { rerender } = render(
        <PrintableFloorplan tables={fiftyTables} unassignedGuests={[]} />
      );

      // Single-pass resolution: 50 tables -> 50 resolveDetailedSeatAssignments calls, 50 meal summaries, and 50 party parses (1 per party, not 2-3x)
      expect(resolveSeatsSpy).toHaveBeenCalledTimes(50);
      expect(summarizeMealsSpy).toHaveBeenCalledTimes(50);
      expect(partyMembersSpy).toHaveBeenCalledTimes(50);

      resolveSeatsSpy.mockClear();
      summarizeMealsSpy.mockClear();
      partyMembersSpy.mockClear();

      // Update x, y, width, height, and rotation on tables with cloned array -> 0 table cards re-render
      const movedAndRotatedTables = fiftyTables.map((table, index) =>
        index === 0
          ? {
            ...table,
            x: table.x + 250,
            y: table.y + 140,
            width: 160,
            height: 160,
            rotation: 135,
          }
          : { ...table, rotation: 45 }
      );

      rerender(<PrintableFloorplan tables={movedAndRotatedTables} unassignedGuests={[]} />);

      expect(resolveSeatsSpy).toHaveBeenCalledTimes(0);
      expect(summarizeMealsSpy).toHaveBeenCalledTimes(0);
      expect(partyMembersSpy).toHaveBeenCalledTimes(0);

      // Updating invitationCodes on a single table re-renders ONLY that 1 table card (49 static cards stay untouched)
      const oneRosterUpdated = movedAndRotatedTables.map((table, index) =>
        index === 0
          ? {
            ...table,
            invitationCodes: [
              ...(table.invitationCodes || []),
              createMockInvitationCode({
                id: 'print-guest-extra',
                code: 'SECRET-EXTRA',
                guestName: 'Added Guest',
                seatNumber: 3,
                used: true,
                extraFields: { attending: true },
              }),
            ],
          }
          : table
      );

      rerender(<PrintableFloorplan tables={oneRosterUpdated} unassignedGuests={[]} />);

      expect(resolveSeatsSpy).toHaveBeenCalledTimes(1);
      expect(partyMembersSpy).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Seat 3: Added Guest')).toBeInTheDocument();
    });
  });
});
