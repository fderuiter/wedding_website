import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { prisma } from '@/lib/prisma';

export const GET = withApiMiddleware(async (_request: NextRequest) => {
  const tables = await prisma.seatingTable.findMany({
    include: {
      invitationCodes: {
        orderBy: { seatNumber: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  });

  const unassignedGuests = await prisma.invitationCode.findMany({
    where: { tableId: null },
    orderBy: { guestName: 'asc' },
  });

  const rows = [
    ['Table Name', 'Table Shape', 'Capacity', 'Seat Number', 'Guest Name', 'Invitation Code']
  ];

  for (const table of tables) {
    if (table.invitationCodes.length === 0) {
      rows.push([
        table.name,
        table.shape,
        String(table.capacity),
        '',
        '(Unassigned Table)',
        ''
      ]);
    } else {
      for (const guest of table.invitationCodes) {
        rows.push([
          table.name,
          table.shape,
          String(table.capacity),
          guest.seatNumber ? String(guest.seatNumber) : '',
          guest.guestName,
          guest.code
        ]);
      }
    }
  }

  for (const guest of unassignedGuests) {
    rows.push([
      'Unassigned',
      '',
      '',
      '',
      guest.guestName,
      guest.code
    ]);
  }

  const csvString = rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');

  return new NextResponse(csvString, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="seating-roster-${new Date().toISOString().split('T')[0]}.csv"`,
    },
  });
});
