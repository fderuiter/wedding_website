/** @jest-environment node */

import { generateSeatingChartPdf } from '../pdf.service';
import { SeatingTableDTO } from '../schemas';
import { InvitationCodeDTO } from '@/features/registry/schemas';

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
      invitationCodes: largeGuests,
    };

    const startTime = Date.now();
    const pdfBuffer = await generateSeatingChartPdf([largeTable], []);
    const duration = Date.now() - startTime;

    expect(Buffer.isBuffer(pdfBuffer)).toBe(true);
    expect(pdfBuffer.slice(0, 5).toString('ascii')).toBe('%PDF-');
    expect(duration).toBeLessThan(5000); // Should execute quickly in linear time
  });
});
