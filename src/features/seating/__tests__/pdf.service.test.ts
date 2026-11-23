/** @jest-environment node */

import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { generateSeatingChartPdf } from '../pdf.service';
import { computeSeatPosition, resolveSeatAssignments } from '../seatLayout';
import { SeatingTableDTO } from '../schemas';
import { InvitationCodeDTO } from '@/features/registry';

describe('pdf.service - generateSeatingChartPdf', () => {
  const mockTables: SeatingTableDTO[] = [
    {
      id: 'table-1',
      name: 'Table 1 (Round)',
      shape: 'round',
      capacity: 8,
      x: 50,
      y: 50,
      width: 120,
      height: 120,
      rotation: 0,
      isSample: false,
      invitationCodes: [
        {
          id: 'guest-1',
          guestName: 'Alice Johnson',
          code: 'INV100',
          seatNumber: 1,
          dietaryNotes: 'Vegetarian',
        } as InvitationCodeDTO,
        {
          id: 'guest-2',
          guestName: 'Bob Smith',
          code: 'INV101',
          seatNumber: 2,
        } as InvitationCodeDTO,
      ],
    },
    {
      id: 'table-2',
      name: 'Table 2 (Rectangular)',
      shape: 'rectangular',
      capacity: 4,
      x: 250,
      y: 50,
      width: 160,
      height: 100,
      rotation: 0,
      isSample: false,
      invitationCodes: [],
    },
  ];

  const mockUnassignedGuests: InvitationCodeDTO[] = [
    {
      id: 'guest-3',
      guestName: 'Charlie Brown',
      code: 'INV102',
      dietaryNotes: 'Gluten Free',
    } as InvitationCodeDTO,
  ];

  it('generates a valid PDF buffer with PDF magic bytes', async () => {
    const pdfBuffer = await generateSeatingChartPdf(mockTables, mockUnassignedGuests, {
      siteTitle: 'Sarah & David Wedding',
      weddingDate: 'October 25, 2026',
    });

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(500);

    // PDF files start with %PDF-
    const header = pdfBuffer.slice(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('handles empty tables and guest arrays gracefully', async () => {
    const pdfBuffer = await generateSeatingChartPdf([], [], {
      siteTitle: 'Empty Event Seating',
    });

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.length).toBeGreaterThan(300);

    const header = pdfBuffer.slice(0, 5).toString('ascii');
    expect(header).toBe('%PDF-');
  });

  it('handles over-capacity tables', async () => {
    const overCapacityTable: SeatingTableDTO = {
      id: 'table-over',
      name: 'VIP Table',
      shape: 'round',
      capacity: 2,
      x: 10,
      y: 10,
      width: 100,
      height: 100,
      rotation: 0,
      isSample: false,
      invitationCodes: [
        { id: 'g1', guestName: 'Guest 1', code: 'C1', seatNumber: 1 } as InvitationCodeDTO,
        { id: 'g2', guestName: 'Guest 2', code: 'C2', seatNumber: 2 } as InvitationCodeDTO,
        { id: 'g3', guestName: 'Guest 3', code: 'C3', seatNumber: 3 } as InvitationCodeDTO,
      ],
    };

    const pdfBuffer = await generateSeatingChartPdf([overCapacityTable], []);
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('handles out-of-order explicit seat numbers and fallback guests without seat numbers', async () => {
    const tableWithComplexSeats: SeatingTableDTO = {
      id: 'table-complex',
      name: 'Head Table',
      shape: 'rectangular',
      capacity: 10,
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      rotation: 0,
      isSample: false,
      invitationCodes: [
        { id: 'g10', guestName: 'Explicit Seat 10', code: 'C10', seatNumber: 10 } as InvitationCodeDTO,
        { id: 'g3', guestName: 'Explicit Seat 3', code: 'C3', seatNumber: 3 } as InvitationCodeDTO,
        { id: 'gUnassignedSeat', guestName: 'Fallback Positional Guest', code: 'CFALLBACK' } as InvitationCodeDTO,
      ],
    };

    const pdfBuffer = await generateSeatingChartPdf([tableWithComplexSeats], []);
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('renders large capacity tables efficiently with indexed seat lookup map', async () => {
    const largeGuests: InvitationCodeDTO[] = Array.from({ length: 150 }, (_, idx) => ({
      id: `g-${idx + 1}`,
      guestName: `Guest ${idx + 1}`,
      code: `CODE${idx + 1}`,
      seatNumber: idx + 1,
    })) as InvitationCodeDTO[];

    const largeTable: SeatingTableDTO = {
      id: 'table-large',
      name: 'Grand Ballroom Table',
      shape: 'round',
      capacity: 150,
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      rotation: 0,
      isSample: false,
      invitationCodes: largeGuests,
    };

    const startTime = Date.now();
    const pdfBuffer = await generateSeatingChartPdf([largeTable], []);
    const duration = Date.now() - startTime;

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.slice(0, 5).toString('ascii')).toBe('%PDF-');
    expect(duration).toBeLessThan(5000); // Should execute quickly in linear time
  });

  it('renders 1-sided head and sweetheart tables with dietary restriction indicators', async () => {
    const oneSidedTables: SeatingTableDTO[] = [
      {
        id: 'tbl-head',
        name: 'Head Table',
        shape: 'head',
        capacity: 6,
        x: 80,
        y: 60,
        width: 240,
        height: 80,
        rotation: 0,
        isSample: false,
        invitationCodes: [
          {
            id: 'g1',
            guestName: 'Taylor Morgan',
            code: 'BRIDE1',
            seatNumber: 1,
            dietaryNotes: 'Gluten-Free, Dairy-Free',
          } as InvitationCodeDTO,
        ],
      },
      {
        id: 'tbl-sweet',
        name: 'Sweetheart Table',
        shape: 'sweetheart',
        capacity: 2,
        x: 360,
        y: 60,
        width: 140,
        height: 80,
        rotation: 0,
        isSample: false,
        invitationCodes: [
          {
            id: 'g2',
            guestName: 'Jordan Lee',
            code: 'GROOM1',
            seatNumber: 1,
          } as InvitationCodeDTO,
        ],
      },
    ];

    const pdfBuffer = await generateSeatingChartPdf(oneSidedTables, []);
    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.slice(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdfBuffer.length).toBeGreaterThan(600);
  });

  describe('Unified seat layout, PDF schematic non-duplication, and 24x24px target contracts', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('resolves sparse explicit seat numbers without array-index duplication and places unnumbered guests into open seats', () => {
      const guests: InvitationCodeDTO[] = [
        { id: 'bride', guestName: 'Bride', code: 'B1', seatNumber: 2 } as InvitationCodeDTO,
        { id: 'groom', guestName: 'Groom', code: 'G1', seatNumber: 3 } as InvitationCodeDTO,
      ];

      const sparseMap = resolveSeatAssignments(guests, 8);
      expect(sparseMap.size).toBe(2);
      expect(sparseMap.get(1)).toBeUndefined();
      expect(sparseMap.get(2)?.id).toBe('bride');
      expect(sparseMap.get(3)?.id).toBe('groom');

      const mixedMap = resolveSeatAssignments(
        [
          ...guests,
          { id: 'bestman', guestName: 'Best Man', code: 'BM1', seatNumber: null } as InvitationCodeDTO,
        ],
        8
      );
      expect(mixedMap.get(1)?.id).toBe('bestman');
      expect(mixedMap.get(2)?.id).toBe('bride');
      expect(mixedMap.get(3)?.id).toBe('groom');
    });

    it('computes symmetric 4-edge rectangular seat positions and 1-sided head/sweetheart top-edge positions', () => {
      const coords = Array.from({ length: 8 }, (_, idx) =>
        computeSeatPosition({
          shape: 'rectangular',
          seatNumber: idx + 1,
          capacity: 8,
          width: 250,
          height: 100,
          offset: 16,
        })
      );

      // Top edge: seats 1, 2 at 1/3 and 2/3 of 250
      expect(coords[0].x).toBeCloseTo(250 / 3, 5);
      expect(coords[0].y).toBe(-16);
      expect(coords[1].x).toBeCloseTo((250 * 2) / 3, 5);
      expect(coords[1].y).toBe(-16);

      // Right edge: seats 3, 4 at 1/3 and 2/3 of 100
      expect(coords[2].x).toBe(266);
      expect(coords[2].y).toBeCloseTo(100 / 3, 5);
      expect(coords[3].x).toBe(266);
      expect(coords[3].y).toBeCloseTo((100 * 2) / 3, 5);

      // Bottom edge: seats 5, 6 at 2/3 and 1/3 of 250
      expect(coords[4].x).toBeCloseTo((250 * 2) / 3, 5);
      expect(coords[4].y).toBe(116);
      expect(coords[5].x).toBeCloseTo(250 / 3, 5);
      expect(coords[5].y).toBe(116);

      // Left edge: seats 7, 8 at 2/3 and 1/3 of 100
      expect(coords[6].x).toBe(-16);
      expect(coords[6].y).toBeCloseTo((100 * 2) / 3, 5);
      expect(coords[7].x).toBe(-16);
      expect(coords[7].y).toBeCloseTo(100 / 3, 5);

      // 1-sided head table places all seats evenly along the single top edge
      const headCoords = Array.from({ length: 4 }, (_, idx) =>
        computeSeatPosition({
          shape: 'head',
          seatNumber: idx + 1,
          capacity: 4,
          width: 250,
          height: 90,
          offset: 18,
        })
      );
      expect(headCoords).toEqual([
        { x: 50, y: -18 },
        { x: 100, y: -18 },
        { x: 150, y: -18 },
        { x: 200, y: -18 },
      ]);
    });

    it('draws only occupied seats as filled dots in generateSeatingChartPdf when seats 2 and 3 are occupied on an 8-seat table', async () => {
      const drawnCircles: Array<{ x: number; y: number; r: number; fill?: string }> = [];
      const originalCircle = PDFDocument.prototype.circle;
      const originalFillAndStroke = PDFDocument.prototype.fillAndStroke;
      let pendingCircle: { x: number; y: number; r: number; fill?: string } | null = null;

      jest.spyOn(PDFDocument.prototype, 'circle').mockImplementation(function (
        this: PDFKit.PDFDocument,
        ...args: unknown[]
      ) {
        const [x, y, r] = args as [number, number, number];
        pendingCircle = { x, y, r };
        drawnCircles.push(pendingCircle);
        return originalCircle.call(this, x, y, r);
      });

      jest.spyOn(PDFDocument.prototype, 'fillAndStroke').mockImplementation(function (
        this: PDFKit.PDFDocument,
        ...args: unknown[]
      ) {
        const [fillColor, strokeColor] = args as [
          PDFKit.Mixins.ColorValue | undefined,
          PDFKit.Mixins.ColorValue | undefined,
        ];
        if (pendingCircle && typeof fillColor === 'string') {
          pendingCircle.fill = fillColor;
          pendingCircle = null;
        }
        return originalFillAndStroke.call(this, fillColor, strokeColor);
      });

      const headTable: SeatingTableDTO = {
        id: 'head-sparse',
        name: 'Head Table',
        shape: 'rectangular',
        capacity: 8,
        x: 275,
        y: 40,
        width: 250,
        height: 100,
        rotation: 0,
        isSample: false,
        invitationCodes: [
          {
            id: 'g-bride',
            guestName: 'Bride',
            code: 'BRIDE',
            seatNumber: 2,
            dietaryNotes: 'Gluten-Free',
          } as InvitationCodeDTO,
          {
            id: 'g-groom',
            guestName: 'Groom',
            code: 'GROOM',
            seatNumber: 3,
          } as InvitationCodeDTO,
        ],
      };

      const pdfBuffer = await generateSeatingChartPdf([headTable], []);
      expect(pdfBuffer.slice(0, 5).toString('ascii')).toBe('%PDF-');

      // 8 table seat dots + 3 legend dots (Assigned Seat, Available Seat, Dietary Restriction) = 11 circles total
      expect(drawnCircles).toHaveLength(11);
      const seatCircles = drawnCircles.slice(0, 8);
      const occupiedBlueSeats = seatCircles.filter((c) => c.fill === '#0284c7');
      const occupiedDietarySeats = seatCircles.filter((c) => c.fill === '#047857');
      const emptySeats = seatCircles.filter((c) => c.fill === '#ffffff');

      expect(occupiedDietarySeats).toHaveLength(1);
      expect(occupiedBlueSeats).toHaveLength(1);
      expect(emptySeats).toHaveLength(6);
      // Seat 1 (index 0) must be empty (#ffffff), while Seat 2 (index 1, dietary) and Seat 3 (index 2, assigned) are filled
      expect(seatCircles[0].fill).toBe('#ffffff');
      expect(seatCircles[1].fill).toBe('#047857');
      expect(seatCircles[2].fill).toBe('#0284c7');
    });

    it('enforces >= 24x24px target classes and per-guest unassign labels in floorplan and inspector source', () => {
      const canvasSrc = fs.readFileSync(
        path.resolve(__dirname, '../components/FloorplanCanvas.tsx'),
        'utf8'
      );
      const pageSrc = fs.readFileSync(
        path.resolve(__dirname, '../../../app/admin/dashboard/seating-chart/page.tsx'),
        'utf8'
      );

      expect(canvasSrc).toContain('w-7 h-7 rounded-full');
      expect(canvasSrc).toContain('min-w-7 min-h-6');
      expect(pageSrc).toContain('min-w-6 min-h-6');
      expect(pageSrc).toContain('aria-label={`Unassign ${guest.guestName}`}');
    });

    it('renders contiguous companion seat dots and party attendee headcount in generateSeatingChartPdf', async () => {
      const drawnCircles: Array<{ x: number; y: number; r: number; fill?: string }> = [];
      const renderedTexts: string[] = [];
      const originalCircle = PDFDocument.prototype.circle;
      const originalFillAndStroke = PDFDocument.prototype.fillAndStroke;
      const originalText = PDFDocument.prototype.text;
      let pendingCircle: { x: number; y: number; r: number; fill?: string } | null = null;

      jest.spyOn(PDFDocument.prototype, 'circle').mockImplementation(function (
        this: PDFKit.PDFDocument,
        ...args: unknown[]
      ) {
        const [x, y, r] = args as [number, number, number];
        pendingCircle = { x, y, r };
        drawnCircles.push(pendingCircle);
        return originalCircle.call(this, x, y, r);
      });

      jest.spyOn(PDFDocument.prototype, 'fillAndStroke').mockImplementation(function (
        this: PDFKit.PDFDocument,
        ...args: unknown[]
      ) {
        const [fillColor, strokeColor] = args as [
          PDFKit.Mixins.ColorValue | undefined,
          PDFKit.Mixins.ColorValue | undefined,
        ];
        if (pendingCircle && typeof fillColor === 'string') {
          pendingCircle.fill = fillColor;
          pendingCircle = null;
        }
        return originalFillAndStroke.call(this, fillColor, strokeColor);
      });

      jest.spyOn(PDFDocument.prototype, 'text').mockImplementation(function (
        this: PDFKit.PDFDocument,
        ...args: unknown[]
      ) {
        if (typeof args[0] === 'string') {
          renderedTexts.push(args[0]);
        }
        return (originalText as (...a: unknown[]) => PDFKit.PDFDocument).apply(this, args);
      });

      const coupleTable: SeatingTableDTO = {
        id: 'tbl-pdf-couple',
        name: 'Couple Table',
        shape: 'round',
        capacity: 4,
        x: 120,
        y: 120,
        width: 120,
        height: 120,
        rotation: 0,
        isSample: false,
        invitationCodes: [
          {
            id: 'g-pdf-couple',
            guestName: 'Jordan Taylor',
            code: 'PDFCPL',
            seatNumber: 1,
            used: true,
            isSample: false,
            partyTags: [],
            plusOneAllocations: 1,
            extraFields: {
              attending: true,
              plusOneCount: 1,
              plusOneNames: ['Morgan Taylor'],
            },
          } as InvitationCodeDTO,
        ],
      };

      const unassignedCouple = [
        {
          id: 'u-pdf-couple',
          guestName: 'Alex Rivera',
          code: 'PDFU1',
          used: false,
          isSample: false,
          partyTags: [],
          plusOneAllocations: 1,
        } as InvitationCodeDTO,
      ];

      await generateSeatingChartPdf([coupleTable], unassignedCouple);

      // 1 round table circle + 4 seat dots + 3 legend dots = 8 circles; Seats 1 and 2 are both filled (#0284c7)
      expect(drawnCircles).toHaveLength(8);
      const seatCircles = drawnCircles.slice(1, 5);
      expect(seatCircles[0].fill).toBe('#0284c7');
      expect(seatCircles[1].fill).toBe('#0284c7');
      expect(seatCircles[2].fill).toBe('#ffffff');
      expect(seatCircles[3].fill).toBe('#ffffff');

      const joined = renderedTexts.join(' | ');
      expect(joined).toContain('2/4 seats');
      expect(joined).toContain('Seat 1 | Jordan Taylor');
      expect(joined).toContain('Seat 2 | Morgan Taylor (Jordan Taylor +1)');
      expect(joined).toContain('Unassigned Guests (2)');
    });
  });
});
