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

  it('does not duplicate sparse explicit seats onto lower empty seats in PDF schematic and spaces four rectangular edges evenly', async () => {
    const circleCalls: Array<{ x: number; y: number; r: number }> = [];
    const fillAndStrokeCalls: Array<{ fillColor: unknown; strokeColor: unknown }> = [];

    const origCircle = PDFDocument.prototype.circle;
    const origFillAndStroke = PDFDocument.prototype.fillAndStroke;

    const circleSpy = jest
      .spyOn(PDFDocument.prototype, 'circle')
      .mockImplementation(function (this: InstanceType<typeof PDFDocument>, ...args: unknown[]) {
        const [x, y, radius] = args as [number, number, number];
        circleCalls.push({ x, y, r: radius });
        return origCircle.call(this, x, y, radius);
      });

    const fillStrokeSpy = jest
      .spyOn(PDFDocument.prototype, 'fillAndStroke')
      .mockImplementation(function (this: InstanceType<typeof PDFDocument>, ...args: unknown[]) {
        const [fillColor, strokeColor] = args as [string | undefined, string | undefined];
        fillAndStrokeCalls.push({ fillColor, strokeColor });
        return origFillAndStroke.call(this, fillColor, strokeColor);
      });

    try {
      const sparseRectTable: SeatingTableDTO = {
        id: 'table-sparse-head',
        name: 'Head Table',
        shape: 'rectangular',
        capacity: 8,
        x: 200,
        y: 150,
        width: 240,
        height: 120,
        rotation: 0,
        isSample: true,
        invitationCodes: [
          {
            id: 'guest-2',
            guestName: 'Alex Rivera',
            code: 'RIVERA2026',
            seatNumber: 2,
          } as InvitationCodeDTO,
          {
            id: 'guest-3',
            guestName: 'Jessica Davis',
            code: 'DAVIS2026',
            seatNumber: 3,
          } as InvitationCodeDTO,
        ],
      };

      const resolvedMap = resolveSeatAssignments(sparseRectTable.invitationCodes, 8);
      expect(resolvedMap.get(1)).toBeUndefined();
      expect(resolvedMap.get(2)?.guestName).toBe('Alex Rivera');
      expect(resolvedMap.get(3)?.guestName).toBe('Jessica Davis');
      expect(resolvedMap.size).toBe(2);

      const pdfBuffer = await generateSeatingChartPdf([sparseRectTable], []);
      expect(pdfBuffer.slice(0, 5).toString('ascii')).toBe('%PDF-');

      // First 8 circle calls belong to the 8 rectangular table seats (legend adds 2 smaller 4pt circles afterward)
      expect(circleCalls.length).toBe(10);
      const seatCircles = circleCalls.slice(0, 8);

      // Verify Top (0,1), Right (2,3), Bottom (4,5), and Left (6,7) edge symmetry
      expect(seatCircles[0].y).toBeCloseTo(seatCircles[1].y, 5); // Top edge shared Y
      expect(seatCircles[2].x).toBeCloseTo(seatCircles[3].x, 5); // Right edge shared X
      expect(seatCircles[4].y).toBeCloseTo(seatCircles[5].y, 5); // Bottom edge shared Y
      expect(seatCircles[6].x).toBeCloseTo(seatCircles[7].x, 5); // Left edge shared X
      // Top and Bottom seat X positions mirror each other at 1/3 and 2/3 of table width
      expect(seatCircles[0].x).toBeCloseTo(seatCircles[5].x, 5);
      expect(seatCircles[1].x).toBeCloseTo(seatCircles[4].x, 5);
      // Right and Left seat Y positions mirror each other at 1/3 and 2/3 of table height
      expect(seatCircles[2].y).toBeCloseTo(seatCircles[7].y, 5);
      expect(seatCircles[3].y).toBeCloseTo(seatCircles[6].y, 5);

      // Verify helper geometry directly matches (edgeIndex + 1) / (edgeSeatCount + 1)
      const topFirst = computeSeatPosition({
        seatNumber: 1,
        capacity: 8,
        shape: 'rectangular',
        width: 240,
        height: 120,
        offset: 10,
      });
      const topSecond = computeSeatPosition({
        seatNumber: 2,
        capacity: 8,
        shape: 'rectangular',
        width: 240,
        height: 120,
        offset: 10,
      });
      expect(topFirst).toEqual({ x: 80, y: -10 });
      expect(topSecond).toEqual({ x: 160, y: -10 });

      // Verify exactly 2 schematic seats are styled occupied (#0284c7) + 1 legend circle = 3 total #0284c7 fills
      const occupiedSeatFills = fillAndStrokeCalls.filter((c) => c.fillColor === '#0284c7');
      expect(occupiedSeatFills).toHaveLength(3);
    } finally {
      circleSpy.mockRestore();
      fillStrokeSpy.mockRestore();
    }
  });

  it('enforces >= 24x24px WCAG 2.2 SC 2.5.8 target classes and per-guest unassign labels across seating views', () => {
    const canvasSource = fs.readFileSync(
      path.join(process.cwd(), 'src/features/seating/components/FloorplanCanvas.tsx'),
      'utf8'
    );
    const pageSource = fs.readFileSync(
      path.join(process.cwd(), 'src/app/admin/dashboard/seating-chart/page.tsx'),
      'utf8'
    );

    // Rotation knob is w-7 h-7 (28x28px >= 24x24px) and quick-rotate buttons are min-w-7 min-h-6 (>= 28x24px)
    expect(canvasSource).toContain('w-7 h-7');
    expect(canvasSource).toContain('min-w-7 min-h-6');
    expect(canvasSource).not.toContain('w-5 h-5 rounded-full bg-primary');

    // Inspector unassign buttons include type="button", min-w-6 min-h-6 (24x24px), title="Unassign guest", and per-guest aria-label
    expect(pageSource).toContain('min-w-6 min-h-6');
    expect(pageSource).toContain('title="Unassign guest"');
    expect(pageSource).toContain('aria-label={`Unassign ${guest.guestName}`}');
  });
});
