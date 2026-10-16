import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { prisma } from '@/lib/prisma';
import { generateCsvContent } from '@/utils/csv';

const HEADERS = [
  'Table Name',
  'Table Shape',
  'Capacity',
  'Seat Number',
  'Guest Name',
  'Invitation Code',
];

interface SeatingExportRecord extends Record<string, unknown> {
  'Table Name': string;
  'Table Shape': string;
  'Capacity': string;
  'Seat Number': string;
  'Guest Name': string;
  'Invitation Code': string;
}

export const GET = withApiMiddleware(async (_request: NextRequest) => {
  const [tables, unassignedGuests] = await Promise.all([
    prisma.seatingTable.findMany({
      include: {
        invitationCodes: {
          orderBy: { seatNumber: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.invitationCode.findMany({
      where: { tableId: null },
      orderBy: { guestName: 'asc' },
    }),
  ]);

  const exportRecords: SeatingExportRecord[] = [];

  for (const table of tables) {
    if (table.invitationCodes.length === 0) {
      exportRecords.push({
        'Table Name': table.name,
        'Table Shape': table.shape,
        'Capacity': String(table.capacity),
        'Seat Number': '',
        'Guest Name': '(Unassigned Table)',
        'Invitation Code': '',
      });
    } else {
      for (const guest of table.invitationCodes) {
        exportRecords.push({
          'Table Name': table.name,
          'Table Shape': table.shape,
          'Capacity': String(table.capacity),
          'Seat Number': guest.seatNumber ? String(guest.seatNumber) : '',
          'Guest Name': guest.guestName,
          'Invitation Code': guest.code,
        });
      }
    }
  }

  for (const guest of unassignedGuests) {
    exportRecords.push({
      'Table Name': 'Unassigned',
      'Table Shape': '',
      'Capacity': '',
      'Seat Number': '',
      'Guest Name': guest.guestName,
      'Invitation Code': guest.code,
    });
  }

  const csvString = generateCsvContent(exportRecords, HEADERS);

  return new NextResponse(csvString, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="seating-roster-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  });
});
